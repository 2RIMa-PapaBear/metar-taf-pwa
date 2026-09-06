import { state, getCeiling } from './core.js';
import { memoGet, fetchOpenMeteo } from './core.js';

const _cache = new Map();
const TTL_MS = 30 * 60 * 1000;

export async function fetchFreezingLevel(icao) {
    if (!icao) return null;

    const cached = _cache.get(icao);
    if (cached && Date.now() - cached.ts < TTL_MS) return cached.value;

    const memo = memoGet(icao);
    const lat = memo?.lat ?? null;
    const lon = memo?.lon ?? null;
    if (lat == null || lon == null) return null;

    try {

        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=freezing_level_height,relative_humidity_2m,dew_point_2m&timezone=auto`;
        let data;
        try { data = await fetchOpenMeteo(url); } catch { return null; }
        if (!data) return null;

        const heightM = data?.current?.freezing_level_height;
        if (typeof heightM !== 'number' || isNaN(heightM)) return null;

        const altFt = Math.round(heightM * 3.28084);

        const value = {
            altFt,
            source: 'Open-Meteo',
            humidity: typeof data?.current?.relative_humidity_2m === 'number' ? data.current.relative_humidity_2m : null,
            dewPointC: typeof data?.current?.dew_point_2m === 'number' ? data.current.dew_point_2m : null,
        };
        _cache.set(icao, { value, ts: Date.now() });
        return value;
    } catch (e) {
        console.warn('Freezing level fetch failed:', e);
        return null;
    }
}

// Évaluation du risque de givrage (carburation / cellule).
//
// Combine deux approches complémentaires :
//   1. Comparaison plafond vs isotherme 0°C (logique historique, inchangée pour go-nogo).
//   2. Analyse thermodynamique T / Td / spread (norme C-FIP simplifiée) :
//        - Zone critique de givrage : T ∈ [-2°C ; +2°C] avec air humide (nuage ou spread ≤ 2°C).
//        - Zone modérée              : T ∈ [-15°C ; -2°C] avec nuage significatif.
//        - Hors risque               : T > +2°C (trop chaud) ou air très sec (spread > 5°C).
//      La saturation proche (spread T-Td ≤ 2°C) élève le niveau d'un cran.
//
// RÉTRO-COMPATIBILITÉ : tempC / tdC sont optionnels. Si absents, on retombe sur la
// logique historique (plafond vs isotherme). Les appelants existants (go-nogo.js)
// n'ont pas besoin d'être modifiés.
export function evaluateIcingRisk(freezingLevelFt, nuageStr, tempC = null, tdC = null) {
    if (freezingLevelFt == null || isNaN(freezingLevelFt)) return null;
    if (!nuageStr) return null;

    const isFr = state.lang === 'fr';
    const flLabel = Math.round(freezingLevelFt);
    const fl0Msg = isFr
        ? `Isotherme 0°C à ${flLabel} ft`
        : `Freezing level at ${flLabel} ft`;

    // --- Approche 1 : plafond vs isotherme (historique) ---
    const ceilHund = getCeiling(nuageStr);
    const ceilingFt = (ceilHund >= 999) ? null : ceilHund * 100;
    const hasSignificantCloud = ceilingFt != null; // BKN/OVC/VV détecté

    // --- Approche 2 : thermodynamique T / Td ---
    // Calcule un niveau de risque 'ok' | 'caution' | 'danger' | null si pas de donnée T.
    let thermoLevel = null; // null = analyse thermo indisponible
    if (typeof tempC === 'number' && !isNaN(tempC)) {
        const spread = (typeof tdC === 'number' && !isNaN(tdC)) ? (tempC - tdC) : null;
        const saturated = spread != null && spread <= 2;       // air proche saturation
        const veryDry = spread != null && spread > 5;            // air très sec

        if (tempC > 2 || veryDry) {
            thermoLevel = 'ok';                                  // trop chaud ou trop sec
        } else if (tempC >= -2 && tempC <= 2) {
            // Zone critique -2..+2°C : givrage probable si humidité/nuage présent.
            thermoLevel = (hasSignificantCloud || saturated) ? 'danger' : 'caution';
        } else if (tempC >= -15) {
            // Zone modérée -15..-2°C : risque en nuage, aggravé par saturation.
            thermoLevel = (hasSignificantCloud || saturated) ? 'caution' : 'ok';
        } else {
            // T < -15°C : air très froid et sec (glace pure), risque faible côté carburation.
            thermoLevel = 'ok';
        }
    }

    // Rétro-compatibilité : sans donnée thermo ET sans plafond exploitable, on ne peut
    // rien conclure (comportement identique à l'ancienne version qui retournait null).
    if (thermoLevel == null && ceilingFt == null) return null;

    // --- Fusion : on prend le risque le plus élevé entre thermo et approche plafond ---
    const SEV = { ok: 0, caution: 1, danger: 2 };
    let level = 'ok';
    let detail = '';

    if (thermoLevel != null && SEV[thermoLevel] > SEV[level]) {
        level = thermoLevel;
        const tLabel = `${Math.round(tempC)}°C`;
        const tdLabel = (typeof tdC === 'number' && !isNaN(tdC)) ? `${Math.round(tdC)}°C` : null;
        if (level === 'danger') {
            detail = isFr
                ? `GIVRAGE PROBABLE — T ${tLabel}${tdLabel ? `, Td ${tdLabel}` : ''}`
                : `LIKELY ICING — OAT ${tLabel}${tdLabel ? `, dew ${tdLabel}` : ''}`;
        } else if (level === 'caution') {
            detail = isFr
                ? `Risque de givrage — T ${tLabel}${tdLabel ? `, Td ${tdLabel}` : ''}`
                : `Icing risk — OAT ${tLabel}${tdLabel ? `, dew ${tdLabel}` : ''}`;
        }
    }

    // Approche plafond vs isotherme : on ne l'applique que si la thermo n'a pas déjà
    // remonté un danger (pour éviter un double signal dans le message).
    if (ceilingFt != null && ceilingFt >= freezingLevelFt && level !== 'danger') {
        const margin = ceilingFt - freezingLevelFt;
        if (margin < 2000) {
            level = 'danger';
            detail = isFr
                ? `GIVRAGE PROBABLE — plafond ${ceilingFt} ft, ${fl0Msg}`
                : `LIKELY ICING — ceiling ${ceilingFt} ft, ${fl0Msg}`;
        } else if (level !== 'caution') {
            level = 'caution';
            detail = isFr
                ? `Risque de givrage en nuage — ${fl0Msg}`
                : `Icing risk in cloud — ${fl0Msg}`;
        }
    }

    // Message final : si niveau ok, message informatif (isotherme 0°C / sous le plafond).
    let message;
    if (level === 'ok') {
        message = ceilingFt != null && ceilingFt < freezingLevelFt
            ? (isFr ? `${fl0Msg} — sous le plafond` : `${fl0Msg} — below ceiling`)
            : (isFr ? `${fl0Msg} — pas de risque détecté` : `${fl0Msg} — no risk detected`);
    } else {
        message = detail;
    }

    return { level, message };
}
