/* ================================================================
 * ELEVATION CHART — Profil d'élévation interactif (canvas)
 * ================================================================
 *
 * Affiche le profil du terrain entre le départ et la destination sous
 * la carte régionale. Le pilote peut :
 *   - survoler pour voir l'altitude/distance du point sous le curseur,
 *   - zoomer (molette) verticalement,
 *   - glisser horizontalement pour se déplacer le long de la route.
 *
 * Une ligne horizontale représente l'altitude de croisière saisie dans
 * le planificateur de vol, pour visualiser la clearance.
 * ================================================================ */

const PAD = { top: 18, right: 16, bottom: 28, left: 52 };
const MIN_H = 100;

// État d'interaction (un seul graphique à la fois).
let _canvas = null;
let _ctx = null;
let _profile = null;
let _cruiseFt = 0;
let _fromIcao = '';
let _toIcao = '';
let _waypoints = null;        // [{icao, lat, lon}] waypoints intermédiaires (ou null).
let _zones = null;            // groupes d'espaces aériens traversés (airspace-profile.js).
let _hoverFrac = null;       // position du curseur (0-1), null si hors canvas.
let _hoverY = null;          // ordonnée du curseur (px CSS), pour le survol des zones.
let _zoomMax = null;         // plafond de l'échelle Y (ft), null = auto ; la base est fixée au sol.
let _dragging = false;
let _dragStartX = 0;
let _dragOffset = 0;
let _distTotalKm = 0;
let _lastScale = null;        // dernière échelle dessinée (QA : sol ancré en bas).

/**
 * Affiche le profil d'élévation dans le conteneur donné.
 * @param {string} containerId ID du conteneur parent.
 * @param {Object} profile Résultat de fetchRouteElevation ({points, maxFt, minFt, avgFt}).
 * @param {number} cruiseAltFt Altitude de croisière (ft).
 * @param {string} fromIcao Code OACI départ.
 * @param {string} toIcao Code OACI destination.
 * @param {Array|null} waypoints Waypoints intermédiaires [{icao, lat, lon}] pour multi-leg.
 * @param {Array|null} routeAirspaces Groupes de zones traversées (airspace-profile.js) —
 *        rectangles d'altitude + infobulle au survol.
 */
export function renderElevationChart(containerId, profile, cruiseAltFt, fromIcao, toIcao, waypoints = null, routeAirspaces = null) {
    const container = document.getElementById(containerId);
    if (!container || !profile?.points?.length) {
        clearElevationChart(containerId);
        return;
    }

    container.style.display = 'block';
    _profile = profile;
    _cruiseFt = cruiseAltFt || 0;
    _waypoints = (waypoints && waypoints.length > 2) ? waypoints : null;
    _zones = routeAirspaces || null;
    _fromIcao = fromIcao || '';
    _toIcao = toIcao || '';
    _zoomMax = null;
    _hoverFrac = null;
    _hoverY = null;

    // Distance totale (km) depuis le premier/dernier point.
    const pts = profile.points;
    _distTotalKm = _haversineKm(pts[0].lat, pts[0].lon, pts[pts.length - 1].lat, pts[pts.length - 1].lon);

    // Met à jour le label de route (distance totale en NM, unité aviation).
    const label = document.getElementById('elev-route-label');
    if (label) label.textContent = `${fromIcao} → ${toIcao} · ${Math.round(_distTotalKm / 1.852)} NM`;

    _ensureCanvas(container);
    _draw();
    // Rediffère le dessin : si le conteneur était invisible au moment du
    // premier _draw() (panneau carte fermé), le canvas avait une largeur nulle.
    // requestAnimationFrame + timeout double pour couvrir le délai d'animation CSS.
    requestAnimationFrame(() => { _draw(); setTimeout(_draw, 250); });
}

/**
 * Redessine le graphique avec la langue courante (titre compris) — appelé
 * sur l'événement 'lang-changed' émis par setLanguage.
 */
