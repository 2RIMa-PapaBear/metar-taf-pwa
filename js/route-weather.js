import { state, I18N, fetchAvecRelais, memoGet, escapeHtml } from './core.js';
import { getAirportByICAO } from './ui-module.js';
import { parseVisiToMeters, CAT_COLORS } from './core.js';
import { greatCircleDistanceNm, trueCourseDeg } from './flight-planner.js';
import { getDeclinationForIcao } from './magvar.js';

let _routeLayer = null;
let _routeMarkers = [];
let _waypointMarkers = [];
let _lastFitKey = null;
let _wpActionsBound = false;   // handlers popupopen des waypoints de route

// Étiquettes de tronçons (Cap / Distance / Temps) + case à cocher bas-gauche.
const ROUTE_LABELS_LS = 'mt-route-labels';
let _legLabelMarkers = [];
let _routeLabelsCtl = null;
let _lastMap = null;
let _lastRoutePoints = [];

export async function showRouteWeather(map, fromIcao, toIcao, opts = {}) {
    if (!map || !fromIcao || !toIcao || fromIcao === toIcao) {
        _clearRoute(map);
        return;
    }

    const fromApt = getAirportByICAO(fromIcao);
    const toApt = getAirportByICAO(toIcao);
    const fromMemo = memoGet(fromIcao);
    const toMemo = memoGet(toIcao);

    const fromLat = fromMemo?.lat ?? fromApt?.lat ?? null;
    const fromLon = fromMemo?.lon ?? fromApt?.lon ?? null;
    const toLat = toMemo?.lat ?? toApt?.lat ?? null;
    const toLon = toMemo?.lon ?? toApt?.lon ?? null;

    if (fromLat == null || toLat == null) {
        _clearRoute(map);
        return;
    }

    _clearRoute(map);

    // Construit la liste des points : A→B simple, ou multi-waypoints si state.route est défini.
    const route = (Array.isArray(state.route) && state.route.length >= 3)
        ? state.route : [fromIcao, toIcao];
    const routePoints = [];
    for (const icao of route) {
        if (!icao) continue;
        const apt = getAirportByICAO(icao);
        const memo = memoGet(icao);
        const lat = memo?.lat ?? apt?.lat ?? null;
        const lon = memo?.lon ?? apt?.lon ?? null;
        if (lat != null && lon != null) routePoints.push([lat, lon, icao]);
    }
    if (routePoints.length < 2) { _clearRoute(map); return; }

    // Polyline principale (A→B ou multi-points) — même bleu que la ligne
    // d'altitude de croisière du profil d'élévation (#38BDF8), cohérence
    // visuelle route ↔ profil.
    _routeLayer = L.polyline(routePoints.map(p => [p[0], p[1]]), {
        color: '#38BDF8',
        weight: 3,
        opacity: 0.8,
        dashArray: '8, 6',
    }).addTo(map);

    _addRouteEndpoint(map, fromLat, fromLon, fromIcao, true);
    _addRouteEndpoint(map, toLat, toLon, toIcao, false);
    // Marqueurs intermédiaires pour les waypoints (cercles ambre) — ajoutés directement
    // à la map (pas à la polyline, qui n'accepte pas addTo).
    // Étiquette permanente du CODE OACI pour les aérodromes ; les repères
    // libres (ZZxx) portent déjà leur nom via leur marqueur dédié (pas de
    // doublon d'étiquette).
    const isFr = state.lang === 'fr';
    _waypointMarkers = routePoints.slice(1, -1).map(p => {
        const isFreeWp = /^ZZ[A-Z]{2}$/.test(p[2]);
        const apt = getAirportByICAO(p[2]);
        const name = apt?.name && apt.name !== p[2] ? apt.name : null;
        const marker = L.circleMarker([p[0], p[1]], {
            radius: 5, color: '#FBBF24', weight: 2, fillColor: '#FBBF24', fillOpacity: 0.4,
        }).addTo(map).bindPopup(`
            <div class="mp-inner">
                <div class="mp-title"><strong>${escapeHtml(name || p[2])}</strong>${name && name !== p[2] ? ` · <span style="font-family:'DM Mono',monospace;font-size:10px;color:var(--text-muted,#94A3B8);">${escapeHtml(p[2])}</span>` : ''}</div>
                <div class="mp-btns">
                    ${isFreeWp ? `<button class="mp-renamewp-btn" data-icao="${escapeHtml(p[2])}">${isFr ? 'Renommer' : 'Rename'}</button>` : ''}
                    <button class="mp-rmwp-btn" data-icao="${escapeHtml(p[2])}" title="${isFr ? 'Retire cette étape du plan de vol' : 'Remove this leg from the flight plan'}">${isFr ? 'Retirer du plan' : 'Remove from plan'}</button>
                </div>
            </div>
        `, { maxWidth: 250, keepInView: true });
        if (!isFreeWp) {
            marker.bindTooltip(escapeHtml(p[2]), { permanent: true, direction: 'right', className: 'free-wp-label' });
        }
        return marker;
    });
    _mountWaypointPopupActions(map);

    // Étiquettes Cap / Distance / Temps par tronçon (selon les cases cochées).
    _lastMap = map;
    _lastRoutePoints = routePoints;
    _mountRouteLabelsControl(map);
    _drawLegLabels(map, routePoints);

    // Cadrage automatique sur la route (départ + arrivée visibles) — uniquement
    // quand la route CHANGE, pas aux rafraîchissements météo, pour ne pas
    // reprendre la main sur un utilisateur qui a déplacé la carte.
    const fitKey = routePoints.map(p => p[2]).join('>');
    if (fitKey !== _lastFitKey) {
        _lastFitKey = fitKey;
        map.fitBounds(_routeLayer.getBounds(), { padding: [40, 40], maxZoom: 10 });
    }

    if (!opts.skipMetars) {
        await _loadCorridorMetars(map, fromLat, fromLon, toLat, toLon, fromIcao, toIcao, opts);
    }
}

