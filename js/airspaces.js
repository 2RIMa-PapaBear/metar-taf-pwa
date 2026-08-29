import { config } from './config.js';
import { state } from './core.js';
import { getServiceFreq } from './freq-sia.js';

const BASE_URL = 'https://api.core.openaip.net/api/airspaces';

const IDB_NAME = 'openaip-cache';
const IDB_STORE = 'airspaces';
const IDB_VERSION = 1;
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Seuil à 4 (retour 28/08) : les cadres de routes longues et écrans
// étroits descendent bas ; la base SIA officielle (212 Ko locaux) rend un
// affichage bas-zoom trivial, openAIP reste clampé par la bbox 5°.
const MIN_ZOOM = 4;

const MAX_BASE_FT = 5000;

// Numérotation openAIP BRUTE (cellules data/airspaces/cells/) — vérifiée
// sur le corpus servi : RMZ CHERBOURG=6, TMZ SEINE=5, ZARAGOZA ATZ=13,
// MATZ britanniques (WITTERING…)=14, MOA US=25, CTA australiennes=26…
const TYPE_MAP = {
    0:  'OTHER',
    1:  'RESTRICTED',
    2:  'DANGER',
    3:  'PROHIBITED',
    4:  'CTR',
    5:  'TMZ',
    6:  'RMZ',
    7:  'TMA',
    8:  'TMA',        // TRA
    9:  'TMA',        // TSA
    10: 'OTHER',      // FIR — zone administrative, filtrée au rendu
    11: 'OTHER',      // UIR — idem
    12: 'OTHER',      // ADIZ
    13: 'ATZ',
    14: 'ATZ',        // MATZ (Military ATZ, RU : WITTERING, SHAWBURY…)
    15: 'GLIDER',
    16: 'DANGER',
    17: 'PROHIBITED',
    18: 'RESTRICTED', // Warning areas US (W-506…)
    19: 'RESTRICTED',
    20: 'RESTRICTED',
    21: 'RESTRICTED',
    22: 'RESTRICTED',
    23: 'ATZ',        // TIZ
    24: 'ATZ',        // TIA
    25: 'RESTRICTED', // MOA US
    26: 'CTA',
    27: 'OTHER',      // secteurs ACC — filtrés au rendu
    28: 'DROP',       // zones de largage (DZ, PAL…)
    29: 'RESTRICTED', // parcs / réserves naturelles
    30: 'OTHER',
    31: 'OTHER',
    32: 'OTHER',
    33: 'SIV',        // SIV France + FIZ (même code openAIP et SIA)
    34: 'CTA',
    35: 'OTHER',
    36: 'CTR',        // MCTR
};

// Numérotation PRIVÉE de la base SIA (scripts/fetch-sia-airac.mjs TYPE_NUM)
// — elle COLLISIONNE avec openAIP (5=TMA ici vs TMZ là, 6=ATZ vs RMZ,
// 14=planeurs vs MATZ…) d'où un décodage source-aware : les items SIA sont
// marqués _sia au chargement, les items openAIP non.
const SIA_TYPE_MAP = {
    4:  'CTR',
    5:  'TMA',
    34: 'CTA',       // LTA
    33: 'SIV',       // France : « SIV SEINE », « SIV CHEVREUSE »…
    6:  'ATZ',
    3:  'PROHIBITED',
    15: 'RESTRICTED',
    2:  'DANGER',
    1:  'DROP',       // Pje (parachutage)
    14: 'GLIDER',    // Vol / TrPla / TrPVL / TrVL
    11: 'TMZ',
    12: 'RMZ',
};

const ICAO_CLASS_MAP = {
    0: 'A',
    1: 'B',
    2: 'C',
    3: 'D',
    4: 'E',
    5: 'F',
    6: 'G',
    7: 'SPECIAL',
    8: 'NA',
};

const AIRSPACE_STYLE = {
    CTR:    { color: '#EF4444', fill: 'rgba(239,68,68,0.10)',  weight: 2, label: 'CTR' },
    TMA:    { color: '#F97316', fill: 'rgba(249,115,22,0.10)', weight: 2, label: 'TMA' },
    CTA:    { color: '#F97316', fill: 'rgba(249,115,22,0.10)', weight: 1.5, label: 'CTA' },
    ATZ:    { color: '#FBBF24', fill: 'rgba(251,191,36,0.08)', weight: 1.2, label: 'ATZ' },
    ACRO:   { color: '#A855F7', fill: 'rgba(168,85,247,0.08)', weight: 1, label: 'Voltige' },
    'A':    { color: '#DC2626', fill: 'rgba(220,38,38,0.10)',  weight: 1.5, label: 'A' },
    'B':    { color: '#DC2626', fill: 'rgba(220,38,38,0.10)',  weight: 1.5, label: 'B' },
    'C':    { color: '#F97316', fill: 'rgba(249,115,22,0.10)', weight: 1.5, label: 'C' },
    'D':    { color: '#FBBF24', fill: 'rgba(251,191,36,0.10)', weight: 1.5, label: 'D' },
    'E':    { color: '#38BDF8', fill: 'rgba(56,189,248,0.06)', weight: 1, label: 'E' },
    'G':    { color: '#94A3B8', fill: 'rgba(148,163,184,0.04)', weight: 0.8, label: 'G' },
    RMZ:    { color: '#A855F7', fill: 'rgba(168,85,247,0.10)', weight: 1.5, label: 'RMZ' },
    TMZ:    { color: '#A855F7', fill: 'rgba(168,85,247,0.10)', weight: 1.5, label: 'TMZ' },
    'GLIDER': { color: '#4ADE80', fill: 'rgba(74,222,128,0.08)', weight: 1, label: 'Planel' },
    'DROP': { color: '#94A3B8', fill: 'rgba(148,163,184,0.08)', weight: 1, label: 'Parachut.' },
    'RESTRICTED': { color: '#EF4444', fill: 'rgba(239,68,68,0.18)', weight: 2, label: 'Réglementée' },
    'DANGER': { color: '#F59E0B', fill: 'rgba(245,158,11,0.15)', weight: 2, label: 'Dangereuse' },
    'PROHIBITED': { color: '#DC2626', fill: 'rgba(220,38,38,0.25)', weight: 2.5, label: 'Interdite' },
    'SIV':   { color: '#38BDF8', fill: 'rgba(56,189,248,0.07)', weight: 1.5, label: 'SIV' },
    'OTHER': { color: '#94A3B8', fill: 'rgba(148,163,184,0.06)', weight: 1, label: '?' },
};