export function refreshElevationChart() {
    _draw();
}

/** Échelle Y du dernier dessin — réservé aux tests (sol ancré en bas). */
export function _debugScale() { return _lastScale; }

/**
 * Masque et vide le graphique.
 */
export function clearElevationChart(containerId) {
    const container = document.getElementById(containerId);
    if (container) container.style.display = 'none';
    if (_canvas && _canvas.parentElement === container) {
        _detachListeners();
        _canvas.remove();
        _canvas = null;
        _ctx = null;
    }
    _profile = null;
}

// ----------------------------------------------------------------
// Rendu canvas
// ----------------------------------------------------------------

function _ensureCanvas(container) {
    const old = document.getElementById('elevation-canvas');
    if (old) { _detachListeners(); old.remove(); }

    const title = document.createElement('div');
    title.className = 'elev-title';
    title.style.cssText = 'font-size:11px; color:var(--text-muted); margin-bottom:4px; font-weight:600;';

    _canvas = document.createElement('canvas');
    _canvas.id = 'elevation-canvas';
    _canvas.style.cssText = 'width:100%; height:150px; cursor:crosshair; display:block;';
    _ctx = _canvas.getContext('2d');

    container.innerHTML = '';
    container.appendChild(title);
    container.appendChild(_canvas);

    _attachListeners();

    // ResizeObserver pour gérer la responsivité.
    if (window.ResizeObserver) {
        const ro = new ResizeObserver(() => _draw());
        ro.observe(_canvas);
        _canvas._ro = ro;
    }
}