// Force le prochain affichage de route à recadrer la carte (appelé par
// regional-map à chaque (ré)initialisation, et quand la route est effacée).
export function resetRouteFit() {
    _lastFitKey = null;
}

// Effacement de la route (retour au vol local) : le prochain tracé recadrera.
// (Garde-fou DOM : le module est aussi importé par les tests Node.)
if (typeof document !== 'undefined') {
    document.addEventListener('clear-route', resetRouteFit);
}

async function _loadCorridorMetars(map, fromLat, fromLon, toLat, toLon, fromIcao, toIcao, opts = {}) {
    try {
        // Anti-doublon : pas de seconde pastille sur un aérodrome déjà affiché
        // comme voisin, ni sur le départ/destination (points verts/rouges de la
        // route) — sinon deux points décalés par terrain (ARP vs station).
        const skip = opts.skipIcao || (() => false);

        const minLat = Math.min(fromLat, toLat) - 1;
        const maxLat = Math.max(fromLat, toLat) + 1;
        const minLon = Math.min(fromLon, toLon) - 1;
        const maxLon = Math.max(fromLon, toLon) + 1;

        const stationsUrl = `https://aviationweather.gov/api/data/stationinfo?bbox=${minLat},${minLon},${maxLat},${maxLon}&format=json`;
        const stations = await fetchAvecRelais(stationsUrl, 'json', 3600);
        if (!Array.isArray(stations)) return;

        const corridorStations = stations
            .filter(s => {
                if (!s.icaoId || !/^[A-Z][A-Z0-9]{3}$/.test(s.icaoId)) return false;
                const code = s.icaoId.toUpperCase();
                if (code === fromIcao.toUpperCase() || code === toIcao.toUpperCase()) return false;
                if (skip(code)) return false;
                const d = _pointToSegmentDist(s.lat, s.lon, fromLat, fromLon, toLat, toLon);
                return d < 0.8;
            })
            .sort((a, b) => _pointToSegmentDist(a.lat, a.lon, fromLat, fromLon, toLat, toLon) - _pointToSegmentDist(b.lat, b.lon, fromLat, fromLon, toLat, toLon))
            .slice(0, 10);

        if (corridorStations.length === 0) return;

        const metarUrl = `https://aviationweather.gov/api/data/metar?ids=${corridorStations.map(s => s.icaoId).join(',')}&format=json`;
        const metars = await fetchAvecRelais(metarUrl, 'json');
        if (!Array.isArray(metars)) return;

        const metarByCode = {};
        metars.forEach(m => {
            const code = (m.icaoId || m.stationId || '').toUpperCase();
            if (code) metarByCode[code] = m.rawOb || m.rawMetar || m.rawText || '';
        });

        const catColors = CAT_COLORS;
        corridorStations.forEach(s => {
            const raw = metarByCode[s.icaoId.toUpperCase()];
            if (!raw) return;
            const cat = _categoryFromMetar(raw);
            const color = catColors[cat] || '#94A3B8';

            const marker = L.circleMarker([s.lat, s.lon], {
                radius: 6,
                fillColor: color,
                color: '#fff',
                weight: 1,
                opacity: 1,
                fillOpacity: 0.85,
            }).addTo(map);

            marker.bindTooltip(`<strong>${s.icaoId}</strong> — <span style="color:${color};font-weight:700;">${cat}</span>`, { direction: 'top' });
            _routeMarkers.push(marker);
        });
    } catch (e) {
        console.warn('Corridor METAR load failed:', e);
    }
}

