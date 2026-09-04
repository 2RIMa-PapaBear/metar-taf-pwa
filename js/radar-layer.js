/* ================================================================
 * RADAR — Animation précipitations
 * ================================================================
 *
 * FONCTIONNALITÉ
 * --------------
 * Remplace l'ancien radar statique de regional-map.js par un
 * contrôleur animé reposant sur RainViewer :
 *
 *   RADAR (précipitations) :
 *      - Frames passées (dernières ~2h, par pas de 10 min).
 *      - Animation en boucle, lecture/pause, slider temporel.
 *
 * SOURCE
 * ------
 * RainViewer — https://api.rainviewer.com/public/weather-maps.json
 * Gratuit, sans clé, CORS natif. API v2 : le manifeste renvoie
 * l'hôte tuile + des chemins de base hash (ex. /v2/radar/3aa62ff1a7da)
 * auxquels on suffixe /{size}/{z}/{x}/{y}/{color}/{smooth}_1.png.
 *
 * ARCHITECTURE
 * ------------
 * createPrecipController(map) fabrique un contrôleur encapsulant :
 *   - le chargement du manifeste RainViewer (cache 10 min),
 *   - les couches Leaflet (une active à la fois par type),
 *   - l'horloge d'animation (setInterval, vitesse réglable),
 *   - le rendu HTML des contrôles dans un conteneur fourni.
 *
 * Le contrôleur est créé une fois par carte et détruit à la fermeture
 * du panneau pour libérer les minuteurs et les couches.
 * ================================================================ */

import { state } from './core.js';

const MANIFEST_URL = 'https://api.rainviewer.com/public/weather-maps.json';
const MANIFEST_TTL_MS = 10 * 60 * 1000;      // rafraîchi toutes les 10 min
const DEFAULT_SPEED_MS = 600;                 // ms entre frames à vitesse normale
const TILE_SIZE = 256;
// Schéma de couleur RainViewer : 2 = original (vert→jaune→rouge).
// smooth=1 active l'interpolation spatiale (rendu plus doux).
const RADAR_COLOR = 2;
const RADAR_SMOOTH = 1;

// Cache du manifeste (partagé entre contrôleurs d'une même session).
let _manifest = null;
let _manifestTs = 0;

/**
 * Charge le manifeste RainViewer, avec cache session de 10 min.
 * Timeout de 12s : un fetch qui pend indéfiniment laisse la carte vide
 * sans feedback. On échoue vite pour pouvoir réessayer au prochain toggle.
 * @returns {Promise<Object>} Manifeste RainViewer.
 */