function _draw() {
    if (!_ctx || !_canvas || !_profile) return;

    // Titre re-traduit à chaque dessin (langue courante du document).
    const titleEl = _canvas.parentElement?.querySelector('.elev-title');
    if (titleEl) {
        const isFr = (document.documentElement.lang || 'fr') === 'fr';
        titleEl.textContent = isFr
            ? `Profil d'élévation — ${_fromIcao} → ${_toIcao}`
            : `Elevation profile — ${_fromIcao} → ${_toIcao}`;
    }

    const dpr = window.devicePixelRatio || 1;
    const cw = _canvas.clientWidth;
    const ch = Math.max(MIN_H, _canvas.clientHeight);
    _canvas.width = cw * dpr;
    _canvas.height = ch * dpr;
    _ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    _ctx.clearRect(0, 0, cw, ch);

    const pts = _profile.points;
    const plotW = cw - PAD.left - PAD.right;
    const plotH = ch - PAD.top - PAD.bottom;

    // Échelle Y (altitude) : le SOL reste collé en bas du graphe — la base
    // est 0 ft (ou le relief le plus bas s'il est négatif) et ne bouge
    // JAMAIS au zoom ; seul le plafond de la fenêtre change. La marge de
    // tête (× 1,2) garde la ligne de croisière sous les codes OACI du haut.
    const yMin = Math.min(0, _profile.minFt);
    let yMax = _zoomMax ?? Math.max(_profile.maxFt, _cruiseFt) * 1.2 + 100;
    if (yMax - yMin < 500) yMax = yMin + 500; // évite une échelle trop plate.
    _lastScale = { yMin, yMax };

    const xOf = frac => PAD.left + frac * plotW;
    const yOf = elev => PAD.top + (1 - (elev - yMin) / (yMax - yMin)) * plotH;

    // --- Fond ---
    _ctx.fillStyle = 'rgba(255,255,255,0.03)';
    _ctx.fillRect(PAD.left, PAD.top, plotW, plotH);

    // --- Grille horizontale + labels Y ---
    _ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    _ctx.lineWidth = 1;
    _ctx.fillStyle = 'rgba(255,255,255,0.35)';
    _ctx.font = '9px "DM Mono", monospace';
    _ctx.textAlign = 'right';
    const ySteps = 4;
    for (let i = 0; i <= ySteps; i++) {
        const elev = yMin + (yMax - yMin) * i / ySteps;
        const y = PAD.top + (1 - i / ySteps) * plotH;
        _ctx.beginPath();
        _ctx.moveTo(PAD.left, y);
        _ctx.lineTo(cw - PAD.right, y);
        _ctx.stroke();
        _ctx.fillText(Math.round(elev) + ' ft', PAD.left - 6, y + 3);
    }

    // --- Rectangles d'altitude des zones traversées (sous le terrain) ---
    // Conteneurs d'abord, imbriqués par-dessus ; plafond au-dessus de
    // l'échelle → bord haut pointillé (il continue au-dessus du graphe).
    const hoveredZone = _drawZones(xOf, yOf, yMax, plotW, plotH);

    // --- Aire sous la courbe ---
    _ctx.beginPath();
    _ctx.moveTo(xOf(pts[0].frac), PAD.top + plotH);
    pts.forEach(p => _ctx.lineTo(xOf(p.frac), yOf(p.elevFt)));
    _ctx.lineTo(xOf(pts[pts.length - 1].frac), PAD.top + plotH);
    _ctx.closePath();
    const grad = _ctx.createLinearGradient(0, PAD.top, 0, PAD.top + plotH);
    grad.addColorStop(0, 'rgba(251,146,60,0.35)');
    grad.addColorStop(1, 'rgba(251,146,60,0.05)');
    _ctx.fillStyle = grad;
    _ctx.fill();

    // --- Ligne de terrain ---
    _ctx.beginPath();
    pts.forEach((p, i) => {
        const x = xOf(p.frac), y = yOf(p.elevFt);
        if (i === 0) _ctx.moveTo(x, y); else _ctx.lineTo(x, y);
    });
    _ctx.strokeStyle = '#FB923C';
    _ctx.lineWidth = 1.8;
    _ctx.stroke();

    // --- Ligne altitude de croisière ---
    if (_cruiseFt > yMin && _cruiseFt < yMax) {
        const yc = yOf(_cruiseFt);
        _ctx.beginPath();
        _ctx.setLineDash([6, 4]);
        _ctx.moveTo(PAD.left, yc);
        _ctx.lineTo(cw - PAD.right, yc);
        _ctx.strokeStyle = '#38BDF8';
        _ctx.lineWidth = 1.5;
        _ctx.stroke();
        _ctx.setLineDash([]);
        _ctx.fillStyle = '#38BDF8';
        _ctx.font = '9px "DM Sans", sans-serif';
        _ctx.textAlign = 'left';
        // Ligne haute (croisière qui domine) : le libellé passe SOUS la
        // ligne pour ne pas se coller aux codes OACI du coin haut gauche.
        const ly = yc < PAD.top + 30 ? yc + 11 : yc - 4;
        _ctx.fillText(Math.round(_cruiseFt) + ' ft', PAD.left + 4, ly);
    }

    // --- Axe X : distance de chaque tronçon (entre waypoints), en NM ---
    // Remplace les graduations km : le pilote veut la distance de chaque
    // segment de route, alignée sous celui-ci (bornes = départ, étapes, arrivée).
    _ctx.fillStyle = 'rgba(255,255,255,0.55)';
    _ctx.font = '9px "DM Mono", monospace';
    _ctx.textAlign = 'center';
    const distTotalNm = _distTotalKm / 1.852;
    const bornes = [0];
    if (_waypoints && _waypoints.length > 2) {
        for (let i = 1; i < _waypoints.length - 1; i++) {
            const f = _findWaypointFrac(_waypoints[i]);
            if (f != null) bornes.push(f);
        }
        bornes.sort((a, b) => a - b);
    }
    bornes.push(1);
    for (let i = 0; i < bornes.length - 1; i++) {
        const nm = Math.round((bornes[i + 1] - bornes[i]) * distTotalNm);
        _ctx.fillText(nm + ' NM', xOf((bornes[i] + bornes[i + 1]) / 2), ch - PAD.bottom + 16);
    }

    // --- Labels départ / arrivée ---
    _ctx.textAlign = 'left';
    _ctx.fillStyle = 'rgba(255,255,255,0.5)';
    _ctx.font = 'bold 9px "DM Mono", monospace';
    _ctx.fillText(_fromIcao, PAD.left + 2, PAD.top + 10);
    _ctx.textAlign = 'right';
    _ctx.fillText(_toIcao, cw - PAD.right - 2, PAD.top + 10);

    // --- Marqueurs waypoints intermédiaires (multi-leg) ---
    if (_waypoints && _waypoints.length > 2) {
        for (let i = 1; i < _waypoints.length - 1; i++) {
            const wp = _waypoints[i];
            // Trouve le frac du point de profil le plus proche du waypoint.
            const frac = _findWaypointFrac(wp);
            if (frac == null) continue;
            const wx = xOf(frac);

            // Ligne verticale pointillée ambre.
            _ctx.beginPath();
            _ctx.setLineDash([3, 3]);
            _ctx.moveTo(wx, PAD.top);
            _ctx.lineTo(wx, PAD.top + plotH);
            _ctx.strokeStyle = 'rgba(251, 191, 36, 0.5)';
            _ctx.lineWidth = 1;
            _ctx.stroke();
            _ctx.setLineDash([]);

            // Point + label ICAO en haut.
            _ctx.fillStyle = '#FBBF24';
            _ctx.beginPath();
            _ctx.arc(wx, PAD.top + 2, 3, 0, Math.PI * 2);
            _ctx.fill();
            _ctx.fillStyle = '#FBBF24';
            _ctx.font = 'bold 9px "DM Mono", monospace';
            _ctx.textAlign = 'center';
            _ctx.fillText(wp.name || wp.icao, wx, PAD.top - 4 > 0 ? PAD.top - 4 : PAD.top + 14);
        }
    }

    // --- Curseur de survol ---
    if (_hoverFrac != null) {
        const hx = xOf(_hoverFrac);
        const pt = _nearestPoint(_hoverFrac);
        if (pt) {
            const hy = yOf(pt.elevFt);

            // Ligne verticale.
            _ctx.beginPath();
            _ctx.setLineDash([3, 3]);
            _ctx.moveTo(hx, PAD.top);
            _ctx.lineTo(hx, PAD.top + plotH);
            _ctx.strokeStyle = 'rgba(255,255,255,0.4)';
            _ctx.lineWidth = 1;
            _ctx.stroke();
            _ctx.setLineDash([]);

            // Point sur la courbe.
            _ctx.beginPath();
            _ctx.arc(hx, hy, 4, 0, Math.PI * 2);
            _ctx.fillStyle = '#FB923C';
            _ctx.fill();
            _ctx.strokeStyle = '#fff';
            _ctx.lineWidth = 1.5;
            _ctx.stroke();

            // Tooltip (distance cumulée en NM, unité aviation).
            const nm = Math.round(pt.frac * _distTotalKm / 1.852);
            const clearance = Math.round(_cruiseFt - pt.elevFt);
            const lines = [
                `${Math.round(pt.elevFt)} ft`,
                `${nm} NM`,
                clearance >= 0 ? `+${clearance} ft` : `${clearance} ft`,
            ];
            const tipW = 76, tipH = 40;
            let tipX = hx + 10;
            if (tipX + tipW > cw - PAD.right) tipX = hx - tipW - 10;
            const tipY = Math.max(PAD.top, hy - tipH - 8);

            _ctx.fillStyle = 'rgba(15,23,42,0.95)';
            _ctx.strokeStyle = 'rgba(255,255,255,0.15)';
            _ctx.lineWidth = 1;
            _roundRect(tipX, tipY, tipW, tipH, 5);
            _ctx.fill();
            _ctx.stroke();

            _ctx.font = '9px "DM Mono", monospace';
            _ctx.textAlign = 'left';
            const colors = ['#FB923C', 'rgba(255,255,255,0.6)', clearance >= 0 ? '#4ADE80' : '#EF4444'];
            lines.forEach((line, i) => {
                _ctx.fillStyle = colors[i];
                _ctx.fillText(line, tipX + 6, tipY + 12 + i * 11);
            });
        }
    }

    // --- Infobulle de la zone survolée (nom, ALT MIN/ALT MAX, fréquence) ---
    if (hoveredZone) _drawZoneTooltip(hoveredZone, cw, xOf);
}