// Familles (dé)cochables du menu « Espaces » — chaque case filtre le rendu
// sans re-téléchargement (les items du dernier cadrage sont rejoués).
export const AIRSPACE_GROUPS = {
    ctr:    { kinds: ['CTR'], label: 'CTR', en: 'CTR', color: '#EF4444' },
    tma:    { kinds: ['TMA', 'CTA'], label: 'TMA / CTA', en: 'TMA / CTA', color: '#F97316' },
    siv:    { kinds: ['SIV'], label: 'SIV', en: 'SIV', color: '#38BDF8' },
    atz:    { kinds: ['ATZ'], label: 'ATZ', en: 'ATZ', color: '#FBBF24' },
    rpd:    { kinds: ['RESTRICTED', 'PROHIBITED', 'DANGER', 'DROP'], label: 'Zones R · P · D', en: 'R · P · D areas', color: '#DC2626' },
    tmz:    { kinds: ['TMZ', 'RMZ'], label: 'TMZ / RMZ', en: 'TMZ / RMZ', color: '#A855F7' },
    autres: { kinds: ['GLIDER', 'ACRO', 'OTHER'], label: 'Planeurs & autres', en: 'Glider & others', color: '#4ADE80' },
};
const _KIND_TO_GROUP = (() => {
    const m = {};
    for (const [g, def] of Object.entries(AIRSPACE_GROUPS)) for (const k of def.kinds) m[k] = g;
    return m;
})();

function _openDB() {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') return reject(new Error('IDB indisponible'));
        const req = indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);

        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function _idbGet(key) {
    try {
        const db = await _openDB();
        return await new Promise((resolve) => {
            const tx = db.transaction(IDB_STORE, 'readonly');
            const req = tx.objectStore(IDB_STORE).get(key);
            req.onsuccess = () => { db.close(); resolve(req.result || null); };
            req.onerror = () => { db.close(); resolve(null); };
        });
    } catch { return null; }
}

async function _idbPut(key, data) {
    try {
        const db = await _openDB();
        await new Promise((resolve) => {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            tx.objectStore(IDB_STORE).put({ data, ts: Date.now() }, key);
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => { db.close(); resolve(); };
        });
    } catch {   }
}

function _bboxKey(minLat, minLon, maxLat, maxLon) {
    const r = (x) => Math.round(x * 2) / 2;
    return `bbox_${r(minLat)}_${r(minLon)}_${r(maxLat)}_${r(maxLon)}`;
}

// File d'attente openAIP PARTAGÉE par toute l'app (carte, corridor du
// profil, aérodromes des alternates) : l'API refuse les rafales — ~4
// requêtes rapprochées → 429 SERVI PAR CLOUDFLARE SANS EN-TÊTES CORS, que
// le navigateur affiche comme un blocage CORS (retour utilisateur 27/08).
// Toutes les requêtes passent donc ici : sérialisées, espacées, avec une
// unique reprise après temporisation sur 429.
let _oaQueue = Promise.resolve();
let _oaLastReq = 0;
const OA_MIN_SPACING_MS = 1500;
const OA_BACKOFF_MS = 20000;

// ---------------------------------------------------------------------------
// SOURCE FICHIER — espaces aériens MONDIAUX par cellule 1°, servis par
// NOTRE serveur (data/airspaces/cells/{lat}_{lon}.json, régénérés par le
// crawl quotidien du cron GitHub scripts/fetch-airspaces.mjs). Une vue est
// couverte par sa grille de cellules : chargement à la demande (comme des
// tuiles de carte), aucune requête API → aucun 429. Un fichier vide = zone
// crawlée sans espaces ; une absence de fichier (404) = zone pas encore
// crawlée → repli API pour ces cellules seulement.
// ---------------------------------------------------------------------------
const CELL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const _cellCache = new Map();        // "lat_lon" → items[] | null (404)
const _cellPending = new Map();

/** Convertit un item compact du fichier en forme openAIP (tout le reste du
 *  module — rendu, filtres, corridor du profil — travaille ainsi).
 *  Exporté pour les tests. */
