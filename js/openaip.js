import { config } from './config.js';
import { injectMagvar } from './magvar.js';

const BASE_URL = 'https://api.core.openaip.net/api/airports';
const FT_PER_M = 3.28084;

const IDB_NAME = 'openaip-cache';
const IDB_STORE = 'airports';
const IDB_VERSION = 1;

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

async function _idbGet(icao) {
    try {
        const db = await _openDB();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, 'readonly');
            const req = tx.objectStore(IDB_STORE).get(icao.toUpperCase());
            req.onsuccess = () => { db.close(); resolve(req.result || null); };
            req.onerror = () => { db.close(); reject(req.error); };
        });
    } catch { return null; }
}

async function _idbPut(icao, data) {
    try {
        const db = await _openDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            tx.objectStore(IDB_STORE).put({ data, ts: Date.now() }, icao.toUpperCase());
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => { db.close(); reject(tx.error); };
        });
    } catch {   }
}

function _mapSurface(mainComposite) {
    switch (mainComposite) {
        case 0: return 'ASP';
        case 1: return 'CON';
        case 2: return 'GRS';
        case 3: return 'GVL';
        case 4: return 'GRE';
        case 5: return 'SAN';
        case 6: return 'WAT';
        default: return 'U';
    }
}

function _mToFt(m) { return Math.round(m * FT_PER_M); }

// openAIP tape « UNK » (type 16) sur beaucoup de fréquences des petits
// terrains. Le NOM désigne parfois le vrai rôle (« A/A », « AIR-AIR »,
// « TWR »…) → vraie étiquette ; sinon PAS D'ÉTIQUETTE (jamais « UNK » à
// l'affichage — le détail des waypoints montre la fréquence seule : la
// valeur est fiable, le rôle community ne l'est pas).
// Sert AUSSI à assainir les entrées du cache IndexedDB écrites avant cette
// règle (elles portent des « UNK » persistés).
export function _relabelUnk(name) {
    const n = String(name || '');
    if (/\bA\s*\/\s*A\b|AIR[\s\/-]?AIR/i.test(n)) return 'A/A';
    if (/\bTWR\b|TOUR DE CONTR|TOWER/i.test(n)) return 'TWR';
    if (/\bAFIS\b/i.test(n)) return 'AFIS';
    if (/\bAPP\b|APPROCHE/i.test(n)) return 'APP';
    if (/\bATIS\b/i.test(n)) return 'ATIS';
    if (/\bGND\b/i.test(n)) return 'GND';
    if (/\bDEL\b/i.test(n)) return 'DEL';
    return '';
}

/** Assainit un aéroport issu du cache IDB : requalifie ses fréquences
 *  « UNK » (entrées écrites avant la règle _relabelUnk) et repersiste. */
function _sanitizeCachedAirport(key, data) {
    if (Array.isArray(data?.frequencies) && data.frequencies.some(f => f && f.type === 'UNK')) {
        for (const f of data.frequencies) {
            if (f && f.type === 'UNK') f.type = _relabelUnk(f.name);
        }
        _idbPut(key, data);   // repersiste propre (fire-and-forget)
    }
    return data;
}

/** Mapping d'un item openAIP brut → forme interne. Exporté pour les tests. */
export function _mapAirport(aip) {
    const [lon, lat] = aip.geometry?.coordinates || [null, null];
    const elevM = aip.elevation?.value;
    const elevFt = typeof elevM === 'number' ? _mToFt(elevM) : null;

    const runways = [];
    const runwayLengths = {};
    const runwaySurfaces = {};
    let longestRunway = 0;
    let dominantSurface = null;
    const surfCounts = {};

    (aip.runways || []).forEach(rw => {
        const desig = rw.designator;
        if (!desig) return;
        const lenM = rw.dimension?.length?.value;
        const lenFt = typeof lenM === 'number' ? _mToFt(lenM) : null;
        const surfCode = _mapSurface(rw.surface?.mainComposite);

        if (lenFt) {
            runwayLengths[desig] = lenFt;
            if (lenFt > longestRunway) longestRunway = lenFt;
        }
        if (surfCode && surfCode !== 'U') {
            runwaySurfaces[desig] = surfCode;
            surfCounts[surfCode] = (surfCounts[surfCode] || 0) + 1;
        }
    });

    if (Object.keys(surfCounts).length > 0) {
        dominantSurface = Object.entries(surfCounts).sort((a, b) => b[1] - a[1])[0][0];
    }

    const FREQ_TYPE_LABELS = {
        0: 'APP',
        1: 'ARR',
        2: 'DEP',
        3: 'CTR',
        4: 'FIS',
        5: 'AFIS',
        6: 'RAD',
        7: 'INFO',
        8: 'DEL',
        9: 'GND',
        10: 'TWR',
        11: 'ATIS',
        12: 'VOLMET',
        13: 'OPS',
        14: 'TWR',
        15: 'ATIS',
        16: 'UNK',
        17: 'AOC',
        18: 'EMER',
        19: 'SAFETY',
    };
    const frequencies = (aip.frequencies || [])
        .filter(f => f && f.value)
        .map(f => {
            const label = FREQ_TYPE_LABELS[f.type] ?? 'COM';
            return {
                freq: parseFloat(f.value),
                name: f.name || '',
                type: label === 'UNK' ? _relabelUnk(f.name) : label,
                primary: !!f.primary,
            };
        })
        .filter(f => !isNaN(f.freq))

        .sort((a, b) => (b.primary - a.primary) || a.freq - b.freq);

    return {
        icao: aip.name?.match(/[A-Z]{4}/)?.[0] || '',
        name: aip.name || '',
        country: aip.country || '',
        lat,
        lon,
        elevation: elevFt,
        magneticDeclination: typeof aip.magneticDeclination === 'number' ? aip.magneticDeclination : null,
        runways: _buildRunwayPairs(aip.runways),
        runwayLengths,
        runwaySurfaces,
        longestRunway: longestRunway || null,
        surface: dominantSurface,
        frequencies,
        type: aip.type,
        source: 'openaip',
        ts: Date.now(),
    };
}

