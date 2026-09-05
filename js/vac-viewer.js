/* ================================================================
 * VAC VIEWER — cartes officielles du terrain (PDF SIA) dans l'app
 * ================================================================
 *
 * Les cartes de l'eAIP SIA (Cartes/<ICAO>/AD_2_<ICAO>_*.pdf) sont publiées
 * à URL directe, par cycle AIRAC — ~143 terrains France. Chaque terrain
 * publie plusieurs cartes : la visionneuse n'affiche que les familles
 * VFR (aérodrome ADC, insertion MIA, parking APDC, circulation au sol
 * GMC, environnement ENV) — SID/STAR/IAC (IFR) sont écartées.
 *
 * Le SIA n'envoie pas d'en-têtes CORS : le PDF passe par le relais
 * Cloudflare (allowlist stricte Cartes/*.pdf). Consultation HORS LIGNE :
 * chaque carte téléchargée est mise en cache IndexedDB (clé OACI+fichier,
 * cycle inclus) — ouverte une fois en réseau, relisible au club sans
 * connexion ; changement de cycle AIRAC → re-téléchargement automatique.
 * pdfjs (vendor) est chargé À LA DEMANDE au premier affichage.
 * ================================================================ */

import { state } from './core.js';
import { config } from './config.js';
import { getSiaAirac, getCharts, hasSiaEaip } from './freq-sia.js';

const MOIS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Famille d'une carte (segment entre l'OACI et le numéro) → étiquette VFR.
 * Les familles IFR (SID/STAR/IAC/DATA/COM/MVA/ARC/PATC…) retournent null. */
export function chartKind(file, isFr = true) {
    const fam = (String(file || '').match(/^AD_2_[A-Z0-9]{4}_([A-Z]+)_/)?.[1]);
    const L = {
        ADC: isFr ? 'Aérodrome' : 'Aerodrome',
        MIA: isFr ? 'Insertion' : 'Location',
        APDC: isFr ? 'Parking' : 'Parking',
        GMC: isFr ? 'Circulation au sol' : 'Ground movement',
        ENV: isFr ? 'Environnement' : 'Environment',
    };
    return L[fam] ? { fam, label: L[fam] } : null;
}

/** Numéro de la carte (dernier _NN du nom) pour « Insertion 2 »… */
export function chartNum(file) {
    const m = String(file || '').match(/_(\d{2})(?=[A-Z0-9_]*\.pdf$)/);
    return m ? +m[1] : null;
}

/** Cartes VFR du terrain, triées (aérodrome, insertions, parking, sol,
 * environnement) — repli ADC_01 seul si la liste officielle manque. */
export function vacCharts(icao, isFr = true) {
    const code = String(icao || '').toUpperCase();
    const files = getCharts(code) || (hasSiaEaip(code) ? [`AD_2_${code}_ADC_01.pdf`] : []);
    const ORDRE = { ADC: 0, MIA: 1, APDC: 2, GMC: 3, ENV: 4 };
    return files
        .map(f => {
            const k = chartKind(f, isFr);
            if (!k) return null;
            const num = chartNum(f);
            return { file: f, kind: k.fam, label: k.label + (num ? ` ${num}` : '') };
        })
        .filter(Boolean)
        .sort((a, b) => (ORDRE[a.kind] - ORDRE[b.kind]) || (chartNum(a.file) || 0) - (chartNum(b.file) || 0) || a.file.localeCompare(b.file));
}

/** URL officielle d'une carte pour le cycle donné. « 2026-08-06 » →
 * …/eAIP_06_AUG_2026/FRANCE/AIRAC-2026-08-06/… ; fichier par défaut :
 * carte d'aérodrome. */
