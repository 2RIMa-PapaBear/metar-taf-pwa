import { I18N, PALETTE, UNIFIED_RED, REGEX_BLOCKS_PATTERN, parseVisiToMeters, getCeiling, findActiveValueAtHour, CAT_COLORS, catColorRgba } from './core.js';
import { state, memoGet } from './core.js';
import { escapeHtml } from './core.js';
import { dessinerGraphique, updateWindCompass, calculateFlightCategoryRobust, parseWindString, selectBestRunway, getForecastAtHour } from './engine.js';
import { displayWeatherAlerts } from './weather.js';
import { updateDecryptedWidgets, showDecryptedWidgets } from './widgets.js';
import { idbGetAirports, idbPutAirports, AIRPORTS_DB_VERSION } from './db.js';

let AIRPORTS = [];

let AIRPORTS_BY_ICAO = new Map();

function rebuildIndex() {
    AIRPORTS_BY_ICAO = new Map();
    for (const a of AIRPORTS) {
        if (a && a.icao) AIRPORTS_BY_ICAO.set(a.icao.toUpperCase(), a);
    }
}

function signalerErreurChargement() {
    AIRPORTS = [];
    rebuildIndex();
    const infoDiv = document.getElementById('lbl-info');
    if (infoDiv) {
        const msg = I18N[state.lang]?.errDb || 'Erreur : base d aéroports indisponible.';
        infoDiv.innerHTML = `<span style="color:var(--danger);">${escapeHtml(msg)}</span>`;
    }
}

