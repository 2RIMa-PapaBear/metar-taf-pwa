// fetch direct (sans proxy ni queue) : l'endpoint /elevation d'Open-Meteo autorise
// CORS nativement et n'a pas de limite stricte nécessitant la queue de fetchOpenMeteo.
async function _fetchElevation(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) return null;
        return await res.json();
    } finally {
        clearTimeout(timeoutId);
    }
}

const ENDPOINT = 'https://api.open-meteo.com/v1/elevation';
const FT_PER_M = 3.28084;

const DEFAULT_SAMPLES = 20;
const MAX_SAMPLES = 100;

const _cache = new Map();
const TTL_MS = 24 * 60 * 60 * 1000;

export async function fetchRouteElevation(fromLat, fromLon, toLat, toLon, samples, endElevFt = null) {
    if (fromLat == null || toLat == null) return null;

    let n = DEFAULT_SAMPLES;
    if (samples == null) {
        const distNm = _haversineNm(fromLat, fromLon, toLat, toLon);
        n = Math.max(20, Math.min(MAX_SAMPLES, Math.round(distNm / 3)));
    } else {
        n = Math.max(2, Math.min(samples, MAX_SAMPLES));
    }

    const key = `${fromLat.toFixed(2)},${fromLon.toFixed(2)},${toLat.toFixed(2)},${toLon.toFixed(2)},${n}`
        + `,${
            Array.isArray(endElevFt) ? endElevFt.map(v => Number.isFinite(v) ? Math.round(v) : '').join('|') : ''
        }`;
    const cached = _cache.get(key);
    if (cached && Date.now() - cached.ts < TTL_MS) return cached.profile;

    try {

        const lats = [];
        const lons = [];
        for (let i = 0; i < n; i++) {
            const t = i / (n - 1);
            lats.push((fromLat + (toLat - fromLat) * t).toFixed(4));
            lons.push((fromLon + (toLon - fromLon) * t).toFixed(4));
        }

        const url = `${ENDPOINT}?latitude=${lats.join(',')}&longitude=${lons.join(',')}`;
        let data;
        try {
            data = await _fetchElevation(url);
        } catch (e) {
            console.warn('Route elevation fetch error:', e.message);
            return null;
        }
        if (!data) return null;

        const elevs = data?.elevation;
        if (!Array.isArray(elevs) || elevs.length !== n) return null;

        const points = [];
        for (let i = 0; i < n; i++) {
            const elevFt = Math.round(elevs[i] * FT_PER_M);
            const frac = i / (n - 1);
            points.push({
                lat: parseFloat(lats[i]),
                lon: parseFloat(lons[i]),
                elevFt,
                frac,
            });
        }

        // Extrémités calées sur l'élévation OFFICIELLE des terrains (SIA /
        // openAIP, ft) quand elle est connue : la maille du modèle Open-Meteo
        // peut s'en écarter de plusieurs dizaines de pieds, la courbe
        // « démarrait alors dans le vide » aux aérodromes. Sans valeur
        // officielle, la maille est conservée.
        if (Array.isArray(endElevFt)) {
            if (Number.isFinite(endElevFt[0])) points[0].elevFt = Math.round(endElevFt[0]);
            if (Number.isFinite(endElevFt[1])) points[points.length - 1].elevFt = Math.round(endElevFt[1]);
        }

        let maxFt = -Infinity, minFt = Infinity, sumFt = 0;
        for (const p of points) {
            if (p.elevFt > maxFt) maxFt = p.elevFt;
            if (p.elevFt < minFt) minFt = p.elevFt;
            sumFt += p.elevFt;
        }

        const profile = {
            points,
            maxFt,
            minFt,
            avgFt: Math.round(sumFt / points.length),
        };

        _cache.set(key, { profile, ts: Date.now() });
        return profile;
    } catch (e) {
        console.warn('Route elevation fetch failed:', e.message);
        return null;
    }
}

export function evaluateClearance(profile, cruiseAltFt, minClearanceFt = 1000) {
    if (!profile?.points?.length) return { minClearanceFt: null, worstPoint: null, level: 'ok' };

    let worst = profile.points[0];
    let worstClear = cruiseAltFt - worst.elevFt;

    for (const p of profile.points) {
        const clear = cruiseAltFt - p.elevFt;
        if (clear < worstClear) {
            worstClear = clear;
            worst = p;
        }
    }

    let level = 'ok';
    if (worstClear < 0) level = 'danger';
    else if (worstClear < minClearanceFt) level = 'caution';

    return { minClearanceFt: worstClear, worstPoint: worst, level };
}

export function _clearCache() { _cache.clear(); }

// Profil d'élévation multi-segments : concatène plusieurs fetchRouteElevation
// (un par leg), en recalculant `frac` sur la distance cumulée totale.
// `segments` = [[fromLat, fromLon, toLat, toLon], ...].
// `wpElevFt` = élévations OFFICIELLES (ft) des points de route, indexées par
// waypoint (longueur = segments.length + 1) : chaque jonction de segments —
// départ, étapes intermédiaires, arrivée — est ancrée à l'élévation du
// terrain correspondant (la maille Open-Meteo peut en différer). Les valeurs
// non finies laissent la maille du modèle.
export async function fetchMultiSegmentElevation(segments, wpElevFt = null) {
    if (!Array.isArray(segments) || !segments.length) return null;

    const profiles = [];
    const distances = [];
    let totalNm = 0;

    for (let s = 0; s < segments.length; s++) {
        const [fla, flo, tla, tlo] = segments[s];
        const ends = Array.isArray(wpElevFt) ? [wpElevFt[s], wpElevFt[s + 1]] : null;
        const prof = await fetchRouteElevation(fla, flo, tla, tlo, null, ends);
        if (!prof) return null;   // si un segment échoue, on abandonne (cohérence)
        const nm = _haversineNm(fla, flo, tla, tlo);
        profiles.push(prof);
        distances.push(nm);
        totalNm += nm;
    }

    if (totalNm === 0) return null;

    // Concatène en évitant les doublons aux jonctions (le dernier point d'un segment
    // ≈ le premier point du suivant) — on décale frac sur la distance cumulée.
    const allPoints = [];
    let cumNm = 0;
    for (let s = 0; s < profiles.length; s++) {
        const prof = profiles[s];
        const segNm = distances[s];
        const start = allPoints.length > 0 ? 1 : 0; // skip doublon de jonction
        for (let i = start; i < prof.points.length; i++) {
            const p = prof.points[i];
            const localFrac = i / (prof.points.length - 1);
            const globalFrac = (cumNm + localFrac * segNm) / totalNm;
            allPoints.push({ ...p, frac: globalFrac });
        }
        cumNm += segNm;
    }

    const elevs = allPoints.map(p => p.elevFt);
    return {
        points: allPoints,
        maxFt: Math.max(...elevs),
        minFt: Math.min(...elevs),
        avgFt: Math.round(elevs.reduce((a, b) => a + b, 0) / elevs.length),
    };
}

function _haversineNm(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return Math.round(2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) / 1852);
}
