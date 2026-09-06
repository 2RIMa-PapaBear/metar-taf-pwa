// [VERSION TEST GPS] =========================================================
// SUIVI GPS « ma position » sur la carte régionale.
// Ce module n'est chargé QUE dans la copie version-test/ (construite par
// scripts/build-test-version.mjs) : JAMAIS dans la prod Free.fr ni à la
// racine du miroir Pages. La version réelle du site reste intacte.
//
// Arbitrages validés 06/09 (feu vert pilote) :
//   - 1 clic = suivi continu (avion + carte centrée) ; si le pilote déplace
//     la carte, le centrage se coupe, l'avion reste, le bouton devient
//     « Recentrer » ; re-clic GPS = arrêt complet.
//   - Marqueur : avion Lucide blanc à contour sombre, rotation (cap − 45°)
//     car le glyphe pointe vers le NE ; cercle de précision blanc translucide.
//   - Trace magenta #D946EF du trajet parcouru : effacée à chaque démarrage,
//     conservée à l'arrêt, décimation ×2 au-delà de 2000 points.
//   - Wake Lock automatique pendant le suivi + voyant ambre « écran
//     maintenu allumé » ; libéré à l'arrêt.
//   - Contexte non sécurisé (HTTP = Free.fr) : géolocation impossible →
//     bouton grisé + infobulle « Nécessite la version HTTPS (miroir Pages) ».
// Intégration sans toucher aux modules existants : le build expose la carte
// via window.__regionalMap (1 ligne injectée dans la COPIE de regional-map.js)
// et ce module attend #map-layers-bar pour monter son bouton en fin de barre.
// ============================================================================
import { state } from './core.js';

const ROT_OFFSET = -45;          // glyphe Lucide orienté NE → rotation = cap − 45°
const TRACE_MAX = 2000;          // au-delà : décimation ×2 (mémoire bornée)
const TRACE_COLOR = '#D946EF';   // magenta EFB, distinct de la route (#38BDF8) et des repères ambre

const isFr = () => state && state.lang === 'fr';
const T = () => isFr() ? {
    title: 'Suivi de ma position GPS',
    titleStop: 'Suivi actif — cliquer pour arrêter',
    titleRecenter: 'Centrage coupé — cliquer pour reprendre le suivi',
    titleHttp: 'Nécessite la version HTTPS (miroir Pages)',
    recenter: 'Recentrer',
    voyant: 'écran maintenu allumé',
    voyantLock: 'Wake Lock actif — l\'écran restera allumé',
    voyantNoLock: 'Wake Lock indisponible sur ce navigateur',
    errDenied: 'Position indisponible : autorise la localisation de ce site dans ton navigateur (icône cadenas → Autorisations → Localisation).',
    errOther: 'Position GPS introuvable pour le moment — réessaie.',
} : {
    title: 'Track my GPS position',
    titleStop: 'Tracking active — click to stop',
    titleRecenter: 'Centering paused — click to resume tracking',
    titleHttp: 'Requires the HTTPS version (Pages mirror)',
    recenter: 'Recenter',
    voyant: 'screen kept awake',
    voyantLock: 'Wake Lock active — screen will stay on',
    voyantNoLock: 'Wake Lock unavailable on this browser',
    errDenied: 'Position unavailable: allow location for this site in your browser (padlock icon → Permissions → Location).',
    errOther: 'GPS position not found right now — try again.',
};

function planeSvg(hdg) {
    return `<svg class="gps-plane-icon" xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24"
        fill="#FFFFFF" stroke="#1E293B" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"
        style="transform: rotate(${hdg + ROT_OFFSET}deg)">
        <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>
    </svg>`;
}

