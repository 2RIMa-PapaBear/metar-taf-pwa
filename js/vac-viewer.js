/* ================================================================
 * VAC VIEWER — carte « Atterrissage à vue » (Atlas-VAC officiel SIA)
 * ================================================================
 *
 * La carte VAC du terrain vient de l'Atlas-VAC du ZIP eAIP complet du
 * SIA (extrait vers data/vac-sia/<ICAO>.pdf à chaque cycle AIRAC par
 * scripts/fetch-vac-atlas.mjs — 421 terrains, y compris ceux sans fiche
 * eAIP comme LFOM). Fichier local du site : aucun relais nécessaire.
 *
 * Consultation HORS LIGNE : la carte ouverte est mise en cache IndexedDB
 * (clé OACI+cycle) — relisible au club sans connexion ; à chaque nouvel
 * AIRAC elle se re-télécharge. pdfjs (vendor) est chargé À LA DEMANDE au
 * premier affichage. Les VAC comportent souvent 2 pages (recto/verso) :
 * navigation ‹ › quand c'est le cas.
 * ================================================================ */

import { state } from './core.js';

// ---- Index des cartes disponibles (data/vac-sia/index.json, ~5 Ko) ---------

let _indexPromise = null;
function loadVacIndex() {
    _indexPromise ??= (async () => {
        try {
            const r = await fetch('data/vac-sia/index.json', { cache: 'no-cache' });
            if (!r.ok) return null;
            const d = await r.json();
            return (d && Array.isArray(d.icacos)) ? d : null;
        } catch { return null; }
    })();
    return _indexPromise;
}

/** Ce terrain a-t-il une carte VAC publiée (Atlas-VAC) ? */
export function hasVac(icao) {
    const code = String(icao || '').toUpperCase();
    return loadVacIndex().then(idx => !!(idx?.icacos?.includes(code)));
}

/** URL de la carte VAC locale (versionnée par cycle pour les caches). */
export async function vacUrl(icao) {
    const code = String(icao || '').toUpperCase();
    const idx = await loadVacIndex();
    const airac = idx?.airac || '';
    return `data/vac-sia/${code}.pdf${airac ? `?v=${airac}` : ''}`;
}

// ---- Cache IndexedDB (une carte ≈ 300 Ko, cycle inclus) --------------------

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

/** Carte VAC du terrain : cache IndexedDB (cycle courant) sinon fichier
 * local du site. Retourne { blob, airac, offline } ou null. */
