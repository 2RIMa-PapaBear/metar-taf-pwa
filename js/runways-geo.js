/* ================================================================
 * RUNWAYS GEO — Coordonnées réelles des seuils de piste
 * ================================================================
 *
 * FONCTIONNALITÉ
 * --------------
 * Fournit les coordonnées (lat/lon) des seuils de chaque piste d'un terrain,
 * pour permettre un tracé vectoriel précis sur la carte régionale — y compris
 * pour les pistes sécantes (ex. 04/22 et 08/26) que le calcul depuis le
 * centroïde ne sait pas représenter.
 *
 * SOURCE
 * ------
 * OurAirports — https://davidmegginson.github.io/ourairports-data/runways.csv
 * Domaine public, gratuit, sans clé, CORS natif. Contient pour chaque piste :
 *   - airport_ident (code OACI)
 *   - le_ident, le_latitude_deg, le_longitude_deg  (seuil bas)
 *   - he_ident, he_latitude_deg, he_longitude_deg  (seuil haut)
 *
 * Le CSV (~4 Mo) est téléchargé UNE seule fois puis mis en cache IndexedDB
 * (store dédié). Les visites suivantes lisent le cache local instantanément.
 *
 * ARCHITECTURE
 * ------------
 * - loadRunwaysCsv() : télécharge (si besoin) et parse le CSV en un Map
 *   OACI → [{ desig, lat, lon }, ...].
 * - getRunwayThresholds(icao) : retourne les seuils d'un terrain depuis le Map.
 * ================================================================ */

const CSV_URL = 'https://davidmegginson.github.io/ourairports-data/runways.csv';
const IDB_NAME = 'meteo-taf-cache';
const IDB_VERSION = 1;
const IDB_STORE = 'runways-geo';

// Map en mémoire : OACI → [{ desig, lat, lon, lat2, lon2, desig2 }]
let _thresholdsByIcao = null;
let _loadPromise = null;

// ----------------------------------------------------------------
// IndexedDB (store dédié, partagé avec les autres modules)
// ----------------------------------------------------------------

function _idbOpen() {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') return reject(new Error('IDB indisponible'));
        const req = indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            // Crée les stores si absents (cohabitation avec openaip.js).
            if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
            if (!db.objectStoreNames.contains('openaip')) db.createObjectStore('openaip');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function _idbGet(key) {
    return _idbOpen().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    })).catch(() => null);
}

function _idbPut(key, value) {
    return _idbOpen().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    })).catch(() => {});
}

// ----------------------------------------------------------------
// Parsing CSV
// ----------------------------------------------------------------

/**
 * Parse le CSV OurAirports en un Map OACI → pistes.
 * Format : "id","airport_ref","airport_ident",...,"le_ident","le_latitude_deg",...
 * On extrait : ident, le_ident, le_lat, le_lon, he_ident, he_lat, he_lon.
 *
 * @param {string} csv  Contenu brut du CSV.
 * @returns {Map<string, Array<{desig:string,lat:number,lon:number,desig2:string,lat2:number,lon2:number}>>}
 */
function _parseCsv(csv) {
    const lines = csv.split('\n');
    const result = new Map();

    // Index des colonnes utiles (en-tête à la ligne 0).
    const header = _parseCsvLine(lines[0]);
    const idxIdent = header.indexOf('airport_ident');
    const idxLeDesig = header.indexOf('le_ident');
    const idxLeLat = header.indexOf('le_latitude_deg');
    const idxLeLon = header.indexOf('le_longitude_deg');
    const idxHeDesig = header.indexOf('he_ident');
    const idxHeLat = header.indexOf('he_latitude_deg');
    const idxHeLon = header.indexOf('he_longitude_deg');

    if (idxIdent < 0) return result;

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line || !line.includes(',')) continue;
        const cols = _parseCsvLine(line);
        const ident = cols[idxIdent];
        if (!ident || ident.length !== 4) continue;

        const leDesig = cols[idxLeDesig];
        const leLat = parseFloat(cols[idxLeLat]);
        const leLon = parseFloat(cols[idxLeLon]);
        const heDesig = cols[idxHeDesig];
        const heLat = parseFloat(cols[idxHeLat]);
        const heLon = parseFloat(cols[idxHeLon]);

        // Il faut au moins un seuil valide.
        if (!isFinite(leLat) && !isFinite(heLat)) continue;

        if (!result.has(ident)) result.set(ident, []);
        result.get(ident).push({
            desig: leDesig || '', lat: leLat, lon: leLon,
            desig2: heDesig || '', lat2: heLat, lon2: heLon,
        });
    }
    return result;
}

/**
 * Parse une ligne CSV en gérant les guillemets et les virgules échappées.
 */
function _parseCsvLine(line) {
    const cols = [];
    let cur = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
            else inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
            cols.push(cur); cur = '';
        } else {
            cur += ch;
        }
    }
    cols.push(cur);
    return cols;
}

// ----------------------------------------------------------------
// API publique
// ----------------------------------------------------------------

/**
 * Charge le CSV des seuils de piste (depuis le cache IndexedDB ou le réseau).
 * Le Map résultat est mis en cache mémoire pour les appels suivants.
 * @returns {Promise<Map|null>} Map OACI → pistes, ou null si échec.
 */
export async function loadRunwaysCsv() {
    if (_thresholdsByIcao) return _thresholdsByIcao;
    if (_loadPromise) return _loadPromise;

    _loadPromise = (async () => {
        // 1. Cache IndexedDB (version datée pour invalider quand le CSV évolue).
        const CACHE_KEY = 'thresholds-v1';
        const cached = await _idbGet(CACHE_KEY);
        if (cached && typeof cached === 'string' && cached.length > 1000) {
            _thresholdsByIcao = _parseCsv(cached);
            return _thresholdsByIcao;
        }

        // 2. Téléchargement réseau. Le CSV OurAirports supporte CORS natif
        //    (Access-Control-Allow-Origin: *), donc fetch direct — pas de proxy
        //    (le fichier fait ~4 Mo, le proxy Google le tronquerait).
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 25000);
            const res = await fetch(CSV_URL, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const csv = await res.text();
            if (!csv || csv.length < 1000) return null;
            _thresholdsByIcao = _parseCsv(csv);
            _idbPut(CACHE_KEY, csv);  // cache pour les prochaines visites.
            return _thresholdsByIcao;
        } catch (e) {
            console.warn('Runways CSV load failed:', e.message);
            return null;
        }
    })();

    return _loadPromise;
}

/**
 * Retourne les seuils de piste d'un terrain, avec leurs coordonnées réelles.
 * Déclenche le chargement du CSV si nécessaire (premier appel).
 *
 * @param {string} icao Code OACI (ex: 'LFPG').
 * @returns {Promise<Array<{desig:string,lat:number,lon:number,desig2:string,lat2:number,lon2:number}>>}
 *          Tableau des pistes, ou tableau vide si indisponible.
 */
export async function getRunwayThresholds(icao) {
    if (!icao) return [];
    const map = await loadRunwaysCsv();
    if (!map) return [];
    return map.get(icao.toUpperCase()) || [];
}

/**
 * Indique si les seuils de piste sont déjà chargés en mémoire (synchrone).
 * Utile pour éviter un flash si les données sont déjà disponibles.
 */
export function runwaysGeoReady() {
    return _thresholdsByIcao !== null;
}
