/* ================================================================
 * VAC VIEWER — carte VAC officielle du terrain (PDF SIA) dans l'app
 * ================================================================
 *
 * Les cartes d'aérodrome de l'eAIP SIA (AD_2_<ICAO>_ADC_01.pdf) sont
 * publiées à URL directe, par cycle AIRAC — ~143 terrains France (ceux
 * ayant une fiche AD-2). Le SIA n'envoie pas d'en-têtes CORS : le PDF
 * passe par le relais Cloudflare (allowlist stricte Cartes/*.pdf).
 *
 * Consultation HORS LIGNE : chaque carte téléchargée est mise en cache
 * IndexedDB (clé = OACI, avec son cycle) — ouverte une fois en réseau,
 * relisible au club sans connexion. Changement de cycle AIRAC → la
 * carte est automatiquement re-téléchargée.
 * pdfjs (vendor) est chargé À LA DEMANDE au premier affichage.
 * ================================================================ */

import { state } from './core.js';
import { config } from './config.js';
import { getSiaAirac } from './freq-sia.js';

const MOIS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** URL officielle de la carte ADC (VAC) d'un terrain pour le cycle donné.
 * « 2026-08-06 » → …/eAIP_06_AUG_2026/FRANCE/AIRAC-2026-08-06/… */
export function vacUrl(icao, airac = getSiaAirac()) {
    const code = String(icao || '').toUpperCase();
    if (!airac || !/^\d{4}-\d{2}-\d{2}$/.test(airac) || !/^[A-Z][A-Z0-9]{3}$/.test(code)) return null;
    const [y, m, d] = airac.split('-');
    const dossier = `eAIP_${d}_${MOIS[+m - 1]}_${y}`;
    return `https://www.sia.aviation-civile.gouv.fr/media/dvd/${dossier}/FRANCE/AIRAC-${airac}/html/eAIP/Cartes/${code}/AD_2_${code}_ADC_01.pdf`;
}

// ---- Cache IndexedDB (une carte ≈ 40-300 Ko, cycle inclus) ------------------

const IDB_NAME = 'vac-cache';
const IDB_STORE = 'vac';

