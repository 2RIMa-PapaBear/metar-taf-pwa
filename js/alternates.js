import { state, I18N, fetchAvecRelais, memoGet } from './core.js';
import { getAirportByICAO } from './ui-module.js';
import { parseVisiToMeters, getCeiling, CAT_COLORS } from './core.js';
import { fetchOpenAipItems } from './airspaces.js';

// ====================================================================
// ALTERNATES DE ROUTE — TOUS les aérodromes à ± maxOffsetNm de la route
// prévue (openAIP), avec ou sans METAR : si le terrain n'émet pas de
// METAR, on reprend celui de la STATION ÉMETTRICE LA PLUS PROCHE
// (substitution marquée « * » dans le log de nav).
//
// Utilisé par le log de nav PDF (page « Performances et terrain ») :
// le pilote veut savoir où se dérouter en cours de route, pas seulement
// autour du départ. On ne garde que les terrains dont la distance à la
// polyligne de la route est ≤ maxOffsetNm.
// ====================================================================

const R_NM = 3440.065;
const _toRad = d => d * Math.PI / 180;

// Distance angulaire (radians) entre deux points.
function _angDist(lat1, lon1, lat2, lon2) {
    const dLat = _toRad(lat2 - lat1), dLon = _toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(_toRad(lat1)) * Math.cos(_toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function _bearingRad(lat1, lon1, lat2, lon2) {
    const φ1 = _toRad(lat1), φ2 = _toRad(lat2), Δλ = _toRad(lon2 - lon1);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return Math.atan2(y, x);
}

function _haversineNm(lat1, lon1, lat2, lon2) {
    return _angDist(lat1, lon1, lat2, lon2) * R_NM;
}

/**
 * Distance d'un point au SEGMENT A→B (NM) — perpendiculaire si la projection
 * tombe dans le segment, distance à l'extrémité la plus proche sinon (ce qui
 * couvre les terrains au-delà du départ/arrivée).
 * @returns {{nm: number, side: number}} side : +1 à droite du tracé A→B, -1 à gauche.
 * Exporté pour les tests (qa géométrie de route).
 */
export function _distToSegmentNm(p, a, b) {
    const d13 = _angDist(a.lat, a.lon, p.lat, p.lon);
    const th13 = _bearingRad(a.lat, a.lon, p.lat, p.lon);
    const th12 = _bearingRad(a.lat, a.lon, b.lat, b.lon);
    const sinXtd = Math.max(-1, Math.min(1, Math.sin(d13) * Math.sin(th13 - th12)));
    const xtd = Math.asin(sinXtd);
    // Along-track SIGNÉ (atan2) : négatif si la projection tombe derrière A —
    // la forme acos perd ce signe (point dans l'axe opposé au segment).
    const atd = Math.atan2(Math.sin(d13) * Math.cos(th13 - th12), Math.cos(d13));
    const segLen = _angDist(a.lat, a.lon, b.lat, b.lon);
    const side = Math.sign(sinXtd) || 1;
    if (atd < 0) return { nm: _haversineNm(p.lat, p.lon, a.lat, a.lon), side };
    if (atd > segLen) return { nm: _haversineNm(p.lat, p.lon, b.lat, b.lon), side };
    return { nm: Math.abs(xtd) * R_NM, side };
}

/**
 * Pour chaque candidat : son METAR s'il émet, sinon celui de la STATION
 * émettrice la plus proche (substitution marquée metarFrom/metarDistNm).
 * Fonction pure — testée sous Node.
 * @param {Array} candidates terrains [{code, name, lat, lon, offsetNm, side}]
 * @param {Object} metarByCode METAR bruts par code OACI de station.
 * @param {Array} pool stations émettrices [{code, lat, lon}].
 */
export function _attachMetars(candidates, metarByCode, pool) {
    const emitters = pool.filter(s => s.code && metarByCode[s.code]);
    return candidates.map(c => {
        if (c.code && metarByCode[c.code]) {
            return { ...c, raw: metarByCode[c.code], metarFrom: null, metarDistNm: null };
        }
        let best = null;
        for (const s of emitters) {
            const d = _haversineNm(c.lat, c.lon, s.lat, s.lon);
            if (!best || d < best.d) best = { s, d };
        }
        if (!best) return null;
        return {
            ...c,
            raw: metarByCode[best.s.code],
            metarFrom: best.s.code,
            metarDistNm: Math.round(best.d),
        };
    }).filter(Boolean);
}

// Types openAIP à exclure : 0 = aerodrome fermé, 7 = hélisurface.
const OPENAIP_TYPE_EXCLUDED = new Set([0, 7]);

/** Tous les aérodromes openAIP d'une bbox (couloir) — avec ou sans METAR.
 *  Hélisurfaces, terrains fermés et plateformes treuil exclus. Bbox
 *  découpée en tuiles ≤ 5° (limite openAIP) pour couvrir les routes
 *  longues sans écrêtage d'un côté ; une tuile refusée (429/5xx, rafale
 *  au changement de plan) est réessayée une fois. */
async function _fetchOpenAipAirports(minLat, minLon, maxLat, maxLon) {
    // Arrondi au quart de degré : meilleure réutilisation du cache relais.
    const q = x => (Math.round(x * 4) / 4).toFixed(2);
    const tiles = [];
    for (let lat = minLat; lat < maxLat; lat += 5) {
        for (let lon = minLon; lon < maxLon; lon += 5) {
            tiles.push([lat, lon, Math.min(lat + 5, maxLat), Math.min(lon + 5, maxLon)]);
        }
    }
    const byId = new Map();
    for (const [t0, t1, t2, t3] of tiles) {
        const url = `https://api.core.openaip.net/api/airports?bbox=${q(t1)},${q(t0)},${q(t3)},${q(t2)}&limit=1000`;
        // File partagée openAIP (airspaces.js) : sérialisée et espacée —
        // l'API refuse les rafales (429 sans en-têtes CORS).
        const items = await fetchOpenAipItems(url);
        for (const a of (items || [])) {
            byId.set(a._id ?? JSON.stringify(a.name) + byId.size, a);
        }
    }
    return byId.size ? [...byId.values()] : null;
}

/**
 * Alternates viables le long d'une route.
 * @param {Array<{icao:string, lat:number, lon:number}>} routePts points de la
 *   route (départ, waypoints éventuels, destination).
 * @param {number} [maxOffsetNm=25] écart max à gauche ou à droite de la route.
 * @param {number} [maxRows=6] nombre de terrains retenus.
 * @returns {Promise<Array<{code,name,cat,visiM,ceilHund,wind,offsetNm,side,
 *   metarFrom,metarDistNm}>|null>} null si les données ne sont pas
 *   récupérables (la section est alors omise du PDF) ; sinon les terrains
 *   triés par viabilité (catégorie puis écart). metarFrom non nul = METAR
 *   repris de la station émettrice la plus proche (à metarDistNm).
 */
export async function getEnRouteAlternates(routePts, maxOffsetNm = 25, maxRows = 6) {
    if (!Array.isArray(routePts) || routePts.length < 2) return null;
    try {
        // Bbox englobante de la route + marge couloir (corrigée en longitude
        // par la latitude médiane : 1° de lon ≈ cos(lat) × 60 NM).
        const lats = routePts.map(p => p.lat), lons = routePts.map(p => p.lon);
        const latMargin = maxOffsetNm / 60;
        const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
        const lonMargin = latMargin / Math.max(0.2, Math.cos(_toRad(midLat)));
        const bbox = [
            Math.min(...lats) - latMargin, Math.min(...lons) - lonMargin,
            Math.max(...lats) + latMargin, Math.max(...lons) + lonMargin,
        ].map(v => v.toFixed(3)).join(',');

        // ---- Terrains du couloir : openAIP (tous aérodromes), repli sur
        // les stations aviationweather si openAIP est indisponible.
        const routeIcaos = new Set(routePts.map(p => String(p.icao || '').toUpperCase()).filter(Boolean));
        const candidates = [];

        const aipItems = await _fetchOpenAipAirports(
            Math.min(...lats) - latMargin, Math.min(...lons) - lonMargin,
            Math.max(...lats) + latMargin, Math.max(...lons) + lonMargin);
        if (aipItems) {
            for (const a of aipItems) {
                if (OPENAIP_TYPE_EXCLUDED.has(a.type) || a.winchOnly) continue;
                const [lon, lat] = a.geometry?.coordinates || [];
                if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
                candidates.push({ aip: true, code: _validIcao(a.icaoCode), name: a.name || '', lat, lon });
            }
        } else {
            const stationsUrl = `https://aviationweather.gov/api/data/stationinfo?bbox=${bbox}&format=json`;
            const stations = await fetchAvecRelais(stationsUrl, 'json', 3600);
            if (!Array.isArray(stations)) return null;
            for (const s of stations) {
                if (s.lat == null || s.lon == null) continue;
                candidates.push({ aip: false, code: _validIcao(s.icaoId || s.id), name: s.site || s.name || '', lat: s.lat, lon: s.lon });
            }
        }

        // ---- Couloir : distance à la polyligne ≤ maxOffsetNm ; on écarte
        // aussi les terrains confondus avec un point de la route (départ,
        // arrivée, waypoints) même sans code OACI commun.
        const kept = [];
        for (const c of candidates) {
            if (c.code && routeIcaos.has(c.code)) continue;
            if (routePts.some(p => _haversineNm(c.lat, c.lon, p.lat, p.lon) < 1.5)) continue;
            let best = null;
            for (let i = 0; i < routePts.length - 1; i++) {
                const d = _distToSegmentNm(c, routePts[i], routePts[i + 1]);
                if (!best || d.nm < best.nm) best = d;
            }
            if (best.nm <= maxOffsetNm) {
                kept.push({ ...c, offsetNm: Math.round(best.nm), side: best.side });
            }
        }
        if (!kept.length) return null;
        kept.sort((a, b) => a.offsetNm - b.offsetNm);

        // ---- METAR : pool des stations émettrices du couloir élargi, puis
        // substitution par la plus proche pour les terrains sans METAR.
        const poolMargin = latMargin + 25 / 60;
        const poolBbox = [
            Math.min(...lats) - poolMargin, Math.min(...lons) - lonMargin - 25 / 60 / Math.max(0.2, Math.cos(_toRad(midLat))),
            Math.max(...lats) + poolMargin, Math.max(...lons) + lonMargin + 25 / 60 / Math.max(0.2, Math.cos(_toRad(midLat))),
        ].map(v => v.toFixed(3)).join(',');
        const poolUrl = `https://aviationweather.gov/api/data/stationinfo?bbox=${poolBbox}&format=json`;
        const stations = await fetchAvecRelais(poolUrl, 'json', 3600);
        if (!Array.isArray(stations)) return null;
        const pool = stations
            .map(s => ({ code: _validIcao(s.icaoId || s.id), name: s.site || s.name || '', lat: s.lat, lon: s.lon }))
            .filter(s => s.code && s.lat != null && s.lon != null);

        const metarIds = [...new Set([...pool.map(s => s.code), ...kept.slice(0, 24).map(c => c.code).filter(Boolean)])].slice(0, 60);
        const metarUrl = `https://aviationweather.gov/api/data/metar?ids=${metarIds.join(',')}&format=json`;
        const metars = await fetchAvecRelais(metarUrl, 'json');
        if (!Array.isArray(metars)) return null;
        const metarByCode = {};
        metars.forEach(m => {
            const code = _validIcao(m.icaoId || m.stationId);
            if (code) metarByCode[code] = m.rawOb || m.rawMetar || m.rawText || '';
        });

        const rows = _attachMetars(kept.slice(0, 60), metarByCode, pool)
            .map(s => {
                const cat = _categoryFromMetar(s.raw);
                if (!cat) return null;
                return { ...s, cat, raw: s.raw };
            })
            .filter(Boolean);
        if (!rows.length) return null;

        const catPriority = { VFR: 0, MVFR: 1, IFR: 2, LIFR: 3 };
        rows.sort((a, b) => (catPriority[a.cat.cat] ?? 9) - (catPriority[b.cat.cat] ?? 9) || a.offsetNm - b.offsetNm);
        return rows.slice(0, maxRows);
    } catch (e) {
        console.warn('En-route alternates load failed:', e);
        return null;
    }
}

function _validIcao(v) {
    const s = String(v || '').toUpperCase();
    return /^[A-Z][A-Z0-9]{3}$/.test(s) ? s : '';
}

export async function showAlternates(icao) {
    const container = document.getElementById('alternates-container');
    if (!container) return;

    const apt = getAirportByICAO(icao);
    const memo = memoGet(icao);
    const lat = memo?.lat ?? apt?.lat ?? null;
    const lon = memo?.lon ?? apt?.lon ?? null;

    if (lat == null || lon == null) {
        container.style.display = 'none';
        return;
    }

    try {

        const stationsUrl = `https://aviationweather.gov/api/data/stationinfo?bbox=${lat - 3},${lon - 3},${lat + 3},${lon + 3}&format=json`;
        const stations = await fetchAvecRelais(stationsUrl, 'json', 3600);
        if (!Array.isArray(stations)) { container.style.display = 'none'; return; }

        const nearby = stations
            .map(s => ({
                code: s.icaoId || s.id,
                name: s.site || s.name || '',
                lat: s.lat, lon: s.lon,
                dist: Math.pow(s.lat - lat, 2) + Math.pow(s.lon - lon, 2),
            }))
            .filter(s => s.code && /^[A-Z][A-Z0-9]{3}$/.test(s.code) && s.code !== icao.toUpperCase())
            .sort((a, b) => a.dist - b.dist)
            .slice(0, 12);

        if (nearby.length === 0) { container.style.display = 'none'; return; }

        const metarUrl = `https://aviationweather.gov/api/data/metar?ids=${nearby.map(s => s.code).join(',')}&format=json`;
        const metars = await fetchAvecRelais(metarUrl, 'json');
        if (!Array.isArray(metars)) { container.style.display = 'none'; return; }

        const metarByCode = {};
        metars.forEach(m => {
            const code = (m.icaoId || m.stationId || '').toUpperCase();
            if (code) metarByCode[code] = m.rawOb || m.rawMetar || m.rawText || '';
        });

        const rows = nearby
            .map(s => {
                const raw = metarByCode[s.code.toUpperCase()];
                if (!raw) return null;
                const cat = _categoryFromMetar(raw);
                if (!cat) return null;
                return { ...s, cat, raw };
            })
            .filter(Boolean);

        if (rows.length === 0) { container.style.display = 'none'; return; }

        const catPriority = { VFR: 0, MVFR: 1, IFR: 2, LIFR: 3 };
        rows.sort((a, b) => (catPriority[a.cat.cat] ?? 9) - (catPriority[b.cat.cat] ?? 9) || a.dist - b.dist);

        _render(rows.slice(0, 6), icao);
        container.style.display = 'block';

    } catch (e) {
        console.warn('Alternates load failed:', e);
        container.style.display = 'none';
    }
}

function _render(rows, destIcao) {
    const isFr = state.lang === 'fr';
    const list = document.getElementById('alternates-list');
    if (!list) return;

    const catColors = CAT_COLORS;

    const lblCat = isFr ? 'Cat.' : 'Cat.';
    const lblVisi = isFr ? 'Visi' : 'Visi';
    const lblCeil = isFr ? 'Plafond' : 'Ceiling';
    const lblWind = isFr ? 'Vent' : 'Wind';

    let html = `<div class="alternates-grid">`;
    html += `<div class="alt-header">${isFr ? 'Terrain' : 'Airfield'}</div>`;
    html += `<div class="alt-header">${lblCat}</div>`;
    html += `<div class="alt-header">${lblVisi}</div>`;
    html += `<div class="alt-header">${lblCeil}</div>`;
    html += `<div class="alt-header">${lblWind}</div>`;

    rows.forEach(r => {
        const color = catColors[r.cat.cat];
        const visiM = r.cat.visiM;
        const ceilFt = r.cat.ceilHund === 999 ? null : r.cat.ceilHund * 100;
        const wind = r.cat.wind;

        const visiStr = visiM >= 10000 ? '>10km' : `${visiM}m`;
        const ceilStr = ceilFt !== null ? `${ceilFt}ft` : (isFr ? '∞' : '∞');
        const windStr = wind ? `${wind.dir === null ? 'VRB' : String(wind.dir).padStart(3, '0') + '°'} ${wind.speed}${wind.gust ? 'G' + wind.gust : ''}` : '—';

        html += `
            <div class="alt-cell alt-cell-name" title="${escapeHtml(r.name)}" data-icao="${escapeHtml(r.code)}">
                <span class="alt-code">${escapeHtml(r.code)}</span>
                <span class="alt-name">${escapeHtml(r.name)}</span>
            </div>
            <div class="alt-cell" style="color:${color}; font-weight:800;">${r.cat.cat}</div>
            <div class="alt-cell" style="${visiM < 5000 ? 'color:#FCA5A5;' : ''}">${visiStr}</div>
            <div class="alt-cell" style="${ceilFt !== null && ceilFt < 1500 ? 'color:#FCA5A5;' : ''}">${ceilStr}</div>
            <div class="alt-cell">${windStr}</div>
        `;
    });
    html += `</div>`;

    html += `<div style="font-size:11px; color:var(--text-muted); margin-top:10px; line-height:1.5;">
        <i data-lucide="info" style="width:13px;height:13px;vertical-align:middle;"></i>
        ${isFr
            ? `Alternates viables autour de <strong>${escapeHtml(destIcao)}</strong>, triés par viabilité (catégorie de vol puis proximité). Cliquez un terrain pour le charger.`
            : `Viable alternates around <strong>${escapeHtml(destIcao)}</strong>, sorted by flight category then proximity. Click a field to load it.`}
    </div>`;

    list.innerHTML = html;
    if (window.lucide) window.lucide.createIcons({ root: list });

    list.querySelectorAll('.alt-cell-name').forEach(cell => {
        cell.style.cursor = 'pointer';
        cell.addEventListener('click', () => {
            const targetIcao = cell.dataset.icao;
            if (targetIcao) {
                document.getElementById('icaoInput').value = targetIcao;
                document.getElementById('btn-fetch-metar').click();
            }
        });
    });
}

function _categoryFromMetar(raw) {
    const visiMatch = raw.match(/KT(?:\s+\d{3}V\d{3})?\s+(\d{4})\b/);
    const visiM = visiMatch ? (parseInt(visiMatch[1], 10) === 9999 ? 10000 : parseInt(visiMatch[1], 10)) : parseVisiToMeters('');

    let ceilHund = 999;
    const cloudMatches = [...raw.matchAll(/\b(BKN|OVC)(\d{3})/g)];
    cloudMatches.forEach(m => {
        const alt = parseInt(m[2], 10);
        if (alt < ceilHund) ceilHund = alt;
    });
    const vvMatch = raw.match(/\bVV(\d{3})\b/);
    if (vvMatch) ceilHund = parseInt(vvMatch[1], 10);
    if (/CAVOK|NSC|SKC|NCD/.test(raw)) ceilHund = 999;

    const windMatch = raw.match(/\b(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT\b/);
    const wind = windMatch ? {
        variable: windMatch[1] === 'VRB',
        dir: windMatch[1] === 'VRB' ? null : parseInt(windMatch[1], 10),
        speed: parseInt(windMatch[2], 10),
        gust: windMatch[3] ? parseInt(windMatch[3], 10) : null,
    } : null;

    let cat;
    if (ceilHund < 5 || visiM < 1600) cat = 'LIFR';
    else if (ceilHund < 10 || visiM < 4800) cat = 'IFR';
    else if (ceilHund <= 30 || visiM <= 8000) cat = 'MVFR';
    else cat = 'VFR';

    return { cat, visiM, ceilHund, wind };
}

function escapeHtml(text) {
    const el = document.createElement('div');
    el.textContent = String(text || '');
    return el.innerHTML;
}
