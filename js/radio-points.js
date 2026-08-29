/* ================================================================
 * RADIO POINTS — radiophares (VOR/NDB) et points de repère VFR
 * ================================================================
 *
 * Source : data/radio-points.json — export MONDIAL de l'API openAIP
 * (/navaids + /reporting-points), régénéré chaque semaine par le cron
 * GitHub « Radio points » puis déployé sur le FTP. L'app ne parle
 * JAMAIS à l'API openAIP pour ces données : elle lit le fichier (374 Ko)
 * et le met en cache IndexedDB, avec un contrôle de fraîcheur hebdo
 * (au-delà de 7 jours, re-téléchargement avec contournement du cache
 * HTTP ; en cas d'échec, on garde les données périmées plutôt que rien).
 *
 * Format du fichier (généré par scripts/fetch-radio-points.mjs) :
 *   { generatedAt, counts,
 *     navaids: [[type, ident, lat, lon, freq, unit], …],
 *     vrps:    [[name, lat, lon, country], …] }
 *
 * Classification : openAIP ne publie pas l'énum du champ « type » ;
 * on classe par BANDE de fréquence, incontestable — unit 1 (kHz,
 * 190-1000) = NDB, unit 2 (MHz, 108-118) = VOR (DME colocalisés
 * indifférenciés : l'API n'expose pas de DME isolés).
 *
 * Module SANS dépendance (fonctions pures + IndexedDB optionnel) :
 * testable sous Node, insérable dans la carte régionale.
 * ================================================================ */

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const RADIO_POINTS_URL = 'data/radio-points.json';
export const OBSTACLES_URL = 'data/obstacles.json';

/** Seuils de zoom (déclutter) : VOR, NDB et points VFR apparaissent AU
 * MÊME niveau de zoom (retour utilisateur 27/08 — avant : 6/8/10).
 * Obstacles FRANCE (8 900 points, 91 % d'éoliennes en fermes denses) :
 * couche plus locale, étiquettes de hauteur uniquement en vue rapprochée. */
export const LAYER_MIN_ZOOM = { vor: 6, ndb: 6, vrp: 6, obstacle: 10 };
/** Seuils de zoom pour afficher les étiquettes (icône seule en dessous). */
export const LABEL_MIN_ZOOM = { vor: 7, ndb: 10, vrp: 11, obstacle: 13 };
/** Nombre maximal de marqueurs rendus par couche et par cadrage. VRP 800 :
 * la France seule en compte 675 — un plafond inférieur tronquait
 * arbitrairement (ordre du fichier) dès la vue nationale. */
export const LAYER_MAX_POINTS = { vor: 400, ndb: 400, vrp: 800, obstacle: 800 };

/** Catégories d'obstacles — 21 types SIA regroupés en 6 familles d'icônes
 *  (cf. scripts/fetch-obstacles.mjs, export AIXM officiel du SIA ; le type
 *  EXACT — « Pylône », « Château d'eau »… — reste porté par chaque item). */
export const OBSTACLE_CATS = ['EOLIENNE', 'ANTENNE', 'CHEMINEE', 'CHATEAU_D_EAU', 'BATIMENT', 'AUTRE'];

/**
 * Classe un radiophare par bande de fréquence.
 * @param {number} freq Fréquence (valeur brute openAIP).
 * @param {number} unit 1 = kHz, 2 = MHz (énum observée).
 * @returns {'VOR'|'NDB'}
 */
export function classifyNavaid(freq, unit) {
    if (unit === 1) return 'NDB';   // kHz : plage NDB
    if (unit === 2) return 'VOR';   // MHz 108-118 : VOR (+ DME colocalisé)
    // Unité inconnue : on tranche par la plage si elle parle d'elle-même.
    if (freq != null && freq >= 150 && freq <= 1100) return 'NDB';
    return 'VOR';
}

/**
 * Analyse le fichier compact en ensembles typés.
 * @param {Object} json Contenu de data/radio-points.json.
 * @returns {{vor:Array, ndb:Array, vrp:Array, generatedAt:string,
 *            counts:Object}|null}
 */
