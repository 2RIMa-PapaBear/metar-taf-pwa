/* ================================================================
 * WINDS ALOFT — Vents en altitude (Open-Meteo)
 * ================================================================
 *
 * POURQUOI
 * --------
 * En navigation VFR, le vent au sol (METAR) ne suffit pas : on vole
 * à 1000-3000 ft où le vent peut être significativement différent en
 * force et en direction. Pour calculer la dérive, le cap à suivre et
 * le temps de vol, il faut connaître le vent réel à l'altitude de
 * croisière.
 *
 * SOURCE
 * ------
 * Open-Meteo forecast endpoint — gratuit, sans clé, CORS natif.
 * Variables disponibles à 10/80/180 mètres et à des altitudes
 * isobariques (1000 hPa, 975 hPa, 950 hPa... jusqu'à 50 hPa) :
 *   - windspeed_<alt>m       : vitesse en km/h
 *   - winddirection_<alt>m   : direction en degrés (origine, vraie)
 *
 * On interroge les altitudes 80 m, 180 m, 1000 m, 1500 m, 2000 m,
 * 3000 m (≈ AGL 250/600/3300/5000/6500/10000 ft au-dessus du sol)
 * — couvre toute la plage VFR de transit.
 *
 * On interpole linéairement entre les niveaux pour obtenir le vent
 * à n'importe quelle altitude (ft MSL).
 *
 * CACHE
 * -----
 * Cache session mémoire (Map) par coordonnées arrondies au 0.1°.
 * TTL 1 heure (les vents évoluent sur cette échelle).
 * ================================================================ */

import { fetchOpenMeteo } from './core.js';

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

// Niveaux altimétriques interrogés (mètres au-dessus du sol).
const LEVELS_M = [80, 180, 1000, 1500, 2000, 3000];
const FT_PER_M = 3.28084;

// Cache session : clé "lat,lon" arrondie → { winds, ts }.
const _cache = new Map();
const TTL_MS = 60 * 60 * 1000;  // 1 heure.

/**
 * Récupère les vents en altitude pour une position.
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @returns {Promise<Array<{altFt:number, speedKt:number, dir:number}>|null>}
 *   Liste des vents par niveau (ft MSL, kt, degrés vrais d'origine).
 */
export async function fetchWindsAloft(lat, lon) {
    if (lat == null || lon == null) return null;

    const key = `${lat.toFixed(1)},${lon.toFixed(1)}`;
    const cached = _cache.get(key);
    if (cached && Date.now() - cached.ts < TTL_MS) return cached.winds;

    try {
        // Construction de la liste des variables à demander.
        const speedVars = LEVELS_M.map(h => `windspeed_${h}m`);
        const dirVars = LEVELS_M.map(h => `winddirection_${h}m`);
        const vars = [...speedVars, ...dirVars].join(',');

        const url = `${ENDPOINT}?latitude=${lat}&longitude=${lon}` +
            `&current=${vars}&timezone=auto`;

        let data;
        try { data = await fetchOpenMeteo(url); } catch { return null; }
        if (!data) return null;

        const cur = data?.current;
        if (!cur) return null;

        // Assemble la liste des vents par niveau.
        const winds = LEVELS_M.map(h => {
            const speedKmh = cur[`windspeed_${h}m`];
            const dir = cur[`winddirection_${h}m`];
            if (typeof speedKmh !== 'number' || typeof dir !== 'number') return null;
            // km/h → kt (1 kt = 1.852 km/h).
            const speedKt = Math.round(speedKmh / 1.852);
            return { altFt: Math.round(h * FT_PER_M), speedKt, dir };
        }).filter(Boolean);

        if (winds.length === 0) return null;

        _cache.set(key, { winds, ts: Date.now() });
        return winds;
    } catch (e) {
        console.warn('Winds aloft fetch failed:', e.message);
        return null;
    }
}

/**
 * Obtient le vent interpolé à une altitude donnée (ft MSL).
 * Interpolation linéaire entre les niveaux connus.
 * @param {Array} winds Liste issue de fetchWindsAloft.
 * @param {number} altFt Altitude cible (ft MSL).
 * @returns {{speedKt:number, dir:number}|null}
 */
export function getWindAtAltitude(winds, altFt) {
    if (!Array.isArray(winds) || winds.length === 0) return null;

    // Sous le niveau le plus bas → on renvoie le plus bas.
    if (altFt <= winds[0].altFt) return { speedKt: winds[0].speedKt, dir: winds[0].dir };
    // Au-dessus du plus haut → le plus haut.
    const last = winds[winds.length - 1];
    if (altFt >= last.altFt) return { speedKt: last.speedKt, dir: last.dir };

    // Trouve l'encadrement.
    for (let i = 0; i < winds.length - 1; i++) {
        const a = winds[i], b = winds[i + 1];
        if (altFt >= a.altFt && altFt <= b.altFt) {
            const t = (altFt - a.altFt) / (b.altFt - a.altFt);
            const speedKt = Math.round(a.speedKt + (b.speedKt - a.speedKt) * t);
            // Direction : interpolation circulaire (pour éviter le saut 359→001).
            const dir = _interpAngle(a.dir, b.dir, t);
            return { speedKt, dir };
        }
    }
    return null;
}

/**
 * Interpolation angulaire (gère le passage 360°→0°).
 */
function _interpAngle(a, b, t) {
    let diff = b - a;
    if (diff > 180) diff -= 360;
    else if (diff < -180) diff += 360;
    let r = a + diff * t;
    return Math.round(((r % 360) + 360) % 360);
}

/**
 * Invalide le cache session (utile pour les tests).
 */
export function _clearCache() { _cache.clear(); }
