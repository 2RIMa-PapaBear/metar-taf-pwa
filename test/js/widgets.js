// Widgets données décryptées : Vent / Visi+Plafond / T°+Td+givrage / QNH.
//
// Présente en lecture rapide les valeurs clés du METAR (ou de l'heure cible d'un TAF).
// Dépendances : parseWindString (engine.js), parseVisiToMeters/getCeiling/findActiveValueAtHour
// (core.js), CAT_COLORS (core.js), evaluateIcingRisk/fetchFreezingLevel (freezing-level.js).
// IMPORTANT : aucun import depuis ui-module.js (évite le cycle d'import).

import { state, I18N, CAT_COLORS, parseVisiToMeters, getCeiling, findActiveValueAtHour } from './core.js';
import { parseWindString } from './engine.js';
import { evaluateIcingRisk, fetchFreezingLevel } from './freezing-level.js';
import { evaluateCarbIcing } from './carb-icing.js';

function _tr() { return I18N[state.lang]; }

function _escAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }

export function showDecryptedWidgets(show) {
    const el = document.getElementById('decrypted-widgets');
    if (!el) return;
    if (show) { el.classList.add('visible'); el.hidden = false; }
    else { el.classList.remove('visible'); el.hidden = true; }
}

function _emptyWidget(id, iconName, titleText) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = `
        <i data-lucide="${iconName}" class="widget-watermark"></i>
        <div class="widget-title"><i data-lucide="${iconName}" class="widget-title-icon"></i>${titleText}</div>
        <div class="widget-body"><span class="widget-empty">--</span></div>`;
    if (window.lucide) window.lucide.createIcons({ root: el });
}

function _parseTempDew(tempStr) {
    if (!tempStr) return null;
    const m = tempStr.match(/(-?\d+)\s*°C\s*\/\s*(-?\d+)\s*°C/);
    if (!m) return null;
    const temp = parseInt(m[1], 10), dew = parseInt(m[2], 10);
    if (isNaN(temp) || isNaN(dew)) return null;
    return { temp, dew, spread: temp - dew };
}

function _parseQnh(qnhStr) {
    if (!qnhStr) return null;
    const m = qnhStr.match(/(\d{3,4})\s*hPa(?:\s*\((\d+\.\d+)\s*inHg\))?/);
    if (!m) return null;
    const hpa = parseInt(m[1], 10);
    if (isNaN(hpa)) return null;
    return { hpa, inhg: m[2] || null };
}

function _windSpeedColor(speed) {
    if (speed == null) return 'var(--text-color)';
    if (speed < 6) return 'var(--wind-calm, #94A3B8)';
    if (speed < 12) return '#4ADE80';
    if (speed < 20) return '#FBBF24';
    if (speed < 28) return '#F97316';
    return '#EF4444';
}

const ARROW_SVG = `<svg class="widget-arrow-svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>`;

function _renderWindWidget(windStr) {
    const tr = _tr();
    const el = document.getElementById('widget-wind');
    if (!el) return;
    if (!windStr) { _emptyWidget('widget-wind', 'wind', tr.lblWidgetWind); return; }
    const w = parseWindString(windStr);
    if (!w || (w.speed == null && !w.variable)) { _emptyWidget('widget-wind', 'wind', tr.lblWidgetWind); return; }
    const isCalm = w.speed === 0 && !w.variable;
    const dirLabel = w.variable ? tr.lblWidgetVariable : (w.dir != null ? `${w.dir}°` : '--');
    const speedColor = _windSpeedColor(w.speed);
    let subHtml = '';
    if (w.gust != null && w.gust > 0) subHtml += `<div class="widget-row"><span class="widget-label">${tr.lblWidgetGust}</span><span class="widget-data" style="color:#F97316;">${w.gust} KT</span></div>`;
    if (w.varFrom != null && w.varTo != null) subHtml += `<div class="widget-row"><span class="widget-label">${tr.lblWidgetVariable}</span><span class="widget-data">${w.varFrom}°–${w.varTo}°</span></div>`;
    // +180° : la flèche montre le flux du vent (queue à l'origine, pointe vers
    // où il souffle), même convention que la rose des vents (js/engine.js).
    const arrowHtml = (!w.variable && w.dir != null) ? `<span class="widget-arrow" style="transform: rotate(${(w.dir + 180) % 360}deg); color:${speedColor};">${ARROW_SVG}</span>` : '';
    const valueHtml = isCalm ? `<div class="widget-value">${tr.lblWidgetCalm}</div>` : `<div class="widget-value" style="color:${speedColor};">${w.speed ?? '--'}<span class="widget-unit">KT</span></div>`;
    el.innerHTML = `<i data-lucide="wind" class="widget-watermark"></i><div class="widget-title"><i data-lucide="wind" class="widget-title-icon"></i>${tr.lblWidgetWind}</div><div class="widget-body"><div class="widget-row" style="justify-content:space-between;"><div style="display:flex; flex-direction:column;">${valueHtml}<span class="widget-sub">${dirLabel}</span></div>${arrowHtml}</div>${subHtml}</div>`;
    if (window.lucide) window.lucide.createIcons({ root: el });
}