export function parseRadioPoints(json) {
    if (!json || !Array.isArray(json.navaids) || !Array.isArray(json.vrps)) return null;
    const vor = [], ndb = [], vrp = [];
    for (const [type, ident, lat, lon, freq, unit] of json.navaids) {
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || !ident) continue;
        const it = { ident, lat, lon, freq: Number.isFinite(freq) ? freq : null, type };
        (classifyNavaid(freq, unit) === 'NDB' ? ndb : vor).push(it);
    }
    for (const [name, lat, lon, cc] of json.vrps) {
        if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        vrp.push({ name: String(name), lat, lon, cc: cc || '' });
    }
    return { vor, ndb, vrp, generatedAt: json.generatedAt || '', counts: json.counts || {} };
}

/**
 * Filtre les points dans un cadrage géographique. Gère l'antiméridien
 * (cadre à cheval sur ±180° : est < ouest → deux fenêtres).
 * @param {Array} items Points {lat, lon, …}.
 * @param {number} west Longitude ouest, `south` latitude sud, etc.
 * @returns {Array} Points dans le cadre, ordre du fichier conservé.
 */
export function filterBbox(items, west, south, east, north) {
    if (east >= west) {
        return items.filter(p => p.lat >= south && p.lat <= north && p.lon >= west && p.lon <= east);
    }
    // Traverse ±180° : [west, 180] ∪ [-180, east]
    return items.filter(p => p.lat >= south && p.lat <= north
        && (p.lon >= west || p.lon <= east));
}

/**
 * Couches visibles à un zoom donné (déclutter).
 * @param {number} zoom Niveau de zoom Leaflet.
 * @returns {{vor:boolean, ndb:boolean, vrp:boolean, obstacle:boolean}}
 */
export function visibleKinds(zoom) {
    return {
        vor: zoom >= LAYER_MIN_ZOOM.vor,
        ndb: zoom >= LAYER_MIN_ZOOM.ndb,
        vrp: zoom >= LAYER_MIN_ZOOM.vrp,
        obstacle: zoom >= LAYER_MIN_ZOOM.obstacle,
    };
}

/** Formate une fréquence pour affichage (« 113.30 » ou « 355 kHz »). */
export function formatFreq(freq, unit) {
    if (freq == null) return '';
    return unit === 1 ? `${freq} kHz` : `${(+freq).toFixed(2).replace(/0$/, '')} MHz`;
}

/**
 * Analyse data/obstacles.json (export AIXM officiel du SIA).
 * Lignes compactes [cat, lat, lon, hFt, elevFt, lgt, name, type] :
 * hFt = hauteur sol (ft), elevFt = altitude du SOMMET (ft AMSL),
 * lgt = balisage lumineux (1/0), type = libellé exact SIA.
 * @returns {{obstacles:Array<{cat:number,lat:number,lon:number,hFt:number|null,
 *            elevFt:number|null,lgt:number,name:string,type:string}>,
 *            generatedAt:string, airac:string}|null}
 */
export function parseObstacles(json) {
    if (!json || !Array.isArray(json.obstacles)) return null;
    const obstacles = [];
    for (const [cat, lat, lon, hFt, elevFt, lgt, name, type] of json.obstacles) {
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const c = Number.isFinite(+cat) ? Math.min(5, Math.max(0, +cat)) : 5;
        obstacles.push({
            cat: c, lat, lon,
            hFt: Number.isFinite(+hFt) && +hFt > 0 ? Math.round(+hFt) : null,
            elevFt: Number.isFinite(+elevFt) ? Math.round(+elevFt) : null,
            lgt: lgt === 1 || lgt === true ? 1 : 0,
            name: name ? String(name) : '',
            type: type ? String(type) : '',
        });
    }
    return { obstacles, generatedAt: json.generatedAt || '', airac: json.airac || '' };
}