// ---- Style propre au module (aucune modification de css/style.css) ---------
const CSS = `
.gps-voyant {
    display: none; align-items: center; gap: 4px; font-size: 11px; color: #CBD5E1;
    background: rgba(2, 6, 23, .7); border: 1px solid #334155; border-radius: 6px;
    padding: 3px 7px; margin-left: 4px; white-space: nowrap;
}
.gps-voyant.on { display: inline-flex; }
.gps-voyant::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: #FBBF24; box-shadow: 0 0 6px #FBBF24; }
.gps-error {
    display: none; position: fixed; top: 150px; left: 10px; z-index: 1300; max-width: 380px;
    background: #450A0A; border: 1px solid #F87171; color: #FECACA; border-radius: 8px;
    font-size: 12px; padding: 8px 10px;
}
.gps-error.on { display: block; }
.precip-toggle.gps-disabled { opacity: .45; cursor: not-allowed; }
.gps-plane-icon { filter: drop-shadow(0 1px 2px rgba(0, 0, 0, .8)); }
`;

// ---- État du contrôleur -----------------------------------------------------
let btn = null, voyant = null, errBox = null, errTimer = null;
let mode = 'off';                 // off | follow | recenter
let watchId = null, wakeLock = null;
let marker = null, circle = null, traceLine = null, trace = [];
let lastFix = null, lastHdg = 0, haveHdg = false;
let activeMap = null;

function bearing(a, b) {
    const toRad = d => d * Math.PI / 180;
    const φ1 = toRad(a[0]), φ2 = toRad(b[0]), Δλ = toRad(b[1] - a[1]);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function drawPlane(ll, hdg, accM) {
    if (!activeMap) return;
    const icon = L.divIcon({ html: planeSvg(hdg), className: '', iconSize: [30, 30], iconAnchor: [15, 15] });
    if (!marker) {
        marker = L.marker(ll, { icon, zIndexOffset: 1000, interactive: false }).addTo(activeMap);
        circle = L.circle(ll, {
            radius: accM, color: '#FFFFFF', weight: 1, opacity: .9,
            fillColor: '#FFFFFF', fillOpacity: .15, interactive: false,
            className: 'gps-acc-circle',
        }).addTo(activeMap);
    } else {
        marker.setIcon(icon).setLatLng(ll);
        circle.setLatLng(ll).setRadius(accM);
    }
}

function clearMarker() {
    if (marker && activeMap) activeMap.removeLayer(marker);
    if (circle && activeMap) activeMap.removeLayer(circle);
    marker = null; circle = null;
}

function resetTrace() {
    trace = [];
    if (traceLine && activeMap) activeMap.removeLayer(traceLine);
    traceLine = null;
}

function appendTrace(ll) {
    trace.push(ll);
    if (trace.length > TRACE_MAX) trace = trace.filter((_, i) => i % 2 === 0);
    if (!traceLine) {
        traceLine = L.polyline(trace, { color: TRACE_COLOR, weight: 3, opacity: .85, interactive: false, className: 'gps-trace-path' }).addTo(activeMap);
    } else {
        traceLine.setLatLngs(trace);
    }
}

// ---- Wake Lock --------------------------------------------------------------
async function requestWakeLock() {
    try {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { /* libéré (écran éteint, onglet masqué…) */ });
    } catch (e) { /* refusé ou indisponible : le voyant reste informatif */ }
    updateVoyant();
}
function releaseWakeLock() {
    try { wakeLock && wakeLock.release(); } catch (e) { /* déjà libéré */ }
    wakeLock = null;
    updateVoyant();
}
function updateVoyant() {
    if (!voyant) return;
    const on = mode !== 'off';
    voyant.classList.toggle('on', on);
    if (on) voyant.title = wakeLock ? T().voyantLock : T().voyantNoLock;
}
document.addEventListener('visibilitychange', () => {
    // La plateforme libère le Wake Lock quand la page passe en arrière-plan :
    // on le ré-acquiert au retour si le suivi est toujours actif.
    if (document.visibilityState === 'visible' && mode !== 'off') requestWakeLock();
});

// ---- Suivi ------------------------------------------------------------------
function onFix(pos) {
    const c = pos.coords;
    const ll = [c.latitude, c.longitude];
    // Cap : capteur boussole s'il existe, sinon cap sol calculé entre deux
    // fixations en déplacement (> ~5 kt), sinon on garde le dernier cap.
    if (Number.isFinite(c.heading)) { lastHdg = c.heading; haveHdg = true; }
    else if (lastFix && Number.isFinite(c.speed) && c.speed > 2.57) { lastHdg = bearing(lastFix, ll); haveHdg = true; }
    lastFix = ll;
    drawPlane(ll, lastHdg, Math.max(Number.isFinite(c.accuracy) ? c.accuracy : 0, 8));
    appendTrace(ll);
    if (mode === 'follow' && activeMap) activeMap.panTo(ll, { animate: true, duration: .25 });
}

