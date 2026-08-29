import { memoGet } from './core.js';
import { getOfficialDeclination } from './sia-data.js';

const _sessionCache = new Map();

const LS_KEY = 'magvar-cache';

function _readLs() {
    try {
        return JSON.parse(localStorage.getItem(LS_KEY)) || {};
    } catch {
        return {};
    }
}

function _writeLs(icao, dec) {
    try {
        const cache = _readLs();
        cache[icao.toUpperCase()] = dec;
        localStorage.setItem(LS_KEY, JSON.stringify(cache));
    } catch {

    }
}

export function getDeclinationForIcao(icao) {
    if (!icao) return 0;
    const key = icao.toUpperCase();

    if (_sessionCache.has(key)) return _sessionCache.get(key);

    // Déclinaison OFFICIELLE SIA (France, AdMagVar millésimé — ex. 0,24°
    // 2025) en priorité sur le modèle WMM2020 ; null tant que sia-data
    // n'est pas chargé ou hors France.
    const sia = getOfficialDeclination(key);
    if (typeof sia === 'number') {
        _sessionCache.set(key, sia);
        _writeLs(icao, sia);
        return sia;
    }

    const lsCache = _readLs();
    if (typeof lsCache[key] === 'number') {
        _sessionCache.set(key, lsCache[key]);
        return lsCache[key];
    }

    // Calcul synchrone via la lib geomag (WMM2020, chargée en <script> dans index.html).
    // Indépendant du réseau : garantit une valeur réelle même si OpenAIP ne répond pas.
    _fetchAndCache(icao);
    return _sessionCache.get(key) ?? 0;
}

export async function getDeclinationForIcaoAsync(icao) {
    if (!icao) return 0;
    const key = icao.toUpperCase();
    if (_sessionCache.has(key)) return _sessionCache.get(key);

    const sia = getOfficialDeclination(key);
    if (typeof sia === 'number') {
        _sessionCache.set(key, sia);
        _writeLs(icao, sia);
        return sia;
    }

    const lsCache = _readLs();
    if (typeof lsCache[key] === 'number') {
        _sessionCache.set(key, lsCache[key]);
        return lsCache[key];
    }

    _fetchAndCache(icao);
    return _sessionCache.get(key) ?? 0;
}

function _getCoords(icao) {
    const memo = memoGet(icao);
    if (memo && typeof memo.lat === 'number') {
        return { lat: memo.lat, lon: memo.lon };
    }
    return { lat: null, lon: null };
}

// Calcule la déclinaison (°, convention : + = Est, - = Ouest) via le modèle
// WMM (World Magnetic Model) embarqué dans vendor/geomag.js (lib MIT, ~9 Ko).
// Précision : ~±1° (modèle WMM2020 extrapolé ; suffisant en VFR où la tolérance
// de nav est de ±5°). La lib expose window.geomag.field(lat, lon, altM) → { declination }.
function _fetchAndCache(icao) {
    if (!icao) return;
    const { lat, lon } = _getCoords(icao);
    if (lat == null || lon == null) return;
    try {
        if (typeof window !== 'undefined' && window.geomag && typeof window.geomag.field === 'function') {
            const result = window.geomag.field(lat, lon, 0);
            const dec = result?.declination;
            if (typeof dec === 'number' && !isNaN(dec)) {
                _writeLs(icao, dec);
                _sessionCache.set(icao.toUpperCase(), dec);
            }
        }
    } catch {
        // Silencieux : on garde le comportement par défaut (0).
    }
}

export async function preloadDeclination(icao) {
    if (!icao) return;
    const key = icao.toUpperCase();
    if (_sessionCache.has(key)) return;
    const lsCache = _readLs();
    if (typeof lsCache[key] === 'number') {
        _sessionCache.set(key, lsCache[key]);
        return;
    }
    _fetchAndCache(icao);
}

export function getMagneticDeclination(lat, lon) {
    if (lat == null || lon == null) return 0;
    const key = `${lat.toFixed(0)},${lon.toFixed(0)}`;
    if (_sessionCache.has(key)) return _sessionCache.get(key);
    const lsCache = _readLs();
    if (typeof lsCache[key] === 'number') return lsCache[key];
    // Calcul direct via la lib geomag (évite de dépendre d'un ICAO).
    try {
        if (typeof window !== 'undefined' && window.geomag && typeof window.geomag.field === 'function') {
            const dec = window.geomag.field(lat, lon, 0)?.declination;
            if (typeof dec === 'number' && !isNaN(dec)) {
                _sessionCache.set(key, dec);
                _writeLs(key, dec);
                return dec;
            }
        }
    } catch {
        // Silencieux.
    }
    return 0;
}

export function trueToMagnetic(trueHdg, lat, lon) {
    if (trueHdg == null) return null;
    const dec = getMagneticDeclination(lat, lon);
    return (((trueHdg - dec) % 360) + 360) % 360;
}

export function magneticToTrue(magHdg, lat, lon) {
    if (magHdg == null) return null;
    const dec = getMagneticDeclination(lat, lon);
    return (((magHdg + dec) % 360) + 360) % 360;
}

export function _clearSessionCache() {
    _sessionCache.clear();
}

// Permet à un module externe (ex: openaip.js) de peupler le cache déclinaison
// avec une valeur déjà connue, sans repasser par _fetchAndCache. Utile pour
// réinjecter la magneticDeclination d'OpenAIP dès qu'elle est récupérée.
export function injectMagvar(icao, dec) {
    if (!icao || typeof dec !== 'number' || isNaN(dec)) return;
    const key = icao.toUpperCase();
    _sessionCache.set(key, dec);
    _writeLs(icao, dec);
}