function _buildRunwayPairs(aipRunways) {
    if (!aipRunways || aipRunways.length === 0) return [];
    const pairs = [];
    const used = new Set();

    aipRunways.forEach(rw => {
        if (used.has(rw.designator)) return;

        const oppHeading = (rw.trueHeading + 180) % 360;
        let opp = aipRunways.find(o =>
            !used.has(o.designator) &&
            o.designator !== rw.designator &&
            Math.abs(o.trueHeading - oppHeading) < 5
        );
        if (!opp) {

            pairs.push(`${rw.designator} (${String(Math.round(rw.trueHeading)).padStart(3,'0')}°)`);
            used.add(rw.designator);
            return;
        }
        pairs.push(`${rw.designator} (${String(Math.round(rw.trueHeading)).padStart(3,'0')}°)/${opp.designator} (${String(Math.round(opp.trueHeading)).padStart(3,'0')}°)`);
        used.add(rw.designator);
        used.add(opp.designator);
    });

    return pairs;
}

const _memCache = new Map();

export async function fetchAirportByIcao(icao, opts = {}) {
    if (!icao) return null;
    if (!config.OPENAIP_API_KEY) return null; // miroir public : pas d'appel API
    const key = icao.toUpperCase();

    if (!opts.forceRefresh && _memCache.has(key)) return _memCache.get(key);

    if (!opts.forceRefresh) {
        const cached = await _idbGet(key);
        if (cached?.data) {
            // Entrées écrites AVANT la règle « jamais UNK » : leurs
            // fréquences « UNK » sont requalifiées (puis repersistées) —
            // sinon le cache IndexedDB (sans TTL) resservait le vieux
            // libellé indéfiniment.
            const data = _sanitizeCachedAirport(key, cached.data);
            _memCache.set(key, data);
            return data;
        }
    }

    try {
        const url = `${BASE_URL}?search=${encodeURIComponent(key)}&limit=1`;
        const res = await fetch(url, {
            headers: { 'x-openaip-api-key': config.OPENAIP_API_KEY },
            signal: AbortSignal.timeout(12000),
        });
        if (!res.ok) {
            console.warn('OpenAIP fetch failed:', res.status);
            return null;
        }
        const data = await res.json();
        const item = data.items?.[0];
        if (!item) return null;

        const mapped = _mapAirport(item);

        mapped.icao = key;

        // Réinjecte la déclinaison magnétique d'OpenAIP dans le cache magvar,
        // pour que getDeclinationForIcao() renvoie une valeur réelle au lieu de 0.
        if (typeof mapped.magneticDeclination === 'number') {
            injectMagvar(key, mapped.magneticDeclination);
        }

        _memCache.set(key, mapped);
        _idbPut(key, mapped);
        return mapped;
    } catch (e) {
        console.warn('OpenAIP fetch error:', e.message);
        return null;
    }
}

export async function searchAirports(query, limit = 8) {
    if (!query || query.trim().length < 2) return [];
    if (!config.OPENAIP_API_KEY) return [];   // miroir public : pas d'appel API
    try {
        const url = `${BASE_URL}?search=${encodeURIComponent(query.trim())}&limit=${limit}`;
        const res = await fetch(url, {
            headers: { 'x-openaip-api-key': config.OPENAIP_API_KEY },
            signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return [];
        const data = await res.json();
        return (data.items || []).map(a => {
            const [lon, lat] = a.geometry?.coordinates || [null, null];
            return {
                icao: _extractIcao(a),
                name: a.name || '',
                country: a.country || '',
                lat,
                lon,
                type: a.type,
            };
        }).filter(a => a.name);
    } catch {
        return [];
    }
}

function _extractIcao(aip) {

    if (aip.icaoId && /^[A-Z][A-Z0-9]{3}$/.test(aip.icaoId)) return aip.icaoId;
    if (aip.ICAO && /^[A-Z][A-Z0-9]{3}$/.test(aip.ICAO)) return aip.ICAO;

    return '';
}

export function _clearMemCache() {
    _memCache.clear();
}