function _renderVisiWidget(visiStr, nuageStr) {
    const tr = _tr();
    const el = document.getElementById('widget-visi');
    if (!el) return;
    const visiM = visiStr ? parseVisiToMeters(visiStr) : 0;
    const ceilHund = nuageStr ? getCeiling(nuageStr) : 999;
    const ceilFt = ceilHund * 100;
    const ceilUnlimited = ceilHund >= 999;
    if (!visiStr && !nuageStr) { _emptyWidget('widget-visi', 'eye', tr.lblWidgetVisi); return; }
    const visiLabel = visiStr ? (visiM >= 10000 ? '> 10 km' : `${(visiM / 1000).toFixed(1)} km`) : '--';
    const visiColor = visiM < 4800 ? CAT_COLORS.IFR : (visiM <= 8000 ? CAT_COLORS.MVFR : CAT_COLORS.VFR);
    const ceilLabel = nuageStr ? (ceilUnlimited ? tr.lblWidgetUnlimited : `${ceilFt} ft`) : '--';
    const ceilColor = !ceilUnlimited && ceilFt < 1000 ? CAT_COLORS.LIFR : (!ceilUnlimited && ceilFt <= 3000 ? CAT_COLORS.MVFR : CAT_COLORS.VFR);
    el.innerHTML = `<i data-lucide="eye" class="widget-watermark"></i><div class="widget-title"><i data-lucide="eye" class="widget-title-icon"></i>${tr.lblWidgetVisi}</div><div class="widget-body"><div class="widget-value" style="color:${visiColor};">${visiLabel}</div><div class="widget-row"><span class="widget-label">${tr.lblWidgetCeiling}</span><span class="widget-data" style="color:${ceilColor};">${ceilLabel}</span></div></div>`;
    if (window.lucide) window.lucide.createIcons({ root: el });
}

async function _renderTempWidget(tempStr, nuageStr, icao) {
    const tr = _tr();
    const el = document.getElementById('widget-temp');
    if (!el) return;
    const td = _parseTempDew(tempStr);
    if (!td) { _emptyWidget('widget-temp', 'thermometer', tr.lblWidgetTemp); return; }
    const spreadColor = td.spread <= 2 ? '#FBBF24' : 'var(--text-muted)';
    const carbLabelTip = tr.tipCarbChart.replace('{t}', td.temp).replace('{td}', td.dew).replace('{s}', td.spread);
    el.innerHTML = `<i data-lucide="thermometer" class="widget-watermark"></i><div class="widget-title"><i data-lucide="thermometer" class="widget-title-icon"></i>${tr.lblWidgetTemp}</div><div class="widget-body"><div class="widget-row widget-inline"><span class="widget-ig"><span class="widget-label">${tr.lblTempShort} :</span><span class="widget-data">${td.temp}°C</span></span><span class="widget-ig"><span class="widget-label">${tr.lblDewShort} :</span><span class="widget-data">${td.dew}°C</span></span></div><div class="widget-row widget-inline"><span class="widget-ig"><span class="widget-label">${tr.lblWidgetSpread} :</span><span class="widget-data" style="color:${spreadColor};">${td.spread}°C</span></span></div><div class="widget-row widget-stack"><span class="widget-label" title="${_escAttr(tr.tipIcingCell)}">${tr.lblWidgetIcingCell}</span><span id="widget-icing-slot"><span class="widget-sub">…</span></span></div><div class="widget-row widget-stack"><span class="widget-label" title="${_escAttr(carbLabelTip)}">${tr.lblWidgetIcingCarb}</span><span id="widget-carb-slot"><span class="widget-sub">…</span></span></div></div>`;
    if (window.lucide) window.lucide.createIcons({ root: el });
    _renderCarbIcingPill(td);
    try {
        const fl = icao ? await fetchFreezingLevel(icao) : null;
        const flFt = fl?.altFt ?? state._freezingLevel ?? null;
        const tdC = (typeof td.dew === 'number') ? td.dew : (fl?.dewPointC ?? null);
        const risk = evaluateIcingRisk(flFt, nuageStr, td.temp, tdC);
        _renderIcingPill(risk);
    } catch { _renderIcingPill(null); }
}

