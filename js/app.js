/* ================================================================
 * APP — Orchestrateur principal (Zéro Dépendance Circulaire)
 * ================================================================ */

import { state, memoSet, memoGet, escapeHtml, I18N, fetchOpenMeteo } from './core.js';
import { fetchAvecRelais } from './core.js';
import { analyserMETAR, analyserTAF, publishActiveRunway } from './engine.js';
import { displayWeatherAlerts } from './weather.js';
import { tzGet, tzPut } from './db.js';
import {
    sanitizeStorage, initAirportsDB, updateFavoritesUI, renderSearchHistory,
    initAutocomplete, handleInput, handleScroll, toggleLanguage, setLanguage,
    lireMETAR, stopAudio, updateFinalUI, _hideDashboard, addToHistory, toggleFavorite,
    updateHighlights, getAirportByICAO, _selectAndFetch, enrichAirport,
    getStartupFavorite
} from './ui-module.js';
import { initNightMode, toggleNightMode } from './night-mode.js';
import { showFlightWindow, hideFlightWindow } from './flight-window.js';
import { initFlightMode, setFlightMode, getFlightMode } from './flight-mode.js';
import { renderGoNoGo, refreshPressureTrend, refreshSigmet, refreshFreezingLevel } from './go-nogo.js';
import { toggleRegionalMap, showRegionalMapFor } from './regional-map.js';
import { showAlternates } from './alternates.js';
import { preloadDeclination } from './magvar.js';
import { showTakeoffWidget } from './takeoff-ui.js';
import { refreshWbWidget } from './wb-ui.js';
import { showFrequenciesWidget } from './frequencies-ui.js';
import { showFlightPlanner, parseWaypointsField, formatWaypointsField } from './flight-planner-ui.js';
import { clearElevationChart, refreshElevationChart } from './elevation-chart.js';
import { greatCircleDistanceNm, cheapestWaypointInsertion } from './flight-planner.js';
import { initCockpitMode, toggleCockpitMode } from './cockpit-mode.js';
import { openShareModal, hasPermalink, readPermalink } from './permalink.js';
import { initWatchdog, openWatchdogPanel, getWatchdogSettings } from './watchdog.js';
import { fetchAirportByIcao } from './openaip.js';
import { initPlanIo } from './flight-plan-io.js';
import { loadFreqSources, getSiaAirac } from './freq-sia.js';
import { config, applyLocalOverride } from './config.js';
import { loadSiaAux } from './sia-data.js';

// Données auxiliaires officielles SIA (pistes, déclinaison, élévation) :
// chargement non-bloquant au boot — les getters servent null tant qu'il
// n'est pas fini, les consommateurs replient sur openAIP.
loadSiaAux();

const lastFetchTime = {};

// Toggle Départ/Destination (mode Navigation).
let _depIcao = null;       // mémorise le code de départ pendant la consultation destination.
let _viewingDest = false;  // true quand on consulte la destination (pas le départ).

// Départ réel de la navigation (même pendant la consultation de la météo
// destination via le toggle Départ/Destination).
function _navDepRef() {
    return (_viewingDest ? _depIcao : state.requestedIcao) || state.requestedIcao;
}

// Applique un changement de destination : nom du terrain, route sur la carte
// régionale, plan de navigation et profil d'élévation.
let _lastPlannedDest = null;   // destination du plan courant (reset waypoints si changement)

export function handleDestinationChange() {
    const toInput = document.getElementById('route-to-input');
    if (!toInput) return;
    const toIcao = toInput.value.trim().toUpperCase();

    // Nom du terrain destination : confirmation visuelle du code saisi.
    const toNameEl = document.getElementById('route-to-name');
    if (toNameEl) {
        const apt = /^[A-Z][A-Z0-9]{3}$/.test(toIcao) ? getAirportByICAO(toIcao) : null;
        toNameEl.textContent = apt
            ? apt.name
            : (/^[A-Z][A-Z0-9]{3}$/.test(toIcao) ? (state.lang === 'fr' ? '(terrain inconnu)' : '(unknown airfield)') : '');
    }

    const depForNav = _navDepRef();
    // Destination valide : 4 lettres, ≠ départ, connue de la base locale.
    const destApt = /^[A-Z][A-Z0-9]{3}$/.test(toIcao) ? getAirportByICAO(toIcao) : null;
    const validDest = !!(destApt && depForNav && toIcao !== depForNav.toUpperCase());

    // NOUVELLE destination : le plan repart à zéro — les waypoints saisis pour
    // la route précédente n'ont pas de sens vers une autre arrivée (les repères
    // libres restent posés sur la carte, réutilisables via leur popup « + Plan »).
    if (validDest && toIcao !== _lastPlannedDest) {
        const wpInput = document.getElementById('fp-waypoints');
        if (wpInput && wpInput.value.trim()) wpInput.value = '';
        state.route = null;
        _lastPlannedDest = toIcao;
    } else if (validDest) {
        _lastPlannedDest = toIcao;
    }

    // Si le panneau carte est ouvert, on rafraîchit la route.
    const panel = document.getElementById('regional-map-panel');
    if (panel && panel.classList.contains('open') && depForNav) {
        showRegionalMapFor(depForNav, true);
    }
    // Flight planner + profil d'élévation.
    if (getFlightMode() === 'nav' && depForNav) {
        if (validDest) {
            showFlightPlanner(depForNav, toIcao);
        } else {
            const fpPanel = document.getElementById('flight-planner-panel');
            if (fpPanel) fpPanel.style.display = 'none';
            clearElevationChart('elevation-profile-container');
        }
    }
}

// Coordonnées d'un terrain (base locale enrichie + mémo), ou null.
function _icaoCoords(code) {
    if (!code || !/^[A-Z][A-Z0-9]{3}$/.test(code)) return null;
    const apt = getAirportByICAO(code);
    const memo = memoGet(code);
    const lat = memo?.lat ?? apt?.lat ?? null;
    const lon = memo?.lon ?? apt?.lon ?? null;
    return (lat != null && lon != null) ? { lat, lon } : null;
}

// Distance orthodromique entre le départ courant et un terrain (NM, ou null).
function _destDistNm(apt) {
    const dep = _icaoCoords(_navDepRef());
    if (!dep || apt.lat == null) return null;
    return greatCircleDistanceNm(dep.lat, dep.lon, apt.lat, apt.lon);
}

