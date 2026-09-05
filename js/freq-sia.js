/* ================================================================
 * FREQ SIA — fréquences radio officielles (SIA) + overrides
 * ================================================================
 *
 * Priorité d'affichage des fréquences :
 *   1. data/freq-overrides.json — corrections MANUELLES (committées,
 *      l'utilisateur les édite directement) ;
 *   2. data/freq-sia.json — extrait de l'eAIP officiel du SIA (AD 2.17/
 *      2.18, cycle AIRAC 28 j, régénéré par scripts/fetch-freq-sia.mjs) ;
 *   3. data/freq-aa-sia.json — AFIS + A/A du XML_SIA (227 A/A + 68 AFIS :
 *      complète l'eAIP pour les petits terrains sans page AD-2 — Ploërmel,
 *      Avranches, Lessay, Quiberon… — régénéré par fetch-sia-airac.mjs),
 *      FUSIONNÉE à l'eAIP par terrain (déduplication par fréquence) ;
 *   4. openAIP — pour les terrains hors France métropole et repli.
 *
 * Les SIV/secteurs ne figurent pas dans l'eAIP (ils sont sur les cartes
 * VAC) : leurs fréquences restent openAIP, corrigibles via la clé
 * « services » des overrides (ex. "RENNES INFORMATION": "134.000").
 * ================================================================ */

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
let _sia = null;            // { airac, airports: {OACI: [{type,name,value,hor}]} }
let _siaAa = null;          // idem, AFIS + A/A du XML_SIA
let _overrides = null;      // { airports: {OACI: [...]}, services: {NOM: "fréq"} }
let _loading = null;

async function _fetchJsonCached(url, idbKey) {
    const cached = await _idbGet(idbKey);
    if (cached?.data && Date.now() - cached.ts < TTL_MS) return cached.data;
    try {
        const res = await fetch(url + `?t=${cached?.ts || 0}`);
        if (!res.ok) return cached?.data || null;
        const data = await res.json();
        _idbPut(idbKey, data);
        return data;
    } catch { return cached?.data || null; }
}

// Petit IDB dédié (store 'freq') : deux clés seulement.
function _idbOpen() {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') return reject(new Error('no idb'));
        // v2 (04/09/2026) : purge de l'entrée « freq » empoisonnée par un bug
        // de clé (l'ancien appel passait le NOM du store aux helpers uniparamétrés
        // _idbGet/_idbPut → les deux fichiers s'écrasaient mutuellement sous la
        // clé « freq », et la valeur stockée était la chaîne 'sia'/'sia-aa').
        const req = indexedDB.open('freq-sia-cache', 2);
        req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains('freq')) req.result.createObjectStore('freq');
            try { req.transaction.objectStore('freq').delete('freq'); } catch { /* base neuve */ }
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

/** Charge (une fois) SIA (eAIP + XML AFIS/A-A) + overrides. */
export function loadFreqSources() {
    _loading ??= (async () => {
        // Les overrides sont minuscules : toujours revalidés.
        try {
            const res = await fetch('data/freq-overrides.json', { cache: 'no-cache' });
            if (res.ok) _overrides = await res.json();
        } catch {   }
        const [sia, aa] = await Promise.all([
            _fetchJsonCached('data/freq-sia.json', 'sia'),
            _fetchJsonCached('data/freq-aa-sia.json', 'sia-aa'),
        ]);
        _sia = sia;
        _siaAa = aa;
        // Échec total (réseau coupé au chargement) : autoriser une nouvelle
        // tentative au prochain appel plutôt que de figer l'échec pour
        // toute la session.
        if (!_sia && !_siaAa) _loading = null;
    })();
    return _loading;
}

/** Fréquences d'un terrain, forme du widget ({freq, name, type, primary}).
 *  Priorité : overrides > SIA eAIP ⊕ SIA XML (AFIS/A-A fusionnés,
 *  dédupliqués par fréquence) > openAIP.
 *  Retourne aussi la source ('overrides' | 'sia' | 'openaip'). */
/** Fréquences GONIO (VDF) : elles ne font que DUPLIQUER les fréquences des
 * organismes existants (Tour, FIS…) utilisables pour le relèvement —
 * aucune valeur propre, elles alourdissent la liste (retour pilote 05/09). */
const _isGonio = (f) => /^(VDF|GONIO)$/i.test(f.type || '') || /gonio/i.test(f.name || '');

export function getAirportFreqs(icao, openaipFreqs) {
    const code = String(icao || '').toUpperCase();
    const ov = _overrides?.airports?.[code];
    if (Array.isArray(ov) && ov.length) {
        return { source: 'overrides', freqs: ov.filter(f => !_isGonio(f)).map(f => ({
            freq: parseFloat(f.value), name: f.name || '', type: f.type || '', hor: f.hor || null,
            primary: /^(TWR|AFIS|APP)$/i.test(f.type || ''),
        })) };
    }
    const sia = _sia?.airports?.[code];
    const aa = _siaAa?.airports?.[code];
    if ((Array.isArray(sia) && sia.length) || (Array.isArray(aa) && aa.length)) {
        // Fusion : eAIP d'abord (TWR/AFIS/ATIS…), AFIS/A-A du XML en
        // complément, doublons de fréquence écartés (AFIS et A/A portent
        // souvent la même valeur). GONIO écartées partout.
        const merged = [...(sia || [])].filter(f => !_isGonio(f));
        for (const f of aa || []) {
            if (_isGonio(f)) continue;
            if (!merged.some(x => x.value === f.value)) merged.push(f);
        }
        return { source: 'sia', freqs: merged.map(f => ({
            freq: parseFloat(f.value), name: f.name || '', type: f.type || '', hor: f.hor || null,
            primary: /^(TWR|AFIS|APP)$/i.test(f.type || ''),
        })) };
    }
    return { source: 'openaip', freqs: (openaipFreqs || []).filter(f => !_isGonio(f)) };
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
export function _setSources(sia, overrides, siaAa) { _sia = sia; _overrides = overrides; _siaAa = siaAa; }
