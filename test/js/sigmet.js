import { state, I18N, fetchAvecRelais } from './core.js';

export async function fetchSigmetAirmet(lat, lon, radiusDeg = 5) {
    if (lat == null || lon == null) return [];
    try {

        const url = `https://aviationweather.gov/api/data/sigmet?format=json`;
        const data = await fetchAvecRelais(url, 'json');

        if (!Array.isArray(data)) return [];

        const relevant = [];
        for (const item of data) {

            const raw = item.rawAirSigmet || item.rawText || item.raw || item.rawSigmet || '';
            if (!raw) continue;

            const coords = Array.isArray(item.coords) ? item.coords : [];
            const isNear = coords.length === 0 || coords.some(c =>
                typeof c.lat === 'number' && typeof c.lon === 'number' &&
                Math.abs(c.lat - lat) <= radiusDeg && Math.abs(c.lon - lon) <= radiusDeg
            );

            const isNearFromText = coords.length === 0 && _isNearFromText(raw, lat, lon, radiusDeg);

            if (isNear || isNearFromText) {
                // Conserve la géométrie pour permettre le tracé sur la carte Leaflet.
                const allCoords = coords.length ? coords : _extractCoords(raw);
                relevant.push({
                    raw,
                    type: item.airSigmetType || (item.type === 'A' ? 'AIRMET' : 'SIGMET'),
                    hazard: item.hazard || _inferHazard(raw),
                    obs: /OBS|OBSERVED/i.test(raw),
                    coords: allCoords,
                    polygon: allCoords.length >= 3 ? _toLeafletRing(allCoords) : null,
                    center: allCoords.length ? _centroid(allCoords) : null,
                });
            }
        }

        return relevant;
    } catch (e) {
        console.warn('SIGMET/AIRMET fetch failed:', e);
        return [];
    }
}

function _isNearFromText(raw, lat, lon, radiusDeg) {
    const coords = _extractCoords(raw);
    return coords.some(c =>
        Math.abs(c.lat - lat) <= radiusDeg && Math.abs(c.lon - lon) <= radiusDeg
    );
}

function _extractCoords(raw) {
    const coords = [];

    const re = /(\d{2,4})([NS])\s+(\d{2,5})([EW])/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
        const latRaw = m[1];
        const lonRaw = m[3];
        const lat = parseInt(latRaw.slice(0, 2), 10) + (latRaw.length > 2 ? parseInt(latRaw.slice(2), 10) / 60 : 0);

        const lonDegLen = lonRaw.length > 4 ? 3 : 2;
        const lon = parseInt(lonRaw.slice(0, lonDegLen), 10) + (lonRaw.length > lonDegLen ? parseInt(lonRaw.slice(lonDegLen), 10) / 60 : 0);
        coords.push({
            lat: m[2] === 'S' ? -lat : lat,
            lon: m[4] === 'W' ? -lon : lon,
        });
    }
    return coords;
}

// Convertit une liste de {lat,lon} en anneau Leaflet [[lat,lon],...].
function _toLeafletRing(coords) {
    return coords.map(c => [c.lat, c.lon]);
}

// Centre approché (moyenne arithmétique) — utilisé comme fallback quand le
// polygone n'est pas exploitable (moins de 3 points) pour positionner un marker.
function _centroid(coords) {
    if (!coords.length) return null;
    const sum = coords.reduce((acc, c) => ({ lat: acc.lat + c.lat, lon: acc.lon + c.lon }), { lat: 0, lon: 0 });
    return { lat: sum.lat / coords.length, lon: sum.lon / coords.length };
}

// Palette couleurs par hazard SIGMET/AIRMET (source unique — réutilisée par la carte).
export const HAZARD_COLORS = {
    TS: '#EF4444',   // orages — rouge
    ICE: '#3B82F6',  // givrage — bleu
    TURB: '#F97316', // turbulence — orange
    MTW: '#A855F7',  // onde de montagne — violet
    HAIL: '#EF4444', // grêle — rouge
    VA: '#6B7280',   // cendres volcaniques — gris
    IFR: '#94A3B8',  // conditions IFR — gris-bleu
    OTHER: '#FBBF24',// autre — ambre
};

function _inferHazard(raw) {
    const r = raw.toUpperCase();
    if (/\bTS\b|\bTHUNDERSTORM|CONVECTIVE/.test(r)) return 'TS';
    if (/\bICE\b|\bICING|\bFZRA/.test(r)) return 'ICE';
    if (/\bTURB|\bTURBULENCE/.test(r)) return 'TURB';
    if (/\bMTN|\bMOUNTAIN WAVE/.test(r)) return 'MTW';
    if (/\bHAIL|\bGR\b/.test(r)) return 'HAIL';
    if (/\bASH|\bVOLCANIC/.test(r)) return 'VA';
    if (/\bIFR|\bCIG|\bVIS/.test(r)) return 'IFR';
    return 'OTHER';
}

export function evaluateSigmetAirmet(sigmets) {
    if (!sigmets || sigmets.length === 0) return [];
    const isFr = state.lang === 'fr';
    const results = [];

    const hazardLabels = {
        'TS': { fr: 'Orages (SIGMET)', en: 'Thunderstorms (SIGMET)', icon: 'cloud-lightning', level: 'danger' },
        'ICE': { fr: 'Givrage (SIGMET/AIRMET)', en: 'Icing (SIGMET/AIRMET)', icon: 'snowflake', level: 'danger' },
        'TURB': { fr: 'Turbulence (SIGMET/AIRMET)', en: 'Turbulence (SIGMET/AIRMET)', icon: 'wind', level: 'caution' },
        'MTW': { fr: 'Onde de montagne', en: 'Mountain wave', icon: 'mountain-snow', level: 'caution' },
        'HAIL': { fr: 'Grêle', en: 'Hail', icon: 'cloud-hail', level: 'danger' },
        'VA': { fr: 'Cendres volcaniques', en: 'Volcanic ash', icon: 'cloudy', level: 'danger' },
        'IFR': { fr: 'Conditions IFR (AIRMET)', en: 'IFR conditions (AIRMET)', icon: 'cloud-fog', level: 'caution' },
        'OTHER': { fr: 'Phénomène météo significatif', en: 'Significant weather', icon: 'alert-triangle', level: 'caution' },
    };

    const seenHazards = new Set();
    for (const s of sigmets) {
        if (seenHazards.has(s.hazard)) continue;
        seenHazards.add(s.hazard);

        const lbl = hazardLabels[s.hazard] || hazardLabels.OTHER;
        results.push({
            level: lbl.level,
            icon: lbl.icon,
            text: isFr ? lbl.fr : lbl.en,
        });
    }

    return results;
}
