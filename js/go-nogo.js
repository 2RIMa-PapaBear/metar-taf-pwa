import { state, I18N, parseVisiToMeters, getCeiling, memoGet } from './core.js';
import { parseWindString, selectBestRunway } from './engine.js';
import { analyzeWeatherAlerts, analyzeForecastAlerts, openThresholdsModal } from './weather.js';
import { getAirportByICAO } from './ui-module.js';
import { getPerformanceData, densityAltitude, evaluateDensityAltitude } from './density-altitude.js';
import { computeFlightWindow } from './flight-window.js';
import { fetchPressureTrend, evaluatePressureTrend } from './pressure-trend.js';
import { evaluateSigmetAirmet } from './sigmet.js';
import { fetchSigmetAirmet } from './sigmet.js';
import { getDeclinationForIcao } from './magvar.js';
import { evaluateIcingRisk, fetchFreezingLevel } from './freezing-level.js';
import { evaluateTakeoffPerformance } from './takeoff-performance.js';

function _currentCategory() {
    const parsed = state.lastParsed;
    if (!parsed) return null;
    const visiStr = parsed.base?.visi?.[0]?.val;
    const nuageStr = parsed.base?.nuage?.[0]?.val;
    const visiM = parseVisiToMeters(visiStr || '');
    const ceilHund = getCeiling(nuageStr || '');
    if (ceilHund < 5 || visiM < 1600) return { cat: 'LIFR' };
    if (ceilHund < 10 || visiM < 4800) return { cat: 'IFR' };
    if (ceilHund <= 30 || visiM <= 8000) return { cat: 'MVFR' };
    return { cat: 'VFR' };
}