export async function initAirportsDB() {

    const cached = await idbGetAirports();
    if (cached && cached.length > 0) {
        AIRPORTS = cached;
        rebuildIndex();
        return;
    }

    try {
        // Pas de cache:'reload' — l'URL contient déjà la version (?v=AIRPORTS_DB_VERSION),
        // ce qui suffit au cache-busting. (Le <link rel=preload> d'airports.json a été
        // retiré d'index.html : inutilisé dès qu'IndexedDB sert la base, il générait
        // un warning console « preloaded but not used » à chaque chargement.)
        const r = await fetch(`data/airports.json?v=${AIRPORTS_DB_VERSION}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        AIRPORTS = Array.isArray(data) ? data : [];
        rebuildIndex();

        idbPutAirports(AIRPORTS).catch(() => {});
    } catch (e) {
        console.warn('Airports DB load failed:', e);
        signalerErreurChargement();
    }
}
export function getAirportByICAO(icao) {
    if (!icao) return null;
    return AIRPORTS_BY_ICAO.get(icao.toUpperCase()) || null;
}

export function getAirportsInBbox(minLat, minLon, maxLat, maxLon) {
    return AIRPORTS
        .filter(a =>
            a.lat >= minLat && a.lat <= maxLat &&
            a.lon >= minLon && a.lon <= maxLon &&
            (a.longestRunway || 0) >= 1000
        )
        .map(a => ({ icao: a.icao, name: a.name, lat: a.lat, lon: a.lon }));
}

export function enrichAirport(icao, enriched) {
    if (!icao || !enriched) return;
    const key = icao.toUpperCase();
    const existing = AIRPORTS_BY_ICAO.get(key) || {};

    AIRPORTS_BY_ICAO.set(key, { ...existing, ...enriched, icao: key });
}

export function sanitizeStorage() {
    const keys = ['search-history', 'favorites'];
    keys.forEach(k => {
        try {
            let data = localStorage.getItem(k); if (!data) return;
            let parsed = JSON.parse(data).filter(item => item && String(item).toUpperCase() !== 'UNDEFINED');
            localStorage.setItem(k, JSON.stringify(parsed));
        } catch (e) { console.warn(`Storage sanitization error for ${k}:`, e); }
    });
}

export function _showDashboard(isMetar) {
    const d = document.getElementById('metar-dashboard'); if (d) d.classList.add('visible');
    showDecryptedWidgets(true);
}
export function _hideDashboard() {
    const d = document.getElementById('metar-dashboard'); if (d) d.classList.remove('visible');
    showDecryptedWidgets(false);
}

export function _selectAndFetch(icao) {
    document.getElementById('icaoInput').value = icao;
    document.getElementById('btn-fetch-metar').click();
}

export function updateFinalUI(res, raw, forcedId) {
    if (state.rafId) cancelAnimationFrame(state.rafId);
    state.rafId = requestAnimationFrame(() => {

        const aptCode = state.requestedIcao || res.code;
        const apt = getAirportByICAO(aptCode); const runways = apt ? apt.runways : null;
        const memo = memoGet(res.code);
        let tz = memo && typeof memo.tzOffset === 'number' ? memo.tzOffset : -(new Date().getTimezoneOffset() / 60);

        const infoDiv = document.getElementById('lbl-info');
        if(infoDiv && memo) {
            let displayName = memo.name;
            if (apt && (!displayName || displayName === res.code)) {
                displayName = apt.name;
            }

            let infoHtml = `<strong>${I18N[state.lang].lblAirport}</strong> `;

            if (aptCode !== res.code && state.warningMessage) {
                const reqApt = getAirportByICAO(aptCode);
                const reqName = reqApt ? reqApt.name : aptCode;
                const sourceLabel = res.isMetar ? I18N[state.lang].lblMetarFrom : I18N[state.lang].lblTafFrom;
                infoHtml += `${escapeHtml(reqName)} (${escapeHtml(aptCode)}) — <em>${escapeHtml(sourceLabel)} ${escapeHtml(displayName)} (${escapeHtml(res.code)})</em> - ${escapeHtml(res.validity)}`;
            } else {
                infoHtml += `${escapeHtml(displayName)} (${escapeHtml(res.code)}) - ${escapeHtml(res.validity)}`;
            }
            state.baseInfoString = infoHtml;
            infoDiv.innerHTML = state.baseInfoString;
            demarrerHorlogeLocale(res.code);
        }

        _showDashboard(res.isMetar);

        if (res.isMetar) {
            displayWeatherAlerts(raw, res);
            updateWindCompass(res, null, null, runways, forcedId, apt);

            const cat = calculateFlightCategoryRobust(res.base?.visi?.[0]?.val, res.base?.nuage?.[0]?.val);

            let tempoCatObj = null;
            let tempoProb = '';
            (res.tempo || []).forEach(b => {
                const tVisi = b.visi || res.base?.visi?.[0]?.val;
                const tNuage = b.nuage || res.base?.nuage?.[0]?.val;
                const tCatObj = calculateFlightCategoryRobust(tVisi, tNuage);

                if (tCatObj.cat !== 'VFR') {
                    const getSev = (c) => c === 'LIFR' ? 4 : (c === 'IFR' ? 3 : (c === 'MVFR' ? 2 : 1));
                    if (!tempoCatObj || getSev(tCatObj.cat) > getSev(tempoCatObj.cat)) {
                        tempoCatObj = tCatObj;
                        let p = b.prob || '';
                        tempoProb = (b.type === 'TEMPO') ? (p ? p + ' TEMPO' : 'TEMPO') : p;
                    }
                }
            });

            updateFlightCategoryBadge(cat, res.weatherIcon, true, true, false, runways, forcedId, res.base?.vent?.[0]?.val, res.base?.visi?.[0]?.val, res.base?.nuage?.[0]?.val, tempoCatObj, tempoProb.trim());
            updateDecryptedWidgets(res, null);
        } else {
            let targetH = state.manualTargetHour === null ? (new Date().getUTCHours() + new Date().getUTCMinutes()/60) : state.manualTargetHour;

            if (targetH >= res.startH && targetH <= res.endH) {
                displayWeatherAlerts(raw, res, targetH);
            } else {
                displayWeatherAlerts(null, null);
            }

            let diffH = Math.round(targetH - res.startH);
            let labelTime = diffH === 0 ? "H+0" : (diffH > 0 ? `H+${diffH}h` : `H${diffH}h`);

            updateWindCompass(res, targetH, labelTime, runways, forcedId, apt);
            const forecast = getForecastAtHour(res, targetH);

            let windStr = findActiveValueAtHour(res.base?.vent, targetH);
            let visiStr = findActiveValueAtHour(res.base?.visi, targetH);
            let nuageStr = findActiveValueAtHour(res.base?.nuage, targetH);

            updateFlightCategoryBadge(forecast.catObj, forecast.icon, true, false, false, runways, forcedId, windStr, visiStr, nuageStr, forecast.tempoCatObj, forecast.tempoProb);
            updateDecryptedWidgets(res, targetH);
        }

        let targetHGraph = state.manualTargetHour === null ? (new Date().getUTCHours() + new Date().getUTCMinutes()/60) : state.manualTargetHour;
        dessinerGraphique(res, targetHGraph, tz);
        state.rafId = null;
    });
}

function demarrerHorlogeLocale(icao) {
    if (state.horlogeInterval) clearInterval(state.horlogeInterval);
    const infoDiv = document.getElementById('lbl-info'); if (!infoDiv) return;
    const majHorloge = () => {
        const memo = memoGet(icao);
        if (!memo || typeof memo.tzOffset !== 'number') return;
        let utcNow = new Date(); let locMs = utcNow.getTime() + (memo.tzOffset * 3600000); let locD = new Date(locMs);
        let hh = String(locD.getUTCHours()).padStart(2, '0'); let mm = String(locD.getUTCMinutes()).padStart(2, '0');
        let tempStr = memo.temperature != null ? memo.temperature : '--';
        let qnhStr = memo.qnh != null ? memo.qnh : '--';

        let displayName = memo.name;
        const apt = getAirportByICAO(icao);
        if (apt && (!displayName || displayName === icao)) displayName = apt.name;

        let str = I18N[state.lang].localTimeFormat.replace('{time}', `${hh}:${mm}`).replace('{name}', displayName).replace('{temp}', tempStr).replace('{qnh}', qnhStr);

        infoDiv.innerHTML = state.baseInfoString + `<span style="opacity:0.8;font-size:0.9em;margin-left:8px;">${escapeHtml(str)}</span>`;
    };
    majHorloge(); state.horlogeInterval = setInterval(majHorloge, 60000);
}

export function updateFlightCategoryBadge(catObj, iconName, showAnim, isMetar, isTafFuture, runways, forcedId, windStr, visiStr, nuageStr, tempoCatObj = null, tempoProbLabel = '') {
    const b = document.getElementById('flight-cat-badge'); if (!b) return;

    const speed = windStr ? (parseWindString(windStr)?.speed || 0) : 0;
    const visiM = parseVisiToMeters(visiStr || '');
    const ceilFt = getCeiling(nuageStr || '') * 100;

    let windLabel = windStr ? `${speed} KT` : '--';
    let visiLabel = visiStr ? (visiM >= 10000 ? '> 10 km' : (visiM/1000).toFixed(1)+' km') : '--';
    let ceilLabel = nuageStr ? (ceilFt === 99900 ? (I18N[state.lang].lblCeilingUnlimited || 'Unlimited') : ceilFt+' ft') : '--';

    b.className = 'dashboard-cell vfr-card ' + (catObj.class || `cat-${catObj.cat.toLowerCase()}`);

    const borderCol = CAT_COLORS[catObj.cat] || CAT_COLORS.NONE;
    const bgCol = catColorRgba(catObj.cat, 0.2);

    b.style.background = bgCol;
    b.style.borderColor = borderCol;

    let isFr = state.lang === 'fr';
    let lblWind = isFr ? 'Vent' : 'Wind';
    let lblVisi = isFr ? 'Visibilité' : 'Visibility';
    let lblCeil = isFr ? 'Plafond' : 'Ceiling';

    let tempoHtml = '';
    if (tempoCatObj && tempoCatObj.cat !== 'VFR') {
        const tCol = CAT_COLORS[tempoCatObj.cat] || CAT_COLORS.NONE;
        tempoHtml = `<div style="color:${tCol}; font-size:18px; font-weight:800; margin-top:4px; letter-spacing: 0.5px;">${tempoProbLabel} ${tempoCatObj.cat}</div>`;
    }

    let html = `
        <i data-lucide="${iconName}" class="vfr-watermark-icon"></i>
        <div style="display:flex; flex-direction:column; height:100%; position:relative; z-index:1;">
            <div style="flex:1;">
                <div class="dash-title" style="color:rgba(255,255,255,0.9); margin-bottom:8px;">${isMetar ? I18N[state.lang].lblObservation : I18N[state.lang].lblWeather}</div>
                <div class="vfr-cat" style="color:${borderCol}; font-size: 52px;">${catObj.cat}</div>
                ${tempoHtml}
            </div>
            <div style="display:flex; flex-direction:column; gap:6px; margin-top:15px; width: 100%;">
                <div class="vfr-chip" style="background:rgba(0,0,0,0.4);">
                    <span class="vfr-chip-label">${lblWind}</span>
                    <span class="vfr-chip-value">${windLabel}</span>
                </div>
                <div class="vfr-chip" style="background:rgba(0,0,0,0.4);">
                    <span class="vfr-chip-label">${lblVisi}</span>
                    <span class="vfr-chip-value">${visiLabel}</span>
                </div>
                <div class="vfr-chip" style="background:rgba(0,0,0,0.4);">
                    <span class="vfr-chip-label">${lblCeil}</span>
                    <span class="vfr-chip-value">${ceilLabel}</span>
                </div>
            </div>
        </div>
    `;

    b.innerHTML = html;

    const prevCat = b.dataset.lastCat;
    if (showAnim && catObj.cat !== prevCat) {
        b.style.animation = 'none'; void b.offsetWidth; b.style.animation = 'windArrowPulse 0.4s ease-out';
    }
    b.dataset.lastCat = catObj.cat;
    if (window.lucide) window.lucide.createIcons({ root: b });
}

export function updateHighlights() {
    const raw = document.getElementById('tafInput').value, hl = document.getElementById('highlights');
    if (!hl || !raw) return;
    let t = escapeHtml(raw);
    t = t.replace(REGEX_BLOCKS_PATTERN, '<span class="hl-block">$&</span>');
    hl.innerHTML = t;
}

export function addToHistory(icao) {
    if (!icao || icao.length !== 4) return;
    try {
        let history = JSON.parse(localStorage.getItem('search-history')) || [];
        history = history.filter(item => item !== icao);
        history.unshift(icao);
        if (history.length > 8) history.pop();
        localStorage.setItem('search-history', JSON.stringify(history));
    } catch (e) { console.warn('addToHistory failed:', e); }
}

export function toggleFavorite(icao) {
    if (!icao || icao.length !== 4) return;
    try {
        let favs = JSON.parse(localStorage.getItem('favorites')) || [];
        if (favs.includes(icao)) favs = favs.filter(f => f !== icao); else favs.push(icao);
        localStorage.setItem('favorites', JSON.stringify(favs));
    } catch (e) { console.warn('toggleFavorite failed:', e); }
}

export function isFavorite(icao) {
    try { return (JSON.parse(localStorage.getItem('favorites')) || []).includes(icao); } catch (e) { console.warn('isFavorite failed:', e); return false; }
}

export function getStartupFavorite() {
    try { return localStorage.getItem('startup-favorite') || null; } catch (e) { return null; }
}

export function setStartupFavorite(icao) {
    try {
        if (icao) localStorage.setItem('startup-favorite', icao);
        else localStorage.removeItem('startup-favorite');
    } catch (e) {   }
}

export function updateFavoritesUI(onSelect) {
    const c = document.getElementById('favorites-list'); if (!c) return;
    let favs = []; try { favs = JSON.parse(localStorage.getItem('favorites')) || []; } catch {}
    if (favs.length === 0) { c.innerHTML = `<div class="history-empty">${I18N[state.lang].favorisEmpty}</div>`; return; }
    const isFr = state.lang === 'fr';
    const startup = getStartupFavorite();
    let html = '<div class="history-items">';
    favs.forEach(icao => {
        let apt = getAirportByICAO(icao);
        let displayName = apt ? apt.name : icao;
        if (state.memo[icao] === 'PENDING') displayName = I18N[state.lang].lblSearching;
        else if (state.memo[icao] && typeof state.memo[icao] === 'object' && state.memo[icao].name) displayName = state.memo[icao].name;

        const isStartup = icao === startup;

        html += `<button class="history-item fav-item" data-icao="${escapeHtml(icao)}" style="display:flex; flex-direction:row; align-items:center; padding: 6px 8px 6px 4px; gap: 6px;">
            <div class="fav-remove-btn fav-remove" data-icao="${escapeHtml(icao)}" style="padding: 2px; margin:0;">
                <i data-lucide="x" style="width:16px; height:16px; margin:0;"></i>
            </div>
            <div style="display:flex; flex-direction:column; flex:1; text-align:left;">
                <div style="display:flex; flex-direction:row; align-items:center; gap:4px;">
                    <span class="history-icao">${escapeHtml(icao)}</span>
                    <div class="fav-startup-btn fav-startup" data-icao="${escapeHtml(icao)}" title="${isFr ? (isStartup ? 'Ne plus charger au démarrage' : 'Charger au démarrage') : (isStartup ? 'Stop loading on startup' : 'Load on startup')}" style="padding:1px; cursor:pointer; opacity:${isStartup ? '1' : '0.4'}; color:${isStartup ? '#FBBF24' : 'var(--text-muted)'};">
                        <i data-lucide="${isStartup ? 'pin' : 'pin-off'}" style="width:14px; height:14px; margin:0;"></i>
                    </div>
                </div>
                <span class="history-name">${escapeHtml(displayName)}</span>
            </div>
        </button>`;
    });
    html += '</div>';

    c.innerHTML = html;

    if (window.lucide) window.lucide.createIcons({ root: c });

    c.querySelectorAll('.fav-item').forEach(b => {
        b.addEventListener('click', function(e) {
            if (!e.target.closest('.fav-remove') && !e.target.closest('.fav-startup')) onSelect(this.dataset.icao);
        });
    });

    c.querySelectorAll('.fav-remove').forEach(i => {
        i.addEventListener('click', function(e) {
            e.stopPropagation();
            toggleFavorite(this.dataset.icao);

            if (this.dataset.icao === getStartupFavorite()) setStartupFavorite(null);
            updateFavoritesUI(onSelect);
        });
    });

    c.querySelectorAll('.fav-startup').forEach(i => {
        i.addEventListener('click', function(e) {
            e.stopPropagation();
            const icao = this.dataset.icao;
            setStartupFavorite(getStartupFavorite() === icao ? null : icao);
            updateFavoritesUI(onSelect);
        });
    });
}

export function renderSearchHistory(containerId, onSelect) {
    const c = document.getElementById(containerId); if (!c) return;
    let h = []; try { h = JSON.parse(localStorage.getItem('search-history')) || []; } catch {}
    const tr = I18N[state.lang];
    if (h.length === 0) { c.innerHTML = `<div class="history-empty">${tr.noRecentSearch || 'Aucune recherche récente.'}</div>`; return; }

    let html = '<div class="history-items">';
    h.forEach(icao => {
        let apt = getAirportByICAO(icao);
        let displayName = apt ? apt.name : icao;
        if (state.memo[icao] === 'PENDING') displayName = tr.lblSearching;
        else if (state.memo[icao] && typeof state.memo[icao] === 'object' && state.memo[icao].name) displayName = state.memo[icao].name;

        html += `
            <button class="history-item" data-icao="${escapeHtml(icao)}">
                <span class="history-icao">${escapeHtml(icao)}</span>
                <span class="history-name">${escapeHtml(displayName)}</span>
            </button>`;
    });
    const clearLabel = tr.clearHistory || (state.lang === 'fr' ? "Vider l'historique" : "Clear History");
    html += `</div><button id="btn-clear-history" class="btn-clear-history">${clearLabel}</button>`;

    c.innerHTML = html;

    c.querySelectorAll('.history-item').forEach(b => b.addEventListener('click', function() { onSelect(this.dataset.icao); }));
    const clearBtn = document.getElementById('btn-clear-history');
    if (clearBtn) clearBtn.addEventListener('click', () => { localStorage.removeItem('search-history'); renderSearchHistory(containerId, onSelect); });

    if (window.lucide) window.lucide.createIcons({ root: c });
}

let _acInstances = [];
export function initAutocomplete(inputId, onSelect, opts = {}) {
    const input = document.getElementById(inputId); if (!input) return;

    input.parentElement.classList.add('autocomplete-wrapper');

    // Une dropdown par champ (recherche principale ET destination de nav).
    const dropdownId = opts.dropdownId || `autocomplete-dropdown-${inputId}`;
    let dropdown = document.getElementById(dropdownId);
    if (!dropdown) {
        dropdown = document.createElement('div');
        dropdown.id = dropdownId;
        dropdown.className = 'autocomplete-dropdown';
        input.parentElement.appendChild(dropdown);
    }

    let activeIndex = -1;

    let _acDebounce = null;
    let _acRequestId = 0;

    // Fermeture au clic extérieur : un seul handler global pour toutes les
    // instances (chaque instance enregistre sa paire input/dropdown).
    _acInstances = _acInstances.filter(i => i.input !== input);
    _acInstances.push({ input, dropdown, close() { dropdown.classList.remove('visible'); activeIndex = -1; } });
    document.removeEventListener('click', _acGlobalClickHandler);
    document.addEventListener('click', _acGlobalClickHandler);

    function highlightActiveItem() {
        const items = dropdown.querySelectorAll('.autocomplete-item');
        items.forEach((item, i) => {
            item.classList.toggle('autocomplete-active', i === activeIndex);
            if (i === activeIndex) item.scrollIntoView({ block: 'nearest' });
        });
    }

    function _renderAutocomplete(results) {
        dropdown.innerHTML = '';
        activeIndex = -1;
        if (results.length === 0) {
            dropdown.classList.remove('visible');
            return;
        }
        results.forEach(apt => {
            const item = document.createElement('button');
            item.className = 'autocomplete-item';

            if (opts.formatItem) {
                item.innerHTML = opts.formatItem(apt);
            } else {
                const icaoHtml = apt.icao
                    ? `<span class="autocomplete-icao">${escapeHtml(apt.icao)}</span>`
                    : `<span class="autocomplete-icao" style="opacity:0.5;font-size:10px;">${escapeHtml(apt.country || '')}</span>`;
                item.innerHTML = `${icaoHtml}<span class="autocomplete-name">${escapeHtml(apt.name)}</span>`;
            }
            item.addEventListener('click', (e) => {
                e.preventDefault();

                let value = apt.icao;

                if (!value && apt.name) {
                    const norm = s => String(s).toUpperCase().replace(/[\s\-_'.]/g, '');
                    const target = norm(apt.name);
                    if (target.length >= 4) {
                        const cands = AIRPORTS.filter(a => a.name && a.icao && norm(a.name).includes(target));
                        if (cands.length === 1) value = cands[0].icao;
                        else if (cands.length > 1) {
                            const exact = cands.find(a => norm(a.name) === target);
                            value = (exact || cands[0]).icao;
                        }
                    }
                }

                if (!value) value = apt.name;

                input.value = value;
                dropdown.classList.remove('visible');
                activeIndex = -1;
                onSelect(value);
            });
            dropdown.appendChild(item);
        });
        dropdown.classList.add('visible');
    }

    input.addEventListener('input', () => {
        const val = input.value.trim();

        if (val.length < 2) {
            dropdown.classList.remove('visible');
            return;
        }

        const valUpper = val.toUpperCase();
        let localMatches = AIRPORTS.filter(a =>
            (a.icao && a.icao.toUpperCase().includes(valUpper)) ||
            (a.name && a.name.toUpperCase().includes(valUpper))
        );
        if (opts.filterList) localMatches = opts.filterList(localMatches, valUpper);
        else localMatches = localMatches.slice(0, 6);
        if (localMatches.length > 0) _renderAutocomplete(localMatches);

        clearTimeout(_acDebounce);
        const reqId = ++_acRequestId;
        _acDebounce = setTimeout(async () => {
            try {
                const { searchAirports } = await import('./openaip.js');
                let liveResults = await searchAirports(val, 8);
                // Champ Destination : seuls les codes OACI sont exploitables.
                if (opts.requireIcao) liveResults = liveResults.filter(a => a.icao && /^[A-Z][A-Z0-9]{3}$/.test(a.icao));

                if (reqId === _acRequestId && liveResults.length > 0) {
                    // Destination : la base locale (codes + distance depuis le
                    // départ) prime sur les résultats live — la liste ne doit
                    // pas changer sous le pointeur au moment du clic.
                    if (localMatches.length >= 6 || (opts.preferLocal && localMatches.length > 0)) {
                        return;
                    }
                    _renderAutocomplete(liveResults);
                }
            } catch {   }
        }, 300);
    });

    input.addEventListener('keydown', (e) => {
        const items = dropdown.querySelectorAll('.autocomplete-item');
        if (!dropdown.classList.contains('visible') || items.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            activeIndex = (activeIndex + 1) % items.length;
            highlightActiveItem();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            activeIndex = activeIndex <= 0 ? items.length - 1 : activeIndex - 1;
            highlightActiveItem();
        } else if (e.key === 'Enter') {
            if (activeIndex >= 0 && activeIndex < items.length) {
                e.preventDefault();
                items[activeIndex].click();
            }
            dropdown.classList.remove('visible');
            activeIndex = -1;
        } else if (e.key === 'Escape') {
            dropdown.classList.remove('visible');
            activeIndex = -1;
        }
    });
}

function _acGlobalClickHandler(e) {
    _acInstances.forEach(inst => {
        if (e.target !== inst.input && !inst.dropdown.contains(e.target)) inst.close();
    });
}

let synth = null;
export function lireMETAR(t) { if ('speechSynthesis' in window) { synth = window.speechSynthesis; synth.cancel(); const u = new SpeechSynthesisUtterance(t); u.lang = state.lang === 'fr' ? 'fr-FR' : 'en-US'; u.rate = 0.9; synth.speak(u); } }
export function stopAudio() { if (synth) synth.cancel(); }

export function toggleLanguage() { setLanguage(state.lang === 'fr' ? 'en' : 'fr'); if (state.refreshCallback) state.refreshCallback(); }

export function setLanguage(l) {
    state.lang = l;
    document.documentElement.lang = l;
    const btn = document.getElementById('btn-lang-toggle'); if (btn) btn.className = `btn-lang-toggle ${l === 'en' ? 'lang-en' : 'lang-fr'}`;
    const tr = I18N[l];
    const elIcao = document.getElementById('icaoInput'); if (elIcao) elIcao.placeholder = tr.placeholderIcao;
    const elTaf = document.getElementById('tafInput'); if (elTaf) elTaf.placeholder = tr.placeholderTaf;
    // Textes statiques d'index.html (header, panneaux latéraux, légende carte...).
    const dict = {
        'lbl-source': tr.lblSource, 'lbl-aero-hours': tr.lblAeroHours,
        'btn-add-favorite': tr.btnAddFavorite, 'btn-read-metar': tr.btnReadMetar, 'btn-stop-audio': tr.btnStopAudio,
        'lbl-favoris-title': tr.favorisTitle, 'footer-warning': tr.footerWarning,
        'leg-clr': tr.legClr, 'leg-few': tr.legFew, 'leg-sct': tr.legSct, 'leg-bkn': tr.legBkn, 'leg-ovc': tr.legOvc, 'leg-vv': tr.legVv,
        'ui-title': tr.uiTitle, 'lbl-notice': tr.noticeBtn,
        'seg-local': tr.flightModeLocal, 'seg-nav': tr.flightModeNav,
        'search-history-title': tr.searchRecentTitle, 'history-title-text': tr.historyTitle,
        'lbl-alternates': tr.alternatesTitle, 'lbl-regional-map': tr.regionalMapTitle,
        'lbl-route-from': tr.routeFrom, 'lbl-route-to': tr.routeTo,
        'lbl-no-metar': tr.mapNoMetar, 'lbl-current-apt': tr.mapCurrentApt,
        'lbl-dep-btn': tr.depBtn, 'lbl-dest-btn': tr.destBtn,
    };
    Object.keys(dict).forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = dict[id]; });
    // Attributs visibles (bulles d'aide au survol, libellés d'accessibilité).
    const attrs = {
        'btn-lang-toggle': { 'aria-label': tr.langToggleAria },
        'btn-notice': { title: tr.noticeBtnTitle },
        'btn-night-mode': { title: tr.nightModeTitle, 'aria-label': tr.nightModeAria },
        'flight-mode-toggle': { title: tr.flightModeTitle, 'aria-label': tr.flightModeTitle },
        'btn-cockpit-mode': { title: tr.cockpitModeTitle, 'aria-label': tr.cockpitModeAria },
        'btn-share': { title: tr.shareTitle, 'aria-label': tr.shareAria },
        'btn-watchdog': { title: tr.watchdogTitle, 'aria-label': tr.watchdogAria },
        'btn-fetch-metar': { 'aria-label': tr.fetchMetarAria },
        'btn-fetch-taf': { 'aria-label': tr.fetchTafAria },
        'route-to-input': { placeholder: tr.routeToPlaceholder },
    };
    Object.entries(attrs).forEach(([id, map]) => {
        const el = document.getElementById(id);
        if (el) for (const [k, v] of Object.entries(map)) el.setAttribute(k, v);
    });
    updateFavoritesUI(_selectAndFetch);
    renderSearchHistory('search-history-list', _selectAndFetch);
    if (window.lucide) window.lucide.createIcons();
    // Les modules à rendu dynamique (titres de widgets repliables, profil
    // d'élévation...) écoutent cet événement pour se re-traduire.
    window.dispatchEvent(new CustomEvent('lang-changed'));
}

export function handleInput() {
    updateHighlights();
    if (state.debounceTimer) clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(() => { if (state.refreshCallback) state.refreshCallback(); }, 500);
}
export function handleScroll() {
    const tf = document.getElementById('tafInput'), hl = document.getElementById('highlights');
    if (tf && hl) { hl.scrollTop = tf.scrollTop; hl.scrollLeft = tf.scrollLeft; }
}