export function _expandFileItem(c) {
    const g = c.g;
    let geometry = null;
    if (g) {
        if (g.t === 0) geometry = { type: 'Point', coordinates: g.c };
        else if (g.t === 1) geometry = { type: 'Polygon', coordinates: g.c };
        else if (g.t === 2) geometry = { type: 'MultiPolygon', coordinates: g.c };
        else if (g.t === 3) geometry = { type: 'LineString', coordinates: g.c };
    }
    const lim = (l) => (Array.isArray(l) ? { value: l[0], unit: l[1] } : null);
    return {
        _id: c.i, name: c.n, type: c.ty, icaoClass: c.ic,
        lowerLimit: lim(c.lo), upperLimit: lim(c.up),
        frequencies: c.f || [], radius: Array.isArray(c.r) ? { value: c.r[0] } : null,
        geometry,
    };
}

/** Items d'une cellule 1° : depuis le cache IndexedDB (7 j) ou notre serveur.
 *  Retourne items[] (vide si crawlée sans zones) ou null si le fichier
 *  n'existe pas encore (404 : zone non crawlée → repli API). */
function _loadCellItems(lat, lon) {
    const k = `${lat}_${lon}`;
    if (_cellCache.has(k)) return Promise.resolve(_cellCache.get(k));
    if (!_cellPending.has(k)) {
        _cellPending.set(k, (async () => {
            const idbKey = `cellfile:${k}`;
            const cached = await _idbGet(idbKey);
            if (cached?.data && Date.now() - cached.ts < CELL_TTL_MS) {
                _cellCache.set(k, cached.data);
                return cached.data;
            }
            try {
                const res = await fetch(`data/airspaces/cells/${k}.json?t=${cached?.ts || 0}`, {
                    signal: AbortSignal.timeout(12000),
                });
                if (res.status === 404) {
                    _cellCache.set(k, null);   // pas encore crawlée (mémoire seulement : re-essaiera)
                    return null;
                }
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const items = (await res.json()).items.map(_expandFileItem);
                _idbPut(idbKey, items);
                _cellCache.set(k, items);
                return items;
            } catch {
                _cellCache.set(k, cached?.data || null);
                return cached?.data || null;
            } finally {
                _cellPending.delete(k);
            }
        })());
    }
    return _cellPending.get(k);
}

/** Charge les cellules 1° couvrant une bbox quantifiée. Retourne
 *  { items, missing } : union des items fichier + cellules sans fichier.
 *  La base OFFICIELLE SIA (data/sia-airspaces.json, export XML AIRAC)
 *  PRIME sur openAIP pour toute vue dans la couverture SIA : les zones
 *  openAIP de la même zone sont alors écartées (doublons évités). */
const SIA_COVERAGE = [41, -63, 52, 12];   // France métropole + DOM proches
let _siaItems = null;
let _siaPending = null;

async function _loadSiaItems() {
    if (_siaItems) return _siaItems;
    _siaPending ??= (async () => {
        // Marqueur de source : indispensable au décodage (numérotations SIA
        // et openAIP incompatibles). Appliqué aussi au cache IndexedDB
        // existant, posé avant la correction de TYPE_MAP.
        const stamp = (arr) => { for (const it of arr) it._sia = true; return arr; };
        // v2 : la base du 29/08 corrige la géométrie (contours densifiés
        // SIA — cercles cwa rendus en triangles avant) — nouveau clé = les
        // clients re-téléchargent sans attendre le TTL de 7 j.
        const cached = await _idbGet('sia:airspaces:v2');
        if (cached?.data && Date.now() - cached.ts < CELL_TTL_MS) { _siaItems = stamp(cached.data); return _siaItems; }
        try {
            const res = await fetch(`data/sia-airspaces.json?t=${cached?.ts || 0}`, { signal: AbortSignal.timeout(15000) });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const d = await res.json();
            _siaItems = stamp(d.items.map(_expandFileItem));
            _idbPut('sia:airspaces:v2', _siaItems);
        } catch { _siaItems = stamp(cached?.data || []); }
        return _siaItems;
    })();
    return _siaPending;
}

function _bboxInSia(minLat, minLon, maxLat, maxLon) {
    return minLat >= SIA_COVERAGE[0] && maxLat <= SIA_COVERAGE[2]
        && minLon >= SIA_COVERAGE[1] && maxLon <= SIA_COVERAGE[3];
}
function _bboxOverlapsSia(minLat, minLon, maxLat, maxLon) {
    return minLat <= SIA_COVERAGE[2] && maxLat >= SIA_COVERAGE[0]
        && minLon <= SIA_COVERAGE[3] && maxLon >= SIA_COVERAGE[1];
}
/** Les items SIA intersectant grossièrement la bbox (test bbox par zone). */
function _siaItemsForArea(minLat, minLon, maxLat, maxLon) {
    if (!_siaItems) return [];
    const out = [];
    for (const it of _siaItems) {
        const ring = it.geometry?.coordinates?.[0];
        if (!Array.isArray(ring) || !ring.length) continue;
        let a = 90, b = -90, c = 180, d2 = -180;
        for (const [lon, lat] of ring) {
            if (lat < a) a = lat; if (lat > b) b = lat;
            if (lon < c) c = lon; if (lon > d2) d2 = lon;
        }
        if (b >= minLat && a <= maxLat && d2 >= minLon && c <= maxLon) out.push(it);
    }
    return out;
}