/** « SFC », « FL065 », « 2500 ft » — mêmes règles que la carte. */
function _altTxt(ft) {
    if (ft <= 0) return 'SFC';
    if (ft >= 4000 && ft % 500 === 0) return 'FL' + String(Math.round(ft / 100)).padStart(3, '0');
    return `${Math.round(ft)} ft`;
}

/** Rectangles des zones traversées ; renvoie la zone survolée (ou null). */
function _drawZones(xOf, yOf, yMax, plotW, plotH) {
    if (!_zones?.length) return null;
    let hovered = null;
    for (const g of _zones) {
        const clamped = g.up > yMax;
        const yT = yOf(Math.min(g.up, yMax));
        const yB = yOf(g.lo);
        if (yB - yT < 3) continue;
        for (const [fa, fb] of g.ranges) {
            const x0 = Math.max(xOf(fa), PAD.left);
            const x1 = Math.min(xOf(fb), PAD.left + plotW);
            if (x1 - x0 < 2) continue;

            _ctx.fillStyle = 'rgba(56,189,248,0.10)';
            _ctx.fillRect(x0, yT, x1 - x0, yB - yT);
            _ctx.strokeStyle = 'rgba(56,189,248,0.85)';
            _ctx.lineWidth = 1.2;
            _ctx.strokeRect(x0 + 0.5, yT + 0.5, x1 - x0 - 1, yB - yT - 1);
            if (clamped) {   // plafond au-dessus de l'échelle : bord haut pointillé
                _ctx.setLineDash([4, 3]);
                _ctx.beginPath();
                _ctx.moveTo(x0 + 1, yT + 0.5);
                _ctx.lineTo(x1 - 1, yT + 0.5);
                _ctx.stroke();
                _ctx.setLineDash([]);
            }
            // Séparateurs entre secteurs du même organisme (ex. SEINE 6/7/8).
            for (let i = 1; i < g.segs.length; i++) {
                const sx = xOf((g.segs[i - 1].fb + g.segs[i].fa) / 2);
                if (sx <= x0 || sx >= x1) continue;
                _ctx.setLineDash([3, 3]);
                _ctx.strokeStyle = 'rgba(56,189,248,0.5)';
                _ctx.lineWidth = 1;
                _ctx.beginPath();
                _ctx.moveTo(sx, yT + 1);
                _ctx.lineTo(sx, yB - 1);
                _ctx.stroke();
                _ctx.setLineDash([]);
            }
            // Survol : curseur dans ce rectangle → zone la plus spécifique.
            if (_hoverFrac != null && _hoverY != null &&
                _hoverFrac >= fa && _hoverFrac <= fb && _hoverY >= yT && _hoverY <= yB) {
                if (!hovered || g.span < hovered.g.span) {
                    const seg = g.segs.find(s => _hoverFrac >= s.fa && _hoverFrac <= s.fb) || g.segs[0];
                    hovered = { g, seg };
                }
            }
        }
    }
    return hovered;
}