// Actions des popups des waypoints de route : « Retirer du plan » (app.js
// retire le code du champ Waypoints et relance le calcul) et « Renommer »
// pour les repères libres (regional-map rouvre son éditeur au point).
function _mountWaypointPopupActions(map) {
    if (_wpActionsBound || !map) return;
    _wpActionsBound = true;
    map.on('popupopen', (e) => {
        const el = e.popup?.getElement();
        const rmBtn = el?.querySelector('.mp-rmwp-btn');
        if (rmBtn) {
            rmBtn.addEventListener('click', () => {
                const icao = rmBtn.dataset.icao;
                if (!icao) return;
                map.closePopup();
                document.dispatchEvent(new CustomEvent('remove-waypoint', { detail: { icao } }));
            });
        }
        const rnBtn = el?.querySelector('.mp-renamewp-btn');
        if (rnBtn) {
            rnBtn.addEventListener('click', () => {
                const icao = rnBtn.dataset.icao;
                if (!icao) return;
                map.closePopup();
                document.dispatchEvent(new CustomEvent('edit-free-waypoint', { detail: { icao } }));
            });
        }
    });
}

function _addRouteEndpoint(map, lat, lon, icao, isStart) {    const marker = L.circleMarker([lat, lon], {
        radius: 11,
        fillColor: isStart ? '#4ADE80' : '#EF4444',
        color: '#fff',
        weight: 3,
        opacity: 1,
        fillOpacity: 0.9,
    }).addTo(map);
    // Étiquette permanente du code OACI (vert départ / rouge arrivée), même
    // principe que les étapes intermédiaires. Remplace l'ancien tooltip de
    // survol : l'information est désormais toujours visible.
    marker.bindTooltip(escapeHtml(icao), {
        permanent: true,
        direction: 'right',
        className: isStart ? 'route-dep-label' : 'route-arr-label',
    });
    _routeMarkers.push(marker);
}

// ---------------------------------------------------------------------------
// Étiquettes de tronçons : Cap / Distance / Temps.
//
// Données : plan de vol du planificateur (state._lastNavPlan.plan.legs) quand
// il est disponible — caps magnétiques et temps AVEC vent exacts ; sinon
// calcul géographique (cap vrai - déclinaison, distance orthodromique) et
// pas de temps (il faut le vent et le TAS pour l'estimer).
// Position : au milieu de chaque tronçon, du CÔTÉ DROIT du sens de vol —
// la direction écran du tooltip est choisie selon le cap pour ne jamais
// recouvrir la ligne (ex. tronçon vers l'est → étiquette en dessous).
// ---------------------------------------------------------------------------

function _readLabelPrefs() {
    const base = { cap: false, dist: false, time: false };
    try { return { ...base, ...JSON.parse(localStorage.getItem(ROUTE_LABELS_LS) || '{}') }; }
    catch { return base; }
}

function _fmtMin(min) {
    if (min == null || min < 0) return null;
    const h = Math.floor(min / 60), m = Math.round(min % 60);
    return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
}

// Cap du tronçon → direction d'écran de la pilule : à DROITE pour un tronçon
// vertical (nord/sud), AU-DESSUS pour un tronçon horizontal (est/ouest) —
// jamais en dessous ni à gauche, et jamais sur la ligne.
// Exporté pour les tests.
export function _tooltipDirForTrack(tc) {
    const horizontal = (tc >= 45 && tc < 135) || (tc >= 225 && tc < 315);
    return horizontal ? 'top' : 'right';
}