// Clé de désignateur pour les zones réglementées françaises : le SIA nomme
// « R 278 » ce qu'openAIP nomme « LF-R278 VANNES » — le dé-duplounage par
// nom exact laissait donc les DEUX copies se dessiner (et la copie openAIP
// apporter ses fréquences communautaires, parfois fausses — LF-R278/279
// Vannes « 122.600 » alors que le SIA ne publie AUCUNE fréquence pour ces
// zones). On rapproche sur le désignateur : R278A, D59B, P23…
export function _rdpKey(name) {
    const n = String(name || '').toUpperCase();
    let m = n.match(/^LF-([RDP]\d+(?:[A-Z]\d?)?(?:\(\d+\))?)\b/);
    if (m) return m[1];
    m = n.match(/^([RDP]) (\d+(?:[A-Z]\d?)?(?:\(\d+\))?)( |$)/);
    return m ? m[1] + m[2] : null;
}

/** Écarte les zones openAIP déjà couvertes par la base SIA : par nom exact,
 *  ou par désignateur R/D/P (LF-R278 ≡ R 278). Les items SIA passent tel
 *  quels. Exporté pour les tests. */
export function _dropOpenAipDuplicates(items, sia) {
    const siaNames = new Set(sia.map(z => String(z.name || '').toUpperCase()));
    const siaRdp = new Set(sia.map(z => _rdpKey(z.name)).filter(Boolean));
    return items.filter(z => sia.includes(z)
        || !(siaNames.has(String(z.name || '').toUpperCase()) || siaRdp.has(_rdpKey(z.name))));
}

async function _loadCellsGrid(minLat, minLon, maxLat, maxLon) {
    // Base officielle SIA : prioritaire dans la couverture (France) — les
    // zones openAIP homologues sont écartées pour éviter les doublons
    // (par nom exact, ET par désignateur R/D/P pour les zones
    // réglementées) — mais les familles que le SIA ne publie pas (ATZ…)
    // et l'étranger viennent TOUJOURS des cellules openAIP.
    await _loadSiaItems();
    const sia = _siaItemsForArea(minLat, minLon, maxLat, maxLon);

    const cells = [];
    for (let lat = Math.floor(minLat); lat < Math.ceil(maxLat); lat++)
        for (let lon = Math.floor(minLon); lon < Math.ceil(maxLon); lon++)
            cells.push([lat, lon]);
    const results = await Promise.all(cells.map(([la, lo]) => _loadCellItems(la, lo)));
    const items = [...sia];
    const missing = [];
    results.forEach((r, i) => {
        if (r) items.push(...r);
        else missing.push(cells[i]);
    });
    if (sia.length) return { items: _dropOpenAipDuplicates(items, sia), missing };
    return { items, missing };
}

export function fetchOpenAipItems(url) {
    // Sans clé openAIP (miroir public) : jamais d'appel API — les fichiers
    // statiques (cellules 1° servies par l'hébergeur) couvrent le besoin.
    if (!config.OPENAIP_API_KEY) return Promise.resolve(null);
    const run = async () => {
        const wait = _oaLastReq + OA_MIN_SPACING_MS - Date.now();
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
        _oaLastReq = Date.now();
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const res = await fetch(url, {
                    headers: { 'x-openaip-api-key': config.OPENAIP_API_KEY },
                    signal: AbortSignal.timeout(15000),
                });
                if (res.ok) {
                    const d = await res.json();
                    return Array.isArray(d?.items) ? d.items : null;
                }
                if (res.status === 429 && attempt === 0) {
                    await new Promise(r => setTimeout(r, OA_BACKOFF_MS));
                    _oaLastReq = Date.now();
                    continue;
                }
                return null;   // erreur définitive (403/404…)
            } catch {
                if (attempt === 0) {   // réseau : une reprise rapprochée
                    await new Promise(r => setTimeout(r, 1500));
                    _oaLastReq = Date.now();
                    continue;
                }
                return null;
            }
        }
        return null;
    };
    _oaQueue = _oaQueue.then(run, run);
    return _oaQueue;
}

// Cache mémoire de session des tuiles openAIP : si l'API limite le débit
// (429 en rafale : carte + zones + aérodromes au même changement de plan),
// le profil garde les dernières zones connues au lieu de disparaître.
const _memTiles = new Map();

/**
 * Charge les zones aériennes d'une bbox SANS carte (profil d'élévation,
 * log de nav) : quantification 1° et cache IndexedDB PARTAGÉS avec la
 * carte — la bbox d'une route déjà consultée ne re-télécharge rien.
 * Une bbox plus large que la limite API openAIP (5°) est DÉCOUPÉE EN
 * TUILES agrégées : sans ça, l'écrêtage rognait un côté de la route et
 * les zones traversées disparaissaient au changement de plan.
 * Une tuile refusée (429/5xx) est réessayée une fois, puis servie depuis
 * le cache mémoire/IDB si elle a déjà été vue dans la session.
 * Retourne les items openAIP bruts ([] si indisponible).
 */
