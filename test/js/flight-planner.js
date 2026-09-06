import { memoGet } from './core.js';
import { getAirportByICAO } from './ui-module.js';
import { getActiveAircraft } from './aircraft-fleet.js';
import { getDeclinationForIcao } from './magvar.js';
import { fetchWindsAloft, getWindAtAltitude } from './winds-aloft.js';
import { fetchRouteElevation, evaluateClearance, fetchMultiSegmentElevation } from './route-elevation.js';
import { computeRouteAirspaces, routeBbox } from './airspace-profile.js';
import { fetchAirspacesForBbox } from './airspaces.js';
import { loadFreqSources, getServiceFreq } from './freq-sia.js';
import { getSiaAirfield } from './sia-data.js';

// Élévation OFFICIELLE d'un terrain en ft (SIA AdRefAltFt, repli base locale
// openAIP déjà convertie) — pour ancrer les extrémités du profil d'élévation
// au niveau réel du sol des aérodromes (la maille Open-Meteo peut en différer).
function _officialElevFt(icao, apt = null) {
    return getSiaAirfield(icao)?.elevFt ?? apt?.elevation ?? null;
}

// Zones aériennes traversées par la route (rectangles d'altitude du profil
// d'élévation) : bbox du corridor → items openAIP → groupes. Non bloquant —
// null silencieux si l'API/cache est indisponible. Une correction manuelle
// de fréquence (freq-overrides.json, par INDICATIF) prime sur openAIP.
async function loadRouteAirspaces(elevProfile, cruiseAltFt) {
    try {
        if (!elevProfile?.points?.length) return null;
        const bbox = routeBbox(elevProfile.points);
        if (!bbox) return null;
        const items = await fetchAirspacesForBbox(bbox[0], bbox[1], bbox[2], bbox[3]);
        if (!items?.length) return null;
        loadFreqSources();
        const groups = computeRouteAirspaces(elevProfile.points, items, { cruiseAltFt });
        for (const g of groups || []) {
            const fixed = getServiceFreq(g.name);
            if (fixed) g.freq = fixed;
        }
        return groups;
    } catch { return null; }
}

const RESERVE_MIN_DAY = 30;
const RESERVE_MIN_NIGHT = 45;

const KT_TO_KMH = 1.852;
const KMH_TO_KT = 1 / KT_TO_KMH;

