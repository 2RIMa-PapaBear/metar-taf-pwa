/* ================================================================
 * FLIGHT WINDOW — Créneau de vol jour VFR & alerte nuit
 * ================================================================
 *
 * CONTEXTE RÉGLEMENTAIRE (France / EASA)
 * ---------------------------------------
 * En France, le VFR de jour s'exerce entre les "heures aéronautiques"
 * définies comme : du lever du soleil -30 min au coucher du soleil
 * +30 min (Crépuscules civils). Hors de cette fenêtre, le vol VFR
 * de jour n'est pas autorisé (réservé au VFR de nuit, très encadré :
 * terrains habilités, qualification spécifique).
 *
 * FONCTIONNALITÉ
 * --------------
 * Ce module affiche une bannière dynamique qui indique au pilote :
 *  - Les heures de lever / coucher civil (UTC) du terrain affiché.
 *  - L'état actuel : FENÊTRE OUVERTE / PAS ENCORE / NUIT AÉRONAUTIQUE.
 *  - Le temps restant avant la tombée de la nuit (compte à rebours).
 *  - Un code couleur : vert (ouvert), ambre (bientôt fermée / pas ouverte),
 *    rouge (nuit — vol VFR de jour interdit).
 *
 * La bannière se met à jour toutes les minutes en live.
 * ================================================================ */

import { state, I18N, memoGet } from './core.js';
import { getAirportByICAO } from './ui-module.js';

let _updateInterval = null;
let _currentIcao = null;

/**
 * Affiche (ou masque) la bannière du créneau de vol jour.
 * À appeler après chaque chargement de météo, avec le code OACI du terrain.
 * @param {string|null} icao Code OACI du terrain affiché (null pour masquer).
 */
export function showFlightWindow(icao) {
    const container = document.getElementById('flight-window-banner');
    if (!container) return;

    _currentIcao = icao;

    // Pas de terrain ou SunCalc indisponible : on masque.
    if (!icao || typeof SunCalc === 'undefined') {
        container.style.display = 'none';
        stopLiveUpdate();
        return;
    }

    const apt = getAirportByICAO(icao);
    const memo = memoGet(icao);
    const lat = memo?.lat ?? apt?.lat ?? null;
    const lon = memo?.lon ?? apt?.lon ?? null;

    // Coordonnées indisponibles : on masque.
    if (lat == null || lon == null) {
        container.style.display = 'none';
        stopLiveUpdate();
        return;
    }

    render(lat, lon);
    startLiveUpdate(lat, lon);
}

/**
 * Masque la bannière (appelé quand on efface les données).
 */
export function hideFlightWindow() {
    const container = document.getElementById('flight-window-banner');
    if (container) container.style.display = 'none';
    stopLiveUpdate();
    _currentIcao = null;
}

/**
 * Calcule l'état de la fenêtre de vol jour pour une position et une date.
 * @param {number} lat
 * @param {number} lon
 * @param {Date} now Date de référence (défaut : maintenant).
 * @returns {Object|null} { sunrise, sunset, aeroStart, aeroEnd, status, minutesLeft }
 */
export function computeFlightWindow(lat, lon, now = new Date()) {
    if (typeof SunCalc === 'undefined' || lat == null || lon == null) return null;

    const times = SunCalc.getTimes(now, lat, lon);
    if (!times.sunrise || !times.sunset || isNaN(times.sunrise.getTime())) return null;

    // Heures aéronautiques : lever -30min / coucher +30min.
    const aeroStart = new Date(times.sunrise.getTime() - 30 * 60000);
    const aeroEnd = new Date(times.sunset.getTime() + 30 * 60000);

    let status;
    let minutesLeft = null;

    if (now < aeroStart) {
        status = 'before';
        minutesLeft = Math.round((aeroStart - now) / 60000);
    } else if (now > aeroEnd) {
        status = 'night';
    } else {
        status = 'open';
        minutesLeft = Math.round((aeroEnd - now) / 60000);
    }

    // Alerte "fenêtre se ferme bientôt" : moins de 30 min restantes.
    if (status === 'open' && minutesLeft !== null && minutesLeft <= 30) {
        status = 'closing';
    }

    return { sunrise: times.sunrise, sunset: times.sunset, aeroStart, aeroEnd, status, minutesLeft };
}

/**
 * Génère le HTML de la bannière.
 */