export async function fetchAirspacesForBbox(minLat, minLon, maxLat, maxLon) {
    // SOURCE FICHIER MONDIALE : les cellules 1° du corridor sont chargées
    // depuis notre serveur (cache IndexedDB) — aucune requête API pour les
    // zones crawlées. Repli API (tuiles ≤ 5°, file sérialisée) seulement
    // pour les cellules sans fichier.
    {
        const lat0 = Math.floor(minLat), lon0 = Math.floor(minLon);
        let lat1 = Math.ceil(maxLat), lon1 = Math.ceil(maxLon);
        if (lat1 - lat0 > 12) lat1 = lat0 + 12;   // garde-fou corridor très long
        if (lon1 - lon0 > 12) lon1 = lon0 + 12;
        const { items, missing } = await _loadCellsGrid(lat0, lon0, lat1, lon1);
        // La base SIA couvre toute la France : si le corridor y est contenu,
        // les items (SIA + cellules openAIP existantes) suffisent — PAS de
        // repli API (les cellules non crawlées n'y ajouteraient que des
        // doublons, et la console se remplissait de 404 inutiles).
        const inSia = _bboxInSia(lat0, lon0, lat1, lon1);
        if (items.length && (!missing.length || inSia)) return items;
        if (items.length && missing.length) {
            // Mélange : complète par l'API sur la zone manquante.
            const api = await fetchAirspacesForBbox(missing[0][0], Math.min(...missing.map(c => c[1])), Math.max(...missing.map(c => c[0])) + 1, Math.max(...missing.map(c => c[1])) + 1);
            const byId = new Map(items.map(it => [it._id, it]));
            for (const it of (api || [])) byId.set(it._id, it);
            return [...byId.values()];
        }
    }
    const q = (x) => Math.floor(x);
    const cl = (x) => Math.ceil(x);
    const b = [q(minLat), q(minLon), cl(maxLat), cl(maxLon)];

    const tiles = [];
    for (let lat = b[0]; lat < b[2]; lat += 5) {
        for (let lon = b[1]; lon < b[3]; lon += 5) {
            tiles.push([lat, lon, Math.min(lat + 5, b[2]), Math.min(lon + 5, b[3])]);
        }
    }

    const byId = new Map();
    const absorb = (items) => {
        for (const it of (items || [])) byId.set(it._id ?? JSON.stringify(it.name) + byId.size, it);
    };

    for (const [t0, t1, t2, t3] of tiles) {
        const key = _bboxKey(t0, t1, t2, t3);
        const cached = await _idbGet(key);
        if (cached?.data && cached.ts > Date.now() - TTL_MS) {
            absorb(cached.data);
            _memTiles.set(key, cached.data);
            continue;
        }
        if (cached?.data) absorb(cached.data);   // périmé : gardé en repli
        // File partagée : sérialisée, espacée, reprise sur 429 (l'API refuse
        // les rafales et les sert en erreurs sans en-têtes CORS).
        const items = await fetchOpenAipItems(`${BASE_URL}?bbox=${t1},${t0},${t3},${t2}&limit=200`);
        if (items) {
            _idbPut(key, items);
            _memTiles.set(key, items);
            absorb(items);
        } else if (_memTiles.has(key)) {
            absorb(_memTiles.get(key));          // dernière valeur connue
        }
    }
    return [...byId.values()];
}

function _decodeAirspace(as) {
    const typeName = _decodeType(as);
    const classLetter = _decodeIcaoClass(as);
    return { kind: typeName, classLetter };
}

export function _decodeType(as) {

    // Base SIA et cellules openAIP ne numérotent PAS les types pareil :
    // on décode selon la source (marqueur _sia posé au chargement).
    const map = as._sia ? SIA_TYPE_MAP : TYPE_MAP;
    if (typeof as.type === 'number' && map[as.type]) {
        return map[as.type];
    }

    const t = String(as.type || '').toUpperCase();
    if (t === 'CTR' || t === 'D') return 'CTR';
    if (t === 'TMA') return 'TMA';
    if (t === 'CTA') return 'CTA';
    if (t === 'ATZ') return 'ATZ';
    if (t === 'RMZ') return 'RMZ';
    if (t === 'TMZ') return 'TMZ';
    if (t.includes('RESTRICTED') || t === 'R') return 'RESTRICTED';
    if (t.includes('DANGER') || t === 'Q') return 'DANGER';
    if (t.includes('PROHIBITED') || t === 'P') return 'PROHIBITED';
    if (t.includes('GLIDER') || t.includes('GLIDING')) return 'GLIDER';

    const name = String(as.name || as.designator || '').toUpperCase();
    if (/\bCTR\b/.test(name)) return 'CTR';
    if (/\bTMA\b/.test(name)) return 'TMA';
    if (/\bATZ\b/.test(name)) return 'ATZ';
    if (/\bRMZ\b/.test(name)) return 'RMZ';
    if (/\bTMZ\b/.test(name)) return 'TMZ';
    if (/RESTRICT|REGUL|RTBA|R\d{2,}/.test(name)) return 'RESTRICTED';
    if (/DANGER/.test(name)) return 'DANGER';
    if (/PROHIB/.test(name)) return 'PROHIBITED';
    if (/PARACHUTE|\bPA\b|\(PA\)/.test(name)) return 'DROP';
    if (/ACRO|VOLTIGE|AEROBAT/.test(name)) return 'ACRO';
    if (/GLIDER|PLANEUR|VOL.A.VOILE/.test(name)) return 'GLIDER';

    return 'OTHER';
}

function _decodeIcaoClass(as) {
    if (typeof as.icaoClass === 'number') return ICAO_CLASS_MAP[as.icaoClass] || '';
    const c = String(as.icaoClass || '').toUpperCase();
    return /^[A-G]$/.test(c) ? c : '';
}