// ----------------------------------------------------------------
// Chargement + cache IndexedDB (navigation seule ; sous Node, injecter
// fetchImpl et storage 'off' pour tester).
// ----------------------------------------------------------------
const IDB_NAME = 'radio-points-cache';
const IDB_STORE = 'world';

function _openDB() {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') return reject(new Error('IDB indisponible'));
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function _idbGet(key = 'data') {
    try {
        const db = await _openDB();
        return await new Promise((resolve, reject) => {
            const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
            req.onsuccess = () => { db.close(); resolve(req.result || null); };
            req.onerror = () => { db.close(); resolve(null); };
        });
    } catch { return null; }
}

async function _idbPut(entry, key = 'data') {
    try {
        const db = await _openDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            tx.objectStore(IDB_STORE).put(entry, key);
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => { db.close(); resolve(); };
        });
    } catch { /* quota : le cache HTTP fera le relais */ }
}

// Cache obstacles : même base IndexedDB, clé distincte — suffixée -sia pour
// invalider le format openAIP précédent (jamais déployé, préversion locale).
const _idbGetObstacles = () => _idbGet('obstacles-sia');
const _idbPutObstacles = (entry) => _idbPut(entry, 'obstacles-sia');

/**
 * Charge les points mondiaux : cache IndexedDB si frais (< 7 jours),
 * sinon téléchargement (contournement du cache HTTP) puis mise en cache.
 * En cas d'échec réseau, sert les données périmées si présentes.
 *
 * @param {{fetchImpl?:Function, now?:number}} [opts] Injection pour tests.
 * @returns {Promise<{vor:Array,ndb:Array,vrp:Array,generatedAt:string,
 *                    counts:Object, stale:boolean}|null>}
 */
export async function loadRadioPoints(opts = {}) {
    const doFetch = opts.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
    const now = opts.now ?? Date.now();

    const cached = await _idbGet();
    if (cached?.parsed && (now - cached.ts) < WEEK_MS) {
        return { ...cached.parsed, stale: false };
    }

    if (!doFetch) return cached?.parsed ? { ...cached.parsed, stale: true } : null;
    try {
        const bust = (now - (cached?.ts ?? 0)) >= WEEK_MS ? `?t=${now}` : '';
        const res = await doFetch(RADIO_POINTS_URL + bust, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const parsed = parseRadioPoints(await res.json());
        if (!parsed) throw new Error('format inattendu');
        await _idbPut({ parsed, ts: now });
        return { ...parsed, stale: false };
    } catch {
        // Hors ligne / serveur injoignable : données périmées en repli.
        return cached?.parsed ? { ...cached.parsed, stale: true } : null;
    }
}

/**
 * Charge les obstacles France : même politique de cache que les radiophares
 * (IndexedDB 7 jours, contournement HTTP à l'expiration, repli périmé).
 * Fichier indépendant (data/obstacles.json) : absent du serveur → null
 * silencieux, la case reste simplement sans effet.
 *
 * @param {{fetchImpl?:Function, now?:number}} [opts] Injection pour tests.
 * @returns {Promise<{obstacles:Array, generatedAt:string, stale:boolean}|null>}
 */
export async function loadObstacles(opts = {}) {
    const doFetch = opts.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
    const now = opts.now ?? Date.now();

    const cached = await _idbGetObstacles();
    if (cached?.parsed && (now - cached.ts) < WEEK_MS) {
        return { ...cached.parsed, stale: false };
    }
    if (!doFetch) return cached?.parsed ? { ...cached.parsed, stale: true } : null;
    try {
        const bust = (now - (cached?.ts ?? 0)) >= WEEK_MS ? `?t=${now}` : '';
        const res = await doFetch(OBSTACLES_URL + bust, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const parsed = parseObstacles(await res.json());
        if (!parsed) throw new Error('format inattendu');
        await _idbPutObstacles({ parsed, ts: now });
        return { ...parsed, stale: false };
    } catch {
        return cached?.parsed ? { ...cached.parsed, stale: true } : null;
    }
}
