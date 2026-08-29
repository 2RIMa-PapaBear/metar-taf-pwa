/* ================================================================
 * PIREPS — Pilot Reports (rapports en vol des pilotes)
 * ================================================================
 *
 * POURQUOI
 * --------
 * Les PIREPs (Pilot Reports) sont des observations météo faites en
 * vol par d'autres pilotes : turbulence, givrage observé, base et
 * sommet de nuages, visibilité en vol. Ce sont les données les plus
 * "fraîches" et crédibles dont dispose un pilote avant son propre vol
 * — un pilote qui signale une turbulence sévère sur une route est
 * une information autrement plus actionnable qu'une prévision AIRMET.
 *
 * SOURCE
 * ------
 * API AviationWeather.gov /data/pirep — PIREPs par zone (bbox obligatoire
 * depuis le renommage d'aircraftrep, constaté 2026-08-19). Comme
 * l'endpoint ne renvoie pas les en-têtes CORS, on passe par le proxy
 * Google Apps Script existant (fetchAvecRelais).
 *
 * Les PIREPs sont codés dans un format spécifique (UR PA..., UUA
 * pour urgent). On parse le texte brut pour extraire : localisation,
 * type d'observation (turbu/givrage/base-sommet), intensité, altitude.
 *
 * INTÉGRATION
 * -----------
 * On filtre géographiquement (comme pour les SIGMETs) autour de la
 * zone d'intérêt, puis on place des marqueurs sur la carte régionale.
 * Le pilote voit en un coup d'œil les conditions réelles signalées
 * par ses confrères.
 * ================================================================ */

import { fetchAvecRelais } from './core.js';

// Cache session par bbox arrondie.
const _cache = new Map();
const TTL_MS = 10 * 60 * 1000;  // 10 min (les PIREPs évoluent vite).

/**
 * Récupère les PIREPs proches d'un point et les parse.
 * @param {number} lat Latitude du centre.
 * @param {number} lon Longitude du centre.
 * @param {number} [radiusDeg=3] Rayon de recherche en degrés (~1° ≈ 111 km).
 * @returns {Promise<Array<{raw:string, type:string, lat:number, lon:number, altFt:number, intensity:string}>>}
 */
export async function fetchPireps(lat, lon, radiusDeg = 3) {
    if (lat == null || lon == null) return [];

    const key = `${lat.toFixed(1)},${lon.toFixed(1)}`;
    const cached = _cache.get(key);
    if (cached && Date.now() - cached.ts < TTL_MS) return cached.pireps;

    try {
        // Endpoint renommé par AviationWeather (constaté 2026-08-19) :
        // /data/aircraftrep → /data/pirep, avec bbox OBLIGATOIRE (une requête
        // mondiale renvoie 400). Fenêtre 24h pour garder les mêmes données
        // qu'avant le renommage ; zone sans PIREP → 204 corps vide.
        const r = Math.min(radiusDeg, 5);
        const bbox = [
            Math.max(-90, lat - r).toFixed(2), Math.max(-180, lon - r).toFixed(2),
            Math.min(90, lat + r).toFixed(2), Math.min(180, lon + r).toFixed(2),
        ].join(',');
        const url = `https://aviationweather.gov/api/data/pirep?bbox=${bbox}&format=json&hours=24`;
        const data = await fetchAvecRelais(url, 'json');

        if (!Array.isArray(data)) return [];

        const relevant = [];
        for (const p of data) {
            const raw = p.rawOb || p.rawText || p.raw || '';
            if (!raw) continue;

            // Coordonnées du PIREP.
            const pLat = typeof p.lat === 'number' ? p.lat : null;
            const pLon = typeof p.lon === 'number' ? p.lon : null;

            // Filtrage géographique si coords disponibles.
            if (pLat != null && pLon != null) {
                if (Math.abs(pLat - lat) > radiusDeg || Math.abs(pLon - lon) > radiusDeg) continue;
            } else {
                // Sans coords, on tente d'extraire depuis le texte (rare mais possible).
                continue;
            }

            const parsed = _parsePirep(raw);
            relevant.push({
                raw,
                type: parsed.type,
                intensity: parsed.intensity,
                altFt: parsed.altFt,
                lat: pLat,
                lon: pLon,
            });
        }

        _cache.set(key, { pireps: relevant, ts: Date.now() });
        return relevant;
    } catch (e) {
        console.warn('PIREPs fetch failed:', e.message);
        return [];
    }
}