async function _loadManifest() {
    if (_manifest && Date.now() - _manifestTs < MANIFEST_TTL_MS) return _manifest;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    try {
        const res = await fetch(MANIFEST_URL, { signal: controller.signal });
        if (!res.ok) throw new Error('RainViewer HTTP ' + res.status);
        _manifest = await res.json();
        _manifestTs = Date.now();
        return _manifest;
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Construit la liste des frames radar (passées + prévision).
 * Les frames passées sont inversées pour obtenir un ordre chronologique.
 * @param {Object} manifest Manifeste RainViewer.
 * @returns {Array<{time:number, path:string, forecast:boolean}>}
 */
function _buildRadarFrames(manifest) {
    const past = (manifest.radar?.past || []).map(f => ({ ...f, forecast: false }));
    const nowcast = (manifest.radar?.nowcast || []).map(f => ({ ...f, forecast: true }));
    return [...past, ...nowcast];
}

/**
 * Construit le template d'URL tuile RainViewer (v2) pour Leaflet.
 *
 * L'API v2 ne renvoie plus que le chemin de base (ex. /v2/radar/3aa62ff1a7da) ;
 * il faut lui suffixer taille / {z}/{x}/{y} / couleur / options.
 *
 * @param {string} host Hôte (manifest.host).
 * @param {string} path Chemin de base (manifest.radar.past[].path).
 * @param {number} [color] Schéma couleur (radar seulement ; ex. 2 = original).
 * @param {number} [smooth] Lissage spatial 0/1 (radar seulement).
 * @returns {string} Template avec jetons {z}/{x}/{y} pour L.tileLayer.
 */
function _tileUrl(host, path, color, smooth) {
    // Radar : {host}{path}/{size}/{z}/{x}/{y}/{color}/{smooth}_1.png
    // (snow=1 activé par défaut pour afficher les précipitations solides).
    return `${host}${path}/${TILE_SIZE}/{z}/{x}/{y}/${color}/${smooth || 0}_1.png`;
}

/**
 * Fabrique un contrôleur radar pour une carte Leaflet.
 *
 * @param {L.Map} map Instance Leaflet.
 * @returns {{
 *   mountControls: (el: HTMLElement) => void,
 *   toggleRadar: (on: boolean) => Promise<void>,
 *   destroy: () => void
 * }}
 */
export function createPrecipController(map) {
    // ---- État interne ----
    let radarFrames = [];
    let radarLayer = null;
    let radarVisible = false;    // radar DÉSACTIVÉ par défaut (choix du pilote)
    let frameIdx = 0;            // index courant dans radarFrames
    let playing = false;
    let playTimer = null;
    let speedMs = DEFAULT_SPEED_MS;
    let controlsEl = null;       // conteneur des contrôles (pour rafraîchir l'UI)

    // ---- Initialisation asynchrone (non bloquante) ----
    let _initPromise = null;
    let _initOk = false;
    function _ensureInit() {
        // Si l'init a déjà réussi, on retourne le cache. Si la promesse est en
        // cours, on attend. Si elle a échoué, on réessaie : un échec réseau
        // ponctuel ne doit pas verrouiller le bouton pour toute la session.
        if (_initOk && _initPromise) return _initPromise;
        _initPromise = (async () => {
            const mf = await _loadManifest();
            radarFrames = _buildRadarFrames(mf);
            // Par défaut : frame la plus récente (dernière passée).
            const lastPastIdx = radarFrames.map(f => f.forecast).lastIndexOf(false);
            frameIdx = lastPastIdx >= 0 ? lastPastIdx : radarFrames.length - 1;
            _initOk = true;
        })().catch(e => {
            console.warn('Precip controller init failed:', e);
            _initOk = false;  // autorise une nouvelle tentative au prochain clic
            _initPromise = null;
        });
        return _initPromise;
    }

    // ---- Gestion des couches Leaflet ----

    function _removeRadarLayer() {
        if (radarLayer) { map.removeLayer(radarLayer); radarLayer = null; }
    }

    /**
     * Affiche la frame radar à l'index courant.
     */
    function _showRadarFrame() {
        if (!radarVisible || radarFrames.length === 0) return;
        const host = _manifest?.host;
        if (!host) return;
        const f = radarFrames[frameIdx];
        if (!f) return;
        const url = _tileUrl(host, f.path, RADAR_COLOR, RADAR_SMOOTH);
        _removeRadarLayer();
        radarLayer = L.tileLayer(url, {
            opacity: 0.65,
            tileSize: TILE_SIZE,
            attribution: '© RainViewer',
            zIndex: 400,    // au-dessus du fond de carte, sous les marqueurs
        }).addTo(map);
        _updateFrameLabel();
    }

    // ---- Animation ----

    function _play() {
        if (playing || radarFrames.length < 2) return;
        playing = true;
        playTimer = setInterval(() => {
            frameIdx = (frameIdx + 1) % radarFrames.length;
            _showRadarFrame();
            _syncSlider();
        }, speedMs);
        _updatePlayBtn();
    }

    function _pause() {
        if (playTimer) { clearInterval(playTimer); playTimer = null; }
        playing = false;
        _updatePlayBtn();
    }

    function _setFrame(i) {
        frameIdx = Math.max(0, Math.min(radarFrames.length - 1, i));
        _showRadarFrame();
        _syncSlider();
    }

    // ---- Mises à jour de l'UI des contrôles ----

    function _updatePlayBtn() {
        if (!controlsEl) return;
        const btn = controlsEl.querySelector('.precip-play-btn');
        const icon = controlsEl.querySelector('.precip-play-btn i');
        if (!btn || !icon) return;
        if (playing) {
            icon.setAttribute('data-lucide', 'pause');
            btn.setAttribute('aria-label', state.lang === 'fr' ? 'Pause' : 'Pause');
        } else {
            icon.setAttribute('data-lucide', 'play');
            btn.setAttribute('aria-label', state.lang === 'fr' ? 'Lecture' : 'Play');
        }
        if (window.lucide) window.lucide.createIcons({ root: controlsEl });
    }

    function _syncSlider() {
        if (!controlsEl) return;
        const slider = controlsEl.querySelector('.precip-slider');
        if (slider) slider.value = String(frameIdx);
    }

    function _updateFrameLabel() {
        if (!controlsEl) return;
        const label = controlsEl.querySelector('.precip-time-label');
        if (!label) return;
        const f = radarFrames[frameIdx];
        // Pas de trame (radar éteint/vides) : le « — » est masqué pour que la
        // barre d'outils de la carte tienne sur une seule ligne.
        if (!f) { label.style.display = 'none'; label.textContent = '—'; return; }
        label.style.display = '';
        const d = new Date(f.time * 1000);
        const pad = n => String(n).padStart(2, '0');
        const hhmm = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
        const tag = f.forecast ? (state.lang === 'fr' ? 'prév.' : 'fcst') : '';
        label.textContent = `${hhmm} Z${tag ? ' ' + tag : ''}`;
    }

    // ---- Contrôles DOM ----

    /**
     * Rend la barre de contrôles dans le conteneur fourni.
     * @param {HTMLElement} el Conteneur (ex. .map-layers-bar).
     */
    function mountControls(el) {
        controlsEl = el;
        const isFr = state.lang === 'fr';

        el.innerHTML = `
            <div class="precip-control-group">
                <button class="precip-toggle precip-toggle-radar" data-layer="radar" aria-pressed="false" title="${isFr ? 'Couches radar' : 'Radar layers'}">
                    <i data-lucide="cloud-rain" style="width:14px;height:14px;"></i>
                    <span>${isFr ? 'Radar' : 'Radar'}</span>
                </button>
                <button class="precip-play-btn" aria-label="${isFr ? 'Lecture' : 'Play'}" title="${isFr ? 'Animation précipitations' : 'Precipitation animation'}">
                    <i data-lucide="play" style="width:14px;height:14px;"></i>
                </button>
            </div>
            <div class="precip-slider-group">
                <input type="range" name="precip-frame" aria-label="Horloge animation radar" class="precip-slider" min="0" max="${Math.max(0, radarFrames.length - 1)}" value="${frameIdx}" step="1" aria-label="${isFr ? 'Horloge animation' : 'Animation clock'}">
                <span class="precip-time-label">—</span>
            </div>
        `;

        if (window.lucide) window.lucide.createIcons({ root: el });

        // Bouton radar.
        const radarBtn = el.querySelector('.precip-toggle-radar');
        radarBtn?.addEventListener('click', async () => {
            radarVisible = !radarVisible;
            radarBtn.classList.toggle('active', radarVisible);
            radarBtn.setAttribute('aria-pressed', String(radarVisible));
            if (radarVisible) {
                await _ensureInit();
                _showRadarFrame();
                _syncSliderMax();
            } else {
                _pause();
                _removeRadarLayer();
            }
        });

        // Bouton play/pause.
        el.querySelector('.precip-play-btn')?.addEventListener('click', async () => {
            await _ensureInit();
            if (playing) _pause(); else _play();
        });

        // Slider temporel.
        const slider = el.querySelector('.precip-slider');
        slider?.addEventListener('input', () => {
            _pause();
            _setFrame(parseInt(slider.value, 10));
        });
    }

    function _syncSliderMax() {
        if (!controlsEl) return;
        const slider = controlsEl.querySelector('.precip-slider');
        if (slider) slider.max = String(Math.max(0, radarFrames.length - 1));
        _syncSlider();
        _updateFrameLabel();
    }

    // ---- API publique du contrôleur ----

    return {
        mountControls,
        async toggleRadar(on) {
            radarVisible = on;
            if (on) {
                await _ensureInit();
                _syncSliderMax();
                _showRadarFrame();
            } else {
                _pause();
                _removeRadarLayer();
            }
        },
        /** Pré-charge le manifeste (non bloquant, appelé au chargement du panneau). */
        preload() { return _ensureInit().then(_syncSliderMax); },
        /** Détruit le contrôleur : stoppe l'animation et retire les couches. */
        destroy() {
            _pause();
            _removeRadarLayer();
            controlsEl = null;
        },
    };
}
