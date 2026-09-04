/* ================================================================
 * WATCHDOG — Surveillance active des terrains favoris
 * ================================================================
 *
 * OBJECTIF
 * --------
 * Tant que l'application est ouverte (onglet actif), un minuteur
 * vérifie périodiquement la météo des terrains favoris et alerte le
 * pilote si :
 *   - Un terrain passe en NO-GO (IFR/LIFR, vent trop fort...).
 *   - Un terrain jusqu'alors vert se dégrade (passe en CAUTION).
 *   - Un terrain était vert et devient rouge sur les minimas perso.
 *
 * Cette surveillance proactive évite au pilote de rafraîchir
 * manuellement chaque terrain pendant qu'il prépare autre chose.
 *
 * LIMITES (app 100% statique)
 * ---------------------------
 * Le vrai "push serveur → app fermée" nécessite un backend. En
 * statique, le maximum faisable est :
 *   - Une vérification périodique TANT QUE l'onglet est ouvert.
 *   - L'API Notification (si permission accordée) pour alerter même
 *     si l'onglet est en arrière-plan (mais pas fermé).
 *
 * C'est exactement ce que fait ce module.
 *
 * IMPLÉMENTATION
 * --------------
 * - Minuteur réglable (défaut 15 min, min 5 min).
 * - Recalcule la catégorie de vol de chaque favori.
 * - Compare avec l'état précédent pour ne pas spammer (n'alerte que
 *   sur les transitions : VFR→IFR, GO→NO-GO).
 * - Notification navigateur + badge visuel sur les favoris concernés.
 * ================================================================ */

import { state, fetchAvecRelais } from './core.js';

const LS_KEY = 'watchdog-settings';
const DEFAULT_INTERVAL_MIN = 15;
const MIN_INTERVAL_MIN = 5;

// État précédent des favoris (pour détecter les transitions).
let _lastStates = new Map();   // icao → 'GO' | 'CAUTION' | 'NO-GO'
let _timer = null;

/**
 * Lit les réglages du watchdog.
 * @returns {{enabled:boolean, intervalMin:number, notify:boolean}}
 */
export function getWatchdogSettings() {
    try {
        const raw = JSON.parse(localStorage.getItem(LS_KEY));
        return {
            enabled: raw?.enabled ?? false,
            intervalMin: Math.max(MIN_INTERVAL_MIN, raw?.intervalMin ?? DEFAULT_INTERVAL_MIN),
            notify: raw?.notify ?? false,
        };
    } catch {
        return { enabled: false, intervalMin: DEFAULT_INTERVAL_MIN, notify: false };
    }
}

/**
 * Sauvegarde les réglages.
 */
export function setWatchdogSettings(settings) {
    try {
        localStorage.setItem(LS_KEY, JSON.stringify({
            enabled: settings.enabled ?? false,
            intervalMin: Math.max(MIN_INTERVAL_MIN, settings.intervalMin ?? DEFAULT_INTERVAL_MIN),
            notify: settings.notify ?? false,
        }));
    } catch { /* quota */ }

    // Applique immédiatement.
    if (settings.enabled) startWatchdog();
    else stopWatchdog();
}

/**
 * Démarre la surveillance.
 */
export function startWatchdog() {
    stopWatchdog();
    const s = getWatchdogSettings();
    if (!s.enabled) return;

    // Premier check immédiat (pour initialiser l'état de référence).
    _check();

    // Puis répétition.
    _timer = setInterval(_check, s.intervalMin * 60 * 1000);
}

/**
 * Arrête la surveillance.
 */
export function stopWatchdog() {
    if (_timer) {
        clearInterval(_timer);
        _timer = null;
    }
}

/**
 * Vérifie l'état de tous les favoris et déclenche les alertes.
 */