export function evaluateGoNoGo() {
    const parsed = state.lastParsed;
    if (!parsed) return null;

    const isFr = state.lang === 'fr';
    const icao = state.requestedIcao || parsed.code;
    const reasons = [];
    let verdict = 'GO';

    const catObj = _currentCategory();

    if (catObj.cat === 'LIFR' || catObj.cat === 'IFR') {
        verdict = 'NO-GO';
        reasons.push({
            level: 'danger',
            icon: 'cloud-fog',
            text: isFr
                ? `Conditions ${catObj.cat} — sous les minimas VFR`
                : `${catObj.cat} conditions — below VFR minima`,
        });
    } else if (catObj.cat === 'MVFR') {
        if (verdict === 'GO') verdict = 'CAUTION';
        reasons.push({
            level: 'caution',
            icon: 'cloud-drizzle',
            text: isFr ? `MVFR — marges VFR réduites` : `MVFR — reduced VFR margins`,
        });
    }

    const raw = document.getElementById('tafInput')?.value || '';
    let alerts = [];
    if (parsed.isMetar) {
        alerts = analyzeWeatherAlerts(raw);
    } else {
        const targetH = state.manualTargetHour === null
            ? (new Date().getUTCHours() + new Date().getUTCMinutes() / 60)
            : state.manualTargetHour;
        if (targetH >= parsed.startH && targetH <= parsed.endH) {
            alerts = analyzeForecastAlerts(parsed, targetH);
        }
    }

    const dangerAlerts = alerts.filter(a => a.level === 'danger');
    const warningAlerts = alerts.filter(a => a.level === 'warning');

    if (dangerAlerts.length > 0) {
        if (verdict !== 'NO-GO') verdict = 'NO-GO';
        dangerAlerts.forEach(a => {
            reasons.push({ level: 'danger', icon: a.icon, text: _formatAlertText(a, isFr) });
        });
    }
    if (warningAlerts.length > 0) {
        if (verdict === 'GO') verdict = 'CAUTION';
        warningAlerts.forEach(a => {
            reasons.push({ level: 'caution', icon: a.icon, text: _formatAlertText(a, isFr) });
        });
    }

    const memo = memoGet(parsed.code);
    const apt = getAirportByICAO(icao);
    const lat = memo?.lat ?? apt?.lat ?? null;
    const lon = memo?.lon ?? apt?.lon ?? null;

    if (lat != null && lon != null) {
        const window = computeFlightWindow(lat, lon);
        if (window && window.status === 'night') {
            if (verdict !== 'NO-GO') verdict = 'NO-GO';
            reasons.unshift({
                level: 'danger',
                icon: 'moon',
                text: isFr ? 'Nuit aéronautique — VFR de jour interdit' : 'Aeronautical night — day VFR prohibited',
            });
        } else if (window && window.status === 'closing') {
            if (verdict === 'GO') verdict = 'CAUTION';
            reasons.push({
                level: 'caution',
                icon: 'sunset',
                text: isFr
                    ? `Fin de journée proche (${window.minutesLeft} min avant la nuit)`
                    : `Daylight ending soon (${window.minutesLeft} min before night)`,
            });
        }
    }

    const perf = getPerformanceData();
    if (perf) {
        const daResult = densityAltitude(perf.elevationFt, perf.qnh, perf.oat);
        if (daResult) {
            const evalDa = evaluateDensityAltitude(daResult.da);
            if (evalDa && evalDa.level !== 'ok') {
                if (verdict === 'GO') verdict = 'CAUTION';
                reasons.push({ level: evalDa.level, icon: 'thermometer-sun', text: evalDa.message });
            }
        }
    }

    const toResult = evaluateTakeoffPerformance(icao);
    if (toResult) {
        if (toResult.level === 'danger') {
            if (verdict !== 'NO-GO') verdict = 'NO-GO';
            reasons.push({ level: 'danger', icon: 'plane-takeoff', text: toResult.message });
        } else if (toResult.level === 'caution') {
            if (verdict === 'GO') verdict = 'CAUTION';
            reasons.push({ level: 'caution', icon: 'plane-takeoff', text: toResult.message });
        }
    }

    if (state._pressureTrend) {
        const evalPt = evaluatePressureTrend(state._pressureTrend);
        if (evalPt && evalPt.level !== 'ok') {
            if (verdict === 'GO') verdict = 'CAUTION';
            reasons.push({ level: evalPt.level, icon: evalPt.icon, text: evalPt.message });
        }
    }

    if (state._sigmets && state._sigmets.length > 0) {
        const sigAlerts = evaluateSigmetAirmet(state._sigmets);
        sigAlerts.forEach(a => {
            if (a.level === 'danger') {
                if (verdict !== 'NO-GO') verdict = 'NO-GO';
            } else if (verdict === 'GO') verdict = 'CAUTION';
            reasons.push({ level: a.level, icon: a.icon, text: a.text });
        });
    }

    if (state._freezingLevel != null) {
        const nuageStr = parsed.base?.nuage?.[0]?.val || '';
        const icing = evaluateIcingRisk(state._freezingLevel, nuageStr);
        if (icing && icing.level !== 'ok') {
            if (icing.level === 'danger') {
                if (verdict !== 'NO-GO') verdict = 'NO-GO';
            } else if (verdict === 'GO') verdict = 'CAUTION';
            reasons.push({ level: icing.level, icon: 'snowflake', text: icing.message });
        }
    }

    const windStr = parsed.base?.vent?.[0]?.val;
    const wind = windStr ? parseWindString(windStr) : null;
    if (wind && apt && apt.runways && wind.dir !== null) {

        const dec = getDeclinationForIcao(icao);
        const rwyData = selectBestRunway(apt.runways, wind, null, dec);
        if (rwyData.active) {

            const magWindDir = (((wind.dir - dec) % 360) + 360) % 360;
            const xw = Math.abs(wind.speed * Math.sin((magWindDir - rwyData.active.hdg) * Math.PI / 180));

            if (xw >= 12) {
                if (verdict === 'GO') verdict = 'CAUTION';
                reasons.push({
                    level: xw >= 15 ? 'danger' : 'caution',
                    icon: 'wind',
                    text: isFr
                        ? `Vent traversier ${Math.round(xw)} kt sur ${rwyData.active.name} — vérifiez les limites avion`
                        : `Crosswind ${Math.round(xw)} kt on ${rwyData.active.name} — check aircraft limits`,
                });
                if (xw >= 15 && verdict !== 'NO-GO') verdict = 'NO-GO';
            }
        }
    }

    const colors = {
        'GO': '#4ADE80',
        'CAUTION': '#F59E0B',
        'NO-GO': '#EF4444',
    };

    return { verdict, reasons, color: colors[verdict] || '#94A3B8', cat: catObj.cat };
}

let _trendIcao = null;

export async function refreshPressureTrend(icao) {
    if (!icao || icao === _trendIcao && state._pressureTrend) return;
    _trendIcao = icao;
    state._pressureTrend = null;
    const trend = await fetchPressureTrend(icao);
    if (trend && _trendIcao === icao) {
        state._pressureTrend = trend;

        renderGoNoGo();
    }
}

let _sigmetIcao = null;
let _sigmetCoords = null;

export async function refreshSigmet(lat, lon, icao) {
    if (lat == null || lon == null) return;
    const key = `${lat.toFixed(1)},${lon.toFixed(1)}`;
    if (icao === _sigmetIcao && _sigmetCoords === key && state._sigmets) return;
    _sigmetIcao = icao;
    _sigmetCoords = key;
    state._sigmets = null;
    const sigmets = await fetchSigmetAirmet(lat, lon);
    if (_sigmetIcao === icao) {
        state._sigmets = sigmets;
        // Notifie la carte régionale pour tracé des polygones SIGMET/AIRMET.
        document.dispatchEvent(new CustomEvent('sigmets-updated', { detail: sigmets }));
        renderGoNoGo();
    }
}