function _idbOpen() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
async function _idbGet(key) {
    try {
        const db = await _idbOpen();
        return await new Promise((resolve, reject) => {
            const r = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(key);
            r.onsuccess = () => resolve(r.result || null);
            r.onerror = () => reject(r.error);
        });
    } catch { return null; }
}
async function _idbPut(key, value) {
    try {
        const db = await _idbOpen();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            tx.objectStore(IDB_STORE).put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch { /* quota : la carte ne sera simplement pas hors ligne */ }
}

/** Récupère la carte du terrain : cache IndexedDB (cycle courant) sinon
 * relais. Retourne { blob, airac, offline } ou null (indisponible). */
export async function fetchVac(icao) {
    const code = String(icao || '').toUpperCase();
    const airac = getSiaAirac();
    const url = vacUrl(code, airac);
    if (!url) return null;

    const cached = await _idbGet(code);
    if (cached?.airac === airac && cached?.blob instanceof Blob) {
        return { blob: cached.blob, airac, offline: true };
    }

    if (config.PROXY_URL) {
        try {
            const res = await fetch(`${config.PROXY_URL}?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(25000) });
            if (res.ok) {
                const buf = await res.arrayBuffer();
                if (buf.byteLength > 500 && buf.byteLength < 8 * 1024 * 1024) {
                    const blob = new Blob([buf], { type: 'application/pdf' });
                    _idbPut(code, { airac, blob, ts: Date.now() });
                    return { blob, airac, offline: false };
                }
            }
        } catch { /* réseau : repli cache périmé puis ouverture directe */ }
    }

    // Réseau indisponible mais carte d'un cycle précédent : elle vaut mieux
    // que rien (badge « ancien cycle »).
    if (cached?.blob instanceof Blob) return { blob: cached.blob, airac: cached.airac, offline: true, stale: true };
    return null;
}

// ---- pdfjs chargé à la demande ----------------------------------------------

let _pdfjsPromise = null;
function _loadPdfjs() {
    _pdfjsPromise ??= new Promise((resolve, reject) => {
        if (window.pdfjsLib) return resolve(window.pdfjsLib);
        const s = document.createElement('script');
        s.src = 'vendor/pdfjs-3.11.174.min.js';
        s.onload = () => {
            const lib = window.pdfjsLib;
            if (!lib) return reject(new Error('pdfjsLib absent'));
            lib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs-worker-3.11.174.min.js';
            resolve(lib);
        };
        s.onerror = () => reject(new Error('pdfjs non chargé'));
        document.head.appendChild(s);
    });
    return _pdfjsPromise;
}

// ---- Visionneuse plein cadre -------------------------------------------------

let _ui = null;   // { overlay, canvas, pdf, page, scale, container }

/** Ouvre la visionneuse VAC du terrain (bouton fiche terrain). */
export async function openVac(icao) {
    const code = String(icao || '').toUpperCase();
    const isFr = state.lang === 'fr';
    const url = vacUrl(code);

    let data = null;
    try { data = await fetchVac(code); } catch { data = null; }
    if (!data) {
        // Aucune carte (réseau KO sans cache) : ouverture directe du PDF
        // officiel dans un onglet — dernier recours toujours utile.
        if (url) window.open(url, '_blank', 'noopener');
        return false;
    }

    let lib;
    try { lib = await _loadPdfjs(); } catch { if (url) window.open(url, '_blank', 'noopener'); return false; }
    const pdf = await lib.getDocument({ data: await data.blob.arrayBuffer() }).promise;
    _buildOverlay(code, data, isFr);
    await _render(pdf);
    return true;
}

function _buildOverlay(code, data, isFr) {
    _closeVac();
    const ov = document.createElement('div');
    ov.id = 'vac-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:4000;background:var(--bg-color,#020617);display:flex;flex-direction:column;';
    const badge = data.stale
        ? (isFr ? `hors ligne · cycle ${data.airac}` : `offline · cycle ${data.airac}`)
        : (isFr ? (data.offline ? 'hors ligne' : 'cache mis à jour') : (data.offline ? 'offline' : 'cached'));
    ov.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--panel-bg,#0F172A);border-bottom:1px solid var(--border-color,rgba(255,255,255,.15));flex:0 0 auto;">
            <i data-lucide="map" style="width:16px;height:16px;color:var(--primary,#38BDF8);"></i>
            <span style="font-weight:700;font-size:14px;color:var(--text-color,#F8FAFC);">${code}</span>
            <span style="font-size:11px;color:var(--text-muted,#94A3B8);">${isFr ? 'Carte VAC officielle · SIA eAIP' : 'Official VAC · SIA eAIP'}</span>
            <span title="${isFr ? 'carte enregistrée sur cet appareil' : 'stored on this device'}" style="font-size:10px;font-weight:700;color:${data.offline ? '#2DD4BF' : 'var(--text-muted,#94A3B8)'};border:1px solid var(--border-color,rgba(255,255,255,.15));border-radius:4px;padding:2px 7px;">${badge}</span>
            <span style="flex:1;"></span>
            <button data-vac="out" title="${isFr ? 'Ouvrir le PDF original' : 'Open original PDF'}" style="background:none;border:1px solid var(--border-color,rgba(255,255,255,.15));border-radius:6px;color:var(--text-muted,#94A3B8);padding:5px 8px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:5px;"><i data-lucide="external-link" style="width:13px;height:13px;"></i>PDF</button>
            <button data-vac="minus" title="${isFr ? 'Réduire' : 'Zoom out'}" style="background:none;border:1px solid var(--border-color,rgba(255,255,255,.15));border-radius:6px;color:var(--text-color,#F8FAFC);width:28px;height:28px;cursor:pointer;font-size:15px;font-weight:700;">−</button>
            <span data-vac="pct" style="font-family:'DM Mono',monospace;font-size:11px;color:var(--text-muted,#94A3B8);min-width:42px;text-align:center;">100%</span>
            <button data-vac="plus" title="${isFr ? 'Agrandir' : 'Zoom in'}" style="background:none;border:1px solid var(--border-color,rgba(255,255,255,.15));border-radius:6px;color:var(--text-color,#F8FAFC);width:28px;height:28px;cursor:pointer;font-size:15px;font-weight:700;">+</button>
            <button data-vac="close" title="${isFr ? 'Fermer (Échap)' : 'Close (Esc)'}" style="background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.35);border-radius:6px;color:#EF4444;width:28px;height:28px;cursor:pointer;font-size:13px;font-weight:700;">✕</button>
        </div>
        <div data-vac="container" style="flex:1;overflow:auto;display:flex;justify-content:center;align-items:flex-start;padding:14px;">
            <canvas data-vac="canvas"></canvas>
        </div>`;
    document.body.appendChild(ov);
    if (window.lucide) window.lucide.createIcons({ root: ov });
    ov.querySelector('[data-vac="close"]').addEventListener('click', _closeVac);
    ov.querySelector('[data-vac="out"]').addEventListener('click', () => {
        const u = vacUrl(code);
        if (u) window.open(u, '_blank', 'noopener');
    });
    ov.querySelector('[data-vac="plus"]').addEventListener('click', () => _zoom(1.3));
    ov.querySelector('[data-vac="minus"]').addEventListener('click', () => _zoom(1 / 1.3));
    // Molette = zoom (la carte est un document, pas une page à défiler).
    ov.querySelector('[data-vac="container"]').addEventListener('wheel', (e) => {
        if (!e.ctrlKey) { e.preventDefault(); _zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15); }
    }, { passive: false });
    const onKey = (e) => { if (e.key === 'Escape') { _closeVac(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
    _ui = { overlay: ov, canvas: ov.querySelector('[data-vac="canvas"]'), container: ov.querySelector('[data-vac="container"]'), pct: ov.querySelector('[data-vac="pct"]'), pdf: null, page: null, scale: null, baseScale: null };
}

async function _render(pdf) {
    if (!_ui) return;
    _ui.pdf = pdf;
    _ui.page = await pdf.getPage(1);
    await _zoomTo(null);   // ajustement initial : largeur
}

function _zoom(f) {
    if (!_ui?.scale) return;
    _zoomTo(_ui.scale * f);
}   // flottant volontaire : le rendu continue en tâche de fond

async function _zoomTo(scale) {
    if (!_ui?.page) return;
    const dpr = window.devicePixelRatio || 1;
    const avail = _ui.container.clientWidth - 28;
    const viewport1 = _ui.page.getViewport({ scale: 1 });
    if (scale == null) scale = avail / viewport1.width;   // ajusté à la largeur
    scale = Math.min(8, Math.max(0.3, scale));
    _ui.scale = scale;
    const viewport = _ui.page.getViewport({ scale });
    const canvas = _ui.canvas;
    canvas.width = Math.round(viewport.width * dpr);
    canvas.height = Math.round(viewport.height * dpr);
    canvas.style.width = Math.round(viewport.width) + 'px';
    canvas.style.height = Math.round(viewport.height) + 'px';
    _ui.pct.textContent = Math.round((scale / (avail / viewport1.width)) * 100) + '%';
    // pdfjs interdit deux render() simultanés sur un même canvas : le
    // précédent est annulé, et le rendu est ATTENDU (les tests comme les
    // zooms rapides lisent le canvas avant la fin sinon).
    const ctx = canvas.getContext('2d');
    _ui.renderTask?.cancel();
    _ui.renderTask = _ui.page.render({ canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
    await _ui.renderTask.promise.catch(() => {});
}

export function _closeVac() {
    if (_ui?.overlay?.parentNode) _ui.overlay.parentNode.removeChild(_ui.overlay);
    _ui = null;
}