// Item d'autocomplétion du champ Destination : code, nom, distance depuis le départ.
function _formatDestItem(apt) {
    const nm = _destDistNm(apt);
    const distHtml = nm != null
        ? `<span class="autocomplete-dist">${Math.round(nm)} NM</span>`
        : '';
    return `<span class="autocomplete-topline"><span class="autocomplete-icao">${escapeHtml(apt.icao)}</span>${distHtml}</span>` +
           `<span class="autocomplete-name">${escapeHtml(apt.name)}</span>`;
}

// Trie les correspondances : code OACI en préfixe d'abord, puis par distance
// depuis le départ (les terrains les plus proches apparaissent en tête).
function _sortDestMatches(matches, valUpper) {
    const startsWithCode = a => a.icao && a.icao.toUpperCase().startsWith(valUpper);
    const dist = a => _destDistNm(a) ?? 1e9;
    return [...matches]
        .sort((a, b) => (startsWithCode(b) ? 1 : 0) - (startsWithCode(a) ? 1 : 0) || dist(a) - dist(b))
        .slice(0, 8);
}


export function genererGraphique() {
    const raw = document.getElementById('tafInput').value;
    
    const currentRenderState = `${raw}|${state.lang}|${state.manualTargetHour}|${state.forcedRunway || ''}`;
    if (state.lastRenderState === currentRenderState) return;
    state.lastRenderState = currentRenderState;

    if (!raw.trim() || raw.includes('Recherche') || raw.includes('Aucun message') || raw.includes('Erreur') || raw.includes('Error')) {
        _hideDashboard();
        displayWeatherAlerts(null);
        renderGoNoGo(); // masque la bannière (state.lastParsed est null ou invalide)
        showTakeoffWidget(null); // masque le widget décollage
        refreshWbWidget(null); // masque le widget centrage
        showFrequenciesWidget(null); // masque le widget fréquences
        const fpPanel = document.getElementById('flight-planner-panel');
        if (fpPanel) fpPanel.style.display = 'none'; // masque le flight planner
        return;
    }

    const cacheKey = `${raw}|${state.lang}`;
    if (cacheKey !== state.lastCacheKey) {
        state.lastCacheKey = cacheKey;
        const isMetarLike = raw.toUpperCase().startsWith('METAR') || raw.toUpperCase().startsWith('SPECI') || !raw.match(/\d{4}\/\d{4}/);
        state.lastParsed = isMetarLike ? analyserMETAR(raw) : analyserTAF(raw);
    }

    const res = state.lastParsed;
    if (!res) {
        displayWeatherAlerts(null);
        return;
    }

    // Quand l'utilisateur colle un message manuellement (pas de recherche par
    // bouton), on suit le code OACI du message collé : cela synchronise la carte
    // régionale, le créneau de vol et les autres widgets avec le terrain affiché.
    // La recherche par bouton initialise requestedIcao dans traiterSucces.
    // state.requestedIcao est déjà positionné par traiterSucces lors d'une
    // recherche par bouton. On ne l'écrase avec res.code que lors d'un collage
    // manuel (pas de recherche → requestedIcao peut être null ou obsolète).
    // On évite aussi d'écraser quand res.code est un substitut (ex: LFRD au
    // lieu de LFRT demandé) : traiterSucces a déjà mis le bon code.
    if (res.code && /^[A-Z][A-Z0-9]{3}$/.test(res.code) && !state.requestedIcao) {
        state.requestedIcao = res.code;
    }

    state.isMetar = res.isMetar;
    // Ces opérations ne dépendent pas de l'heure d'arrivée (manualTargetHour) :
    // on les saute pendant le drag pour ne pas alourdir chaque frame.
    if (!state.isDragging) {
        _chercherNomAeroport(res.code, res.validity);

        // Affiche le créneau de vol jour pour le terrain collé (comme le chemin
        // bouton). showFlightWindow se cache seul si lat/lon est indisponible.
        showFlightWindow(state.requestedIcao);
        // Met à jour la carte régionale UNIQUEMENT si on n'est pas en train de
        // consulter la destination (sinon le trajet reste départ→destination).
        if (!_viewingDest) {
            showRegionalMapFor(state.requestedIcao);
        }

        const memo = memoGet(res.code);
        if (memo && memo !== 'PENDING' && memo.lat != null && memo.lon != null) {
            // Le fuseau horaire d'un aéroport ne change jamais : on le persiste
            // en localStorage (clé 'airport-tz') pour ne pas le re-demander à
            // Open-Meteo à chaque visite. En revanche, la température et le QNH
            // « temps réel » évoluent : on les redemande à CHAQUE visite via le
            // même endpoint Open-Meteo (current=temperature_2m,pressure_msl).
            const cachedTz = tzGet(res.code);
            if (cachedTz && typeof memo.tzOffset !== 'number') {
                memo.tzOffset = cachedTz.tzOffset;
                state.lastRenderState = null; genererGraphique();
            }
            // Toujours rafraîchir la température/QNH temps réel. On ne persiste
            // que le tzOffset (immuable) ; les valeurs current sont jetables.
            memo.tzOffset = memo.tzOffset === undefined ? 'FETCHING' : memo.tzOffset;
            // Open-Meteo autorise le CORS direct : fetch sans proxy Google (cache 5 min,
            // file d'attente et retry 429 intégrés dans fetchOpenMeteo). Ne pas passer
            // par fetchAvecRelais ici — chaque appel inutile charge le relai Apps Script.
            fetchOpenMeteo(`https://api.open-meteo.com/v1/forecast?latitude=${memo.lat}&longitude=${memo.lon}&current=temperature_2m,pressure_msl&timezone=auto`)
                .then(d => {
                    if (d && d.utc_offset_seconds !== undefined) {
                        // ATTENTION : ce bloc vit DANS genererGraphique. Le cache 5 min
                        // de fetchOpenMeteo résout instantanément — si le .then relance
                        // systématiquement le rendu, la page boucle à l'infini en
                        // microtask et gèle l'onglet. On ne re-rend QUE si une valeur
                        // affichée (tz / T° / QNH) a réellement changé.
                        const prev = `${memo.tzOffset}|${memo.temperature}|${memo.qnh}`;
                        memo.tzOffset = d.utc_offset_seconds / 3600;
                        memo.temperature = d.current ? d.current.temperature_2m : null;
                        memo.qnh = d.current ? d.current.pressure_msl : null;
                        tzPut(res.code, { name: memo.name, lat: memo.lat, lon: memo.lon, tzOffset: memo.tzOffset });
                        const next = `${memo.tzOffset}|${memo.temperature}|${memo.qnh}`;
                        if (prev !== next) { state.lastRenderState = null; genererGraphique(); }
                    } else if (memo.tzOffset === 'FETCHING') {
                        memo.tzOffset = -(new Date().getTimezoneOffset() / 60);
                    }
                }).catch(() => { if (memo.tzOffset === 'FETCHING') memo.tzOffset = -(new Date().getTimezoneOffset() / 60); });
        }
    }

    updateFinalUI(res, raw, state.forcedRunway);

    // Rendu de la bannière GO/NO-GO et du widget décollage (s'adaptent au
    // message affiché, qu'il soit départ ou destination).
    renderGoNoGo();
    showTakeoffWidget(state.requestedIcao || res.code);
    refreshWbWidget(state.requestedIcao || res.code);

    // Met à jour le label du bouton lecture audio selon le type de message.
    const readBtn = document.getElementById('btn-read-metar');
    if (readBtn) {
        const isFr = state.lang === 'fr';
        const label = state.isMetar
            ? (isFr ? 'Lire METAR' : 'Read METAR')
            : (isFr ? 'Lire TAF' : 'Read TAF');
        readBtn.innerHTML = `<i data-lucide='volume-2' class='icon-sm'></i> ${label}`;
        if (window.lucide) window.lucide.createIcons({ root: readBtn });
    }
}