export function vacUrl(icao, airac = getSiaAirac(), file = null) {
    const code = String(icao || '').toUpperCase();
    if (!airac || !/^\d{4}-\d{2}-\d{2}$/.test(airac) || !/^[A-Z][A-Z0-9]{3}$/.test(code)) return null;
    const [y, m, d] = airac.split('-');
    const dossier = `eAIP_${d}_${MOIS[+m - 1]}_${y}`;
    const f = file || `AD_2_${code}_ADC_01.pdf`;
    return `https://www.sia.aviation-civile.gouv.fr/media/dvd/${dossier}/FRANCE/AIRAC-${airac}/html/eAIP/Cartes/${code}/${f}`;
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

/** Récupère une carte : cache IndexedDB (cycle courant) sinon relais.
 * Retourne { blob, airac, offline } ou null (indisponible). */
export async function fetchVac(icao, file = null) {
    const code = String(icao || '').toUpperCase();
    const airac = getSiaAirac();
    const f = file || `AD_2_${code}_ADC_01.pdf`;
    const url = vacUrl(code, airac, f);
    if (!url) return null;
    const cle = `${code}:${f}`;

    const cached = await _idbGet(cle);
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
                    _idbPut(cle, { airac, blob, ts: Date.now() });
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

let _ui = null;   // { overlay, canvas, container, pct, badge, select, charts, icao, lib, file, pdf, page, scale, renderTask }

/** Ouvre la visionneuse VAC du terrain (bouton fiche terrain). */
export async function openVac(icao) {
    const code = String(icao || '').toUpperCase();
    const isFr = state.lang === 'fr';
    const charts = vacCharts(code, isFr);
    if (!charts.length) return false;

    const lib = await _loadPdfjs().catch(() => null);
    if (!lib) { window.open(vacUrl(code), '_blank', 'noopener'); return false; }
    _buildOverlay(code, charts, isFr, lib);
    await _loadChart(charts[0].file);
    return true;
}

async function _loadChart(file) {
    if (!_ui) return;
    let data = null;
    try { data = await fetchVac(_ui.icao, file); } catch { data = null; }
    if (!data) {
        // Carte indisponible (réseau KO sans cache) : PDF officiel en onglet.
        const u = vacUrl(_ui.icao, null, file);
        if (u) window.open(u, '_blank', 'noopener');
        return;
    }
    _ui.file = file;
    _setBadge(data, _ui.isFr);
    const pdf = await _ui.lib.getDocument({ data: await data.blob.arrayBuffer() }).promise;
    _ui.pdf = pdf;
    _ui.page = await pdf.getPage(1);
    await _zoomTo(null);   // ajustement largeur
}

function _setBadge(data, isFr) {
    if (!_ui?.badge) return;
    const txt = data.stale
        ? (isFr ? `hors ligne · cycle ${data.airac}` : `offline · cycle ${data.airac}`)
        : (isFr ? (data.offline ? 'hors ligne' : 'cache mis à jour') : (data.offline ? 'offline' : 'cached'));
    _ui.badge.textContent = txt;
    _ui.badge.style.color = data.offline ? '#2DD4BF' : 'var(--text-muted,#94A3B8)';
}

function _buildOverlay(code, charts, isFr, lib) {
    _closeVac();
    const ov = document.createElement('div');
    ov.id = 'vac-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:4000;background:var(--bg-color,#020617);display:flex;flex-direction:column;';
    const opt = (c) => `<option value="${c.file}"${c.file === charts[0].file ? ' selected' : ''}>${c.label}</option>`;
    const btn = (id, t, h, extra = '') => `<button data-vac="${id}" title="${t}" style="background:none;border:1px solid var(--border-color,rgba(255,255,255,.15));border-radius:6px;color:var(--text-color,#F8FAFC);height:28px;cursor:pointer;font-size:13px;font-weight:700;${extra}">${h}</button>`;
    ov.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--panel-bg,#0F172A);border-bottom:1px solid var(--border-color,rgba(255,255,255,.15));flex:0 0 auto;flex-wrap:wrap;">
            <i data-lucide="map" style="width:15px;height:15px;color:var(--primary,#38BDF8);"></i>
            <span style="font-weight:700;font-size:13.5px;color:var(--text-color,#F8FAFC);">${code}</span>
            <span data-vac="badge" title="${isFr ? 'cartes enregistrées sur cet appareil' : 'charts stored on this device'}" style="font-size:10px;font-weight:700;color:var(--text-muted,#94A3B8);border:1px solid var(--border-color,rgba(255,255,255,.15));border-radius:4px;padding:2px 7px;"></span>
            <span style="flex:1;"></span>
            ${btn('out', isFr ? 'Ouvrir le PDF original' : 'Open original PDF', `<i data-lucide="external-link" style="width:13px;height:13px;"></i>`, 'padding:0 9px;display:flex;align-items:center;')}
            ${btn('minus', isFr ? 'Réduire' : 'Zoom out', '−', 'width:28px;')}
            <span data-vac="pct" style="font-family:'DM Mono',monospace;font-size:11px;color:var(--text-muted,#94A3B8);min-width:42px;text-align:center;">100%</span>
            ${btn('plus', isFr ? 'Agrandir' : 'Zoom in', '+', 'width:28px;')}
            ${btn('close', isFr ? 'Fermer (Échap)' : 'Close (Esc)', '✕', 'width:28px;background:rgba(239,68,68,.12);border-color:rgba(239,68,68,.35);color:#EF4444;')}
        </div>
        <div style="display:flex;align-items:center;gap:8px;padding:6px 12px;background:var(--panel-bg,#0F172A);border-bottom:1px solid var(--border-color,rgba(255,255,255,.15));flex:0 0 auto;">
            <span style="font-size:10px;font-weight:700;letter-spacing:.5px;color:var(--text-muted,#94A3B8);text-transform:uppercase;">${isFr ? 'Carte' : 'Chart'}</span>
            <select data-vac="select" style="background:var(--input-bg,#0F172A);border:1px solid var(--border-color,rgba(255,255,255,.15));border-radius:6px;color:var(--text-color,#F8FAFC);font-size:12px;padding:4px 8px;max-width:220px;">${charts.map(opt).join('')}</select>
            <span data-vac="count" style="font-size:10px;color:var(--text-muted,#94A3B8);font-family:'DM Mono',monospace;">${charts.length} ${isFr ? 'cartes VFR' : 'VFR charts'}</span>
        </div>
        <div data-vac="container" style="flex:1;overflow:auto;display:flex;justify-content:center;align-items:flex-start;padding:14px;">
            <canvas data-vac="canvas"></canvas>
        </div>`;
    document.body.appendChild(ov);
    if (window.lucide) window.lucide.createIcons({ root: ov });
    _ui = {
        overlay: ov, icao: code, charts, isFr, lib,
        canvas: ov.querySelector('[data-vac="canvas"]'),
        container: ov.querySelector('[data-vac="container"]'),
        pct: ov.querySelector('[data-vac="pct"]'),
        badge: ov.querySelector('[data-vac="badge"]'),
        select: ov.querySelector('[data-vac="select"]'),
        pdf: null, page: null, scale: null, renderTask: null, file: charts[0].file,
    };
    ov.querySelector('[data-vac="close"]').addEventListener('click', _closeVac);
    ov.querySelector('[data-vac="out"]').addEventListener('click', () => {
        const u = vacUrl(code, null, _ui?.file);
        if (u) window.open(u, '_blank', 'noopener');
    });
    ov.querySelector('[data-vac="plus"]').addEventListener('click', () => _zoom(1.3));
    ov.querySelector('[data-vac="minus"]').addEventListener('click', () => _zoom(1 / 1.3));
    ov.querySelector('[data-vac="container"]').addEventListener('wheel', (e) => {
        if (!e.ctrlKey) { e.preventDefault(); _zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15); }
    }, { passive: false });
    // Garde : un select remis à vide (valeur inconnue) ne doit PAS
    // recharger la carte par défaut en boucle.
    _ui.select.addEventListener('change', () => {
        const f = _ui.select.value;
        if (f && f !== _ui.file) _loadChart(f);
    });
    const onKey = (e) => { if (e.key === 'Escape') { _closeVac(); document.removeEventListener('keydown', onKey); } };
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