export async function fetchVac(icao) {
    const code = String(icao || '').toUpperCase();
    const idx = await loadVacIndex();
    const airac = idx?.airac || null;
    if (!idx?.icacos?.includes(code)) return null;
    const cle = `${code}:VAC:${airac}`;

    const cached = await _idbGet(cle);
    if (cached?.blob instanceof Blob) {
        return { blob: cached.blob, airac, offline: true };
    }
    try {
        const res = await fetch(`data/vac-sia/${code}.pdf${airac ? `?v=${airac}` : ''}`, { signal: AbortSignal.timeout(20000) });
        if (res.ok) {
            const blob = await res.blob();
            if (blob.size > 500) {
                _idbPut(cle, { airac, blob, ts: Date.now() });
                return { blob, airac, offline: false };
            }
        }
    } catch { /* réseau : repli cache périmé puis portail */ }

    // Réseau indisponible mais carte d'un cycle précédent : mieux que rien.
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

let _ui = null;   // { overlay, canvas, container, pct, badge, icao, lib, pdf, page, scale, renderTask, pageNo, numPages }

/** Ouvre la visionneuse VAC du terrain (bouton fiche terrain). */
export async function openVac(icao) {
    const code = String(icao || '').toUpperCase();
    const isFr = state.lang === 'fr';

    let data = null;
    try { data = await fetchVac(code); } catch { data = null; }
    if (!data) return false;

    const lib = await _loadPdfjs().catch(() => null);
    if (!lib) { window.open(await vacUrl(code), '_blank', 'noopener'); return false; }
    const pdf = await lib.getDocument({ data: await data.blob.arrayBuffer() }).promise;
    _buildOverlay(code, pdf.numPages, data, isFr);
    _ui.pdf = pdf;
    await _showPage(1);
    return true;
}

async function _showPage(n) {
    if (!_ui?.pdf) return;
    _ui.pageNo = Math.min(_ui.numPages, Math.max(1, n));
    _ui.page = await _ui.pdf.getPage(_ui.pageNo);
    if (_ui.pageLbl) _ui.pageLbl.textContent = `${_ui.pageNo}/${_ui.numPages}`;
    if (_ui.prev) { _ui.prev.disabled = _ui.pageNo <= 1; _ui.next.disabled = _ui.pageNo >= _ui.numPages; }
    await _zoomTo(null);   // ajustement largeur
}

function _buildOverlay(code, numPages, data, isFr) {
    _closeVac();
    const ov = document.createElement('div');
    ov.id = 'vac-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:4000;background:var(--bg-color,#020617);display:flex;flex-direction:column;';
    const badge = data.stale
        ? (isFr ? `hors ligne · cycle ${data.airac}` : `offline · cycle ${data.airac}`)
        : (isFr ? (data.offline ? 'hors ligne' : 'enregistrée') : (data.offline ? 'offline' : 'stored'));
    const btn = (id, t, h, extra = '') => `<button data-vac="${id}" title="${t}" style="background:none;border:1px solid var(--border-color,rgba(255,255,255,.15));border-radius:6px;color:var(--text-color,#F8FAFC);height:28px;cursor:pointer;font-size:13px;font-weight:700;${extra}">${h}</button>`;
    ov.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--panel-bg,#0F172A);border-bottom:1px solid var(--border-color,rgba(255,255,255,.15));flex:0 0 auto;flex-wrap:wrap;">
            <i data-lucide="map" style="width:15px;height:15px;color:var(--primary,#38BDF8);"></i>
            <span style="font-weight:700;font-size:13.5px;color:var(--text-color,#F8FAFC);">${code}</span>
            <span style="font-size:11px;color:var(--text-muted,#94A3B8);">${isFr ? 'Carte VAC · Atterrissage à vue · SIA' : 'VAC · Visual approach · SIA'}</span>
            <span data-vac="badge" title="${isFr ? 'carte enregistrée sur cet appareil' : 'stored on this device'}" style="font-size:10px;font-weight:700;color:${data.offline ? '#2DD4BF' : 'var(--text-muted,#94A3B8)'};border:1px solid var(--border-color,rgba(255,255,255,.15));border-radius:4px;padding:2px 7px;">${badge}</span>
            <span style="flex:1;"></span>
            ${btn('out', isFr ? 'Ouvrir le PDF original' : 'Open original PDF', `<i data-lucide="external-link" style="width:13px;height:13px;"></i>`, 'padding:0 9px;display:flex;align-items:center;')}
            ${btn('minus', isFr ? 'Réduire' : 'Zoom out', '−', 'width:28px;')}
            <span data-vac="pct" style="font-family:'DM Mono',monospace;font-size:11px;color:var(--text-muted,#94A3B8);min-width:42px;text-align:center;">100%</span>
            ${btn('plus', isFr ? 'Agrandir' : 'Zoom in', '+', 'width:28px;')}
            ${btn('close', isFr ? 'Fermer (Échap)' : 'Close (Esc)', '✕', 'width:28px;background:rgba(239,68,68,.12);border-color:rgba(239,68,68,.35);color:#EF4444;')}
        </div>
        <div style="display:flex;align-items:center;justify-content:center;gap:8px;padding:6px 12px;background:var(--panel-bg,#0F172A);border-bottom:1px solid var(--border-color,rgba(255,255,255,.15));flex:0 0 auto;">
            ${btn('prev', isFr ? 'Page précédente' : 'Previous page', '‹', 'width:26px;')}
            <span data-vac="pagelbl" style="font-family:'DM Mono',monospace;font-size:11px;color:var(--text-muted,#94A3B8);min-width:34px;text-align:center;">1/${numPages}</span>
            ${btn('next', isFr ? 'Page suivante' : 'Next page', '›', 'width:26px;')}
        </div>
        <div data-vac="container" style="flex:1;overflow:auto;display:flex;justify-content:center;align-items:flex-start;padding:14px;">
            <canvas data-vac="canvas"></canvas>
        </div>`;
    document.body.appendChild(ov);
    if (window.lucide) window.lucide.createIcons({ root: ov });
    _ui = {
        overlay: ov, icao: code,
        canvas: ov.querySelector('[data-vac="canvas"]'),
        container: ov.querySelector('[data-vac="container"]'),
        pct: ov.querySelector('[data-vac="pct"]'),
        badge: ov.querySelector('[data-vac="badge"]'),
        prev: ov.querySelector('[data-vac="prev"]'),
        next: ov.querySelector('[data-vac="next"]'),
        pageLbl: ov.querySelector('[data-vac="pagelbl"]'),
        numPages, pageNo: 1,
        pdf: null, page: null, scale: null, renderTask: null,
    };
    ov.querySelector('[data-vac="close"]').addEventListener('click', _closeVac);
    ov.querySelector('[data-vac="out"]').addEventListener('click', async () => {
        window.open(await vacUrl(code), '_blank', 'noopener');
    });
    ov.querySelector('[data-vac="plus"]').addEventListener('click', () => _zoom(1.3));
    ov.querySelector('[data-vac="minus"]').addEventListener('click', () => _zoom(1 / 1.3));
    _ui.prev?.addEventListener('click', () => _showPage(_ui.pageNo - 1));
    _ui.next?.addEventListener('click', () => _showPage(_ui.pageNo + 1));
    ov.querySelector('[data-vac="container"]').addEventListener('wheel', (e) => {
        if (!e.ctrlKey) { e.preventDefault(); _zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15); }
    }, { passive: false });
    const onKey = (e) => {
        if (e.key === 'Escape') { _closeVac(); document.removeEventListener('keydown', onKey); }
        if (_ui && e.key === 'ArrowLeft') _showPage(_ui.pageNo - 1);
        if (_ui && e.key === 'ArrowRight') _showPage(_ui.pageNo + 1);
    };
    document.addEventListener('keydown', onKey);
}

function _zoom(f) {
    if (!_ui?.scale) return;
    _zoomTo(_ui.scale * f);
}

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