function _renderIcingPill(risk) {
    const slot = document.getElementById('widget-icing-slot');
    if (!slot) return;
    const tr = _tr();
    if (!risk || risk.level === 'ok') {
        slot.innerHTML = `<span class="widget-pill icing-ok" title="${_escAttr(tr.tipIcingCell)}">${tr.lblIcingOk}</span>`;
        return;
    }
    const cls = risk.level === 'danger' ? 'icing-danger' : 'icing-caution';
    const msg = risk.message || '';
    slot.innerHTML = `<span class="widget-pill ${cls}" title="${_escAttr(msg)}">${msg}</span>`;
}

// Givrage carburateur : abaque T / Td (js/carb-icing.js) + estimation de la
// T° carburateur (OAT −20 à −35 °C par vaporisation dans le venturi).
function _renderCarbIcingPill(td) {
    const slot = document.getElementById('widget-carb-slot');
    if (!slot) return;
    const tr = _tr();
    const r = evaluateCarbIcing(td.temp, td.dew);
    if (!r) {
        slot.innerHTML = `<span class="widget-sub">--</span>`;
        return;
    }
    const ZONES = {
        serious: { cls: 'icing-danger',  lbl: tr.lblCarbSerious },
        descent: { cls: 'icing-descent', lbl: tr.lblCarbDescent },
        light:   { cls: 'icing-caution', lbl: tr.lblCarbLight },
        none:    { cls: 'icing-ok',      lbl: tr.lblCarbNone },
    };
    const z = ZONES[r.level];
    const tip = tr.tipCarbChart.replace('{t}', td.temp).replace('{td}', td.dew).replace('{s}', r.spread)
        + ' — ' + tr.tipCarbTemp.replace('{min}', Math.round(r.carbMin)).replace('{max}', Math.round(r.carbMax));
    slot.innerHTML = `<span class="widget-pill ${z.cls}" title="${_escAttr(tip)}">${z.lbl}</span>`;
}

function _renderQnhWidget(qnhStr) {
    const tr = _tr();
    const el = document.getElementById('widget-qnh');
    if (!el) return;
    const q = _parseQnh(qnhStr);
    if (!q) { _emptyWidget('widget-qnh', 'gauge', tr.lblWidgetQnh); return; }
    const diff = q.hpa - 1013;
    let color = 'var(--text-color)';
    if (Math.abs(diff) >= 15) color = '#FBBF24';
    const subHtml = q.inhg ? `<div class="widget-row"><span class="widget-label">inHg</span><span class="widget-data">${q.inhg}</span></div>` : '';
    el.innerHTML = `<i data-lucide="gauge" class="widget-watermark"></i><div class="widget-title"><i data-lucide="gauge" class="widget-title-icon"></i>${tr.lblWidgetQnh}</div><div class="widget-body"><div class="widget-value" style="color:${color};">${q.hpa}<span class="widget-unit">hPa</span></div>${subHtml}</div>`;
    if (window.lucide) window.lucide.createIcons({ root: el });
}

export function updateDecryptedWidgets(res, targetH = null) {
    if (!res || !res.base) { showDecryptedWidgets(false); return; }
    showDecryptedWidgets(true);
    const windStr  = res.isMetar ? res.base.vent?.[0]?.val  : findActiveValueAtHour(res.base.vent,  targetH);
    const visiStr  = res.isMetar ? res.base.visi?.[0]?.val  : findActiveValueAtHour(res.base.visi,  targetH);
    const nuageStr = res.isMetar ? res.base.nuage?.[0]?.val : findActiveValueAtHour(res.base.nuage, targetH);
    const tempStr  = res.isMetar ? res.base.temp?.[0]?.val  : findActiveValueAtHour(res.base.temp,  targetH);
    const qnhStr   = res.isMetar ? res.base.qnh?.[0]?.val   : findActiveValueAtHour(res.base.qnh,   targetH);
    const icao = state.requestedIcao || res.code;
    _renderWindWidget(windStr);
    _renderVisiWidget(visiStr, nuageStr);
    _renderQnhWidget(qnhStr);
    _renderTempWidget(tempStr, nuageStr, icao);
}