/** Carte sombre au-dessus du curseur : organisme, SECTEUR survolé (nom
 *  openAIP : « SIV RENNES SUD A »…), ALT MIN/ALT MAX, fréquence — même
 *  style que l'infobulle du terrain. */
function _drawZoneTooltip({ g, seg }, cw, xOf) {
    const nm = Math.round(_hoverFrac * _distTotalKm / 1.852);
    // Secteur affiché seulement s'il précise l'organisme (un groupe sans
    // fréquence porte déjà le nom de SA zone : pas de doublon).
    const zone = seg.zone && seg.zone.toUpperCase() !== g.name.toUpperCase() ? seg.zone : null;
    const lines = [
        g.name,
        `ALT MIN : ${_altTxt(g.lo)}   ALT MAX : ${_altTxt(seg.up)}`,
        g.freq ? `${g.freq} MHz` : `${nm} NM`,
    ];
    _ctx.font = 'bold 10px "DM Sans", sans-serif';
    const w0 = _ctx.measureText(lines[0]).width;
    _ctx.font = '9.5px "DM Mono", monospace';
    let wRest = Math.max(_ctx.measureText(lines[1]).width, _ctx.measureText(lines[2]).width);
    if (zone) wRest = Math.max(wRest, _ctx.measureText(zone).width);
    const tipW = Math.max(w0, wRest) + 14, tipH = zone ? 58 : 46;
    const hx = xOf(_hoverFrac);
    let tipX = hx + 12;
    if (tipX + tipW > cw - PAD.right - 2) tipX = hx - tipW - 12;
    if (tipX < PAD.left + 2) tipX = PAD.left + 2;
    const tipY = Math.max(PAD.top + 2, (_hoverY ?? PAD.top) - tipH - 10);

    _ctx.fillStyle = 'rgba(15,23,42,0.95)';
    _ctx.strokeStyle = 'rgba(56,189,248,0.5)';
    _ctx.lineWidth = 1;
    _roundRect(tipX, tipY, tipW, tipH, 5);
    _ctx.fill();
    _ctx.stroke();

    _ctx.textAlign = 'left';
    _ctx.font = 'bold 10px "DM Sans", sans-serif';
    _ctx.fillStyle = '#E2E8F0';
    _ctx.fillText(lines[0], tipX + 7, tipY + 13);
    let y = tipY + 26;
    _ctx.font = '9.5px "DM Mono", monospace';
    if (zone) {
        _ctx.fillStyle = 'rgba(226,232,240,0.55)';
        _ctx.fillText(zone, tipX + 7, y);
        y += 12;
    }
    _ctx.fillStyle = 'rgba(226,232,240,0.75)';
    _ctx.fillText(lines[1], tipX + 7, y);
    y += 13;
    _ctx.fillStyle = '#60A5FA';
    _ctx.fillText(lines[2], tipX + 7, y);
}