// Case à cocher « Cap / Distance / Temps » en bas à gauche de la carte.
function _mountRouteLabelsControl(map) {
    if (_routeLabelsCtl) return;
    const prefs = _readLabelPrefs();
    const ctl = L.control({ position: 'bottomleft' });
    ctl.onAdd = () => {
        const isFr = state.lang === 'fr';
        const div = L.DomUtil.create('div', 'route-labels-ctl');
        const items = [
            ['cap', isFr ? 'Cap' : 'Hdg'],
            ['dist', isFr ? 'Distance' : 'Distance'],
            ['time', isFr ? 'Temps' : 'Time'],
        ];
        div.innerHTML = items.map(([k, lbl]) =>
            `<label><input type="checkbox" data-k="${k}" ${prefs[k] ? 'checked' : ''}><span>${lbl}</span></label>`
        ).join('');
        L.DomEvent.disableClickPropagation(div);
        div.addEventListener('change', (e) => {
            const k = e.target.dataset?.k;
            if (!k) return;
            const p = _readLabelPrefs();
            p[k] = e.target.checked;
            try { localStorage.setItem(ROUTE_LABELS_LS, JSON.stringify(p)); } catch { /* quota */ }
            if (_lastMap && _lastRoutePoints.length) _drawLegLabels(_lastMap, _lastRoutePoints);
        });
        return div;
    };
    ctl.addTo(map);
    _routeLabelsCtl = ctl;
}

function _drawLegLabels(map, routePoints) {
    _legLabelMarkers.forEach(m => map.removeLayer(m));
    _legLabelMarkers = [];

    const prefs = _readLabelPrefs();
    if (!prefs.cap && !prefs.dist && !prefs.time) return;

    const plan = state._lastNavPlan?.plan;
    const legs = plan?.legs;
    for (let i = 0; i < routePoints.length - 1; i++) {
        const [aLat, aLon] = routePoints[i];
        const [bLat, bLon] = routePoints[i + 1];
        // Tronçon unique (A→B sans étape) : le plan single-leg porte aussi
        // cap/distance/temps — exposés comme une jambe virtuelle d'indice 0.
        const leg = Array.isArray(legs)
            ? legs[i]
            : (i === 0 ? { magHeading: plan?.magHeading, distanceNm: plan?.distanceNm, legTimeMin: plan?.legTimeMin } : null);
        const tc = trueCourseDeg(aLat, aLon, bLat, bLon);

        const lines = [];
        if (prefs.cap) {
            const mag = leg?.magHeading != null
                ? leg.magHeading
                : Math.round(((tc - (getDeclinationForIcao(routePoints[i][2]) ?? 0)) % 360 + 360) % 360);
            lines.push(`<span class="rll-cap">${String(mag).padStart(3, '0')}°</span>`);
        }
        if (prefs.dist) {
            const nm = Math.round(leg?.distanceNm ?? greatCircleDistanceNm(aLat, aLon, bLat, bLon));
            lines.push(`<span class="rll-dist">${nm} NM</span>`);
        }
        if (prefs.time) {
            const t = _fmtMin(leg?.legTimeMin ?? null);
            if (t) lines.push(`<span class="rll-time">${t}</span>`);
        }
        if (!lines.length) continue;

        const marker = L.marker([(aLat + bLat) / 2, (aLon + bLon) / 2], {
            interactive: false,
            icon: L.divIcon({ className: 'rll-anchor', iconSize: [0, 0] }),
        });
        marker.bindTooltip(lines.join('<br>'), {
            permanent: true,
            direction: _tooltipDirForTrack(Math.round(tc)),
            className: 'route-leg-label',
            opacity: 1,
        });
        marker.addTo(map);
        _legLabelMarkers.push(marker);
    }
}

function _clearRoute(map) {
    if (_routeLayer && map) {
        map.removeLayer(_routeLayer);
        _routeLayer = null;
    }
    _routeMarkers.forEach(m => map.removeLayer(m));
    _routeMarkers = [];
    _waypointMarkers.forEach(m => map.removeLayer(m));
    _waypointMarkers = [];
    _legLabelMarkers.forEach(m => map.removeLayer(m));
    _legLabelMarkers = [];
}

function _pointToSegmentDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
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

    if (ceilHund < 5 || visiM < 1600) return 'LIFR';
    if (ceilHund < 10 || visiM < 4800) return 'IFR';
    if (ceilHund <= 30 || visiM <= 8000) return 'MVFR';
    return 'VFR';
}
