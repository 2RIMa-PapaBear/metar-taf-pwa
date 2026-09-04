import { config } from './config.js';

export const UNIFIED_RED = "#BF360C";
export const PALETTE = ["#1976D2", "#F57C00", "#00ACC1", "#5D4037", "#3949AB", "#455A64"];
export const REGEX_BLOCKS_PATTERN = /(PROB\d{2}\s+TEMPO|PROB\d{2}|TEMPO|BECMG|NOSIG|FM\d{4,6}Z?|TL\d{4}Z?|AT\d{4}Z?)/g;

// Source de vérité unique pour les couleurs de catégorie de vol.
// DOIT rester synchronisée avec les variables CSS --cat-* dans css/style.css :root.
export const CAT_COLORS = {
    VFR:  '#4ADE80',
    MVFR: '#38BDF8',
    IFR:  '#F87171',
    LIFR: '#D946EF',
    NONE: '#94A3B8',
};
// Variante rgba (pour fonds translucides de badges/cartes). alpha = opacité 0..1.
export function catColorRgba(cat, alpha = 0.2) {
    const hex = CAT_COLORS[cat] || CAT_COLORS.NONE;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const I18N = {
    fr: {
        placeholderIcao: "code oaci ou ville...",
        placeholderTaf: "collez un message taf/metar ici...",
        lblArrival: "Heure d'arrivée prévue (UTC):",
        lblSource: "Source des données :",
        lblAeroHours: "<i data-lucide='sun' class='icon-sm'></i> <i data-lucide='moon' class='icon-sm'></i> Heures Aéronautiques (Lever -30min / Coucher +30min)",
        errNoTaf: "Impossible de lire le message météo.",
        errNoData: "Aucune donnée récente trouvée pour",
        errNetwork: "Erreur de connexion. Vérifiez votre réseau.",
        errInvalidIcao: "Veuillez entrer un code aéroport valide à 4 lettres.",
        errInvalidHpp: "Format d'heure invalide. Utilisez HH:MM.",
        searchInProgress: "Recherche en cours...",
        localTimeFormat: " (Il est actuellement {time} à {name} : {temp}°C, QNH {qnh} hPa [estimation Open-Meteo])",
        footerWarning: "Avertissement : Cet outil est fourni à titre indicatif. Ne pas utiliser pour la préparation des vols.",
        legClr: "Clair", legFew: "Peu", legSct: "Épars",
        legBkn: "Fragmenté", legOvc: "Couvert", legVv: "Invisible",

        lblCloud: "Plafond",
        lblWeather: "Météo",
        lblVisi: "Visibilité",
        lblWind: "Vent moyen\n(KT)",
        lblSun: "Soleil",
        lblTemp: "T° / Rosée",
        lblQnh: "QNH",
        lblTafTemp: "Temp°",

        txtMax: "Max", txtMin: "Mini", prefixLight: "Faible ", prefixHeavy: "Forte ",
        validFrom: "du", validTo: "au", validAt: "à", validH: "h00",
        lblAirport: "Aéroport :", lblSearching: "(Recherche du nom...)", lblObservation: "Observation :",
        aeroDay: "Jour aéro", aeroNight: "Nuit aéro", toggleLangTitle: "Passer en Anglais",
        btnAddFavorite: "<i data-lucide='star' class='icon-sm'></i> Ajouter aux favoris",
        btnReadMetar: "<i data-lucide='volume-2' class='icon-sm'></i> Lire METAR",
        btnStopAudio: "<i data-lucide='square' class='icon-sm'></i> Stop",
        nightModeTitle: "Basculer thème clair/sombre",
        favorisTitle: "<i data-lucide='star' class='icon-sm'></i> Favoris",
        favorisEmpty: "Aucun favori. Ajoutez un aéroport avec le bouton ci-dessous.",
        warnClosest: "Attention : Aucun message {type} disponible pour {req}. Affichage du plus proche ({found}).",
        errNoMsgNear: "Aucun message {type} trouvé près de {req}.",
        errDb: "Erreur : Impossible de contacter la base de données des aéroports.",
        errZone: "Erreur : Aucun aéroport compatible trouvé dans la zone.",
        minimaTitle: "<i data-lucide='settings' class='icon-sm'></i> Réglages des Minimums VFR",
        lblCeiling: "Plafond (ft)",
        lblVisi: "Visibilité (m)",
        lblWindThreshold: "Vent (kt)",
        lblGusts: "Rafales (kt)",
        lblTemperature: "Température (°C)",
        lblQnhThreshold: "QNH (hPa)",
        lblWarning: "Préavis (Orange)",
        lblDanger: "Danger (Rouge)",
        lblHigh: "Haut",
        lblLow: "Bas",
        btnSave: "Enregistrer les seuils",
        btnReset: "Valeurs par défaut",
        noAlerts: "<i data-lucide='check-circle' class='icon-sm'></i> Conditions VFR OK",
        lblPlannedArrival: "Heure d'arrivée prévue :",
        lblCeilingUnlimited: "Illimité",
        lblErrorPrefix: "Erreur : ",
        lblGraphTz: "Heures du graphique : UTC (Zulu)",
        lblMetarFrom: "METAR de",
        lblTafFrom: "TAF de",
        alertCeilingWarn: "Plafond bas",
        alertCeilingDang: "Plafond critique",
        alertVisiWarn: "Visibilité réduite",
        alertVisiDang: "Visibilité critique",
        alertWindWarn: "Vent fort",
        alertWindDang: "Vent très fort",
        alertGustWarn: "Rafales fortes",
        alertGustDang: "Rafales critiques",
        alertsTitle: "ALERTES MINIMA VFR",
        configThresholds: "Configurer",
        noRecentSearch: "Aucune recherche récente.",
        clearHistory: "Vider l'historique",
        alertThunderstorm: "Orage",
        alertCumulonimbus: "Cumulonimbus",
        alertToweringCu: "Towering Cumulus",
        alertHail: "Grêle",
        alertIcing: "Givrage",
        dicoMeteo: {
            "RA":"Pluie","SN":"Neige","DZ":"Bruine","GR":"Grêle","GS":"Grésil",
            "SG":"Neige en grains","IC":"Cristaux de glace","PL":"Granules de glace",
            "SH":"Averse","TS":"Orage","FZ":"Se congelant","BC":"Bancs",
            "BL":"Chasse-haute","DR":"Chasse-basse","MI":"Mince","PR":"Partiel",
            "FG":"Brouillard","BR":"Brume","HZ":"Brume sèche","FU":"Fumée",
            "VA":"Cendres","DU":"Poussière","SA":"Sable",
            "NSW":"Fin Phéno","VV///":"Ciel invisible"
        },

        // --- Widgets données décryptées (js/widgets.js) ---
        lblWidgetWind: "Vent",
        lblWidgetVisi: "Visibilité",
        lblWidgetCeiling: "Plafond",
        lblWidgetTemp: "Température",
        lblTempShort: "Temp",
        lblDewShort: "Rosée",
        lblWidgetSpread: "Écart",
        lblWidgetQnh: "Pression (QNH)",
        lblWidgetGust: "Rafales",
        lblWidgetVariable: "Variable",
        lblWidgetCalm: "Calme",
        lblWidgetUnlimited: "Illimité",
        lblWidgetIcing: "Givrage",
        lblIcingOk: "Aucun risque",
        lblIcingCaution: "Risque modéré",
        lblIcingDanger: "Risque élevé",
        lblWidgetIcingCell: "Givrage cellule",
        lblWidgetIcingCarb: "Givrage carbu",
        lblCarbSerious: "Sévère — toutes puissances",
        lblCarbDescent: "Sévère en descente",
        lblCarbLight: "Léger — surveiller",
        lblCarbNone: "Faible ou nul",
        tipIcingCell: "Givrage de la cellule (structure) : isotherme 0°C vs plafond nuageux + analyse T / point de rosée (zone critique −2 à +2 °C en air humide). Ne concerne pas le carburateur.",
        tipCarbChart: "Abaque givrage carburateur : T {t} °C / Td {td} °C (écart {s} °C)",
        tipCarbTemp: "T° carburateur estimée : {min} à {max} °C (OAT −20 à −35 °C par vaporisation). Givrage si T° carbu entre −15 et 0 °C (risque max vers −5 °C) en air humide.",
        lblModelCompare: "Modèles",
        lblModelCompareAt3h: "à H+3",

        mapLayerRadar: "Radar",
        mapLayerAirspaces: "Espaces",
        mapRadarPlay: "Lecture",
        mapRadarPause: "Pause",
        mapRadarAnimationClock: "Horloge animation",
        mapRadarLayers: "Couches radar",
        mapAirspacesTitle: "Espaces aériens (CTR, TMA, classes...)",
        mapPrecipAnimation: "Animation précipitations",

        freqsAndAirfieldInfo: "Fréquences & info terrain",

        cockpitModeTitle: "Briefing express (vue cockpit)",
        shareTitle: "Partager ce briefing",

        watchdogTitle: "Surveillance des favoris",

        // --- Interface statique (index.html → setLanguage) ---
        uiTitle: "Visualiseur METAR/TAF",
        noticeBtn: "Notice",
        noticeBtnTitle: "Ouvrir la notice complète",
        flightModeTitle: "Basculer entre vol local et navigation",
        flightModeLocal: "Local",
        flightModeNav: "Navigation",
        searchRecentTitle: "Recherches récentes",
        historyTitle: "<i data-lucide='history' class='icon-sm'></i> Historique récent",
        alternatesTitle: "Alternates viables — terrains de déroutement",
        regionalMapTitle: "Carte régionale — radar & terrains voisins",
        routeFrom: "Départ",
        routeTo: "Destination",
        routeToPlaceholder: "ex : LFPO ou Poitiers",
        mapNoMetar: "Sans METAR",
        mapCurrentApt: "Terrain courant",
        depBtn: "Départ",
        destBtn: "Destination",
        langToggleAria: "Basculer entre français et anglais",
        fetchMetarAria: "Télécharger METAR",
        fetchTafAria: "Télécharger TAF",
        nightModeAria: "Basculer thème clair/sombre",
        cockpitModeAria: "Briefing express",
        shareAria: "Partager",
        watchdogAria: "Surveillance favoris"
    },
    en: {
        placeholderIcao: "icao code or city...",
        placeholderTaf: "paste a taf/metar message here...",
        lblArrival: "Planned arrival time (UTC):",
        lblSource: "Weather data source:",
        lblAeroHours: "<i data-lucide='sun' class='icon-sm'></i> <i data-lucide='moon' class='icon-sm'></i> Aeronautical Hours (Sunrise -30m / Sunset +30m)",
        errNoTaf: "Unable to parse weather message.", errNoData: "No recent data found for",
        errNetwork: "Connection error. Please check your network.", errInvalidIcao: "Please enter a valid 4-letter code.",
        errInvalidHpp: "Invalid time format. Use HH:MM.", searchInProgress: "Searching...",
        localTimeFormat: " (Currently at {time} in {name}: {temp}°C, QNH {qnh} hPa [Open-Meteo estimate])",
        footerWarning: "Warning: Informational purposes only. Do not use for flight preparation.",
        legClr: "Clear", legFew: "Few", legSct: "Scattered", legBkn: "Broken", legOvc: "Overcast", legVv: "Invisible",

        lblCloud: "Ceiling",
        lblWeather: "Weather",
        lblVisi: "Visibility",
        lblWind: "Avg Wind\n(KT)",
        lblSun: "Sun",
        lblTemp: "Temp/Dew",
        lblQnh: "QNH",
        lblTafTemp: "Temp°",

        txtMax: "Max", txtMin: "Min", prefixLight: "Light ", prefixHeavy: "Heavy ",
        validFrom: "from", validTo: "to", validAt: "at", validH: ":00",
        lblAirport: "Airport:", lblSearching: "(Searching name...)", lblObservation: "Observation:",
        aeroDay: "Aero Day", aeroNight: "Aero Night", toggleLangTitle: "Switch to French",
        btnAddFavorite: "<i data-lucide='star' class='icon-sm'></i> Add to favorites",
        btnReadMetar: "<i data-lucide='volume-2' class='icon-sm'></i> Read METAR",
        btnStopAudio: "<i data-lucide='square' class='icon-sm'></i> Stop",
        nightModeTitle: "Toggle light/dark theme",
        favorisTitle: "<i data-lucide='star' class='icon-sm'></i> Favorites",
        favorisEmpty: "No favorites. Add an airport below.",
        warnClosest: "Warning: No {type} message available for {req}. Displaying the closest one ({found}).",
        errNoMsgNear: "No {type} message found near {req}.",
        errDb: "Error: Unable to contact the airport database.",
        errZone: "Error: No compatible airport found in this area.",
        minimaTitle: "<i data-lucide='settings' class='icon-sm'></i> VFR Minima Settings",
        lblCeiling: "Ceiling (ft)",
        lblVisi: "Visibility (m)",
        lblWindThreshold: "Wind (kt)",
        lblGusts: "Gusts (kt)",
        lblTemperature: "Temperature (°C)",
        lblQnhThreshold: "QNH (hPa)",
        lblWarning: "Warning (Orange)",
        lblDanger: "Danger (Red)",
        lblHigh: "High",
        lblLow: "Low",
        btnSave: "Save thresholds",
        btnReset: "Reset to default",
        noAlerts: "<i data-lucide='check-circle' class='icon-sm'></i> VFR Conditions OK",
        lblPlannedArrival: "Planned arrival time:",
        lblCeilingUnlimited: "Unlimited",
        lblErrorPrefix: "Error: ",
        lblGraphTz: "Graph times : UTC (Zulu)",
        lblMetarFrom: "METAR from",
        lblTafFrom: "TAF from",
        alertCeilingWarn: "Low ceiling",
        alertCeilingDang: "Critical ceiling",
        alertVisiWarn: "Reduced visibility",
        alertVisiDang: "Critical visibility",
        alertWindWarn: "Strong wind",
        alertWindDang: "Critical wind",
        alertGustWarn: "Strong gusts",
        alertGustDang: "Critical gusts",
        alertsTitle: "VFR MINIMA ALERTS",
        configThresholds: "Configure",
        noRecentSearch: "No recent searches.",
        clearHistory: "Clear History",
        alertThunderstorm: "Thunderstorm",
        alertCumulonimbus: "Cumulonimbus",
        alertToweringCu: "Towering Cumulus",
        alertHail: "Hail",
        alertIcing: "Icing",
        dicoMeteo: {
            "RA":"Rain","SN":"Snow","DZ":"Drizzle","GR":"Hail","GS":"Small Hail",
            "SG":"Snow Grains","IC":"Ice Crystals","PL":"Ice Pellets",
            "SH":"Showers","TS":"Thunderstorm","FZ":"Freezing","BC":"Patches",
            "BL":"Blowing","DR":"Low Drifting","MI":"Shallow","PR":"Partial",
            "FG":"Fog","BR":"Mist","HZ":"Haze","FU":"Smoke",
            "VA":"Volcanic Ash","DU":"Dust","SA":"Sand",
            "NSW":"No Sig Weather","VV///":"Invisible Sky"
        },

        // --- Decoded data widgets (js/widgets.js) ---
        lblWidgetWind: "Wind",
        lblWidgetVisi: "Visibility",
        lblWidgetCeiling: "Ceiling",
        lblWidgetTemp: "Temperature",
        lblTempShort: "Temp",
        lblDewShort: "Dew",
        lblWidgetSpread: "Spread",
        lblWidgetQnh: "Pressure (QNH)",
        lblWidgetGust: "Gusts",
        lblWidgetVariable: "Variable",
        lblWidgetCalm: "Calm",
        lblWidgetUnlimited: "Unlimited",
        lblWidgetIcing: "Icing",
        lblIcingOk: "No risk",
        lblIcingCaution: "Moderate risk",
        lblIcingDanger: "High risk",
        lblWidgetIcingCell: "Airframe icing",
        lblWidgetIcingCarb: "Carb icing",
        lblCarbSerious: "Serious — any power",
        lblCarbDescent: "Serious at descent",
        lblCarbLight: "Light — monitor",
        lblCarbNone: "Little or none",
        tipIcingCell: "Airframe (structural) icing: 0°C isotherm vs cloud ceiling + temperature / dew point analysis (critical band −2 to +2 °C in humid air). Not carburettor icing.",
        tipCarbChart: "Carburettor icing chart: OAT {t} °C / dew {td} °C (spread {s} °C)",
        tipCarbTemp: "Estimated carburettor temp: {min} to {max} °C (OAT −20 to −35 °C from vaporization). Icing when carb temp is between −15 and 0 °C (peak risk near −5 °C) in humid air.",
        lblModelCompare: "Models",
        lblModelCompareAt3h: "at H+3",

        mapLayerRadar: "Radar",
        mapLayerAirspaces: "Airspaces",
        mapRadarPlay: "Play",
        mapRadarPause: "Pause",
        mapRadarAnimationClock: "Animation clock",
        mapRadarLayers: "Radar layers",
        mapAirspacesTitle: "Airspaces (CTR, TMA, classes...)",
        mapPrecipAnimation: "Precipitation animation",

        freqsAndAirfieldInfo: "Frequencies & airfield info",

        cockpitModeTitle: "Briefing express (cockpit view)",
        shareTitle: "Share this briefing",

        watchdogTitle: "Favorites watchdog",

        // --- Interface statique (index.html → setLanguage) ---
        uiTitle: "METAR/TAF Viewer",
        noticeBtn: "Manual",
        noticeBtnTitle: "Open the full manual",
        flightModeTitle: "Switch between local flight and navigation",
        flightModeLocal: "Local",
        flightModeNav: "Nav",
        searchRecentTitle: "Recent searches",
        historyTitle: "<i data-lucide='history' class='icon-sm'></i> Recent history",
        alternatesTitle: "Viable alternates — diversion fields",
        regionalMapTitle: "Regional map — radar & nearby airfields",
        routeFrom: "From",
        routeTo: "To",
        routeToPlaceholder: "e.g. LFPO or Poitiers",
        mapNoMetar: "No METAR",
        mapCurrentApt: "Current airfield",
        depBtn: "Departure",
        destBtn: "Destination",
        langToggleAria: "Switch between French and English",
        fetchMetarAria: "Download METAR",
        fetchTafAria: "Download TAF",
        nightModeAria: "Toggle light/dark theme",
        cockpitModeAria: "Express briefing",
        shareAria: "Share",
        watchdogAria: "Favorites watchdog"
    }
};

export const MEMO_MAX = 50;

const _state = {

    lang: 'fr',

    isMetar: false,
    warningMessage: '',
    lastCacheKey: null,
    lastParsed: null,
    lastRenderState: null,

    requestedIcao: null,

    route: null,  // tableau d'OACO pour le multi-waypoints (null = route A→B simple)

    manualTargetHour: null,
    forcedRunway: null,
    // Piste active calculée par la ROSE DES VENTS (choix auto selon le vent
    // de la vue courante, ou paire forcée au clic sur une bulle). Source de
    // vérité unique pour les widgets qui affichent la piste en service.
    activeRunwayName: null,
    isDragging: false,
    graphMetrics: null,
    sunLineHitboxes: [],

    _sunCache: {},
    _sunCacheOrder: [],
    _memo: {},
    _memoOrder: [],

    rafId: null,
    horlogeInterval: null,
    debounceTimer: null,

    refreshCallback: null,

    baseInfoString: '',
};

export const state = new Proxy(_state, {
    get(target, prop) {
        return target[prop];
    },
    set(target, prop, value) {
        const old = target[prop];
        target[prop] = value;
        return true;
    },
});

Object.defineProperty(_state, 'sunCache', {
    get() { return _state._sunCache; },
    set(v) { _state._sunCache = v; },
    enumerable: true,
});
Object.defineProperty(_state, 'sunCacheOrder', {
    get() { return _state._sunCacheOrder; },
    set(v) { _state._sunCacheOrder = v; },
    enumerable: true,
});
Object.defineProperty(_state, 'memo', {
    get() { return _state._memo; },
    set(v) { _state._memo = v; },
    enumerable: true,
});
Object.defineProperty(_state, 'memoOrder', {
    get() { return _state._memoOrder; },
    set(v) { _state._memoOrder = v; },
    enumerable: true,
});

export function sunCacheSet(key, val) {
    if (!state.sunCache[key]) {
        state.sunCacheOrder.push(key);
        if (state.sunCacheOrder.length > MEMO_MAX) delete state.sunCache[state.sunCacheOrder.shift()];
    }
    state.sunCache[key] = val;
}
export function sunCacheGet(key) { return state.sunCache[key]; }

export function memoSet(icao, val) {
    if (!state.memo[icao]) {
        state.memoOrder.push(icao);
        if (state.memoOrder.length > MEMO_MAX) delete state.memo[state.memoOrder.shift()];
    }
    state.memo[icao] = val;
}
export function memoGet(icao) { return state.memo[icao]; }

export function parseVisiToMeters(visiStr) {
    if (!visiStr) return 10000;
    if (visiStr.includes('9999') || visiStr.includes('CAVOK')) return 10000;
    const smMatch = visiStr.match(/([PM]?)(\d+)?\s?(?:(\d+)\/(\d+))?SM/);
    if (smMatch) {
        const whole = parseInt(smMatch[2]) || 0;
        const num   = parseInt(smMatch[3]) || 0;
        const den   = parseInt(smMatch[4]) || 1;
        return Math.round((whole + num / den) * 1609.34);
    }
    const mMatch = visiStr.match(/(\d{4})/);
    return mMatch ? parseInt(mMatch[1], 10) : 10000;
}

export function findActiveValueAtHour(blocks, targetHour) {
    if (!blocks || !blocks.length) return null;
    for (let i = blocks.length - 1; i >= 0; i--) {
        const b = blocks[i];
        if (targetHour >= b.start && targetHour < b.end && b.val) return b.val;
    }
    return null;
}

export function getCeiling(nuageStr) {
    if (!nuageStr || nuageStr.includes('CAVOK') || nuageStr.includes('NSC') || nuageStr.includes('SKC') || nuageStr.includes('NCD')) return 999;
    if (nuageStr.includes('VV///')) return 0;

    let lowest = 999;
    const regexRaw = /(BKN|OVC|VV)(\d{3})(?!ft)/g;
    let match;
    while ((match = regexRaw.exec(nuageStr)) !== null) {
        const alt = parseInt(match[2], 10);
        if (alt < lowest) lowest = alt;
    }

    const regexParsed = /(BKN|OVC|VV)\s+(\d+)ft/g;
    while ((match = regexParsed.exec(nuageStr)) !== null) {
        const alt = parseInt(match[2], 10) / 100;
        if (alt < lowest) lowest = alt;
    }

    return lowest;
}

export function getFlightCategory(visiM, ceilHundFt) {
    if (ceilHundFt < 5  || visiM < 1600) return { cat: 'LIFR', class: 'cat-lifr' };
    if (ceilHundFt < 10 || visiM < 4800) return { cat: 'IFR',  class: 'cat-ifr'  };
    if (ceilHundFt <= 30 || visiM <= 8000) return { cat: 'MVFR', class: 'cat-mvfr' };
    return { cat: 'VFR', class: 'cat-vfr' };
}

export function getWeatherIcon(nuageStr, tempsStr) {
    if (tempsStr) {
        const t = tempsStr.toLowerCase();
        if (t.includes('orage') || t.includes('thunderstorm') || t.includes('ts')) return 'cloud-lightning';
        if (t.includes('neige') || t.includes('snow') || t.includes('grésil') || t.includes('hail') || t.includes('gr')) return 'cloud-snow';
        if (t.includes('pluie') || t.includes('rain') || t.includes('averse') || t.includes('showers') || t.includes('bruine') || t.includes('drizzle') || t.includes('dz')) return 'cloud-rain';
        if (t.includes('brouillard') || t.includes('fog') || t.includes('brume') || t.includes('mist') || t.includes('fg')) return 'cloud-fog';
    }
    if (nuageStr) {
        if (nuageStr.includes('VV')) return 'cloud-fog';
        if (nuageStr.includes('OVC')) return 'cloud';
        if (nuageStr.includes('BKN')) return 'cloudy';
        if (nuageStr.includes('SCT')) return 'cloud-sun';
        if (nuageStr.includes('FEW')) return 'sun';
    }
    return 'sun';
}

export function inferStartYear(day, month) {
    const now = new Date();
    let year = now.getFullYear();
    const tafDate = new Date(year, month - 1, day);
    const today   = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if ((tafDate - today) / (1000 * 60 * 60 * 24) > 2) year--;
    return year;
}

export function traduireCode(codeBrut) {
    if (!codeBrut) return '';
    const tr = I18N[state.lang];
    const dico = tr.dicoMeteo;
    return codeBrut.split(' ').map(token => {
        if (!token) return '';
        if (dico[token]) return dico[token];
        let prefixe = '', reste = token;
        if (reste.startsWith('-')) { prefixe = tr.prefixLight; reste = reste.substring(1); }
        else if (reste.startsWith('+')) { prefixe = tr.prefixHeavy; reste = reste.substring(1); }
        const parts = [];
        for (let i = 0; i < reste.length; i += 2) {
            const chunk = reste.substring(i, i + 2);
            parts.push(dico[chunk] || chunk);
        }
        return prefixe + parts.join(' ');
    }).filter(Boolean).join(' ');
}

const _escapeEl = typeof document !== 'undefined' ? document.createElement('div') : null;
export function escapeHtml(text) {
    if (!_escapeEl) return text;
    _escapeEl.textContent = text;
    return _escapeEl.innerHTML;
}

export const SURFACE_LABELS = {
    ASP: { fr: 'Asphalte', en: 'Asphalt' },
    BIT: { fr: 'Bitume traité', en: 'Bituminous' },
    BRI: { fr: 'Briques', en: 'Brick' },
    CLA: { fr: 'Argile', en: 'Clay' },
    COM: { fr: 'Composite', en: 'Composite' },
    CON: { fr: 'Béton', en: 'Concrete' },
    COP: { fr: 'Composite dur', en: 'Composite' },
    COR: { fr: 'Corail', en: 'Coral' },
    GRE: { fr: 'Terre tassée', en: 'Graded dirt' },
    GRS: { fr: 'Herbe', en: 'Grass' },
    GVL: { fr: 'Gravier', en: 'Gravel' },
    ICE: { fr: 'Glace', en: 'Ice' },
    LAT: { fr: 'Latérite', en: 'Laterite' },
    MAC: { fr: 'Macadam', en: 'Macadam' },
    MEM: { fr: 'Membrane', en: 'Membrane' },
    MIX: { fr: 'Mixte traité', en: 'Treated mix' },
    PEM: { fr: 'Part-béton', en: 'Part-concrete' },
    PER: { fr: 'Permanent', en: 'Permanent' },
    PSP: { fr: 'Tôles', en: 'Steel planking' },
    SAN: { fr: 'Sable', en: 'Sand' },
    SNO: { fr: 'Neige', en: 'Snow' },
    U:   { fr: 'Inconnu', en: 'Unknown' },
    WAT: { fr: 'Eau (hydravion)', en: 'Water' },
};

export const SOFT_SURFACES = new Set(['GRE', 'GRS', 'GVL', 'CLA', 'SAN', 'LAT']);

export function surfaceLabel(code, lang) {
    const l = lang || (state.lang) || 'fr';
    const info = SURFACE_LABELS[code];
    if (!info) return code || '—';
    return l === 'fr' ? info.fr : info.en;
}

/**
 * Fetch via le relai Google Apps Script, avec retries et gestion des
 * pannes Google (404 echo intermittents, gels 25 s, 502/503 AviationWeather).
 * @param {string} url    cible finale (hébergée sur aviationweather.gov)
 * @param {string} type   'text' | 'json'
 * @param {number} ttlSec optionnel : durée du cache. Sert DEUX couches : le
 *                        relai (cache serveur, 180 s par défaut) ET un micro-
 *                        cache navigateur — pour les données quasi statiques
 *                        (stationinfo → 3600), on évite même le trajet
 *                        /exec → echo, seule source des 404 intermittents.
 */
// Micro-cache navigateur : url → { ts, data }. En mémoire (pas de localStorage :
// périme au rechargement, ce qui suffit pour des données quasi statiques).
const _relaisCache = new Map();

// File de sérialisation : le relai Apps Script ne supporte PAS la concurrence.
// À partir de 2 requêtes /exec simultanées, Google perd des clés echo (404) ou
// gèle la redirection pendant 30-40 s — mesuré au curl 2026-08-19 : 8 requêtes
// concurrentes → 4 échecs ; en séquentiel, 10/10 en ~1 s. Or traiterSucces
// (app.js) déclenche une rafale (tendance pression, SIGMET, ATIS, watchdog…).
// Toutes les requêtes relai passent donc UNE PAR UNE ; les appels simultanés
// d'une même URL partagent la même promesse (dédup).
let _relaisQueue = Promise.resolve();
const _relaisInFlight = new Map();   // url → promesse partagée

export async function fetchAvecRelais(url, type = 'text', ttlSec = null) {

    if (url.includes('nominatim.openstreetmap.org')) {
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error("Erreur de l'API de recherche de ville");
            return type === 'json' ? await res.json() : await res.text();
        } catch (e) {
            throw new Error("Lieu introuvable sur la carte ou service surchargé.");
        }
    }

    if (ttlSec) {
        const hit = _relaisCache.get(url);
        if (hit && Date.now() - hit.ts < ttlSec * 1000) return hit.data;
    }

    // Même URL déjà en cours → on partage son résultat au lieu d'empiler
    // une requête identique dans la file (ex. fetchAtis appelé 2× de suite).
    const pending = _relaisInFlight.get(url);
    if (pending) return pending;

    const task = _relaisQueue.then(() => _viaRelais(url, type, ttlSec));
    _relaisInFlight.set(url, task);
    // La file continue même si la requête échoue (l'erreur reste portée par
    // `task`, le catch ici ne fait qu'empêcher un rejet de bloquer la chaîne).
    _relaisQueue = task.catch(() => {});
    try {
        return await task;
    } finally {
        _relaisInFlight.delete(url);
    }
}