let _freezingIcao = null;

export async function refreshFreezingLevel(icao) {
    if (!icao || icao === _freezingIcao && state._freezingLevel != null) return;
    _freezingIcao = icao;
    state._freezingLevel = null;
    const fl = await fetchFreezingLevel(icao);
    if (fl && _freezingIcao === icao) {
        state._freezingLevel = fl.altFt;
        renderGoNoGo();
    }
}

export function renderGoNoGo() {
    const container = document.getElementById('go-nogo-banner');
    if (!container) return;

    const result = evaluateGoNoGo();
    const isFr = state.lang === 'fr';

    if (!result) {
        container.style.display = 'none';
        return;
    }

    const icons = {
        'GO': 'check-circle',
        'CAUTION': 'alert-triangle',
        'NO-GO': 'x-octagon',
    };

    const verdictLabels = {
        'GO': isFr ? 'GO — Vous pouvez voler' : 'GO — You can fly',
        'CAUTION': isFr ? 'PRUDENCE — Vol possible, soyez vigilant' : 'CAUTION — Flying possible, stay alert',
        'NO-GO': isFr ? 'NO-GO — Vol déconseillé/interdit' : 'NO-GO — Flight not recommended/prohibited',
    };

    let reasonsHtml = '';
    if (result.reasons.length > 0) {
        reasonsHtml = '<div class="go-nogo-reasons" style="margin-top:6px; display:flex; flex-direction:column; gap:4px; flex:1; min-height:0; overflow-y:auto;">';
        result.reasons.forEach(r => {
            const col = r.level === 'danger' ? '#FCA5A5' : '#FCD34D';
            const dot = r.level === 'danger' ? '#EF4444' : '#F59E0B';
            reasonsHtml += `<div class="go-nogo-reason" style="display:flex; align-items:flex-start; gap:6px; padding:5px 8px; border-radius:5px; font-size:11px; line-height:1.3; color:${col};">
                <span style="width:6px; height:6px; border-radius:50%; background:${dot}; flex-shrink:0; margin-top:4px;"></span>
                <span>${r.text}</span>
            </div>`;
        });
        reasonsHtml += '</div>';
    } else if (result.verdict === 'GO') {
        reasonsHtml = `<div style="margin-top:6px; padding:6px 8px; font-size:11px; color:rgba(74,222,128,0.9); display:flex; align-items:center; gap:6px;">
            <span style="width:6px; height:6px; border-radius:50%; background:#4ADE80; flex-shrink:0;"></span>
            ${isFr ? 'Tous les paramètres sont au vert.' : 'All parameters are green.'}
        </div>`;
    }

    container.innerHTML = `
        <div class="go-nogo-content" style="display:flex; flex-direction:column; height:100%;">
            <div class="go-nogo-verdict-block" style="display:flex; flex-direction:column; align-items:center; gap:4px; padding-top:12px; padding-bottom:8px;">
                <div class="go-nogo-icon" style="width:53px; height:53px; border-radius:50%; background:${result.color}22; border:3px solid ${result.color}; display:flex; align-items:center; justify-content:center;">
                    <i data-lucide="${icons[result.verdict]}" style="width:29px; height:29px; color:${result.color};"></i>
                </div>
                <div style="font-size:20px; font-weight:900; color:${result.color}; letter-spacing:1px; line-height:1;">${result.verdict}</div>
                <div style="font-size:9px; color:var(--text-muted); text-align:center; line-height:1.2;">${verdictLabels[result.verdict]}</div>
            </div>
            ${reasonsHtml}
            <button id="go-nogo-config" class="go-nogo-config-btn" title="${isFr ? 'Réglages des Minimums VFR' : 'VFR minima settings'}" style="background:none; border:none; cursor:pointer; padding:3px; border-radius:6px; color:var(--text-muted); opacity:0.6; transition:opacity 0.2s; display:flex; align-items:center; margin-left:auto; margin-top:auto; align-self:flex-end;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6">
                <i data-lucide="settings" style="width:15px; height:15px;"></i>
            </button>
        </div>
    `;
    container.style.background = result.color + '15';
    container.style.borderColor = result.color;
    container.style.borderLeftWidth = '5px';
    container.style.display = 'flex';
    if (window.lucide) window.lucide.createIcons({ root: container });

    container.querySelector('#go-nogo-config')?.addEventListener('click', openThresholdsModal);
}

function _formatAlertText(alert, isFr) {
    if (alert.category === 'phenomenon') return alert.title;
    let unit = '';
    if (alert.category === 'ceiling') unit = ' ft';
    else if (alert.category === 'visibility') unit = ' m';
    else if (alert.category === 'wind' || alert.category === 'gusts') unit = ' kt';
    return alert.value !== null ? `${alert.title}: ${alert.value}${unit}` : alert.title;
}