/**
 * Parse un PIREP brut pour extraire type/intensité/altitude.
 * Format typique : "UUA / OV LFMN / TM 1230 / FL080 / TB SEV / IC LGT"
 * @returns {{type:string, intensity:string, altFt:number|null}}
 */
function _parsePirep(raw) {
    const upper = raw.toUpperCase();

    // Détection du type de phénomène.
    let type = 'OTHER';
    if (/\bTB\b|TURB|TURBULENCE/.test(upper)) type = 'TURB';
    else if (/\bICE\b|ICING|\bFZRA\b|\bFZDZ\b/.test(upper)) type = 'ICE';
    else if (/\bTOP\b|\bBASE\b|\bCIG\b/.test(upper)) type = 'CLOUD';
    else if (/VIS|VISIBILITY/.test(upper)) type = 'VIS';
    else if (/WND|WIND/.test(upper)) type = 'WIND';

    // Intensité (LGT = light, MOD = moderate, SEV = severe, EXT = extreme).
    let intensity = '';
    const intMatch = upper.match(/\b(LGT|MOD|SEV|EXT|EXTRM|LIGHT|MODERATE|SEVERE|EXTREME)\b/);
    if (intMatch) {
        intensity = intMatch[1];
    }

    // Altitude : FL080, FL250, ou altitude "080", "15000".
    let altFt = null;
    const flMatch = upper.match(/\bFL(\d{3})\b/);
    if (flMatch) {
        altFt = parseInt(flMatch[1], 10) * 100;
    } else {
        const altMatch = upper.match(/\b(?:TOP|BASE|ALT)?\s*(\d{4,5})\s*(?:FT|M)\b/);
        if (altMatch) altFt = parseInt(altMatch[1], 10);
    }

    return { type, intensity, altFt };
}

/**
 * Retourne les métadonnées d'affichage (icône, couleur, libellé) d'un type PIREP.
 * @param {string} type Type de phénomène (TURB/ICE/CLOUD/VIS/WIND/OTHER).
 * @param {string} intensity Intensité (LGT/MOD/SEV/EXT).
 * @returns {{icon:string, color:string, labelFr:string, labelEn:string}}
 */
export function pirepDisplayMeta(type, intensity) {
    const sev = /^(SEV|EXT|EXTRM|SEVERE|EXTREME)$/.test(intensity);
    const mod = /^(MOD|MODERATE)$/.test(intensity);

    const META = {
        TURB: {
            icon: 'wind',
            color: sev ? '#EF4444' : (mod ? '#F59E0B' : '#FBBF24'),
            labelFr: sev ? 'Turbulence sévère' : (mod ? 'Turbulence modérée' : 'Turbulence légère'),
            labelEn: sev ? 'Severe turbulence' : (mod ? 'Moderate turbulence' : 'Light turbulence'),
        },
        ICE: {
            icon: 'snowflake',
            color: sev ? '#EF4444' : (mod ? '#F59E0B' : '#38BDF8'),
            labelFr: sev ? 'Givrage sévère' : (mod ? 'Givrage modéré' : 'Givrage léger'),
            labelEn: sev ? 'Severe icing' : (mod ? 'Moderate icing' : 'Light icing'),
        },
        CLOUD: {
            icon: 'cloud',
            color: '#94A3B8',
            labelFr: 'Base/sommet de nuages',
            labelEn: 'Cloud base/tops',
        },
        VIS: {
            icon: 'eye',
            color: '#F59E0B',
            labelFr: 'Visibilité en vol',
            labelEn: 'In-flight visibility',
        },
        WIND: {
            icon: 'wind',
            color: '#94A3B8',
            labelFr: 'Vent en vol',
            labelEn: 'In-flight wind',
        },
        OTHER: {
            icon: 'radio',
            color: '#94A3B8',
            labelFr: 'Rapport pilote',
            labelEn: 'Pilot report',
        },
    };
    return META[type] || META.OTHER;
}

/**
 * Invalide le cache session.
 */
export function _clearCache() { _cache.clear(); }