// Corps réel de l'appel relai : proxy, tentatives, gestion d'erreurs. Toujours
// invoqué via la file de _fetchAvecRelais (jamais en parallèle d'un autre).
async function _viaRelais(url, type, ttlSec) {

    // Sans relais configuré (miroir public GitHub Pages) : appel DIRECT
    // — aviationweather.gov expose son API en CORS ouvert, seule la
    // mise en cache Google est perdue.
    if (!config.PROXY_URL) {
        // Mode SANS relais privé (miroir public) : direct d'abord, puis
        // corsproxy.io (clé perso, plafond gratuit) quand aviationweather
        // bloque CORS — leurs backends n'envoient pas toujours ACAO.
        const looksHtml = (t) => t.trim().startsWith('<') && !t.toLowerCase().includes('<?xml');
        let raw = null;
        try {
            const res = await fetch(url, { cache: 'no-store' });
            if (res.ok) raw = await res.text();
        } catch { /* CORS coupé ou réseau : tentative proxy ci-dessous */ }
        if (raw == null || looksHtml(raw)) {
            if (!config.CORS_PROXY_KEY) {
                if (raw == null) {
                    throw new Error(state.lang === 'fr'
                        ? 'Service météo inaccessible (réseau) — réessayez.'
                        : 'Weather service unreachable (network) — retry.');
                }
                throw new Error('__HTML_INATTENDU__');
            }
            try {
                const px = `https://corsproxy.io/?key=${encodeURIComponent(config.CORS_PROXY_KEY)}&url=${encodeURIComponent(url)}`;
                const res = await fetch(px, { cache: 'no-store' });
                if (!res.ok) throw new Error('__HTML_INATTENDU__');
                raw = await res.text();
            } catch (e) {
                if (e instanceof TypeError) {
                    throw new Error(state.lang === 'fr'
                        ? 'Service météo inaccessible (réseau) — réessayez.'
                        : 'Weather service unreachable (network) — retry.');
                }
                throw e;
            }
        }
        if (looksHtml(raw)) throw new Error('__HTML_INATTENDU__');
        return type === 'json' ? (raw.trim() === '' ? [] : JSON.parse(raw)) : raw;
    }

    let proxyUrl = `${config.PROXY_URL}?url=${encodeURIComponent(url)}`;
    if (ttlSec) proxyUrl += `&ttl=${ttlSec}`;

    // Familles d'échec, distinguées par des marqueurs internes :
    //   '__HTML_INATTENDU__'         → page HTML d'AviationWeather (502/503 sous charge) : transitoire, on retente.
    //   '__PROXY_INDISPONIBLE__|xxx' → déploiement Apps Script mort/inaccessible (404/401/403) : inutile de retenter.
    //   TypeError                    → fetch bloqué (hors-ligne, ou réponse du proxy sans en-têtes CORS) : sondage pour trancher.
    async function _oneAttempt(timeoutMs) {
        const controller = new AbortController();
        // 1re tentative : 25 s de patience (les réponses légitimes du relai
        // montent à 17-25 s quand Google traverse une phase de surcharge).
        // Retries : 15 s — la requête est sérialisée dans une file, un délai
        // long bloquerait toutes les autres derrière.
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(proxyUrl, { signal: controller.signal, cache: 'no-store' });
            // 404/401/403 = le déploiement n'existe plus ou accès refusé : ce n'est PAS
            // une surcharge d'AviationWeather, réessayer ne sert à rien.
            if (res.status === 404 || res.status === 401 || res.status === 403) {
                throw new Error(`__PROXY_INDISPONIBLE__|HTTP ${res.status}`);
            }
            const rawData = await res.text();
            if (rawData.startsWith('PROXY_ERROR:')) throw new Error(`Google n'a pas pu joindre la cible : ${rawData}`);
            // Détecte une page HTML (AviationWeather renvoie parfois une 502/503 sous charge).
            if (rawData.trim().startsWith('<') && !rawData.toLowerCase().includes('<?xml')) {
                throw new Error('__HTML_INATTENDU__');  // marqueur interne pour retry
            }
            return rawData;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    // Sondage no-cors du proxy : « true » = le serveur a répondu au niveau réseau
    // (réponse opaque, statut masqué). Distingue « plus de réseau » (rejet du sondage)
    // de « le proxy répond mais sa réponse est inutilisable » — typiquement un 404 ou
    // un 504 servi sans en-têtes CORS, ce qui fait échouer le fetch en TypeError.
    async function _sondeProxy() {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);
        try {
            await fetch(config.PROXY_URL, { method: 'HEAD', mode: 'no-cors', cache: 'no-store', signal: controller.signal });
            return true;
        } catch { return false; } finally { clearTimeout(timeoutId); }
    }

    const isFr = state.lang === 'fr';

    try {
        let rawData = null;
        let lastErr = null;
        // Jusqu'à 3 tentatives avec backoff progressif (1.5s puis 3.5s) :
        //  - page HTML AviationWeather (502/503) : transitoire, on retente ;
        //  - 404 echo Google : intermittent (clé user_content_key propre à chaque
        //    requête, routage edge) — une nouvelle tentative repart d'un /exec
        //    frais avec une nouvelle clé et réussit souvent ;
        //  - timeout 25s (gel du /exec, sans même un 302) : transitoire aussi —
        //    une seconde tentative est accordée, puis on abandonne ;
        //  - TypeError avec proxy atteignable : 504 sans CORS (transitoire) ou
        //    déploiement mort — on retente puis on tranche ;
        //  - 401/403 (accès refusé au déploiement) ou plus de réseau : arrêt net.
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                rawData = await _oneAttempt(attempt === 0 ? 25000 : 15000);
                lastErr = null;
                break;
            } catch (e) {
                if (e.name === 'AbortError') {
                    if (attempt > 0) throw e;  // timeout : un seul retry, puis échec net
                    lastErr = e;
                } else if (e.message?.startsWith('__PROXY_INDISPONIBLE__')) {
                    if (!e.message.includes('|HTTP 404')) throw e;  // 401/403 : fatal
                    lastErr = e;                                     // 404 : on retente
                } else if (e instanceof TypeError) {
                    if (!await _sondeProxy()) throw new Error(I18N[state.lang].errNetwork);
                    lastErr = e;
                } else if (e.message === '__HTML_INATTENDU__') {
                    lastErr = e;
                } else {
                    throw e;
                }
                if (attempt < 2) await new Promise(r => setTimeout(r, 1500 + attempt * 2000));
            }
        }
        if (lastErr) throw lastErr;

        // Corps vide (204 No Content, ex. zone sans PIREP) → [] pour du JSON
        // (JSON.parse('') sinon lève une SyntaxError).
        const data = type === 'json'
            ? (rawData.trim() === '' ? [] : JSON.parse(rawData))
            : rawData;
        // Succès : alimente le micro-cache navigateur (données quasi statiques
        // uniquement — ttlSec fourni) pour les appels suivants.
        if (ttlSec) _relaisCache.set(url, { ts: Date.now(), data });
        return data;
    } catch (e) {
        if (e.name === 'AbortError') throw new Error(isFr ? "Délai d'attente dépassé. Le relai météo est surchargé — réessayez." : "Timeout. The weather relay is overloaded — please retry.");
        if (e.message?.startsWith('__PROXY_INDISPONIBLE__')) {
            const detail = e.message.split('|')[1] || '';
            throw new Error(isFr
                ? `Relai Google Apps Script inaccessible (${detail}) — incident Google passager (réessayez) ou déploiement à vérifier (js/config.local.js).`
                : `Google Apps Script relay unreachable (${detail}) — transient Google issue (retry) or deployment to check (js/config.local.js).`);
        }
        if (e instanceof TypeError) {
            // Après les retries, le proxy répond (sondage OK) mais ses réponses restent
            // inutilisables : déploiement probablement mort, pas un souci AviationWeather.
            throw new Error(isFr
                ? "Relai Google Apps Script inaccessible (réponse bloquée) — vérifiez le déploiement (js/config.local.js)."
                : "Google Apps Script relay unreachable (blocked response) — check the deployment (js/config.local.js).");
        }
        if (e.message === '__HTML_INATTENDU__') throw new Error(isFr ? "AviationWeather momentanément indisponible (réessayez)." : "AviationWeather temporarily unavailable (please retry).");
        throw e;
    }
}