async function _check() {
    const s = getWatchdogSettings();
    if (!s.enabled) return;

    let favs = [];
    try {
        favs = JSON.parse(localStorage.getItem('favorites')) || [];
    } catch { return; }
    if (favs.length === 0) return;

    try {
        const idsStr = favs.join(',');
        const url = `https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(idsStr)}&format=json`;
        const data = await fetchAvecRelais(url, 'json');
        if (!Array.isArray(data)) return;

        const metarByCode = {};
        data.forEach(m => {
            const code = (m.icaoId || m.stationId || '').toUpperCase();
            if (code) metarByCode[code] = m.rawOb || m.rawMetar || m.rawText || '';
        });

        const isFr = state.lang === 'fr';
        const alerts = [];

        for (const icao of favs) {
            const raw = metarByCode[icao.toUpperCase()];
            if (!raw) continue;

            const newState = _evaluateState(raw);
            const oldState = _lastStates.get(icao);

            // Détecte une DÉGRADATION (transition vers un état pire).
            if (oldState && _isWorse(newState, oldState)) {
                alerts.push({ icao, oldState, newState, raw });
            }
            _lastStates.set(icao, newState);

            // Met à jour l'olive météo sur le favori.
            _updateFavoriteBadge(icao, newState, isFr);
        }

        // Notifie si dégradations.
        if (alerts.length > 0 && s.notify) {
            _notify(alerts, isFr);
        }
    } catch (e) {
        console.warn('Watchdog check failed:', e.message);
    }
}

/**
 * Évalue l'état d'un terrain depuis son METAR.
 * @returns {'GO'|'CAUTION'|'NO-GO'}
 */
function _evaluateState(raw) {
    // Visi.
    const visiMatch = raw.match(/KT(?:\s+\d{3}V\d{3})?\s+(\d{4})\b/);
    const visiM = visiMatch ? (parseInt(visiMatch[1], 10) === 9999 ? 10000 : parseInt(visiMatch[1], 10)) : 10000;

    // Plafond.
    let ceilHund = 999;
    const cloudMatches = [...raw.matchAll(/\b(BKN|OVC)(\d{3})/g)];
    cloudMatches.forEach(m => {
        const alt = parseInt(m[2], 10);
        if (alt < ceilHund) ceilHund = alt;
    });
    const vvMatch = raw.match(/\bVV(\d{3})\b/);
    if (vvMatch) ceilHund = parseInt(vvMatch[1], 10);
    if (/CAVOK|NSC|SKC|NCD/.test(raw)) ceilHund = 999;

    // Catégorie.
    if (ceilHund < 5 || visiM < 1600) return 'NO-GO';
    if (ceilHund < 10 || visiM < 4800) return 'NO-GO';
    if (ceilHund <= 30 || visiM <= 8000) return 'CAUTION';
    return 'GO';
}

/**
 * Indique si newState est pire que oldState.
 */
function _isWorse(newState, oldState) {
    const rank = { 'GO': 0, 'CAUTION': 1, 'NO-GO': 2 };
    return rank[newState] > rank[oldState];
}

/**
 * Met à jour le voyant météo d'un favori dans la liste (UNE pastille par
 * ligne, posée DEVANT le code OACI dans un emplacement réservé). Voyant
 * COULEUR SANS TEXTE (consigne pilote) : vert = GO, orange = prudence,
 * rouge = NO-GO — le libellé complet reste en infobulle.
 */
function _updateFavoriteBadge(icao, weatherState, isFr = true) {
    const favList = document.getElementById('favorites-list');
    if (!favList) return;
    const item = favList.querySelector(`[data-icao="${icao.toUpperCase()}"]`);
    if (!item) return;

    const colors = { 'GO': '#10B981', 'CAUTION': '#F59E0B', 'NO-GO': '#EF4444' };
    let badge = item.querySelector('.fav-status-badge');
    if (!badge) {
        // Repli (DOM ancien ou tiers) : recrée le voyant devant le code OACI.
        badge = document.createElement('span');
        badge.className = 'fav-status-badge';
        const code = item.querySelector('.history-icao');
        if (code) code.parentElement.insertBefore(badge, code);
        else item.appendChild(badge);
    }
    badge.textContent = '';   // voyant couleur SANS texte
    badge.style.background = colors[weatherState] || 'transparent';
    badge.style.borderColor = colors[weatherState] || 'transparent';
    badge.title = isFr
        ? { 'GO': 'Météo favorable', 'CAUTION': 'Météo en dégradation — prudence', 'NO-GO': 'Météo défavorable — NO-GO' }[weatherState] || weatherState
        : { 'GO': 'Good weather', 'CAUTION': 'Degrading weather — caution', 'NO-GO': 'Unfavorable weather — NO-GO' }[weatherState] || weatherState;
    badge.setAttribute('aria-label', badge.title);
}

/**
 * Ré-applique les derniers états connus sur les olives des favoris — appelé
 * après un re-rendu de la liste (updateFavoritesUI recrée le DOM vide).
 */