/**
 * Enrichit les données du terrain courant via OpenAIP, en arrière-plan.
 * Non-bloquant : si l'API échoue, l'app continue avec la base locale.
 * Une fois les données fusionnées, l'UI est rafraîchie pour refléter
 * les infos plus fraîches (pistes précises, déclinaison, radio).
 */
async function _enrichFromOpenAIP(icao) {
    if (!icao) return;
    const enriched = await fetchAirportByIcao(icao);
    if (!enriched) return;

    // Fusionne dans l'index en mémoire (getAirportByICAO retournera la version enrichie).
    enrichAirport(icao, enriched);

    // Injecte la déclinaison magnétique OpenAIP dans le cache magvar.
    if (typeof enriched.magneticDeclination === 'number') {
        try {
            const { state: _s } = await import('./core.js');
            // Écrit directement dans le cache localStorage de magvar.
            const LS_KEY = 'magvar-cache';
            const cache = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
            cache[icao.toUpperCase()] = enriched.magneticDeclination;
            localStorage.setItem(LS_KEY, JSON.stringify(cache));
        } catch { /* quota */ }
    }

    // Rafraîchit l'UI pour refléter les données enrichies.
    // Les fréquences radio sont désormais disponibles → on les affiche.
    showFrequenciesWidget(icao);
    state.lastRenderState = null;
    genererGraphique();
}

function _chercherNomAeroport(icao, validityStr) {
    if (!icao) return; 
    
    const warningDiv = document.getElementById('lbl-warning');
    if (warningDiv) {
        // state.warningMessage intègre des codes/noms issus de l'API NOAA → on échappe avant innerHTML.
        warningDiv.innerHTML = state.warningMessage
            ? `<span style="color:var(--danger);font-size:0.9em;background:rgba(239, 68, 68, 0.1);padding:3px 8px;border-radius:4px;display:inline-block;margin-top:6px;border:1px solid rgba(239, 68, 68, 0.3);"><i data-lucide="alert-triangle" class="icon-sm"></i> ${escapeHtml(state.warningMessage)}</span>`
            : '';
        if (window.lucide) window.lucide.createIcons();
    }

    const memo = memoGet(icao); 
    if (memo && memo !== 'PENDING') return;
    if (memo === 'PENDING') return; 

    // Notre base locale airports.json contient déjà le nom + coordonnées de 17 000+
    // aéroports. On l'utilise en priorité pour éviter un appel réseau (proxy Google)
    // systématique à chaque rendu. L'API NOAA n'est consultée qu'en fallback pour
    // les codes absents de la base locale.
    const localApt = getAirportByICAO(icao);
    if (localApt && localApt.lat != null && localApt.lon != null) {
        memoSet(icao, { name: localApt.name, lat: localApt.lat, lon: localApt.lon });
        state.lastRenderState = null; genererGraphique();
        return;
    }

    // Fallback API : code absent de la base locale.
    memoSet(icao, 'PENDING');
    fetchAvecRelais(`https://aviationweather.gov/api/data/stationinfo?ids=${icao}&format=json`, 'json', 3600)
        .then(data => {
            if (data && data.length > 0) {
                // On capture l'élévation (elev en mètres → convertie en pieds)
                // pour le calcul de densité altitude (module density-altitude).
                const elevM = data[0].elev;
                const elevFt = (typeof elevM === 'number') ? Math.round(elevM * 3.28084) : undefined;
                memoSet(icao, { name: data[0].site || data[0].name || icao, lat: data[0].lat, lon: data[0].lon, elevation: elevFt });
            } else {
                memoSet(icao, { name: icao, lat: null, lon: null });
            }
            state.lastRenderState = null; genererGraphique();
        }).catch(() => {
            memoSet(icao, { name: icao, lat: null, lon: null });
            state.lastRenderState = null; genererGraphique();
        });
}

