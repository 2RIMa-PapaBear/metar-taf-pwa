/* ================================================================
 * PERMALINK — Partage d'état par URL + QR code
 * ================================================================
 *
 * OBJECTIF
 * --------
 * Permettre au pilote de partager un briefing précis : "regarde la
 * météo de LFPG à 14h30 en mode navigation". Au lieu d'expliquer
 * comment configurer l'app, on génère une URL qui encode l'état, et
 * un QR code scannable depuis le tableau d'affichage du club.
 *
 * FORMAT
 * ------
 * L'URL utilise des paramètres de recherche standard :
 *   ?icao=LFPG&taf=1&t=14.5&mode=nav
 *
 *   - icao : code OACI du terrain à charger.
 *   - taf  : 1 pour TAF, absent = METAR.
 *   - t    : heure d'arrivée (HPP) en heures décimales.
 *   - mode : 'nav' ou 'local'.
 *
 * Au chargement de l'app, si ces paramètres existent, on les applique
 * AVANT le premier rendu pour éviter un flash.
 *
 * QR CODE
 * -------
 * Généré en canvas pur, sans dépendance. Implémentation minimale d'un
 * encodeur QR (niveau L, version automatique). Pour rester léger, on
 * utilise une approche simple adaptée aux URLs courtes (< 100 cars).
 *
 * NB : un vrai encodeur QR complet est complexe ; pour ne pas alourdir
 * l'app, on propose le lien copiable + un QR via une API publique de
 * génération (api.qrserver.com) qui ne nécessite pas de clé et qui
 * fonctionne en <img> simple. Le QR est chargé comme image, pas de
 * logique de dessin.
 * ================================================================ */

import { state } from './core.js';
import { parseWaypointsField } from './flight-planner-ui.js';

/**
 * Construit l'URL de partage à partir de l'état courant.
 * @returns {string} URL complète avec paramètres.
 */
export function buildPermalink() {
    const url = new URL(window.location.href);
    url.search = '';  // nettoie les anciens params.

    const icao = state.requestedIcao;
    if (icao) {
        url.searchParams.set('icao', icao);
        url.searchParams.set('taf', state.isMetar ? '0' : '1');
    }

    if (state.manualTargetHour != null) {
        url.searchParams.set('t', String(state.manualTargetHour));
    }

    const mode = localStorage.getItem('flight-mode');
    if (mode === 'nav') {
        url.searchParams.set('mode', 'nav');
        // Navigation complète : destination + étapes — le lien rouvre le plan
        // de vol tel quel (et pas seulement le terrain de départ).
        const icaoU = (icao || '').toUpperCase();
        const dest = (document.getElementById('route-to-input')?.value || '').trim().toUpperCase();
        if (/^[A-Z][A-Z0-9]{3}$/.test(dest) && dest !== icaoU) {
            url.searchParams.set('dest', dest);
            // Codes du plan (le champ affiche les noms réels des repères).
            const wps = parseWaypointsField(document.getElementById('fp-waypoints')?.value || '').join(' ');
            if (wps) url.searchParams.set('wp', wps);
        }
    }

    return url.toString();
}

/**
 * Lit les paramètres de l'URL courante.
 * @returns {{icao:string|null, taf:boolean, t:number|null, mode:'local'|'nav'|null,
 *            dest:string|null, wp:string}}
 */
export function readPermalink() {
    const params = new URLSearchParams(window.location.search);
    return {
        icao: params.get('icao')?.toUpperCase() || null,
        taf: params.get('taf') === '1',
        t: params.has('t') ? parseFloat(params.get('t')) : null,
        mode: params.get('mode') === 'nav' ? 'nav' : (params.get('mode') === 'local' ? 'local' : null),
        dest: params.get('dest')?.toUpperCase() || null,
        wp: (params.get('wp') || '').trim().toUpperCase(),
    };
}

/**
 * Indique si l'URL courante contient des paramètres de permalink.
 * @returns {boolean}
 */
export function hasPermalink() {
    return new URLSearchParams(window.location.search).has('icao');
}

