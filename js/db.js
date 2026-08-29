/* ================================================================
 * DB — Couche de persistance (IndexedDB + localStorage)
 * ================================================================
 * Centralise la mise en cache des données peu évolutives pour éviter
 * de les re-télécharger à chaque visite :
 *
 *  - airports.json (4 Mo / 17 000+ aéroports) → IndexedDB
 *    (gros volume, lecture structurée).
 *  - Fuseau horaire / position des aéroports → localStorage
 *    (petit volume, accès synchrone au rendu).
 *
 * Dégradation gracieuse : si IndexedDB ou localStorage sont
 * indisponibles (mode privé, quotas, etc.), toutes les fonctions
 * résolvent à `null`/`[]` sans lever d'erreur. L'app retombe alors
 * sur le chemin réseau (comportement antérieur inchangé).
 * ================================================================ */

// ----------------------------------------------------------------
// Version des données d'aéroports.
// À BUMPER quand data/airports.json change. Un bump invalide le
// cache IndexedDB existant et force un re-téléchargement.
// Penser aussi à aligner le ?v= du <link rel=preload> dans index.html.
// ----------------------------------------------------------------
export const AIRPORTS_DB_VERSION = '1.15.0';

// ----------------------------------------------------------------
// LocalStorage — fuseaux horaires par aéroport
// ----------------------------------------------------------------
// Le fuseau horaire d'un aéroport ne change jamais → on le persiste
// une fois pour toutes (clé 'airport-tz'). Cap LRU pour éviter la
// croissance infinie.
const TZ_KEY = 'airport-tz';
const TZ_MAX = 200;

/**
 * Lit tout le magasin de fuseaux horaires depuis localStorage.
 * Retourne un objet vide en cas d'erreur / d'absence.
 * @returns {Object<string, {name:string,lat:number,lon:number,tzOffset:number,ts:number}>}
 */
function tzLoad() {
    try {
        const raw = localStorage.getItem(TZ_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

/**
 * Persiste l'objet complet de fuseaux horaires en localStorage.
 * Échoue silencieusement (quota / mode privé).
 * @param {Object} obj
 */
function tzStore(obj) {
    try {
        localStorage.setItem(TZ_KEY, JSON.stringify(obj));
    } catch {
        /* quota dépassé ou stockage interdit — on ignore */
    }
}

/**
 * Récupère le record d'un aéroport (name, lat, lon, tzOffset) en cache.
 * @param {string} icao Code OACI en majuscules.
 * @returns {{name:string,lat:number,lon:number,tzOffset:number}|null}
 */
export function tzGet(icao) {
    if (!icao) return null;
    const all = tzLoad();
    const rec = all[icao.toUpperCase()];
    if (rec && typeof rec.tzOffset === 'number') return rec;
    return null;
}

/**
 * Persiste (ou met à jour) le fuseau horaire d'un aéroport.
 * Gère l'éviction LRU au-delà de TZ_MAX entrées.
 * @param {string} icao Code OACI.
 * @param {{name?:string,lat:number,lon:number,tzOffset:number}} info
 */
export function tzPut(icao, info) {
    if (!icao || !info || typeof info.tzOffset !== 'number') return;
    const key = icao.toUpperCase();
    const all = tzLoad();
    // Si la clé existe déjà, on la supprime pour la réinsérer en fin
    // d'itération (ordre d'insertion = ordre LRU : la plus ancienne
    // en premier, la plus récente en dernier).
    delete all[key];
    all[key] = {
        name: info.name || key,
        lat: info.lat,
        lon: info.lon,
        tzOffset: info.tzOffset,
        ts: Date.now(),
    };
    // Éviction LRU : retire les plus anciennes si dépassement du cap.
    const keys = Object.keys(all);
    if (keys.length > TZ_MAX) {
        for (let i = 0; i < keys.length - TZ_MAX; i++) delete all[keys[i]];
    }
    tzStore(all);
}

// ----------------------------------------------------------------
// IndexedDB — cache de airports.json
// ----------------------------------------------------------------
const DB_NAME = 'metar-taf-cache';
const DB_VERSION = 1;
const STORE = 'kv';
const RECORD_ID = 'airports';

// Délai d'expiration du cache (30 jours). Même si la version n'a pas
// changé, on force un rafraîchissement périodique pour récupérer les
// éventuelles corrections de la base d'aéroports.
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Ouvre (et crée au besoin) la base IndexedDB.
 * Rejette en cas d'indisponibilité pour que l'appatchr tombe sur le réseau.
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB indisponible'));
            return;
        }
        let req;
        try {
            req = indexedDB.open(DB_NAME, DB_VERSION);
        } catch (e) {
            reject(e);
            return;
        }
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('Échec ouverture IndexedDB'));
    });
}

/**
 * Récupère la base d'aéroports en cache, si elle existe, est à la
 * bonne version et n'est pas trop ancienne.
 * @returns {Promise<Array|null>} Le tableau d'aéroports, ou null si absent/périmé.
 */
export async function idbGetAirports() {
    try {
        const db = await openDB();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const req = tx.objectStore(STORE).get(RECORD_ID);
            req.onsuccess = () => {
                const rec = req.result;
                db.close();
                if (!rec || typeof rec !== 'object') return resolve(null);
                if (rec.version !== AIRPORTS_DB_VERSION) return resolve(null);
                if (typeof rec.ts === 'number' && Date.now() - rec.ts > MAX_AGE_MS) return resolve(null);
                resolve(Array.isArray(rec.data) ? rec.data : null);
            };
            req.onerror = () => { db.close(); reject(req.error); };
        });
    } catch {
        // IndexedDB indisponible (mode privé, etc.) → chemin réseau.
        return null;
    }
}

/**
 * Persiste la base d'aéroports en cache IndexedDB avec la version
 * et un horodatage courants. Échoue silencieusement.
 * @param {Array} data Tableau d'aéroports.
 */
export async function idbPutAirports(data) {
    try {
        const db = await openDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put(
                { version: AIRPORTS_DB_VERSION, data, ts: Date.now() },
                RECORD_ID,
            );
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
        db.close();
    } catch {
        /* quota dépassé ou stockage interdit — on ignore */
    }
}
