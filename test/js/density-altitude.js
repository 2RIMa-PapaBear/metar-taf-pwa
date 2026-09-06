/* ================================================================
 * DENSITY ALTITUDE — Calculateur de performances
 * ================================================================
 *
 * CONTEXTE AÉRONAUTIQUE
 * ---------------------
 * La densité altitude (altitude densité) est l'altitude à laquelle
 * l'atmosphère standard (ISA) aurait la même densité que l'air réel.
 * C'est ELLE qui détermine les performances réelles de l'avion :
 * taux de montée, distance de décollage, distance d'atterrissage.
 *
 * Un jour d'été à 30°C sur un terrain à 2000 ft avec QNH 1013 :
 *   - Pressure Altitude ≈ 2000 ft
 *   - OAT = 30°C, ISA à 2000 ft = 15 - 2×2 = 11°C
 *   - Density Altitude ≈ 2000 + 118.8 × (30 - 11) ≈ 4257 ft
 *   → L'avion se comporte comme s'il était à 4257 ft en atmosphère standard !
 *
 * Conséquence pour un C172 : perte significative de taux de montée
 * et d'allongement du roulage, surtout sur piste en herbe.
 *
 * FORMULES (atmosphère standard, approximation opérationnelle)
 * ------------------------------------------------------------
 *  Pressure Altitude (ft) = Elevation(ft) + 27 × (1013.25 − QNH_hPa)
 *  Température ISA à une altitude (°C) = 15 − 1.98 × Alt(ft)/1000
 *  Density Altitude (ft) = PA(ft) + 118.8 × (OAT_°C − ISA_Temp_°C)
 *
 * Ces formules sont des approximations opérationnelles suffisantes pour
 * une aide à la décision. Le manuel de vol de l'avion reste la référence.
 * ================================================================ */

import { state, I18N, memoGet } from './core.js';
import { getAirportByICAO } from './ui-module.js';

// Seuil d'alerte par défaut (densité altitude au-dessus de laquelle on prévient).
// 3000 ft est une valeur communément retenue en instruction VFR.
const DEFAULT_DA_THRESHOLD = 3000;

const STORAGE_KEY = 'density-altitude-threshold';

/**
 * Récupère le seuil d'alerte densité altitude (persistance utilisateur).
 * @returns {number} Seuil en pieds.
 */
export function getDaThreshold() {
    try {
        const v = parseInt(localStorage.getItem(STORAGE_KEY), 10);
        return isNaN(v) ? DEFAULT_DA_THRESHOLD : v;
    } catch {
        return DEFAULT_DA_THRESHOLD;
    }
}

/**
 * Définit le seuil d'alerte densité altitude.
 * @param {number} ft Seuil en pieds.
 */
export function setDaThreshold(ft) {
    try {
        localStorage.setItem(STORAGE_KEY, String(ft));
    } catch {
        /* quota */
    }
}

/**
 * Calcule la pressure altitude à partir de l'élévation et du QNH.
 * @param {number} elevationFt Élévation du terrain en pieds.
 * @param {number} qnhHpa QNH en hPa.
 * @returns {number} Pressure altitude en pieds.
 */
export function pressureAltitude(elevationFt, qnhHpa) {
    return elevationFt + 27 * (1013.25 - qnhHpa);
}

/**
 * Température standard (ISA) à une altitude donnée.
 * @param {number} altFt Altitude en pieds.
 * @returns {number} Température ISA en °C.
 */
export function isaTemp(altFt) {
    return 15 - 1.98 * (altFt / 1000);
}

/**
 * Calcule la densité altitude.
 * @param {number} elevationFt Élévation du terrain (pieds).
 * @param {number} qnhHpa QNH en hPa.
 * @param {number} oatC Température extérieure observée (°C).
 * @returns {{pa: number, da: number, isaT: number, oat: number}|null}
 */
export function densityAltitude(elevationFt, qnhHpa, oatC) {
    if (elevationFt == null || qnhHpa == null || oatC == null) return null;
    if (isNaN(elevationFt) || isNaN(qnhHpa) || isNaN(oatC)) return null;

    const pa = pressureAltitude(elevationFt, qnhHpa);
    const isaT = isaTemp(pa);
    const da = pa + 118.8 * (oatC - isaT);
    return { pa, da, isaT, oat: oatC };
}

/**
 * Récupère les données nécessaires (élévation, QNH, OAT) depuis l'état
 * courant de l'app pour le terrain affiché.
 * @returns {{elevationFt: number, qnh: number, oat: number, icao: string}|null}
 */
export function getPerformanceData() {
    const parsed = state.lastParsed;
    if (!parsed) return null;

    const icao = state.requestedIcao || parsed.code;
    const apt = getAirportByICAO(icao);
    // airports.json contient désormais l'élévation (ft) pour ~100% des terrains
    // (fusion depuis Airports.json/Runways.json). On l'utilise en priorité — pas
    // d'appel API nécessaire. Le memo (API NOAA) reste un fallback.
    const elevationFt = (apt && typeof apt.elevation === 'number')
        ? apt.elevation
        : (memoGet(parsed.code)?.elevation ?? 0);

    // Extrait QNH et température depuis les données parsées.
    let qnh = null;
    let oat = null;

    if (parsed.base) {
        // QNH : "1013 hPa" → on extrait le nombre.
        const qnhStr = parsed.base.qnh?.[0]?.val || '';
        const qnhMatch = qnhStr.match(/(\d{3,4})\s*hPa/);
        if (qnhMatch) qnh = parseInt(qnhMatch[1], 10);

        // Température : "15°C / 8°C" → on prend la première (OAT).
        const tempStr = parsed.base.temp?.[0]?.val || '';
        const tempMatch = tempStr.match(/(-?\d+)°C/);
        if (tempMatch) oat = parseInt(tempMatch[1], 10);
    }

    if (qnh === null || oat === null) return null;

    return { elevationFt, qnh, oat, icao };
}

/**
 * Évalue si la densité altitude dépasse le seuil configuré.
 * @param {number} da Densité altitude en pieds.
 * @returns {{level: 'ok'|'caution'|'danger', message: string}|null}
 */
export function evaluateDensityAltitude(da) {
    if (da == null || isNaN(da)) return null;
    const isFr = state.lang === 'fr';
    const threshold = getDaThreshold();

    // Niveaux : 0-seuil = OK, seuil à seuil+1500 = prudence, > seuil+1500 = danger.
    if (da >= threshold + 1500) {
        return {
            level: 'danger',
            message: isFr
                ? `Densité altitude ÉLEVÉE (${Math.round(da)} ft) — performances fortement dégradées`
                : `HIGH density altitude (${Math.round(da)} ft) — severely degraded performance`,
        };
    }
    if (da >= threshold) {
        return {
            level: 'caution',
            message: isFr
                ? `Densité altitude à surveiller (${Math.round(da)} ft) — vérifiez vos performances`
                : `Density altitude worth watching (${Math.round(da)} ft) — check your performance`,
        };
    }
    return {
        level: 'ok',
        message: isFr
            ? `Densité altitude OK (${Math.round(da)} ft)`
            : `Density altitude OK (${Math.round(da)} ft)`,
    };
}