export function telechargerMessage(typeMessage) {
    const inputVal = document.getElementById('icaoInput').value.trim(); 
    if (!inputVal) return;
    
    const icao = inputVal.toUpperCase();
    const throttleKey = `${icao}_${typeMessage}`;
    const now = Date.now();
    if (lastFetchTime[throttleKey] && (now - lastFetchTime[throttleKey] < 2000)) return; 
    lastFetchTime[throttleKey] = now;

    const tr = I18N[state.lang];
    const textarea = document.getElementById('tafInput');
    const activeBtn = typeMessage === 'metar' ? document.getElementById('btn-fetch-metar') : document.getElementById('btn-fetch-taf');

    state.forcedRunway = null;
    state.manualTargetHour = null;
    state.requestedIcao = icao;
    
    textarea.value = tr.searchInProgress;
    if(activeBtn) activeBtn.classList.add('btn-loading');
    
    document.getElementById('lbl-info').innerHTML = '';
    const canvas = document.getElementById('tafCanvas');
    if(canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    
    _hideDashboard();
    clearInterval(state.horlogeInterval);
    displayWeatherAlerts(null);
    hideFlightWindow();
    updateHighlights();

    function nettoyerUI() {
        if(activeBtn) activeBtn.classList.remove('btn-loading');
        if (textarea.value === tr.searchInProgress) textarea.value = '';
        updateHighlights();
    }

    function traiterSucces(codeOaciFinal, texteMeteo, codeDemandeInitial, stationActuelle) {
        // On mémorise le terrain demandé pour que les pistes affichées soient
        // celles du terrain d'atterrissage réel (LFEA), même si la météo vient
        // du terrain le plus proche (LFRH).
        state.requestedIcao = codeDemandeInitial || codeOaciFinal;

        // On conserve le code demandé (LFEA) dans le champ de recherche quand la
        // météo vient d'un autre terrain (LFRH). Sinon, on affiche le code trouvé.
        const estSubstitut = codeDemandeInitial && codeOaciFinal !== codeDemandeInitial.toUpperCase();
        document.getElementById('icaoInput').value = estSubstitut ? codeDemandeInitial : codeOaciFinal;
        addToHistory(codeOaciFinal);
        renderSearchHistory('search-history-list', _selectAndFetch);

        // Mémorise le dernier terrain consulté pour le restaurer au prochain ouverture.
        try { localStorage.setItem('last-icao', codeOaciFinal); } catch { /* quota */ }
        
        if (estSubstitut) {
            state.warningMessage = tr.warnClosest.replace('{type}', typeMessage.toUpperCase()).replace('{req}', codeDemandeInitial).replace('{found}', codeOaciFinal);
        } else {
            state.warningMessage = ''; 
        }

        if (stationActuelle && stationActuelle.lat !== undefined) {
            const localApt = getAirportByICAO(codeOaciFinal);
            const apiName = stationActuelle.name || stationActuelle.site;
            const finalName = (apiName && apiName !== codeOaciFinal) ? apiName : (localApt ? localApt.name : codeOaciFinal);
            // Capture l'élévation (en mètres) pour le calcul de densité altitude.
            const memoData = { name: finalName, lat: stationActuelle.lat, lon: stationActuelle.lon };
            if (typeof stationActuelle.elev === 'number') memoData.elevation = Math.round(stationActuelle.elev * 3.28084);
            memoSet(codeOaciFinal, memoData);
        }
        
        state.lastCacheKey = null;
        state.lastRenderState = null;
        textarea.value = texteMeteo.trim();
        nettoyerUI();
        // Affiche la bannière du créneau de vol jour pour le terrain demandé
        // (ex: LFEA), même si la météo vient d'un terrain voisin (LFRH).
        showFlightWindow(state.requestedIcao || codeOaciFinal);
        // Récupère la tendance QNH en arrière-plan (alimente le GO/NO-GO).
        refreshPressureTrend(state.requestedIcao);
        // Récupère les SIGMET/AIRMET de la zone (alimente le GO/NO-GO).
        const sigApt = getAirportByICAO(state.requestedIcao);
        const sigMemo = memoGet(state.requestedIcao);
        const sigLat = sigMemo?.lat ?? sigApt?.lat ?? null;
        const sigLon = sigMemo?.lon ?? sigApt?.lon ?? null;
        refreshSigmet(sigLat, sigLon, state.requestedIcao);
        // Récupère le niveau de gel / isotherme 0°C (alimente le GO/NO-GO).
        refreshFreezingLevel(state.requestedIcao);
        // Précharge la déclinaison magnétique (alimente rose des vents + GO/NO-GO).
        preloadDeclination(state.requestedIcao);
        // Enrichit les données du terrain via OpenAIP (arrière-plan, non-bloquant).
        // Les détails plus frais (pistes, radio, déclinaison) sont fusionnés puis
        // l'UI est rafraîchie. On utilise state.requestedIcao (LFRT) et non le
        // substitut (LFRD) pour enrichir le BON terrain.
        _enrichFromOpenAIP(state.requestedIcao);
        // Affiche le widget de performance décollage (densité-altitude vs piste).
        showTakeoffWidget(state.requestedIcao);
        refreshWbWidget(state.requestedIcao);
        // Affiche les fréquences radio du terrain (alimenté par OpenAIP).
        showFrequenciesWidget(state.requestedIcao);
        // Quand on consulte la destination via le toggle, on ne touche PAS à la
        // carte régionale ni au route planner : le trajet reste départ→destination.
        if (!_viewingDest) {
            showRegionalMapFor(codeOaciFinal);
            const routeFromDisplay = document.getElementById('route-from-display');
            if (routeFromDisplay) routeFromDisplay.textContent = codeOaciFinal;
        }
        // Le comparateur d'alternates et le calcul de navigation utilisent le
        // DÉPART (_depIcao si on consulte la destination, sinon codeOaciFinal).
        const depForNav = _viewingDest ? _depIcao : codeOaciFinal;
        if (depForNav && getFlightMode() === 'nav') {
            showAlternates(depForNav);
            // Flight planner : visible si une destination est saisie.
            const toIcao = (document.getElementById('route-to-input')?.value || '').trim().toUpperCase();
            if (toIcao && /^[A-Z][A-Z0-9]{3}$/.test(toIcao) && toIcao !== depForNav.toUpperCase()) {
                showFlightPlanner(depForNav, toIcao);
                // Tout chemin qui calcule un plan mémorise sa destination :
                // le reset des waypoints ne jouera que sur un VRAI changement.
                _lastPlannedDest = toIcao;
            } else {
                clearElevationChart('elevation-profile-container');
            }
        } else if (!_viewingDest) {
            const altC = document.getElementById('alternates-container');
            if (altC) altC.style.display = 'none';
            const fpPanel = document.getElementById('flight-planner-panel');
            if (fpPanel) fpPanel.style.display = 'none';
            clearElevationChart('elevation-profile-container');
        }
        genererGraphique();
    }

    function chercherParallel(listeCodes, codeDemandeInitial) {
        // On récupère jusqu'aux 30 aéroports les plus proches pour être sûr d'en trouver un !
        const topN = listeCodes.slice(0, 30); 
        if (topN.length === 0) {
            textarea.value = tr.errNoMsgNear.replace('{type}', typeMessage.toUpperCase()).replace('{req}', codeDemandeInitial);
            nettoyerUI(); state.lastRenderState=null; genererGraphique(); return;
        }
        
        // Nouvelle technique : On demande les 30 TAFs en une seule requête JSON à l'API américaine
        const idsStr = topN.map(st => st.code).join(',');
        const url = `https://aviationweather.gov/api/data/${typeMessage.toLowerCase()}?ids=${idsStr}&format=json`;
        
        fetchAvecRelais(url, 'json')
            .then(data => {
                if (!Array.isArray(data) || data.length === 0) throw new Error('No data');
                
                let gagnant = null;
                let gagnantTexte = null;
                
                // On boucle sur notre liste (triée par distance) pour trouver le premier qui a un TAF valide
                for (const st of topN) {
                    const found = data.find(m => m.icaoId === st.code || m.stationId === st.code);
                    if (found) {
                        const txt = found.rawTaf || found.rawTAF || found.rawOb || found.rawMetar || found.rawText || found.raw;
                        // On rejette les TAF annulés ou vides ("NIL")
                        if (txt && txt.trim().length > 15 && !/\bNIL\b/i.test(txt)) {
                            gagnant = st;
                            gagnantTexte = txt;
                            break;
                        }
                    }
                }
                
                if (gagnant) traiterSucces(gagnant.code, gagnantTexte, codeDemandeInitial, gagnant);
                else {
                    textarea.value = tr.errNoMsgNear.replace('{type}', typeMessage.toUpperCase()).replace('{req}', codeDemandeInitial);
                    nettoyerUI(); state.lastRenderState=null; genererGraphique();
                }
            })
            .catch((err) => {
                // Affiche le message précis du relais si disponible (timeout, 504…),
                // sinon le message réseau générique.
                const detail = (err && err.message && !err.message.includes('fetch'))
                    ? err.message
                    : tr.errNetwork;
                textarea.value = `${detail} (${codeDemandeInitial})`;
                nettoyerUI();
            });
    }

    function lancerRechercheZone(lat, lon, targetIcao, targetName) {
        // Correction de la boite de recherche (minLat, minLon, maxLat, maxLon)
        const minLat = lat - 1.5;
        const minLon = lon - 1.5;
        const maxLat = lat + 1.5;
        const maxLon = lon + 1.5;
        
        const noaaUrl = `https://aviationweather.gov/api/data/stationinfo?bbox=${minLat},${minLon},${maxLat},${maxLon}&format=json`;
        
        fetchAvecRelais(noaaUrl, 'json', 3600)
            .then(stations => {
                if (!Array.isArray(stations)) stations = [];
                let aerosTries = stations
                    .map(st => {
                        const code = st.icaoId || st.id;
                        if (!code || !/^[A-Z][A-Z0-9]{3}$/.test(code)) return null;
                        return { code, name: st.site || st.name || code, lat: st.lat, lon: st.lon, dist: Math.pow(st.lat - lat, 2) + Math.pow(st.lon - lon, 2) };
                    })
                    .filter(Boolean)
                    .sort((a, b) => a.dist - b.dist);
                    
                if (targetIcao) {
                    aerosTries = aerosTries.filter(a => a.code !== targetIcao);
                    aerosTries.unshift({ code: targetIcao, name: targetName || targetIcao, lat, lon, dist: 0 });
                }
                
                if (aerosTries.length > 0) chercherParallel(aerosTries, targetIcao || targetName || aerosTries[0].code);
                else if (targetIcao) chercherParallel([{ code: targetIcao, lat, lon }], targetIcao);
                else { textarea.value = tr.errZone; nettoyerUI(); }
            })
            .catch(() => {
                if (targetIcao) chercherParallel([{ code: targetIcao, lat, lon }], targetIcao);
                else { textarea.value = tr.errDb; nettoyerUI(); }
            });
    }

    if (icao.length === 4 && /^[A-Z][A-Z0-9]{3}$/.test(icao)) {
        fetchAvecRelais(`https://aviationweather.gov/api/data/stationinfo?ids=${icao}&format=json`, 'json', 3600)
            .then(data => {
                if (data && data.length > 0) lancerRechercheZone(data[0].lat, data[0].lon, icao, data[0].site || data[0].name);
                else {
                    // L'API ne connaît pas cet aérodrome (souvent les petits terrains) :
                    // on retombe sur notre base locale airports.json pour récupérer ses
                    // coordonnées et lancer quand même la recherche de zone (aéroport le plus
                    // proche ayant un message).
                    const localApt = getAirportByICAO(icao);
                    if (localApt && localApt.lat != null && localApt.lon != null) {
                        lancerRechercheZone(localApt.lat, localApt.lon, icao, localApt.name);
                    } else {
                        chercherParallel([{ code: icao }], icao);
                    }
                }
            })
            .catch(() => {
                // En cas d'erreur réseau sur stationinfo, on tente aussi la base locale
                // avant d'abandonner avec un simple chercherParallel.
                const localApt = getAirportByICAO(icao);
                if (localApt && localApt.lat != null && localApt.lon != null) {
                    lancerRechercheZone(localApt.lat, localApt.lon, icao, localApt.name);
                } else {
                    chercherParallel([{ code: icao }], icao);
                }
            });
        return;
    }

    fetchAvecRelais(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(inputVal)}&format=json&limit=1`, 'json')
        .then(data => {
            if (!data || data.length === 0) throw new Error('Lieu introuvable sur la carte.');
            lancerRechercheZone(parseFloat(data[0].lat), parseFloat(data[0].lon), null, inputVal);
        })
	    .catch(err => {
	            textarea.value = I18N[state.lang].lblErrorPrefix + err.message;
            state.warningMessage = '';
            state.lastRenderState = null;
            genererGraphique();
            nettoyerUI();
        });
}

document.addEventListener('DOMContentLoaded', async function () {
    // Surcharge locale (config.local.js, gitignorée) : relais privé + clé
    // openAIP. Absente sur le miroir public GitHub Pages → défauts.
    await applyLocalOverride();
    // Mode nuit rouge : restauré AVANT tout le reste pour éviter un flash de
    // lumière blanche destructrice pour la vision nocturne déjà adaptée.
    initNightMode();

    // Mode de vol (Local / Navigation) : applique la classe sur <body>.
    initFlightMode();

    // Mode cockpit (Briefing express).
    initCockpitMode();

    // Surveillance des favoris (watchdog) — démarre si activé.
    initWatchdog();

    // Enregistrement du Service Worker (PWA — shell hors-ligne uniquement,
    // les données météo ne sont jamais mises en cache : sécurité pilote).
    // L'enregistrement est lancé tôt mais ne bloque pas l'init : un échec
    // (navigateur incompatible, mode privé) est ignoré silencieusement.
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    sanitizeStorage(); await initAirportsDB();
    // Paternité de l'Information SIA réutilisée (pied de page) : cycle AIRAC
    // en vigueur, lu dans le fichier régénéré à chaque cycle — jamais saisi à la main.
    loadFreqSources().then(() => {
        const airac = getSiaAirac();
        const el = document.getElementById('sia-airac');
        if (el) el.textContent = airac ? ` · cycle AIRAC ${airac}` : '';
    }).catch(() => {});
    state.refreshCallback = genererGraphique; setLanguage('fr');

    // Effet d'ondulation (ripple) au clic sur les boutons principaux.
    document.querySelectorAll('.btn-fetch-metar, .btn-fetch-taf, .btn-primary, .btn-secondary').forEach(btn => {
        btn.addEventListener('click', function(e) {
            const circle = document.createElement('span');
            const diameter = Math.max(this.clientWidth, this.clientHeight);
            const rect = this.getBoundingClientRect();
            circle.style.width = circle.style.height = diameter + 'px';
            circle.style.left = (e.clientX - rect.left - diameter / 2) + 'px';
            circle.style.top = (e.clientY - rect.top - diameter / 2) + 'px';
            circle.className = 'ripple';
            this.appendChild(circle);
            setTimeout(() => circle.remove(), 600);
        });
    });

    document.getElementById('tafInput').addEventListener('input', handleInput);
    document.getElementById('tafInput').addEventListener('scroll', handleScroll);
    document.getElementById('btn-lang-toggle').addEventListener('click', toggleLanguage);
    // Changement de langue : re-rend les panneaux dont les titres/contenus
    // dépendent de la langue (widgets repliables, alternates, planificateur,
    // profil d'élévation) pour le terrain courant.
    window.addEventListener('lang-changed', () => {
        const icao = state.requestedIcao;
        if (icao) {
            showTakeoffWidget(icao);
            refreshWbWidget(icao);
            showFrequenciesWidget(icao);
            if (getFlightMode() === 'nav') {
                const depForNav = _viewingDest ? _depIcao : icao;
                if (depForNav) {
                    showAlternates(depForNav);
                    const toIcao = (document.getElementById('route-to-input')?.value || '').trim().toUpperCase();
                    if (toIcao && /^[A-Z][A-Z0-9]{3}$/.test(toIcao) && toIcao !== depForNav.toUpperCase()) {
                        showFlightPlanner(depForNav, toIcao);
                    }
                }
            }
            refreshElevationChart();
        }
    });
    // Nouveau plan de vol calculé : le widget centrage recharge sa
    // consommation (lecture seule, trajet du plan) — sans ça, il gardait
    // la valeur de son dernier rendu.
    window.addEventListener('navplan-changed', () => {
        const icao = state.requestedIcao;
        if (icao) refreshWbWidget(icao);
    });
    document.getElementById('btn-night-mode').addEventListener('click', toggleNightMode);
    document.getElementById('btn-cockpit-mode')?.addEventListener('click', toggleCockpitMode);
    document.getElementById('btn-share')?.addEventListener('click', openShareModal);
    document.getElementById('btn-watchdog')?.addEventListener('click', () => {
        openWatchdogPanel();
        // Reflète l'état actif sur le bouton.
        const btn = document.getElementById('btn-watchdog');
        const s = getWatchdogSettings();
        btn.classList.toggle('active', s.enabled);
    });
    // Reflète l'état watchdog sur le bouton au démarrage.
    const wdBtn = document.getElementById('btn-watchdog');
    if (wdBtn) wdBtn.classList.toggle('active', getWatchdogSettings().enabled);
    document.getElementById('btn-fetch-metar').addEventListener('click', () => telechargerMessage('metar'));
    document.getElementById('btn-fetch-taf').addEventListener('click', () => telechargerMessage('taf'));
    
    document.getElementById('icaoInput').addEventListener('keyup', function (e) { if (e.key === 'Enter') telechargerMessage('metar'); });
    
    document.getElementById('btn-add-favorite').addEventListener('click', () => {
        const icao = document.getElementById('icaoInput').value.trim().toUpperCase();
        if (icao.length === 4) { toggleFavorite(icao); updateFavoritesUI(_selectAndFetch); }
    });
    document.getElementById('btn-read-metar').addEventListener('click', () => lireMETAR(document.getElementById('tafInput').value));
    document.getElementById('btn-stop-audio').addEventListener('click', stopAudio);

    // Toggle Départ/Destination (mode Navigation uniquement).
    // Bascule le contenu de #icaoInput entre le terrain courant et la destination.
    document.querySelectorAll('.dep-dest-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const side = btn.dataset.side;
            const input = document.getElementById('icaoInput');
            const toInput = document.getElementById('route-to-input');
            if (side === 'dep') {
                // Retour au départ : restaure le code mémorisé.
                if (_depIcao) {
                    input.value = _depIcao;
                    _depIcao = null;
                    _viewingDest = false;
                    telechargerMessage('metar');
                }
            } else {
                // Va à la destination : mémorise le départ actuel.
                const destIcao = (toInput?.value || '').trim().toUpperCase();
                if (destIcao && /^[A-Z][A-Z0-9]{3}$/.test(destIcao)) {
                    _depIcao = input.value.trim().toUpperCase();
                    _viewingDest = true;
                    input.value = destIcao;
                    telechargerMessage('taf');
                }
            }
            // Met à jour le state actif.
            document.querySelectorAll('.dep-dest-btn').forEach(b => b.classList.toggle('active', b === btn));
        });
    });

    // Carte régionale : toggle du panneau repliable.
    const mapToggle = document.getElementById('regional-map-toggle');
    if (mapToggle) mapToggle.addEventListener('click', () => {
        toggleRegionalMap();
    });

    // Alternates : toggle du panneau repliable (même mécanisme que la carte).
    const altToggle = document.getElementById('alternates-toggle');
    if (altToggle) {
        altToggle.addEventListener('click', () => {
            document.getElementById('alternates-container')?.classList.toggle('open');
        });
    }

    // Météo de route : mise à jour quand la destination change (frappe clavier).
    const routeToInput = document.getElementById('route-to-input');
    if (routeToInput) {
        routeToInput.addEventListener('input', () => {
            routeToInput.value = routeToInput.value.toUpperCase();
            handleDestinationChange();
        });
    }

    // « Retirer du plan » : popup d'un waypoint de route sur la carte
    // (route-weather.js émet l'événement) — même logique que la croix du plan.
    document.addEventListener('remove-waypoint', (e) => {
        const icao = e.detail?.icao;
        if (!icao) return;
        const wpInput = document.getElementById('fp-waypoints');
        if (!wpInput) return;
        const wps = parseWaypointsField(wpInput.value).filter(w => w !== icao);
        wpInput.value = formatWaypointsField(wps);
        wpInput.dispatchEvent(new Event('change'));
    });

    // Autocomplétion du champ Destination : code OACI ou nom de terrain,
    // résultats priorisés par distance depuis le départ.
    initAutocomplete('route-to-input', (icao) => {
        const toInput = document.getElementById('route-to-input');
        if (toInput) toInput.value = icao.toUpperCase();
        handleDestinationChange();
    }, {
        formatItem: _formatDestItem,
        filterList: _sortDestMatches,
        requireIcao: true,   // la destination doit être un code OACI exploitable
        preferLocal: true,   // base locale (codes + distances) prime sur le live
    });

    // « Définir comme destination » : bouton du popup d'un aérodrome voisin
    // sur la carte régionale (regional-map.js émet l'événement).
    document.addEventListener('set-destination', (e) => {
        const icao = e.detail?.icao;
        if (!icao) return;
        const toInput = document.getElementById('route-to-input');
        if (toInput) {
            toInput.value = icao;
            // PAS de focus ici : il ferait sauter la fenêtre de la carte vers
            // la barre de destination alors que le pilote regarde la carte.
            handleDestinationChange();
        }
    });

    // « + Waypoint » : ajoute le terrain au champ Waypoints du planificateur
    // à la position qui rend le trajet total le plus court (insertion la moins
    // coûteuse — l'ordre des étapes déjà saisies est préservé), puis relance
    // le calcul via son événement 'change'.
    document.addEventListener('add-waypoint', (e) => {
        const icao = e.detail?.icao;
        if (!icao) return;
        const wpInput = document.getElementById('fp-waypoints');
        if (!wpInput) return;   // pas de plan affiché : rien à ajouter
        const wps = parseWaypointsField(wpInput.value);
        if (wps.includes(icao)) return;   // déjà dans la liste : rien à faire
        const toIcao = (document.getElementById('route-to-input')?.value || '').trim().toUpperCase();
        const idx = cheapestWaypointInsertion(_navDepRef(), wps, toIcao, icao, _icaoCoords);
        const at = (idx == null) ? wps.length : idx;   // coords manquantes → en fin
        const next = [...wps.slice(0, at), icao, ...wps.slice(at)];
        wpInput.value = formatWaypointsField(next);
        wpInput.dispatchEvent(new Event('change'));
    });

    initPlanIo();
    initAutocomplete('icaoInput', (icao) => { document.getElementById('icaoInput').value = icao; telechargerMessage('metar'); });
    renderSearchHistory('search-history-list', _selectAndFetch);
    updateFavoritesUI(_selectAndFetch);

    // Sidebars repliables sur mobile : clic sur le titre pour déplier/replier.
    document.querySelectorAll('.side-column h3').forEach(h3 => {
        h3.addEventListener('click', () => {
            if (window.innerWidth <= 800) {
                h3.closest('.side-column').classList.toggle('expanded');
            }
        });
    });

    // Efface la route sur la carte quand on passe en mode Local.
    document.addEventListener('clear-route', () => {
        if (state.requestedIcao) showRegionalMapFor(state.requestedIcao, true);
    });

    document.addEventListener('click', (e) => {
        const bubble = e.target.closest('.rwy-bubble');
        if (bubble) {
            state.forcedRunway = bubble.dataset.rwyId;
            // Publie la nouvelle piste active IMMÉDIATEMENT : le widget
            // décollage (rendu synchrone juste après) doit voir le changement
            // dès ce clic, sans attendre le rAF de la rose.
            publishActiveRunway(getAirportByICAO(state.requestedIcao || state.lastParsed?.code));
            state.lastRenderState = null;
            genererGraphique();
        }
    });

    const canvas = document.getElementById('tafCanvas');
    let tooltip = document.getElementById('drag-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'drag-tooltip';
        tooltip.className = 'canvas-tooltip';
        document.body.appendChild(tooltip);
    }

    // Coalesce les redraws du canvas pendant le drag : un seul genererGraphique par frame,
    // au lieu d'un par évènement mousemove/touchmove (qui déclenchaient un redraw complet).
    let dragRafId = null;
    function scheduleDragRender() {
        if (dragRafId) return;
        dragRafId = requestAnimationFrame(() => {
            dragRafId = null;
            state.lastRenderState = null;
            genererGraphique();
        });
    }
    function cancelDragRender() {
        if (dragRafId) { cancelAnimationFrame(dragRafId); dragRafId = null; }
    }

    function getHourFromMouse(e) {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches && e.touches.length > 0 ? e.touches[0].clientX : e.clientX;
        const mouseX = clientX - rect.left;
        const m = state.graphMetrics;
        if (!m) return null;
        let clampedX = Math.max(m.startX, Math.min(mouseX, m.endX));
        return m.startH + (clampedX - m.startX) / m.pxPerH;
    }

    function handleDrag(e) {
        if (!state.lastParsed || state.lastParsed.isMetar) return;
        
        const rawHour = getHourFromMouse(e);
        if (rawHour === null) return;

        state.manualTargetHour = Math.round(rawHour * 4) / 4;
        state.isDragging = true;
        
        let zuluH = Math.floor(state.manualTargetHour) % 24; 
        if (zuluH < 0) zuluH += 24;
        let zuluM = Math.round((state.manualTargetHour - Math.floor(state.manualTargetHour)) * 60); 
        if (zuluM === 60) { zuluM = 0; zuluH = (zuluH + 1) % 24; }
        
	    const timeStr = String(zuluH).padStart(2, '0') + 'h' + String(zuluM).padStart(2, '0') + 'Z';
	        tooltip.innerHTML = `${I18N[state.lang].lblPlannedArrival} ${timeStr}`;
        
        const clientX = e.touches && e.touches.length > 0 ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches && e.touches.length > 0 ? e.touches[0].clientY : e.clientY;
        // Clamp la position du tooltip dans le viewport pour éviter qu'il sorte
        // de l'écran sur mobile (le transform translate(-50%,-120%) le place au-dessus).
        const ttRect = tooltip.getBoundingClientRect();
        const margin = 10;
        const clampedX = Math.max(ttRect.width / 2 + margin, Math.min(clientX, window.innerWidth - ttRect.width / 2 - margin));
        const clampedY = Math.max(ttRect.height + margin, clientY);
        tooltip.style.left = clampedX + 'px';
        tooltip.style.top = clampedY + 'px';

        // Redraw coalescé : un seul genererGraphique par frame (raf) pendant le drag.
        scheduleDragRender();
    }

    canvas.addEventListener('mousedown', (e) => { 
        state.isDragging = true;
        tooltip.style.opacity = '1';
        handleDrag(e); 
    });
    
    canvas.addEventListener('mousemove', (e) => {
        if (!state.lastParsed || state.lastParsed.isMetar) { canvas.style.cursor = 'default'; return; }
        const m = state.graphMetrics;
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        if (m && mouseX >= m.startX - 10 && mouseX <= m.endX + 10) canvas.style.cursor = 'ew-resize';
        else canvas.style.cursor = 'default';
        if (state.isDragging) handleDrag(e);
    });
    
    window.addEventListener('mouseup', () => {
        if (state.isDragging) {
            state.isDragging = false;
            tooltip.style.opacity = '0';
            // Fin de drag : on annule tout redraw coalescé en attente, puis rendu final synchrone
            // pour figer la dernière valeur (sinon une frame intermédiaire pourrait la remplacer).
            cancelDragRender();
            state.lastRenderState = null; genererGraphique();
        }
    });

    canvas.addEventListener('touchstart', (e) => { 
        state.isDragging = true;
        tooltip.style.opacity = '1';
        handleDrag(e); 
    }, {passive: true});
    
    canvas.addEventListener('touchmove', (e) => { 
        if (state.isDragging) { handleDrag(e); e.preventDefault(); }
    }, {passive: false});
    
    window.addEventListener('touchend', () => {
        if(state.isDragging) {
            state.isDragging = false;
            tooltip.style.opacity = '0';
            // Fin de drag : rendu final synchrone (cf. mouseup).
            cancelDragRender();
            state.lastRenderState = null; genererGraphique();
        }
    });

    canvas.addEventListener('dblclick', () => {
        state.manualTargetHour = null;
        state.isDragging = false;
        tooltip.style.opacity = '0';
        cancelDragRender();
        state.lastRenderState = null; genererGraphique();
    });

    let resizeDebounce = null;
    const resizeObserver = new ResizeObserver(() => {
        if (resizeDebounce) clearTimeout(resizeDebounce);
        resizeDebounce = setTimeout(() => { state.lastRenderState = null; genererGraphique(); }, 60);
    });
    resizeObserver.observe(document.getElementById('graphScroll'));

    // ---- Permalien : si l'URL contient ?icao=..., on charge le terrain ----
    if (hasPermalink()) {
        const link = readPermalink();
        if (link.icao && /^[A-Z][A-Z0-9]{3}$/.test(link.icao)) {
            const input = document.getElementById('icaoInput');
            if (input) input.value = link.icao;
            // Applique le mode si spécifié.
            if (link.mode === 'nav') setFlightMode('nav');
            // Destination transportée par le lien : pré-remplie AVANT le
            // chargement — le plan se créera dès le METAR du départ arrivé.
            const destVal = (/^[A-Z][A-Z0-9]{3}$/.test(link.dest || '') && link.dest !== link.icao.toUpperCase())
                ? link.dest : null;
            if (destVal) {
                const toInput = document.getElementById('route-to-input');
                if (toInput) toInput.value = destVal;
                const apt = getAirportByICAO(destVal);
                const toNameEl = document.getElementById('route-to-name');
                if (toNameEl) toNameEl.textContent = apt?.name || (state.lang === 'fr' ? '(terrain inconnu)' : '(unknown airfield)');
            }
            // Charge METAR ou TAF selon le paramètre.
            setTimeout(() => telechargerMessage(link.taf ? 'taf' : 'metar'), 300);
            // Waypoints du lien : injectés dès que le champ du planner existe,
            // puis recalcul multi-tronçons (réessai prudent jusqu'à rendu).
            if (destVal && link.wp && /^([A-Z][A-Z0-9]{3})(\s+[A-Z][A-Z0-9]{3})*$/.test(link.wp)) {
                const wps = link.wp;
                const inject = (tries) => {
                    const wpInput = document.getElementById('fp-waypoints');
                    if (wpInput && !wpInput.value.trim()) {
                        wpInput.value = wps;
                        wpInput.dispatchEvent(new Event('change'));
                    } else if (tries > 0) {
                        setTimeout(() => inject(tries - 1), 900);
                    }
                };
                setTimeout(() => inject(12), 2500);
            }
        }
    } else {
        // ---- Pas de permalien : priorité au favori de démarrage, sinon dernier terrain ----
        const startupIcao = getStartupFavorite();
        const lastIcao = (() => { try { return localStorage.getItem('last-icao'); } catch { return null; } })();
        const icaoToLoad = (startupIcao && /^[A-Z][A-Z0-9]{3}$/.test(startupIcao))
            ? startupIcao
            : (lastIcao && /^[A-Z][A-Z0-9]{3}$/.test(lastIcao) ? lastIcao : null);
        if (icaoToLoad) {
            const input = document.getElementById('icaoInput');
            if (input) input.value = icaoToLoad;
            setTimeout(() => telechargerMessage('metar'), 300);
        }
    }
});