let _omRunning = false;
const _omCache = new Map();
const _omPending = new Map();
const _OM_DELAY = 1500;
const _OM_RETRY_BASE = 3000;

export async function fetchOpenMeteo(url) {

    const cached = _omCache.get(url);
    if (cached && Date.now() - cached.ts < 5 * 60 * 1000) return cached.data;

    if (_omPending.has(url)) return _omPending.get(url);

    const promise = _omFetchQueued(url);
    _omPending.set(url, promise);
    try {
        const data = await promise;
        return data;
    } finally {
        _omPending.delete(url);
    }
}

async function _omFetchQueued(url) {

    while (_omRunning) {
        await new Promise(r => setTimeout(r, 100));
    }
    _omRunning = true;

    try {

        const cached = _omCache.get(url);
        if (cached && Date.now() - cached.ts < 5 * 60 * 1000) return cached.data;

        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const res = await fetch(url);
                if (res.status === 429) {
                    const wait = _OM_RETRY_BASE * (attempt + 1);
                    console.warn(`Open-Meteo 429, retry ${attempt + 1}/3 dans ${wait}ms`);
                    await new Promise(r => setTimeout(r, wait));
                    continue;
                }
                if (!res.ok) {
                    console.warn(`Open-Meteo HTTP ${res.status}`);
                    return null;
                }
                const data = await res.json();
                _omCache.set(url, { data, ts: Date.now() });
                return data;
            } catch (e) {
                console.warn('Open-Meteo fetch error:', e.message);
                return null;
            }
        }
        console.warn('Open-Meteo: 3 retries épuisés pour', url.slice(0, 60));
        return null;
    } finally {

        await new Promise(r => setTimeout(r, _OM_DELAY));
        _omRunning = false;
    }
}