function _roundRect(x, y, w, h, r) {
    _ctx.beginPath();
    _ctx.moveTo(x + r, y);
    _ctx.arcTo(x + w, y, x + w, y + h, r);
    _ctx.arcTo(x + w, y + h, x, y + h, r);
    _ctx.arcTo(x, y + h, x, y, r);
    _ctx.arcTo(x, y, x + w, y, r);
    _ctx.closePath();
}

function _nearestPoint(frac) {
    if (!_profile?.points) return null;
    let best = _profile.points[0], bestD = Infinity;
    for (const p of _profile.points) {
        const d = Math.abs(p.frac - frac);
        if (d < bestD) { bestD = d; best = p; }
    }
    return best;
}

// Trouve le frac du point de profil le plus proche (en lat/lon) d'un waypoint.
function _findWaypointFrac(wp) {
    if (!_profile?.points || !wp) return null;
    let best = null, bestD = Infinity;
    for (const p of _profile.points) {
        if (p.lat == null || p.lon == null) continue;
        const d = _haversineKm(p.lat, p.lon, wp.lat, wp.lon);
        if (d < bestD) { bestD = d; best = p.frac; }
    }
    return best;
}

// ----------------------------------------------------------------
// Interactions
// ----------------------------------------------------------------

function _attachListeners() {
    if (!_canvas) return;
    _canvas.addEventListener('mousemove', _onMove);
    _canvas.addEventListener('mouseleave', _onLeave);
    _canvas.addEventListener('wheel', _onWheel, { passive: false });
    _canvas.addEventListener('mousedown', _onDown);
    window.addEventListener('mouseup', _onUp);
    _canvas.addEventListener('touchstart', _onTouchStart, { passive: false });
    _canvas.addEventListener('touchmove', _onTouchMove, { passive: false });
}