// Limites verticales openAIP : lowerLimit/upperLimit { value, unit,
// referenceDatum } — unit 6 = FL, unit 1 = ft, unit 0 = m ; referenceDatum
// 1 = AGL. (L'ancien format `lower`/`upper` en mètres est encore accepté.)
function _limitFt(lim) {
    if (!lim || !isFinite(lim.value)) return null;
    if (lim.unit === 6) return lim.value * 100;                      // FL → ft
    if (lim.unit === 0) return Math.round(lim.value * 3.28084);      // m → ft
    return Math.round(lim.value);                                    // ft
}

/** Texte d'une borne : « SFC », « FL065 », « 2500 ft AMSL »… (les limites
 *  verticales des zones sont publiées AMSL ; le referenceDatum openAIP
 *  « AGL » est erroné sur les CTR/TMA — retour utilisateur 2026-08-26). */
function _limitTxt(lim) {
    const ft = _limitFt(lim);
    if (ft == null) return null;
    if (ft <= 0) return 'SFC';
    if (lim.unit === 6 || (ft >= 4000 && ft % 500 === 0)) {
        return `FL${String(Math.round(ft / 100)).padStart(3, '0')}`;
    }
    return `${ft} ft AMSL`;
}

function _baseFt(as) {
    return _limitFt(as.lowerLimit ?? as.lower) ?? 0;
}

function _geometryToLatLngs(geometry, radiusKm = 5) {
    if (!geometry || !geometry.coordinates) return [];
    const type = geometry.type;
    const rings = [];

    if (type === 'Polygon') {

        geometry.coordinates.forEach(ring => {
            rings.push(ring.map(([lon, lat]) => [lat, lon]));
        });
    } else if (type === 'MultiPolygon') {
        geometry.coordinates.forEach(poly => {
            poly.forEach(ring => {
                rings.push(ring.map(([lon, lat]) => [lat, lon]));
            });
        });
    } else if (type === 'LineString') {

        rings.push(geometry.coordinates.map(([lon, lat]) => [lat, lon]));
    } else if (type === 'Point') {

        const [lon, lat] = geometry.coordinates;
        const ring = [];
        const R = 6378.137;
        const steps = 36;
        for (let i = 0; i <= steps; i++) {
            const brg = (i / steps) * 2 * Math.PI;
            const dLat = (radiusKm / R) * (180 / Math.PI);
            const dLon = (radiusKm / R) * (180 / Math.PI) / Math.cos(lat * Math.PI / 180);
            ring.push([lat + dLat * Math.sin(brg), lon + dLon * Math.cos(brg)]);
        }
        rings.push(ring);
    }
    return rings;
}

function _pointInRing(lat, lng, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const lati = ring[i][0], loni = ring[i][1];
        const latj = ring[j][0], lonj = ring[j][1];
        if (((lati > lat) !== (latj > lat)) &&
            (lng < (lonj - loni) * (lat - lati) / (latj - lati) + loni)) {
            inside = !inside;
        }
    }
    return inside;
}