function onErr(err) {
    const t = T();
    showErr(err && err.code === 1 ? t.errDenied : t.errOther);
    if (err && err.code === 1) stop();   // permission refusée : inutile d'insister
}

function showErr(msg) {
    if (!errBox) return;
    errBox.textContent = msg;
    errBox.classList.add('on');
    clearTimeout(errTimer);
    errTimer = setTimeout(() => errBox.classList.remove('on'), 8000);
}

function start() {
    const map = window.__regionalMap;
    if (!map || !navigator.geolocation) return;
    activeMap = map;
    resetTrace();
    clearMarker();
    lastFix = null; haveHdg = false; lastHdg = 0;
    mode = 'follow';
    render();
    requestWakeLock();
    watchId = navigator.geolocation.watchPosition(onFix, onErr,
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
    map.on('dragstart', onUserDrag);
}

function stop() {
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    if (activeMap) activeMap.off('dragstart', onUserDrag);
    releaseWakeLock();
    clearMarker();          // la trace reste affichée après l'arrêt
    mode = 'off';
    render();
}

function onUserDrag() {
    if (mode === 'follow') { mode = 'recenter'; render(); }
}

// ---- Bouton ------------------------------------------------------------------
function render() {
    if (!btn) return;
    const t = T();
    if (mode === 'off') {
        btn.innerHTML = '<i data-lucide="navigation" style="width:14px;height:14px;"></i><span>GPS</span>';
        btn.classList.remove('active');
        btn.title = t.title;
    } else if (mode === 'follow') {
        btn.innerHTML = '<i data-lucide="navigation" style="width:14px;height:14px;"></i><span>GPS</span>';
        btn.classList.add('active');
        btn.title = t.titleStop;
    } else {
        btn.innerHTML = `<i data-lucide="locate" style="width:14px;height:14px;"></i><span>${t.recenter}</span>`;
        btn.classList.add('active');
        btn.title = t.titleRecenter;
    }
    if (window.lucide) window.lucide.createIcons({ root: btn });
    updateVoyant();
}

function mount() {
    if (window.__gpsController) return;
    const bar = document.getElementById('map-layers-bar');
    if (!bar) return;
    window.__gpsController = api;

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const group = document.createElement('div');
    group.className = 'precip-control-group';
    group.innerHTML = `
        <button class="precip-toggle" id="gps-toggle-btn">
            <i data-lucide="navigation" style="width:14px;height:14px;"></i><span>GPS</span>
        </button>
        <span class="gps-voyant">${T().voyant}</span>`;
    bar.appendChild(group);

    errBox = document.createElement('div');
    errBox.className = 'gps-error';
    document.body.appendChild(errBox);

    btn = group.querySelector('#gps-toggle-btn');
    voyant = group.querySelector('.gps-voyant');

    // HTTP (Free.fr) : géolocation impossible → bouton grisé + infobulle.
    if (!(window.isSecureContext && navigator.geolocation)) {
        const t = T();
        btn.disabled = true;
        btn.classList.add('gps-disabled');
        btn.title = t.titleHttp;
        return;
    }

    btn.addEventListener('click', () => {
        if (mode === 'off') start();
        else if (mode === 'recenter') {
            mode = 'follow';
            if (lastFix && activeMap) activeMap.panTo(lastFix, { animate: true, duration: .3 });
            render();
        } else stop();
    });

    render();
}

const api = { start, stop, get mode() { return mode; } };

// La barre est créée à l'ouverture de la carte : on attend qu'elle existe.
const poll = setInterval(() => {
    if (document.getElementById('map-layers-bar') && window.__regionalMap) {
        clearInterval(poll);
        mount();
    }
}, 300);
setTimeout(() => clearInterval(poll), 120000);