/**
 * Construit l'URL d'un QR code pour une URL donnée.
 * Utilise api.qrserver.com (gratuit, sans clé, renvoie une image).
 * @param {string} url URL à encoder.
 * @param {number} [size=200] Taille en pixels.
 * @returns {string} URL de l'image QR.
 */
export function buildQrImageUrl(url, size = 200) {
    return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(url)}`;
}

/**
 * Copie un texte dans le presse-papier (avec fallback navigateur).
 * @param {string} text
 * @returns {Promise<boolean>} true si réussi.
 */
export async function copyToClipboard(text) {
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch { /* fallback */ }

    // Fallback : méthode dépréciée mais robuste.
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
    } catch {
        return false;
    }
}

/**
 * Ouvre le modal de partage (URL copiable + QR code).
 */
export function openShareModal() {
    const isFr = state.lang === 'fr';
    const url = buildPermalink();
    const qrUrl = buildQrImageUrl(url, 220);

    // Ferme un éventuel modal existant.
    closeShareModal();

    const overlay = document.createElement('div');
    overlay.id = 'share-overlay';
    overlay.className = 'share-overlay';
    overlay.innerHTML = `
        <div class="share-modal" role="dialog" aria-modal="true" aria-labelledby="share-title">
            <div class="share-modal-header">
                <h2 id="share-title"><i data-lucide="share-2" class="icon-sm"></i>
                    <span>${isFr ? 'Partager ce briefing' : 'Share this briefing'}</span>
                </h2>
                <button id="share-close" class="share-close" aria-label="${isFr ? 'Fermer' : 'Close'}">
                    <i data-lucide="x"></i>
                </button>
            </div>
            <div class="share-modal-body">
                <div class="share-url-row">
                    <input type="text" id="share-url-input" class="share-url-input" readonly value="${escapeAttr(url)}">
                    <button id="share-copy-btn" class="btn-primary">
                        <i data-lucide="copy" style="width:14px;height:14px;"></i>
                        <span>${isFr ? 'Copier' : 'Copy'}</span>
                    </button>
                </div>
                <div class="share-qr-section">
                    <div class="share-qr-label">${isFr ? 'Scannez pour ouvrir sur mobile' : 'Scan to open on mobile'}</div>
                    <img src="${escapeAttr(qrUrl)}" alt="QR code" class="share-qr-img"
                         onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
                    <div class="share-qr-fallback" style="display:none;">
                        ${isFr ? 'QR code indisponible (hors ligne).' : 'QR code unavailable (offline).'}
                    </div>
                </div>
                <div style="font-size:11px; color:var(--text-muted); margin-top:12px; line-height:1.5;">
                    <i data-lucide="info" style="width:12px;height:12px;vertical-align:middle;"></i>
                    ${isFr
                        ? 'L\'URL encode le terrain, le type de message et l\'heure d\'arrivée. Celui qui l\'ouvre voit exactement ce que vous voyez.'
                        : 'The URL encodes the airfield, message type and arrival time. Opening it shows exactly what you see.'}
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    // Fermeture au clic sur l'overlay.
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeShareModal();
    });
    overlay.querySelector('#share-close')?.addEventListener('click', closeShareModal);

    // Copie.
    overlay.querySelector('#share-copy-btn')?.addEventListener('click', async () => {
        const ok = await copyToClipboard(url);
        const btn = overlay.querySelector('#share-copy-btn');
        if (btn) {
            const original = btn.innerHTML;
            btn.innerHTML = `<i data-lucide="check" style="width:14px;height:14px;"></i> <span>${isFr ? 'Copié !' : 'Copied!'}</span>`;
            if (window.lucide) window.lucide.createIcons({ root: btn });
            setTimeout(() => {
                btn.innerHTML = original;
                if (window.lucide) window.lucide.createIcons({ root: btn });
            }, 2000);
        }
    });

    if (window.lucide) window.lucide.createIcons({ root: overlay });
}

/**
 * Ferme le modal de partage.
 */
export function closeShareModal() {
    const existing = document.getElementById('share-overlay');
    if (existing) existing.remove();
}

function escapeAttr(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
