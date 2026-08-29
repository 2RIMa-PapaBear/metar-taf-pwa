/* ================================================================
 * AIRSPACE PROFILE — Zones aériennes traversées par la route
 * ================================================================
 *
 * Calcule, à partir des points du profil d'élévation (frac/lat/lon) et
 * des zones openAIP brutes, la liste des espaces aériens REellement
 * traversés par la route : tronçon (en fraction 0-1 de la route),
 * plancher/plafond (ft) et fréquence. Les secteurs d'un même organisme
 * (ex. SEINE 6/7/8, même fréquence) sont fusionnés en un groupe avec
 * un plafond par secteur — dessinés comme rectangles d'altitude nichés
 * sur le profil (écran + log de nav PDF), façon EFB.
 *
 * Module PUR (aucune dépendance DOM/réseau) → testable sous Node.
 * ================================================================ */

const FT_PER_M = 3.28084;

// Filtres identiques au rendu de la carte (airspaces.js).
const ADMIN_NAME_RE = /\bFIR\b|\bUIR\b|\bLTA\b/;
const MAX_BASE_FT = 5000;
// Tolérance autour de l'altitude de croisière : une limite de zone à moins
// de 500 ft du niveau de vol reste affichée (marge d'anticipation).
export const ALT_TOLERANCE_FT = 500;
// Tronçon minimal pour dessiner une zone (en fraction de route) : écarte
// les coins à peine effleurés (≈ 1,5 NM sur une navigation de 100 NM).
const MIN_SPAN_FRAC = 0.012;
// Deux secteurs du même organisme séparés de moins que ceci sont dessinés
// comme un seul rectangle (séparateur pointillé au milieu de l'écart).
const MERGE_TOL_FRAC = 0.02;

/** Limite verticale openAIP → ft (unit 6 = FL, 1 = ft, 0 = m). */
export function limitToFt(lim) {
    if (!lim || !Number.isFinite(lim.value)) return null;
    if (lim.unit === 6) return lim.value * 100;
    if (lim.unit === 0) return Math.round(lim.value * FT_PER_M);
    return Math.round(lim.value);
}

/** Bbox [minLat, minLon, maxLat, maxLon] englobant les points + marge. */
export function routeBbox(points, marginDeg = 0.4) {
    let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;
    for (const p of points) {
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
        minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
        minLon = Math.min(minLon, p.lon); maxLon = Math.max(maxLon, p.lon);
    }
    if (!Number.isFinite(minLat)) return null;
    return [minLat - marginDeg, minLon - marginDeg, maxLat + marginDeg, maxLon + marginDeg];
}

// ----------------------------------------------------------------
// Géométrie : point dans une zone openAIP
// ----------------------------------------------------------------

function _pointInRing(lat, lon, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const lati = ring[i][1], loni = ring[i][0];
        const latj = ring[j][1], lonj = ring[j][0];
        if (((lati > lat) !== (latj > lat)) &&
            (lon < (lonj - loni) * (lat - lati) / (latj - lati) + loni)) {
            inside = !inside;
        }
    }
    return inside;
}

/** Teste si (lat, lon) est dans la géométrie openAIP (GeoJSON :
 *  Polygon/MultiPolygon ; Point+rayon → disque ; LineString ignoré). */
export function pointInAirspace(lat, lon, geometry, radiusKm = 5) {
    if (!geometry) return false;
    const type = geometry.type;
    if (type === 'Polygon') {
        return geometry.coordinates.some(ring => _pointInRing(lat, lon, ring));
    }
    if (type === 'MultiPolygon') {
        return geometry.coordinates.some(poly => poly.some(ring => _pointInRing(lat, lon, ring)));
    }
    if (type === 'Point') {
        const [clon, clat] = geometry.coordinates;
        const R = 6371, toRad = d => d * Math.PI / 180;
        const d = 2 * R * Math.asin(Math.sqrt(
            Math.sin(toRad(clat - lat) / 2) ** 2 +
            Math.cos(toRad(lat)) * Math.cos(toRad(clat)) * Math.sin(toRad(clon - lon) / 2) ** 2));
        return d <= radiusKm;
    }
    return false;
}

// ----------------------------------------------------------------
// Tronçons traversés
// ----------------------------------------------------------------

/** Tronçons [fa, fb] (frac) où la route est DANS la zone, à partir des
 *  points échantillonnés (intérieurs contigus). */
export function crossedRanges(points, geometry, radiusKm) {
    const runs = [];
    let start = null;
    for (const p of points) {
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
        const inside = pointInAirspace(p.lat, p.lon, geometry, radiusKm);
        if (inside && start == null) start = p.frac;
        if (!inside && start != null) {
            runs.push([start, p.frac]);
            start = null;
        }
    }
    if (start != null) runs.push([start, points[points.length - 1].frac]);
    return runs.filter(r => r[1] - r[0] >= MIN_SPAN_FRAC);
}

/** Nom d'affichage du service : fréquence openAIP (« SEINE INFORMATION »)
 *  sinon nom de la zone ; « INFORMATION » abrégé en « INFO ». */
