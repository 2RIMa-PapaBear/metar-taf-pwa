/* ================================================================
 * FREQ SIA — fréquences radio officielles (SIA eAIP France) + overrides
 * ================================================================
 *
 * Priorité d'affichage des fréquences :
 *   1. data/freq-overrides.json — corrections MANUELLES (committées,
 *      l'utilisateur les édite directement) ;
 *   2. data/freq-sia.json — extrait de l'eAIP officiel du SIA (AD 2.17/
 *      2.18, cycle AIRAC 28 j, régénéré par scripts/fetch-freq-sia.mjs) ;
 *   3. openAIP — pour les terrains hors France métropole et repli.
 *
 * Les SIV/secteurs ne figurent pas dans l'eAIP (ils sont sur les cartes
 * VAC) : leurs fréquences restent openAIP, corrigibles via la clé
 * « services » des overrides (ex. "RENNES INFORMATION": "134.000").
 * ================================================================ */

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
let _sia = null;            // { airac, airports: {OACI: [{type,name,value,hor}]} }
let _overrides = null;      // { airports: {OACI: [...]}, services: {NOM: "fréq"} }
let _loading = null;

async function _fetchJsonCached(url, idbStore, idbKey) {
    const cached = await _idbGet(idbStore, idbKey);
    if (cached?.data && Date.now() - cached.ts < TTL_MS) return cached.data;
    try {
        const res = await fetch(url + `?t=${cached?.ts || 0}`);
        if (!res.ok) return cached?.data || null;
        const data = await res.json();
        _idbPut(idbStore, idbKey, data);
        return data;
    } catch { return cached?.data || null; }
}

// Petit IDB dédié (store 'freq') : deux clés seulement.
function _idbOpen() {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') return reject(new Error('no idb'));
        const req = indexedDB.open('freq-sia-cache', 1);
        req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains('freq')) req.result.createObjectStore('freq');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
async function _idbGet(key) {
    try {
        const db = await _idbOpen();
        return await new Promise((resolve) => {
            const r = db.transaction('freq', 'readonly').objectStore('freq').get(key);
            r.onsuccess = () => { db.close(); resolve(r.result || null); };
            r.onerror = () => { db.close(); resolve(null); };
        });
    } catch { return null; }
}
async function _idbPut(key, data) {
    try {
        const db = await _idbOpen();
        await new Promise((resolve) => {
            const tx = db.transaction('freq', 'readwrite');
            tx.objectStore('freq').put({ data, ts: Date.now() }, key);
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => { db.close(); resolve(); };
        });
    } catch {   }
}

/** Charge (une fois) SIA + overrides. */
export function loadFreqSources() {
    _loading ??= (async () => {
        // Les overrides sont minuscules : toujours revalidés.
        try {
            const res = await fetch('data/freq-overrides.json', { cache: 'no-cache' });
            if (res.ok) _overrides = await res.json();
        } catch {   }
        _sia = await _fetchJsonCached('data/freq-sia.json', 'sia');
    })();
    return _loading;
}

/** Fréquences d'un terrain, forme du widget ({freq, name, type, primary}).
 *  SIA/offres priorité : overrides > SIA (LF**) > openAIP.
 *  Retourne aussi la source ('overrides' | 'sia' | 'openaip'). */
export function getAirportFreqs(icao, openaipFreqs) {
    const code = String(icao || '').toUpperCase();
    const ov = _overrides?.airports?.[code];
    if (Array.isArray(ov) && ov.length) {
        return { source: 'overrides', freqs: ov.map(f => ({
            freq: parseFloat(f.value), name: f.name || '', type: f.type || '',
            primary: /^(TWR|AFIS|APP)$/i.test(f.type || ''),
        })) };
    }
    const sia = _sia?.airports?.[code];
    if (Array.isArray(sia) && sia.length) {
        return { source: 'sia', freqs: sia.map(f => ({
            freq: parseFloat(f.value), name: f.name || '', type: f.type || '',
            primary: /^(TWR|AFIS|APP)$/i.test(f.type || ''),
        })) };
    }
    return { source: 'openaip', freqs: openaipFreqs || [] };
}

/** Correction manuelle d'une fréquence de SERVICE (SIV/APP…), par nom
 *  d'indicatif (« RENNES INFORMATION ») — null si aucune correction. */
export function getServiceFreq(serviceName) {
    const s = _overrides?.services?.[String(serviceName || '').trim().toUpperCase()];
    return s || null;
}

/** Dernier cycle AIRAC chargé (pour le pied de page du widget). */
export function getSiaAirac() { return _sia?.airac || null; }

/** Test only. */
export function _setSources(sia, overrides) { _sia = sia; _overrides = overrides; }