export function applyFavoriteBadges() {
    const isFr = state.lang === 'fr';
    for (const [icao, st] of _lastStates) _updateFavoriteBadge(icao, st, isFr);
}

/**
 * Envoie une notification navigateur.
 */
function _notify(alerts, isFr) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    const titles = {
        'NO-GO': isFr ? 'NO-GO' : 'NO-GO',
        'CAUTION': isFr ? 'PRUDENCE' : 'CAUTION',
    };

    const body = alerts.map(a => `${a.icao} → ${titles[a.newState] || a.newState}`).join('\n');
    const title = isFr
        ? `${alerts.length} terrain(s) dégradé(s)`
        : `${alerts.length} airfield(s) degraded`;

    try {
        new Notification(title, { body, icon: 'icon.svg', tag: 'watchdog' });
    } catch { /* certaines implémentations requièrent un service worker */ }
}

/**
 * Demande la permission de notifications.
 * @returns {Promise<boolean>} true si accordée.
 */
export async function requestNotificationPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const result = await Notification.requestPermission();
    return result === 'granted';
}

/**
 * Initialise le watchdog au démarrage (si activé).
 */
export function initWatchdog() {
    const s = getWatchdogSettings();
    if (s.enabled) startWatchdog();
}

/**
 * Force un check immédiat (bouton "Vérifier maintenant").
 */
export function checkNow() {
    return _check();
}

export const WATCHDOG_DEFAULTS = { INTERVAL_MIN: DEFAULT_INTERVAL_MIN, MIN_INTERVAL_MIN };

// ----------------------------------------------------------------
// Modal de réglages
// ----------------------------------------------------------------

/**
 * Ouvre le panneau de réglages du watchdog.
 */