export function greatCircleDistanceNm(lat1, lon1, lat2, lon2) {

    const R = 3440.065;
    const toRad = (d) => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function trueCourseDeg(lat1, lon1, lat2, lon2) {
    const toRad = (d) => d * Math.PI / 180;
    const toDeg = (r) => r * 180 / Math.PI;
    const φ1 = toRad(lat1), φ2 = toRad(lat2);
    const Δλ = toRad(lon2 - lon1);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Index d'insertion (0..wps.length) d'un nouveau waypoint qui minimise la
 * distance totale de la route (insertion la moins coûteuse) : on teste chaque
 * slot de la chaîne Départ → étapes existantes → Destination et on garde le
 * plus court trajet. L'ordre des étapes déjà saisies est préservé.
 *
 * @param {string} depIcao   code du départ
 * @param {string[]} wps     étapes existantes (codes OACI, ordre conservé)
 * @param {string} destIcao  code de la destination
 * @param {string} newIcao   waypoint à insérer
 * @param {(code:string)=>{lat:number,lon:number}|null} coordsOf
 *   résolveur de coordonnées (base locale + mémo).
 * @returns {number|null} index d'insertion optimal, ou null si une
 *   coordonnée manque (l'appelant ajoutera alors en fin de liste).
 */
export function cheapestWaypointInsertion(depIcao, wps, destIcao, newIcao, coordsOf) {
    const dep = coordsOf(depIcao);
    const dest = coordsOf(destIcao);
    const x = coordsOf(newIcao);
    const legCoords = wps.map(coordsOf);
    if (!dep || !dest || !x || legCoords.some(c => !c)) return null;

    const legLen = (seq) => {
        let s = 0;
        for (let i = 0; i < seq.length - 1; i++) {
            s += greatCircleDistanceNm(seq[i].lat, seq[i].lon, seq[i + 1].lat, seq[i + 1].lon);
        }
        return s;
    };

    let bestIdx = null;
    let bestLen = Infinity;
    for (let i = 0; i <= wps.length; i++) {
        const seq = [dep, ...legCoords.slice(0, i), x, ...legCoords.slice(i), dest];
        const len = legLen(seq);
        if (len < bestLen) { bestLen = len; bestIdx = i; }
    }
    return bestIdx;
}

export function windCorrection(tcTrueCap, tasKt, wind) {
    if (!wind || tasKt <= 0) {
        return { wcaDeg: 0, driftDeg: 0, gsKt: tasKt, headwindKt: 0, crosswindKt: 0 };
    }
    const toRad = (d) => d * Math.PI / 180;

    const angle = toRad(wind.dir - tcTrueCap);
    const crosswind = wind.speedKt * Math.sin(angle);
    const headwind = wind.speedKt * Math.cos(angle);

    const sinWca = Math.max(-1, Math.min(1, crosswind / tasKt));
    const wcaRad = Math.asin(sinWca);
    const wcaDeg = wcaRad * 180 / Math.PI;

    const gsKt = Math.max(0, tasKt * Math.cos(wcaRad) - headwind);

    return {
        wcaDeg: Math.round(wcaDeg * 10) / 10,
        driftDeg: Math.round(-wcaDeg * 10) / 10,
        gsKt: Math.round(gsKt),
        headwindKt: Math.round(headwind),
        crosswindKt: Math.round(crosswind),
    };
}

export function trueToMagneticHdg(trueHdg, declination) {
    return Math.round((((trueHdg - declination) % 360) + 360) % 360);
}

export function computeFuel(legTimeMin, fuelBurnLph, reserveMin) {
    const tripFuelL = (legTimeMin / 60) * fuelBurnLph;
    const reserveL = (reserveMin / 60) * fuelBurnLph;
    return {
        tripFuelL: Math.round(tripFuelL * 10) / 10,
        reserveL: Math.round(reserveL * 10) / 10,
        totalL: Math.round((tripFuelL + reserveL) * 10) / 10,
    };
}

export async function computeFlightPlan(fromIcao, toIcao, params) {
    if (!fromIcao || !toIcao || fromIcao === toIcao) return null;
    if (!params || typeof params.cruiseAltFt !== 'number') return null;

    const fromApt = getAirportByICAO(fromIcao);
    const toApt = getAirportByICAO(toIcao);
    const fromMemo = memoGet(fromIcao);
    const toMemo = memoGet(toIcao);

    const fromLat = fromMemo?.lat ?? fromApt?.lat ?? null;
    const fromLon = fromMemo?.lon ?? fromApt?.lon ?? null;
    const toLat = toMemo?.lat ?? toApt?.lat ?? null;
    const toLon = toMemo?.lon ?? toApt?.lon ?? null;

    if (fromLat == null || toLat == null) return null;

    const distNm = greatCircleDistanceNm(fromLat, fromLon, toLat, toLon);
    const distKm = Math.round(distNm * KT_TO_KMH);
    const tc = trueCourseDeg(fromLat, fromLon, toLat, toLon);

    const midLat = (fromLat + toLat) / 2;
    const midLon = (fromLon + toLon) / 2;
    const winds = await fetchWindsAloft(midLat, midLon);
    const wind = winds ? getWindAtAltitude(winds, params.cruiseAltFt) : null;

    const declination = getDeclinationForIcao(fromIcao);

    const wc = windCorrection(tc, params.tasKt, wind);

    const trueHdg = (tc + wc.wcaDeg + 360) % 360;
    const magHdg = trueToMagneticHdg(trueHdg, declination);

    const gsKt = wc.gsKt > 0 ? wc.gsKt : params.tasKt;
    const legTimeMin = distNm / gsKt * 60;

    const reserveMin = params.isNight ? RESERVE_MIN_NIGHT : RESERVE_MIN_DAY;
    const fuel = computeFuel(legTimeMin, params.fuelBurnLph, reserveMin);

    const elevProfile = await fetchRouteElevation(fromLat, fromLon, toLat, toLon, null,
        [_officialElevFt(fromIcao, fromApt), _officialElevFt(toIcao, toApt)]);
    const clearance = elevProfile
        ? evaluateClearance(elevProfile, params.cruiseAltFt)
        : null;
    const routeAirspaces = await loadRouteAirspaces(elevProfile, params.cruiseAltFt);

    return {
        from: { icao: fromIcao, lat: fromLat, lon: fromLon, elevFt: fromApt?.elevation ?? null },
        to: { icao: toIcao, lat: toLat, lon: toLon, elevFt: toApt?.elevation ?? null },
        distanceNm: Math.round(distNm * 10) / 10,
        distanceKm: distKm,
        trueCourse: Math.round(tc),
        declination,
        wind: wind ? { ...wind, altFt: params.cruiseAltFt } : null,
        windCorrection: wc,
        trueHeading: Math.round(trueHdg),
        magHeading: magHdg,
        groundSpeed: gsKt,
        legTimeMin: Math.round(legTimeMin),
        fuel,
        cruiseAltFt: params.cruiseAltFt,
        tasKt: params.tasKt,
        elevationProfile: elevProfile,
        clearance,
        routeAirspaces,
    };
}

export function getDefaultAircraftPerf() {
    const ac = getActiveAircraft();

    // Vitesse/conso de croisière des caractéristiques de l'avion (flotte).
    return {
        tasKt: ac?.cruiseSpeedKt ?? 110,
        fuelBurnLph: ac?.fuelBurnLph ?? 35,
    };
}

// ====================================================================
// MULTI-WAYPOINTS : plan de vol multi-segments (au lieu d'un A→B unique).
//
// `route` = tableau d'OACI [from, waypoint1, waypoint2, ..., to].
// Rétro-compatible : computeFlightPlan(from,to,params) reste inchangé.
// ====================================================================

// Calcule un plan de vol multi-jambes. Retourne les métriques agrégées + le détail par leg.
// Éluevation : concatène les profils de chaque segment (via fetchMultiSegmentElevation).
export async function computeMultiLegFlightPlan(route, params) {
    if (!Array.isArray(route) || route.length < 2) return null;
    if (!params || typeof params.cruiseAltFt !== 'number') return null;

    // Résout les coordonnées de chaque waypoint (ICAO → lat/lon).
    const waypoints = [];
    for (const icao of route) {
        const apt = getAirportByICAO(icao);
        const memo = memoGet(icao);
        const lat = memo?.lat ?? apt?.lat ?? null;
        const lon = memo?.lon ?? apt?.lon ?? null;
        if (lat == null || lon == null) return null;
        waypoints.push({ icao, lat, lon, elevFt: _officialElevFt(icao, apt), name: apt?.name || icao });
    }

    const legs = [];
    let totalDistanceNm = 0, totalTimeMin = 0;
    let totalTripFuelL = 0;
    const reserveMin = params.isNight ? RESERVE_MIN_NIGHT : RESERVE_MIN_DAY;

    // Vent moyen sur l'ensemble de la route (point milieu global) — un seul fetch.
    const midIdx = Math.floor((waypoints.length - 1) / 2);
    const midWp = waypoints[midIdx];
    const midNext = waypoints[midIdx + 1] || waypoints[midIdx];
    const midLat = (midWp.lat + midNext.lat) / 2;
    const midLon = (midWp.lon + midNext.lon) / 2;
    const winds = await fetchWindsAloft(midLat, midLon);
    const wind = winds ? getWindAtAltitude(winds, params.cruiseAltFt) : null;

    // Déclinaison au point de départ (suffisante pour des routes VFR courtes).
    const declination = getDeclinationForIcao(route[0]);

    for (let i = 0; i < waypoints.length - 1; i++) {
        const a = waypoints[i], b = waypoints[i + 1];
        const distNm = greatCircleDistanceNm(a.lat, a.lon, b.lat, b.lon);
        const tc = trueCourseDeg(a.lat, a.lon, b.lat, b.lon);
        const wc = windCorrection(tc, params.tasKt, wind);
        const trueHdg = (tc + wc.wcaDeg + 360) % 360;
        const magHdg = trueToMagneticHdg(trueHdg, declination);
        const gsKt = wc.gsKt > 0 ? wc.gsKt : params.tasKt;
        const legTimeMin = distNm / gsKt * 60;
        const fuel = computeFuel(legTimeMin, params.fuelBurnLph, reserveMin);

        legs.push({
            from: { icao: a.icao, lat: a.lat, lon: a.lon },
            to: { icao: b.icao, lat: b.lat, lon: b.lon },
            distanceNm: Math.round(distNm * 10) / 10,
            trueCourse: Math.round(tc),
            windCorrection: wc,
            trueHeading: Math.round(trueHdg),
            magHeading: magHdg,
            groundSpeed: gsKt,
            legTimeMin: Math.round(legTimeMin),
            fuel,
        });

        totalDistanceNm += distNm;
        totalTimeMin += legTimeMin;
        totalTripFuelL += fuel.tripFuelL;
    }

    // Profil d'élévation concaténé sur tous les segments, ancré aux élévations
    // officielles des terrains de la route (départ, étapes, arrivée).
    const legCoords = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
        legCoords.push([waypoints[i].lat, waypoints[i].lon, waypoints[i + 1].lat, waypoints[i + 1].lon]);
    }
    const elevProfile = await fetchMultiSegmentElevation(legCoords, waypoints.map(w => w.elevFt));
    const clearance = elevProfile ? evaluateClearance(elevProfile, params.cruiseAltFt) : null;
    const routeAirspaces = await loadRouteAirspaces(elevProfile, params.cruiseAltFt);

    const totalReserveL = (reserveMin / 60) * params.fuelBurnLph;
    return {
        waypoints,
        legs,
        totalDistanceNm: Math.round(totalDistanceNm * 10) / 10,
        totalDistanceKm: Math.round(totalDistanceNm * KT_TO_KMH),
        totalTimeMin: Math.round(totalTimeMin),
        wind: wind ? { ...wind, altFt: params.cruiseAltFt } : null,
        declination,
        fuel: {
            tripFuelL: Math.round(totalTripFuelL * 10) / 10,
            reserveL: Math.round(totalReserveL * 10) / 10,
            totalL: Math.round((totalTripFuelL + totalReserveL) * 10) / 10,
        },
        cruiseAltFt: params.cruiseAltFt,
        tasKt: params.tasKt,
        elevationProfile: elevProfile,
        clearance,
        routeAirspaces,
        isMultiLeg: true,
    };
}

// Wrapper de compatibilité : un plan A→B est un cas particulier de multi-leg.
export async function computeMultiLegFromPair(fromIcao, toIcao, params) {
    return computeMultiLegFlightPlan([fromIcao, toIcao], params);
}

export const RESERVES = { DAY_MIN: RESERVE_MIN_DAY, NIGHT_MIN: RESERVE_MIN_NIGHT };