function render(lat, lon) {
    const container = document.getElementById('flight-window-banner');
    if (!container) return;

    const isFr = state.lang === 'fr';
    const w = computeFlightWindow(lat, lon);

    if (!w) {
        container.style.display = 'none';
        return;
    }

    const fmt = (d) => {
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} Z`;
    };

    // Configuration couleur/label selon le statut.
    const configs = {
        open: {
            color: '#10B981',       // vert
            bg: 'rgba(16, 185, 129, 0.12)',
            icon: 'sun',
            label: isFr ? 'FENÊTRE DE VOL OUVERTE' : 'FLIGHT WINDOW OPEN',
            detail: _formatRemaining(w.minutesLeft, isFr, false),
        },
        closing: {
            color: '#F59E0B',       // ambre
            bg: 'rgba(245, 158, 11, 0.12)',
            icon: 'alert-triangle',
            label: isFr ? 'FIN DE JOURNÉE PROCHE' : 'DAYLIGHT ENDING SOON',
            detail: _formatRemaining(w.minutesLeft, isFr, true),
        },
        before: {
            color: '#F59E0B',       // ambre
            bg: 'rgba(245, 158, 11, 0.12)',
            icon: 'sunrise',
            label: isFr ? "PAS ENCORE EN HEURES DE JOUR" : 'NOT YET IN DAYLIGHT',
            detail: isFr ? `Ouverture dans ${_mmss(w.minutesLeft)}` : `Opens in ${_mmss(w.minutesLeft)}`,
        },
        night: {
            color: '#EF4444',       // rouge
            bg: 'rgba(239, 68, 68, 0.12)',
            icon: 'moon',
            label: isFr ? 'NUIT AÉRONAUTIQUE — VFR DE JOUR INTERDIT' : 'AERONAUTICAL NIGHT — DAY VFR PROHIBITED',
            detail: isFr ? 'Le prochain lever civil est demain matin.' : 'Next civil sunrise is tomorrow morning.',
        },
    };

    const cfg = configs[w.status] || configs.open;

    const srLabel = isFr ? 'Lever civil' : 'Civil sunrise';
    const ssLabel = isFr ? 'Coucher civil' : 'Civil sunset';
    const aeroLabel = isFr ? 'Heures aéro' : 'Aero hours';

    container.innerHTML = `
        <div class="flight-window-content" style="display:flex; align-items:center; gap:14px; flex-wrap:wrap;">
            <div class="flight-window-status" style="display:flex; align-items:center; gap:10px; min-width:0;">
                <div class="flight-window-icon" style="width:42px; height:42px; border-radius:50%; background:${cfg.bg}; border:2px solid ${cfg.color}; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                    <i data-lucide="${cfg.icon}" style="width:22px; height:22px; color:${cfg.color};"></i>
                </div>
                <div style="min-width:0;">
                    <div style="font-weight:800; font-size:13px; color:${cfg.color}; letter-spacing:0.5px; white-space:nowrap;">${cfg.label}</div>
                    <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">${cfg.detail}</div>
                </div>
            </div>
            <div class="flight-window-times">
                <div style="text-align:center;">
                    <div style="color:var(--text-muted); text-transform:uppercase; font-size:9px; letter-spacing:1px; margin-bottom:2px;">${srLabel}</div>
                    <div style="font-family:'DM Mono', monospace; font-weight:500; color:var(--text-color); font-size:14px;">${fmt(w.sunrise)}</div>
                </div>
                <div style="text-align:center;">
                    <div style="color:var(--text-muted); text-transform:uppercase; font-size:9px; letter-spacing:1px; margin-bottom:2px;">${ssLabel}</div>
                    <div style="font-family:'DM Mono', monospace; font-weight:500; color:var(--text-color); font-size:14px;">${fmt(w.sunset)}</div>
                </div>
                <div style="text-align:center;">
                    <div style="color:var(--text-muted); text-transform:uppercase; font-size:9px; letter-spacing:1px; margin-bottom:2px;">${aeroLabel}</div>
                    <div class="fw-aero"><span>${fmt(w.aeroStart)}</span><i>·</i><span>${fmt(w.aeroEnd)}</span></div>
                </div>
            </div>
        </div>
    `;
    container.style.background = cfg.bg;
    container.style.borderColor = cfg.color;
    container.style.display = 'block';
    if (window.lucide) window.lucide.createIcons({ root: container });
}

/**
 * Formate le temps restant avant la tombée de la nuit.
 */
function _formatRemaining(minutes, isFr, urgent) {
    if (minutes === null) return '';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const timeStr = `${h}h${String(m).padStart(2, '0')}`;
    if (urgent) {
        return isFr ? `⚠ Plus que ${timeStr} avant la nuit — prévoyez votre retour !` : `⚠ Only ${timeStr} before night — plan your return!`;
    }
    return isFr ? `${timeStr} restantes avant la nuit` : `${timeStr} before nightfall`;
}

/**
 * Formate un nombre de minutes en "XhYY" ou "YYmin".
 */
function _mmss(minutes) {
    if (minutes === null) return '--';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h > 0) return `${h}h${String(m).padStart(2, '0')}`;
    return `${m} min`;
}

/**
 * Démarre la mise à jour live (toutes les minutes).
 */
function startLiveUpdate(lat, lon) {
    stopLiveUpdate();
    _updateInterval = setInterval(() => {
        // Ne met à jour que si on est toujours sur le même terrain.
        const memo = _currentIcao ? memoGet(_currentIcao) : null;
        render(lat, lon);
    }, 60000);
}

/**
 * Arrête la mise à jour live.
 */
function stopLiveUpdate() {
    if (_updateInterval) {
        clearInterval(_updateInterval);
        _updateInterval = null;
    }
}