export function openWatchdogPanel() {
    const isFr = state.lang === 'fr';
    const s = getWatchdogSettings();

    // Ferme un éventuel modal existant.
    closeWatchdogPanel();

    const overlay = document.createElement('div');
    overlay.id = 'watchdog-overlay';
    overlay.className = 'watchdog-overlay';
    overlay.innerHTML = `
        <div class="watchdog-modal" role="dialog" aria-modal="true" aria-labelledby="wd-title">
            <div class="watchdog-modal-header">
                <h2 id="wd-title"><i data-lucide="bell" class="icon-sm"></i>
                    <span>${isFr ? 'Surveillance des favoris' : 'Favorites watchdog'}</span>
                </h2>
                <button id="wd-close" class="share-close" aria-label="${isFr ? 'Fermer' : 'Close'}">
                    <i data-lucide="x"></i>
                </button>
            </div>
            <div class="watchdog-modal-body">
                <div class="wd-setting">
                    <div class="wd-setting-label">
                        <span>${isFr ? 'Surveillance active' : 'Active monitoring'}</span>
                        <div class="wd-toggle ${s.enabled ? 'on' : ''}" id="wd-toggle-enabled" role="switch" aria-checked="${s.enabled}"></div>
                    </div>
                    <div class="wd-setting-hint">
                        ${isFr
                            ? 'Vérifie périodiquement la météo de vos terrains favoris et alerte en cas de dégradation.'
                            : 'Periodically checks your favorite airfields weather and alerts on degradation.'}
                    </div>
                </div>

                <div class="wd-setting">
                    <div class="wd-setting-label">
                        <span>${isFr ? 'Intervalle (minutes)' : 'Interval (minutes)'}</span>
                        <div class="wd-interval-row">
                            <input type="number" id="wd-interval" value="${s.intervalMin}" min="${MIN_INTERVAL_MIN}" max="60" step="5">
                        </div>
                    </div>
                    <div class="wd-setting-hint">
                        ${isFr ? `Minimum ${MIN_INTERVAL_MIN} min pour éviter de surcharger l'API.` : `Minimum ${MIN_INTERVAL_MIN} min to avoid API overload.`}
                    </div>
                </div>

                <div class="wd-setting">
                    <div class="wd-setting-label">
                        <span>${isFr ? 'Notifications navigateur' : 'Browser notifications'}</span>
                        <button id="wd-perm-btn" class="wd-perm-btn ${s.notify && Notification.permission === 'granted' ? 'granted' : ''}">
                            ${s.notify && Notification.permission === 'granted'
                                ? (isFr ? '✓ Accordées' : '✓ Granted')
                                : (isFr ? 'Activer' : 'Enable')}
                        </button>
                    </div>
                    <div class="wd-setting-hint">
                        ${isFr
                            ? 'Alerte même si l\'onglet est en arrière-plan (tant que l\'app reste ouverte).'
                            : 'Alerts even if the tab is in the background (as long as the app stays open).'}
                    </div>
                </div>

                <button id="wd-check-now" class="wd-check-btn">
                    <i data-lucide="refresh-cw" style="width:14px;height:14px;vertical-align:middle;margin-right:4px;"></i>
                    ${isFr ? 'Vérifier maintenant' : 'Check now'}
                </button>

                <div style="font-size:10px; color:var(--text-muted); line-height:1.5; margin-top:4px;">
                    <i data-lucide="info" style="width:11px;height:11px;vertical-align:middle;"></i>
                    ${isFr
                        ? 'Seuls les changements d\'état (ex: VFR → IFR) déclenchent une alerte pour éviter le spam.'
                        : 'Only state changes (e.g. VFR → IFR) trigger an alert to avoid spam.'}
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    if (window.lucide) window.lucide.createIcons({ root: overlay });

    // Fermeture.
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeWatchdogPanel();
    });
    overlay.querySelector('#wd-close')?.addEventListener('click', closeWatchdogPanel);

    // Toggle enabled.
    const toggle = overlay.querySelector('#wd-toggle-enabled');
    let enabled = s.enabled;
    let interval = s.intervalMin;
    let notify = s.notify;
    toggle?.addEventListener('click', () => {
        enabled = !enabled;
        toggle.classList.toggle('on', enabled);
        toggle.setAttribute('aria-checked', String(enabled));
        setWatchdogSettings({ enabled, intervalMin: interval, notify });
    });

    // Intervalle.
    const intervalInput = overlay.querySelector('#wd-interval');
    intervalInput?.addEventListener('change', () => {
        interval = Math.max(MIN_INTERVAL_MIN, parseInt(intervalInput.value, 10) || DEFAULT_INTERVAL_MIN);
        intervalInput.value = interval;
        setWatchdogSettings({ enabled, intervalMin: interval, notify });
    });

    // Permission notifications.
    const permBtn = overlay.querySelector('#wd-perm-btn');
    permBtn?.addEventListener('click', async () => {
        const granted = await requestNotificationPermission();
        notify = granted;
        setWatchdogSettings({ enabled, intervalMin: interval, notify });
        if (granted) {
            permBtn.classList.add('granted');
            permBtn.innerHTML = isFr ? '✓ Accordées' : '✓ Granted';
        }
    });

    // Check immédiat.
    // « Vérifier maintenant » : spinner actif PENDANT le check (demande
    // pilote — sans retour visuel, on ne sait pas si le clic a pris) :
    // icône rotative, bouton désactivé, puis bref « ✓ Vérifié ».
    const checkBtn = overlay.querySelector('#wd-check-now');
    checkBtn?.addEventListener('click', async () => {
        if (checkBtn.classList.contains('wd-checking')) return;   // déjà en cours
        const isFr = state.lang === 'fr';
        const idle = checkBtn.innerHTML;
        checkBtn.classList.add('wd-checking');
        checkBtn.disabled = true;
        checkBtn.innerHTML = `<i data-lucide="loader-2" style="width:14px;height:14px;vertical-align:middle;margin-right:4px;"></i>
            ${isFr ? 'Vérification…' : 'Checking…'}`;
        if (window.lucide) window.lucide.createIcons({ root: checkBtn });
        try {
            await checkNow();
        } finally {
            checkBtn.classList.remove('wd-checking');
            checkBtn.disabled = false;
            checkBtn.innerHTML = `<i data-lucide="check" style="width:14px;height:14px;vertical-align:middle;margin-right:4px;"></i>
                ${isFr ? '✓ Vérifié' : '✓ Checked'}`;
            if (window.lucide) window.lucide.createIcons({ root: checkBtn });
            setTimeout(() => {
                if (!checkBtn.classList.contains('wd-checking')) {
                    checkBtn.innerHTML = idle;
                    if (window.lucide) window.lucide.createIcons({ root: checkBtn });
                }
            }, 1600);
        }
    });
}

/**
 * Ferme le panneau de réglages.
 */
export function closeWatchdogPanel() {
    const existing = document.getElementById('watchdog-overlay');
    if (existing) existing.remove();
}