export function serviceDisplayName(as) {
    const f = Array.isArray(as.frequencies) ? as.frequencies.find(x => x && x.value) : null;
    const raw = (f?.name || as.name || as.designator || '?').toString().trim();
    return raw.replace(/\s+information$/i, ' INFO').toUpperCase();
}

/** Fréquence principale affichable (« 127.815 ») ou null. */
export function serviceFreq(as) {
    const f = Array.isArray(as.frequencies) ? as.frequencies.find(x => x && x.value) : null;
    return f ? String(f.value) : null;
}

// Fusionne les tronçons d'un même groupe séparés de < MERGE_TOL_FRAC.
function _mergeRanges(ranges) {
    const sorted = ranges.map(r => [...r]).sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const r of sorted) {
        const last = out[out.length - 1];
        if (last && r[0] - last[1] < MERGE_TOL_FRAC) last[1] = Math.max(last[1], r[1]);
        else out.push([...r]);
    }
    return out;
}

/**
 * Calcule les groupes de zones traversées par la route.
 * @param {Array} points Points du profil d'élévation [{frac, lat, lon}].
 * @param {Array} items  Zones openAIP brutes (bbox de la route chargée).
 * @param {Object} [opts] {cruiseAltFt} : si fournie (> 0), seules les zones
 *   RELEVANTES pour l'altitude du vol sont retenues — la croisière doit être
 *   DANS la tranche verticale (lo ≤ croisière ≤ plafond). Une CTR SFC-1500
 *   survolée à 3500 ft n'apparaît pas (retour utilisateur 27/08).
 * @returns {Array|null} Groupes triés conteneur → imbriqué :
 *   [{ name, freq, lo, up (plafond max), ranges: [[fa,fb]],
 *      segs: [{fa, fb, up, zone}] }] — zone = nom openAIP du SECTEUR
 *   (ex. « SIV RENNES SUD A ») porté par chaque tronçon, ou null si aucun.
 */
export function computeRouteAirspaces(points, items, opts) {
    if (!Array.isArray(points) || points.length < 2 || !Array.isArray(items)) return null;
    const cruise = Number.isFinite(opts?.cruiseAltFt) && opts.cruiseAltFt > 0 ? opts.cruiseAltFt : null;

    const byKey = new Map();
    for (const as of items) {
        if (ADMIN_NAME_RE.test(String(as.name || as.designator || '').toUpperCase())) continue;
        // FIR/UIR/secteurs ACC openAIP dont le nom ne dit pas « FIR »
        // (ex. « LRBB », « POLARIS ACC ») — filtrés aussi sur la carte.
        if (!as._sia && (as.type === 10 || as.type === 11 || as.type === 27)) continue;
        const lo = limitToFt(as.lowerLimit ?? as.lower) ?? 0;
        const up = limitToFt(as.upperLimit ?? as.upper);
        if (up == null || up <= 0) continue;            // plafond inconnu : on ignore
        if (lo > MAX_BASE_FT) continue;                  // plancher trop haut pour du VFR
        if (up <= lo) continue;
        // Altitude du vol : hors tranche verticale (marge 500 ft) → la zone
        // ne concerne pas ce vol (entièrement au-dessus ou en dessous).
        if (cruise != null && (up < cruise - ALT_TOLERANCE_FT || lo > cruise + ALT_TOLERANCE_FT)) continue;

        const ranges = crossedRanges(points, as.geometry,
            (as.radius && Number.isFinite(as.radius.value)) ? as.radius.value : 5);
        if (!ranges.length) continue;

        const name = serviceDisplayName(as);
        const freq = serviceFreq(as);
        // Nom du secteur (zone openAIP brute) : le groupe porte le nom de
        // l'organisme (« RENNES INFO ») mais le survol doit dire LEQUEL
        // des secteurs (Sud A, Nord, Cotentin…) est sous le curseur.
        const zone = String(as.name || as.designator || '').trim();
        const key = `${freq ?? '-'}|${name}`;
        let g = byKey.get(key);
        if (!g) { g = { name, freq, lo: Infinity, up: -Infinity, ranges: [], segs: [] }; byKey.set(key, g); }
        g.lo = Math.min(g.lo, lo);
        g.up = Math.max(g.up, up);
        g.ranges.push(...ranges);
        for (const [fa, fb] of ranges) g.segs.push({ fa, fb, up, zone });
    }

    const groups = [...byKey.values()].map(g => {
        const ranges = _mergeRanges(g.ranges);
        return {
            name: g.name, freq: g.freq, lo: g.lo, up: g.up,
            span: Math.max(...ranges.map(r => r[1] - r[0])),
            ranges,
            segs: g.segs.sort((a, b) => a.fa - b.fa),
        };
    });
    if (!groups.length) return null;
    // Conteneurs d'abord, imbriqués ensuite (dessinés par-dessus).
    groups.sort((a, b) => b.span - a.span);
    return groups;
}