function _detachListeners() {
    if (!_canvas) return;
    _canvas.removeEventListener('mousemove', _onMove);
    _canvas.removeEventListener('mouseleave', _onLeave);
    _canvas.removeEventListener('wheel', _onWheel);
    _canvas.removeEventListener('mousedown', _onDown);
    window.removeEventListener('mouseup', _onUp);
    _canvas.removeEventListener('touchstart', _onTouchStart);
    _canvas.removeEventListener('touchmove', _onTouchMove);
    if (_canvas._ro) _canvas._ro.disconnect();
}

function _fracFromX(clientX) {
    const rect = _canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const plotW = rect.width - PAD.left - PAD.right;
    return Math.max(0, Math.min(1, (x - PAD.left) / plotW));
}

function _yFromClient(clientY) {
    return clientY - _canvas.getBoundingClientRect().top;
}

function _onMove(e) {
    _hoverFrac = _fracFromX(e.clientX);
    _hoverY = _yFromClient(e.clientY);
    if (_dragging) {
        const rect = _canvas.getBoundingClientRect();
        const dx = e.clientX - _dragStartX;
        _dragStartX = e.clientX;
        _dragOffset += dx;
    }
    _draw();
    _emitHover();
}

function _onLeave() {
    _hoverFrac = null;
    _hoverY = null;
    _draw();
    _emitHover();
}

/**
 * Émet un événement DOM 'elevation-hover' avec la position (lat, lon)
 * du point sous le curseur, pour synchroniser le marqueur sur la carte.
 */
function _emitHover() {
    if (!_profile) return;
    const pt = _hoverFrac != null ? _nearestPoint(_hoverFrac) : null;
    document.dispatchEvent(new CustomEvent('elevation-hover', {
        detail: pt ? { lat: pt.lat, lon: pt.lon, frac: pt.frac, elevFt: pt.elevFt } : null,
    }));
}

function _onWheel(e) {
    e.preventDefault();
    if (!_profile) return;
    // Zoom vertical ANCRÉ AU SOL : la base de l'échelle (0 ft) reste en bas
    // du graphe, seul le plafond de la fenêtre se resserre ou s'étend.
    const base = Math.min(0, _profile.minFt);
    const defMax = Math.max(_profile.maxFt, _cruiseFt) * 1.2 + 100;
    let yMax = _zoomMax ?? defMax;
    yMax = base + (yMax - base) * (e.deltaY > 0 ? 1.15 : 0.87);
    _zoomMax = Math.max(base + 500, Math.min(base + 120000, yMax));
    _draw();
}

function _onDown(e) {
    _dragging = true;
    _dragStartX = e.clientX;
    _canvas.style.cursor = 'grabbing';
}

function _onUp() {
    if (_dragging) {
        _dragging = false;
        _canvas.style.cursor = 'crosshair';
    }
}

// --- Touch (mobile) ---
let _lastTouchX = 0;

function _onTouchStart(e) {
    if (e.touches.length === 1) {
        e.preventDefault();
        _lastTouchX = e.touches[0].clientX;
        _hoverFrac = _fracFromX(e.touches[0].clientX);
        _hoverY = _yFromClient(e.touches[0].clientY);
        _draw();
        _emitHover();
    }
}

function _onTouchMove(e) {
    if (e.touches.length === 1) {
        e.preventDefault();
        _hoverFrac = _fracFromX(e.touches[0].clientX);
        _hoverY = _yFromClient(e.touches[0].clientY);
        _draw();
        _emitHover();
    }
}

// ----------------------------------------------------------------
// Utils
// ----------------------------------------------------------------

function _haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
