/* ================================================================
 * PRESSURE TREND — Tendance de pression QNH (3h)
 * ================================================================
 *
 * CONTEXTE MÉTÉOROLOGIQUE
 * -----------------------
 * La pression atmosphérique au niveau de la mer (QNH) est l'un des
 * meilleurs indicateurs de l'évolution du temps :
 *
 *   QNH STABLE ou EN HAUSSE  → temps stable, dorsale, conditions VFR qui durent.
 *   QNH EN BAISSE RAPIDE     → dégradation imminente : arrivée d'une perturbation,
 *                              d'un thalweg, d'un front. Le vent forcit, le plafond
 *                              et la visibilité vont se dégrader.
 *
 * Règle empirique du pilote :
 *   - Chute > 1 hPa/h     → surveiller, dégradation probable.
 *   - Chute > 2 hPa/h     → dégradation significative imminente.
 *   - Chute > 3 hPa/h     → alerte forte (dépression profonde, vent fort).
 *
 * IMPLÉMENTATION
 * --------------
 * On récupère l'historique des METARs (4 dernières heures) via l'API
 * AviationWeather et on calcule la pente du QNH entre le plus ancien
 * et le plus récent. Le résultat alimente la bannière GO/NO-GO.
 * ================================================================ */

import { state, I18N, fetchAvecRelais } from './core.js';

/**
 * Récupère l'historique des METARs pour un terrain et calcule la tendance QNH.
 * @param {string} icao Code OACI.
 * @returns {Promise<{trendHpaPerHour: number, deltaHpa: number, hoursSpan: number, currentQnh: number, oldestQnh: number}|null>}
 */
export async function fetchPressureTrend(icao) {
    if (!icao) return null;
    try {
        // hours=4 : on récupère les METARs des 4 dernières heures.
        const url = `https://aviationweather.gov/api/data/metar?ids=${icao}&hours=4&format=json`;
        const data = await fetchAvecRelais(url, 'json');
        if (!Array.isArray(data) || data.length < 2) return null;

        // Extrait les QNH et heures d'observation, triés du plus ancien au plus récent.
        const points = data
            .map(m => {
                // Le QNH est dans rawOb (ex: "Q1013") ou obsTime.
                const raw = m.rawOb || m.rawMetar || m.rawText || '';
                const qnhMatch = raw.match(/\bQ(\d{4})\b/);
                const inHgMatch = raw.match(/\bA(\d{4})\b/);
                let qnh = null;
                if (qnhMatch) qnh = parseInt(qnhMatch[1], 10);
                else if (inHgMatch) qnh = Math.round(parseInt(inHgMatch[1], 10) / 100 * 33.8639);
                // Heure d'observation : observeTime (ISO) ou extraction depuis rawOb.
                let obsTime = m.observeTime ? new Date(m.observeTime) : null;
                if (!obsTime || isNaN(obsTime)) {
                    const timeMatch = raw.match(/\b(\d{2})(\d{2})(\d{2})Z\b/);
                    if (timeMatch) {
                        const now = new Date();
                        obsTime = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(),
                            parseInt(timeMatch[1], 10), parseInt(timeMatch[2], 10), parseInt(timeMatch[3], 10)));
                    }
                }
                return qnh !== null && obsTime && !isNaN(obsTime) ? { qnh, time: obsTime.getTime() } : null;
            })
            .filter(Boolean)
            .sort((a, b) => a.time - b.time);

        if (points.length < 2) return null;

        const oldest = points[0];
        const newest = points[points.length - 1];
        const deltaHpa = newest.qnh - oldest.qnh;
        const hoursSpan = (newest.time - oldest.time) / 3600000;
        if (hoursSpan < 0.5) return null; // pas assez de recul

        const trendHpaPerHour = deltaHpa / hoursSpan;

        return {
            trendHpaPerHour,
            deltaHpa,
            hoursSpan,
            currentQnh: newest.qnh,
            oldestQnh: oldest.qnh,
        };
    } catch (e) {
        console.warn('Pressure trend fetch failed:', e);
        return null;
    }
}

/**
 * Évalue la tendance et retourne un message d'alerte si pertinent.
 * @param {Object} trend Résultat de fetchPressureTrend.
 * @returns {{level: 'ok'|'caution'|'danger', icon: string, message: string}|null}
 */
export function evaluatePressureTrend(trend) {
    if (!trend || trend.trendHpaPerHour == null) return null;
    const isFr = state.lang === 'fr';
    const rate = trend.trendHpaPerHour;

    // Hausse : temps qui se stabilise ou s'améliore.
    if (rate > 0.5) {
        return {
            level: 'ok',
            icon: 'trending-up',
            message: isFr
                ? `Pression en hausse (${rate.toFixed(1)} hPa/h) — temps stable`
                : `Pressure rising (${rate.toFixed(1)} hPa/h) — stable weather`,
        };
    }

    // Baisse.
    const absRate = Math.abs(rate);
    if (absRate >= 3) {
        return {
            level: 'danger',
            icon: 'trending-down',
            message: isFr
                ? `Pression en forte baisse (${rate.toFixed(1)} hPa/h) — dégradation imminente`
                : `Pressure falling sharply (${rate.toFixed(1)} hPa/h) — imminent deterioration`,
        };
    }
    if (absRate >= 2) {
        return {
            level: 'caution',
            icon: 'trending-down',
            message: isFr
                ? `Pression en baisse (${rate.toFixed(1)} hPa/h) — dégradation probable`
                : `Pressure falling (${rate.toFixed(1)} hPa/h) — likely deterioration`,
        };
    }
    if (absRate >= 1) {
        return {
            level: 'caution',
            icon: 'trending-down',
            message: isFr
                ? `Pression en légère baisse (${rate.toFixed(1)} hPa/h) — à surveiller`
                : `Pressure slightly falling (${rate.toFixed(1)} hPa/h) — monitor`,
        };
    }

    return {
        level: 'ok',
        icon: 'minus',
        message: isFr
            ? `Pression stable (${rate.toFixed(1)} hPa/h)`
            : `Pressure stable (${rate.toFixed(1)} hPa/h)`,
    };
}