export function createAirspaceController(map) {
    let layerGroup = L.layerGroup().addTo(map);
    let visible = false;
    let activeGroups = new Set(Object.keys(AIRSPACE_GROUPS));   // tout coché
    let lastItems = null;                                          // rejouer sans refetch
    let loaded = false;
    let controlsEl = null;
    let lastBboxKey = null;

    let highlighted = null;
    let openZonePopup = null;   // fiche de zone ouverte (bascule au 2e clic)
    let openZonePoly = null;
    let polyMeta = new Map();

    let _loadEpoch = 0;   // annule les rendus d'un chargement dépassé (pan rapide)

    async function loadForBounds(bounds) {
        const epoch = ++_loadEpoch;
        const minLat = Math.floor(bounds.getSouth()), minLon = Math.floor(bounds.getWest());
        let maxLat = Math.ceil(bounds.getNorth()), maxLon = Math.ceil(bounds.getEast());
        if (maxLat - minLat > 5) maxLat = minLat + 5;   // limite API openAIP (repli)
        if (maxLon - minLon > 5) maxLon = minLon + 5;
        const viewKey = `${minLat}_${minLon}_${maxLat}_${maxLon}`;
        if (viewKey === lastBboxKey && loaded) return;

        // SOURCE FICHIER MONDIALE : la grille de cellules 1° de la vue est
        // chargée depuis NOTRE serveur (cache IndexedDB 7 j — un déplacement
        // en terrain connu n'importe plus rien). Les cellules SANS fichier
        // (404 : pas encore crawlées) passent par l'API en repli, en UNE
        // requête fusionnée à travers la file sérialisée.
        const { items: fileItems, missing } = await _loadCellsGrid(minLat, minLon, maxLat, maxLon);
        if (epoch !== _loadEpoch) return;
        lastBboxKey = viewKey; loaded = true;

        const byId = new Map();
        const absorb = (items) => {
            for (const it of (items || [])) byId.set(it._id ?? JSON.stringify(it.name) + byId.size, it);
        };
        absorb(fileItems);
        if (byId.size) {
            lastItems = [...byId.values()];
            _render(lastItems);
        }

        if (missing.length) {
            const mLat0 = Math.min(...missing.map(c => c[0]));
            const mLat1 = Math.max(...missing.map(c => c[0])) + 1;
            const mLon0 = Math.min(...missing.map(c => c[1]));
            const mLon1 = Math.max(...missing.map(c => c[1])) + 1;
            const items = await fetchOpenAipItems(`${BASE_URL}?bbox=${mLon0},${mLat0},${mLon1},${mLat1}&limit=200`);
            if (epoch !== _loadEpoch) return;   // la vue a changé : abandonne
            if (items) absorb(items);
            if (byId.size) {
                lastItems = [...byId.values()];
                _render(lastItems);
            }
        }
    }

    function _render(items) {
        layerGroup.clearLayers();
        polyMeta.clear();
        highlighted = null;
        if (!Array.isArray(items)) return;

        const isFr = state.lang === 'fr';
        let count = 0;

        items.forEach(as => {

            const baseFt = _baseFt(as);
            if (baseFt > MAX_BASE_FT) return;

            // Zones ADMINISTRATIVES nationales (FIR, UIR, LTA « FRANCE »…)
            // tracées comme de grands cadres orange : inutiles en VFR —
            // on ne les dessine pas du tout.
            if (/\bFIR\b|\bUIR\b|\bLTA\b/.test(String(as.name || as.designator || '').toUpperCase())) return;
            // Pareil, par numéro openAIP : FIR (10), UIR (11) et secteurs
            // ACC (27) dont le nom ne contient pas toujours « FIR »
            // (ex. « LRBB », « POLARIS ACC »).
            if (!as._sia && (as.type === 10 || as.type === 11 || as.type === 27)) return;

            const kind = _decodeAirspace(as);
            if (!activeGroups.has(_KIND_TO_GROUP[kind.kind] || 'autres')) return;
            const style = AIRSPACE_STYLE[kind.kind] || AIRSPACE_STYLE.OTHER;
            const radiusKm = (as.radius && typeof as.radius.value === 'number') ? as.radius.value : 5;
            const rings = _geometryToLatLngs(as.geometry, radiusKm);

            const name = as.name || as.designator || style.label;
            const lower = _limitTxt(as.lowerLimit ?? as.lower) ?? 'SFC';
            const upper = _limitTxt(as.upperLimit ?? as.upper) ?? '∞';
            const cls = kind.classLetter;

            const clsDisplay = /^[A-G]$/.test(cls) ? ` · classe ${cls}` : '';
            // Fréquences openAIP (SIV « XX INFORMATION », CTR…) : affichées
            // dans l'infobulle et le popup quand elles sont renseignées —
            // une correction manuelle (freq-overrides.json, par INDICATIF)
            // prime sur la valeur openAIP.
            const freqTxt = (Array.isArray(as.frequencies) ? as.frequencies : [])
                .filter(f => f && f.value)
                .map(f => {
                    const fixed = f.name ? getServiceFreq(f.name) : null;
                    return `${fixed || f.value}${f.name ? ` ${escapeHtml(f.name)}` : ''}`;
                })
                .join('<br>');
            const tooltip = `<strong>${escapeHtml(name)}</strong><br>
                <span style="color:${style.color};font-weight:700;">${style.label}</span>${clsDisplay}<br>
                ${isFr ? 'Alt.' : 'Alt.'}: ${lower} → ${upper}
                ${freqTxt ? `<br><span style="font-family:'DM Mono',monospace;">${freqTxt}</span>` : ''}`;

            rings.forEach((ring, ringIdx) => {
                if (ring.length < 2) return;
                const poly = L.polygon(ring, {
                    color: style.color,
                    weight: style.weight,
                    fillColor: style.color,
                    fillOpacity: parseFloat(style.fill.match(/[\d.]+(?=\))/)[0]) || 0.08,
                    interactive: true,

                });

                poly.bindTooltip(tooltip, { sticky: true, direction: 'top' });

                poly.on('click', (e) => {
                    L.DomEvent.stopPropagation(e);
                    const latlng = e.latlng;
                    // 2e clic sur la même zone alors que sa fiche est
                    // ouverte → on la FERME (bascule), on ne la rouvre pas.
                    if (openZonePoly === poly && openZonePopup) {
                        map.closePopup(openZonePopup);
                        return;
                    }
                    _highlightPoly(poly);
                    let stacked = _findStackedAt(latlng.lat, latlng.lng);
                    if (!stacked.length) stacked = [{ poly, ...(polyMeta.get(poly) || {}) }];
                    if (stacked.length) {
                        _showStackPopup(latlng, stacked, isFr, poly);
                    }
                });

                polyMeta.set(poly, {
                    ring, style, tooltip,

                    summary: `${style.label} — ${escapeHtml(name)} (${lower} → ${upper})`,
                });
                layerGroup.addLayer(poly);
                count++;
            });
        });

        if (controlsEl) {
            const badge = controlsEl.querySelector('.airspace-count');
            if (badge) {
                badge.textContent = count > 0 ? `${count}` : '';
                badge.style.display = count > 0 ? 'inline-block' : 'none';
            }
        }
    }

    function _highlightPoly(poly) {
        if (highlighted === poly) return;
        if (highlighted && polyMeta.has(highlighted)) {
            const m = polyMeta.get(highlighted);
            highlighted.setStyle({ color: m.style.color, weight: m.style.weight });
        }
        poly.bringToFront();
        poly.setStyle({ color: '#FFFFFF', weight: 4 });
        highlighted = poly;
    }

    function _findStackedAt(lat, lng) {
        const found = [];
        polyMeta.forEach((m, poly) => {
            if (_pointInRing(lat, lng, m.ring)) {
                found.push({ poly, ...m });
            }
        });
        return found;
    }

    function _showStackPopup(latlng, stacked, isFr, fromPoly = null) {
        // Zone unique sous le clic : son détail directement (le contour
        // seul sans popup prêtait à confusion — le « rectangle » de la
        // liste n'apparaissait qu'au 2e clic, sur un chevauchement).
        if (stacked.length === 1) {
            const p = L.popup({ className: 'airspace-popup', maxWidth: 280, closeButton: true })
                .setLatLng(latlng)
                .setContent(stacked[0].tooltip)
                .openOn(map);
            openZonePopup = p; openZonePoly = fromPoly;
            return;
        }
        const html = `
            <div class="airspace-stack">
                <div class="airspace-stack-title">${isFr ? `${stacked.length} zones superposées — cliquez pour sélectionner` : `${stacked.length} overlapping zones — click to select`}</div>
                ${stacked.map((s, i) => `
                    <div class="airspace-stack-item" data-idx="${i}">
                        <span class="airspace-dot" style="background:${s.style.color};"></span>
                        <span class="airspace-stack-name">${s.summary}</span>
                    </div>
                `).join('')}
            </div>`;
        const popup = L.popup({ className: 'airspace-popup', maxWidth: 280, closeButton: true })
            .setLatLng(latlng)
            .setContent(html)
            .openOn(map);
        openZonePopup = popup; openZonePoly = fromPoly;

        const root = popup.getElement();
        root?.querySelectorAll('.airspace-stack-item').forEach(el => {
            el.addEventListener('click', () => {
                const idx = parseInt(el.dataset.idx, 10);
                const target = stacked[idx];
                if (target) {
                    _highlightPoly(target.poly);
                    target.poly.openTooltip(latlng);
                }
                map.closePopup(popup);
            });
        });
    }

    function toggle(on) {
        visible = on;
        if (on) {
            layerGroup.addTo(map);

            if (!loaded) loadForBounds(map.getBounds());
        } else {
            map.removeLayer(layerGroup);
        }
        if (controlsEl) {
            const btn = controlsEl.querySelector('.precip-toggle-airspaces');
            if (btn) {
                btn.classList.toggle('active', visible);
                btn.setAttribute('aria-pressed', String(visible));
            }
        }
    }

    function mountControls(el) {
        controlsEl = el;
        const isFr = state.lang === 'fr';

        let btn = el.querySelector('.precip-toggle-airspaces');
        if (!btn) {
            const group = document.createElement('div');
            group.className = 'precip-control-group';
            group.innerHTML = `
                <button class="precip-toggle precip-toggle-airspaces" aria-pressed="false" title="${isFr ? 'Espaces aériens (CTR, TMA, classes...)' : 'Airspaces (CTR, TMA, classes...)'}">
                    <i data-lucide="hexagon" style="width:14px;height:14px;"></i>
                    <span>${isFr ? 'Espaces' : 'Airspaces'}</span>
                    <span class="airspace-count" style="display:none; font-size:9px; background:rgba(56,189,248,0.2); color:#38BDF8; padding:0 5px; border-radius:8px; margin-left:2px; font-weight:700;"></span>
                </button>
            `;
            el.appendChild(group);
            btn = group.querySelector('.precip-toggle-airspaces');
            btn.addEventListener('click', () => toggle(!visible));
            if (window.lucide) window.lucide.createIcons({ root: el });
        }
    }

    function onMapMove() {
        if (visible && map.getZoom() >= MIN_ZOOM) {
            loadForBounds(map.getBounds());
        }
    }

    function onMapClick() {
        if (highlighted && polyMeta.has(highlighted)) {
            const m = polyMeta.get(highlighted);
            highlighted.setStyle({ color: m.style.color, weight: m.style.weight });
            highlighted = null;
        }
        map.closePopup();
    }

    map.on('moveend', onMapMove);
    map.on('zoomend', onMapMove);
    map.on('click', onMapClick);
    // Fiche fermée par ailleurs (clic carte, croix, Échap) : réinitialise
    // l'état de bascule, sinon le prochain clic sur la même zone serait avalé.
    map.on('popupclose', () => { openZonePopup = null; openZonePoly = null; });

    function setGroup(g, on) {
        if (!AIRSPACE_GROUPS[g]) return;
        if (on) activeGroups.add(g); else activeGroups.delete(g);
        if (lastItems) _render(lastItems);   // re-filtre sans re-télécharger
    }
    function getGroups() {
        const out = {};
        for (const g of Object.keys(AIRSPACE_GROUPS)) out[g] = activeGroups.has(g);
        return out;
    }

    return {
        mountControls,
        setGroup,
        getGroups,
        loadForBounds,
        toggle,
        get visible() { return visible; },
        destroy() {
            map.off('moveend', onMapMove);
            map.off('zoomend', onMapMove);
            map.off('click', onMapClick);
            map.removeLayer(layerGroup);
            layerGroup = null;
            controlsEl = null;
            highlighted = null;
            polyMeta.clear();
        },
    };
}

function escapeHtml(text) {
    const el = document.createElement('div');
    el.textContent = String(text || '');
    return el.innerHTML;
}
