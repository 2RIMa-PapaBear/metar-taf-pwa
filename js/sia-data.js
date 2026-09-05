/* ================================================================
 * SIA DATA — Données auxiliaires OFFICIELLES SIA (France, AIRAC 28 j)
 * ================================================================
 *
 * SOURCE
 * ------
 * data/sia-runways.json   (pistes : longueur/largeur M, revêtement,
 *                          piste principale, cap vrai, seuils exacts avec
 *                          altitudes — même source que les cartes SIA)
 * data/sia-airfields.json (terrains : élévation officielle AdRefAltFt,
 *                          déclinaison magnétique officielle AdMagVar
 *                          millésimée, statut, usage VFR/IFR, privé)
 * générés par scripts/fetch-sia-airac.mjs depuis l'export XML du SIA.
 *
 * RÔLE
 * ----
 * Ces valeurs OFFICIELLES priment sur les équivalents openAIP/OurAirports
 * quand elles existent (France) : longueur & revêtement de la piste en
 * service, seuils pour le tracé carte, déclinaison pour le choix de piste
 * active, élévation pour les perfs. Hors France → repli immédiat sur les
 * sources existantes, comportement inchangé.
 *
 * Le chargement est asynchrone (fetch + cache IndexedDB 7 j, ~110 Ko) :
 * les getters synchrones renvoient null tant qu'il n'est pas terminé —
 * les consommateurs traitent déjà ce cas (repli openAIP).
 * ================================================================ */

const IDB_NAME = 'meteo-taf-cache';
const IDB_VERSION = 1;
const IDB_STORE = 'sia-aux';
const TTL_MS = 7 * 24 * 3600 * 1000;

let _runways = null;      // { LFEQ: [ {d, len, wid, surf, main, brg, t1, t2}, … ] }
let _airfields = null;    // [ {code, elevFt, magVar, …}, … ]
let _byCode = null;       // Map code → terrain
let _auxAirac = null;     // cycle AIRAC du fichier sia-airfields (infos terrain)
let _loadPromise = null;

// ----------------------------------------------------------------
// IndexedDB (store dédié, même base que runways-geo)
// ----------------------------------------------------------------
function _idbOpen() {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') return reject(new Error('IDB indisponible'));
        const req = indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
            ['runways-geo', 'openaip'].forEach(s => {
                if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
            });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
function _idbGet(key) {
    return _idbOpen().then(db => new Promise(resolve => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
    })).catch(() => null);
}
function _idbPut(key, value) {
    return _idbOpen().then(db => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put({ ts: Date.now(), data: value }, key);
    }).catch(() => {});
}

/**
 * Charge pistes + terrains officiels (fetch avec cache IndexedDB 7 j,
 * puis ré-écrit le cache). À appeler une fois au boot — les getters
 * synchrones se remplissent au retour.
 * @returns {Promise<{runways:Object, airfields:Array}>}
 */
export async function loadSiaAux() {
    if (_runways && _airfields) return { runways: _runways, airfields: _airfields };
    _loadPromise ??= (async () => {
        const use = async (key, file) => {
            const cached = await _idbGet(key);
            if (cached?.data && Date.now() - cached.ts < TTL_MS) return cached.data;
            try {
                const res = await fetch(`${file}?t=${cached?.ts || 0}`, { signal: AbortSignal.timeout(10000) });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                _idbPut(key, data);
                return data;
            } catch {
                // Réseau KO : cache périmé accepté en repli (donnée quasi
                // statique, cycle AIRAC 28 j).
                return cached?.data || null;
            }
        };
        const [rw, af] = await Promise.all([
            use('sia-runways', 'data/sia-runways.json'),
            // v2 (05/09) : rubriques AD ajoutées (horaires ATS, avitaillement,
            // téléphone) — la clé change pour forcer le re-téléchargement.
            use('sia-airfields:v2', 'data/sia-airfields.json'),
        ]);
        _runways = rw?.items || {};
        _airfields = Array.isArray(af?.items) ? af.items : [];
        _auxAirac = af?.airac || null;
        _byCode = new Map(_airfields.map(t => [t.code, t]));
        return { runways: _runways, airfields: _airfields };
    })();
    return _loadPromise;
}

/** Pistes officielles d'un terrain (France) : [{d,len,wid,surf,main,brg,t1,t2}] ou null. */
export function getSiaRunways(icao) {
    if (!icao || !_runways) return null;
    return _runways[String(icao).toUpperCase()] || null;
}

/**
 * La piste officielle CONTENANT un numéro donné (ex. "11" → paire "11/29").
 * @param {string} icao
 * @param {string} rwyName Numéro seul ("08L") ou paire ("08L/26R").
 */
export function siaRunwayFor(icao, rwyName) {
    const list = getSiaRunways(icao);
    if (!list || !rwyName) return null;
    const n = String(rwyName).toUpperCase().split('/')[0].trim();
    return list.find(r => r.d.split('/').some(x => x.trim() === n)) || null;
}

/** Cycle AIRAC des données terrains/pistes officielles (ex. « 2026-09-03 »). */
export function getSiaAuxAirac() {
    return _auxAirac;
}

/** Terrain officiel (France) : {code, elevFt, magVar, magVarYear, …} ou null. */
export function getSiaAirfield(icao) {
    if (!icao || !_byCode) return null;
    return _byCode.get(String(icao).toUpperCase()) || null;
}

/** Déclinaison magnétique OFFICIELLE du terrain (°E+) ou null hors France. */
export function getOfficialDeclination(icao) {
    const af = getSiaAirfield(icao);
    return af && typeof af.magVar === 'number' ? af.magVar : null;
}

/** Longueur officielle (PIEDS) de la piste contenant rwyName, sinon de la piste principale. */
export function siaRunwayLengthFt(icao, rwyName) {
    const r = siaRunwayFor(icao, rwyName) || (getSiaRunways(icao) || []).find(r => r.main) || null;
    return r && typeof r.len === 'number' ? Math.round(r.len * 3.28084) : null;
}

/** Revêtement officiel → code standard du module runway-surface ('ASP'/'GRS'…). */
export function siaSurfaceCode(surf) {
    const s = String(surf || '').toLowerCase();
    if (!s) return null;
    if (/herbe|grass/.test(s)) return 'GRS';
    if (/non rev|terre|gravier|sable/.test(s)) return 'GRV';
    if (/rev|macadam|béton|bitum|concre|asph|durm|pav/.test(s)) return 'ASP';
    return null;
}

/** Seuils officiel d'un terrain au format runways-geo [{lat,lon,lat2,lon2,desig,desig2}]. */
export function siaThresholds(icao) {
    const list = getSiaRunways(icao);
    if (!list) return [];
    const out = [];
    for (const r of list) {
        if (!r.t1 || !r.t2) continue;
        out.push({ lat: r.t1.lat, lon: r.t1.lon, lat2: r.t2.lat, lon2: r.t2.lon, desig: r.t1.id, desig2: r.t2.id, sia: true });
    }
    return out;
}

/** Tests uniquement : injecte les données sans passer par fetch/IndexedDB. */
export function _importForTests(runways, airfields) {
    _runways = runways || {};
    _airfields = Array.isArray(airfields) ? airfields : [];
    _byCode = new Map(_airfields.map(t => [t.code, t]));
}
