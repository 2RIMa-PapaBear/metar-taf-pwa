/* ================================================================
 * WEATHER — Alertes météo : parsing, affichage, seuils
 * ================================================================ */

import { I18N, parseVisiToMeters, getCeiling, findActiveValueAtHour } from './core.js';
import { state } from './core.js';
import { parseWindString } from './engine.js';

const STORAGE_KEY = 'metar-alert-thresholds';

export const DEFAULT_THRESHOLDS = {
    ceiling: { warning: 1500, danger: 500, enabled: true },
    visibility: { warning: 5000, danger: 1500, enabled: true },
    wind: { warning: 15, danger: 25, enabled: true },
    gusts: { warning: 20, danger: 30, enabled: true },
    temperature: { warningHigh: 35, dangerHigh: 40, warningLow: -10, dangerLow: -20, enabled: true },
    qnh: { warningHigh: 1030, dangerHigh: 1040, warningLow: 990, dangerLow: 980, enabled: true }
};

export function getThresholds() {
    let th = JSON.parse(JSON.stringify(DEFAULT_THRESHOLDS)); 
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved && saved !== 'undefined') {
            const parsed = JSON.parse(saved);
            if (parsed && typeof parsed === 'object') {
                if (parsed.ceiling) th.ceiling = { ...th.ceiling, ...parsed.ceiling };
                if (parsed.visibility) th.visibility = { ...th.visibility, ...parsed.visibility };
                if (parsed.wind) th.wind = { ...th.wind, ...parsed.wind };
                if (parsed.gusts) th.gusts = { ...th.gusts, ...parsed.gusts };
                if (parsed.temperature) th.temperature = { ...th.temperature, ...parsed.temperature };
                if (parsed.qnh) th.qnh = { ...th.qnh, ...parsed.qnh };
            }
        }
    } catch (e) { console.warn('Thresholds load error:', e); }
    return th;
}

export function saveThresholds(thresholds) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(thresholds)); return true; } catch (e) { console.warn('Thresholds save error:', e); return false; }
}

function _lockBodyScroll() {
    const scrollY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.overflow = 'hidden';
    document.body.dataset.scrollY = String(scrollY);
}

function _unlockBodyScroll() {
    const scrollY = parseInt(document.body.dataset.scrollY || '0', 10);
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.overflow = '';
    window.scrollTo(0, scrollY);
    delete document.body.dataset.scrollY;
}

export function openThresholdsModal() {
    const tr = I18N[state.lang] || {};
    const th = getThresholds();
    
    const existing = document.getElementById('thresholds-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'thresholds-modal';
    modal.className = 'modal-overlay visible';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', tr.minimaTitle || "VFR Minima Settings");

    const title = tr.minimaTitle || "Paramètres des Minimums VFR";
    const lblCeil = tr.lblCeiling || "Plafond (ft)";
    const lblVisi = tr.lblVisi || "Visibilité (m)";
    const lblWind = tr.lblWindThreshold || "Vent (kt)";
    const lblGusts = tr.lblGusts || "Rafales (kt)";
    const lblTemp = tr.lblTemperature || "Température (°C)";
    const lblQnh = tr.lblQnhThreshold || "QNH (hPa)";
    const lblWarn = tr.lblWarning || "Préavis (Orange)";
    const lblDang = tr.lblDanger || "Danger (Rouge)";
    const lblHigh = tr.lblHigh || "Haut";
    const lblLow = tr.lblLow || "Bas";
    const btnSave = tr.btnSave || "Enregistrer";
    const btnReset = tr.btnReset || "Valeurs par défaut";

    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2 style="display:flex;align-items:center;gap:10px;"><i data-lucide="settings" class="icon-md"></i> ${title}</h2>
                <button class="btn-close-modal" id="btn-close-th" title="Fermer" aria-label="Fermer"><i data-lucide="x"></i></button>
            </div>
            <div class="modal-body">
                <div class="threshold-section">
                    <div class="threshold-header">
                        <label class="threshold-label" style="cursor:pointer; display:flex; align-items:center; gap:10px;">
                            <input type="checkbox" id="toggle-ceiling" ${th.ceiling.enabled ? 'checked' : ''}>
                            ${lblCeil}
                        </label>
                    </div>
                    <div class="threshold-inputs">
                        <label>${lblWarn} <input type="number" id="ceiling-warning" value="${th.ceiling.warning}"></label>
                        <label>${lblDang} <input type="number" id="ceiling-danger" value="${th.ceiling.danger}"></label>
                    </div>
                </div>
                <div class="threshold-section">
                    <div class="threshold-header">
                        <label class="threshold-label" style="cursor:pointer; display:flex; align-items:center; gap:10px;">
                            <input type="checkbox" id="toggle-visibility" ${th.visibility.enabled ? 'checked' : ''}>
                            ${lblVisi}
                        </label>
                    </div>
                    <div class="threshold-inputs">
                        <label>${lblWarn} <input type="number" id="visibility-warning" value="${th.visibility.warning}"></label>
                        <label>${lblDang} <input type="number" id="visibility-danger" value="${th.visibility.danger}"></label>
                    </div>
                </div>
                <div class="threshold-section">
                    <div class="threshold-header">
                        <label class="threshold-label" style="cursor:pointer; display:flex; align-items:center; gap:10px;">
                            <input type="checkbox" id="toggle-wind" ${th.wind.enabled ? 'checked' : ''}>
                            ${lblWind}
                        </label>
                    </div>
                    <div class="threshold-inputs">
                        <label>${lblWarn} <input type="number" id="wind-warning" value="${th.wind.warning}"></label>
                        <label>${lblDang} <input type="number" id="wind-danger" value="${th.wind.danger}"></label>
                    </div>
                </div>
                <div class="threshold-section">
                    <div class="threshold-header">
                        <label class="threshold-label" style="cursor:pointer; display:flex; align-items:center; gap:10px;">
                            <input type="checkbox" id="toggle-gusts" ${th.gusts.enabled ? 'checked' : ''}>
                            ${lblGusts}
                        </label>
                    </div>
                    <div class="threshold-inputs">
                        <label>${lblWarn} <input type="number" id="gusts-warning" value="${th.gusts.warning}"></label>
                        <label>${lblDang} <input type="number" id="gusts-danger" value="${th.gusts.danger}"></label>
                    </div>
                </div>
                <div class="threshold-section">
                    <div class="threshold-header">
                        <label class="threshold-label" style="cursor:pointer; display:flex; align-items:center; gap:10px;">
                            <input type="checkbox" id="toggle-temperature" ${th.temperature.enabled ? 'checked' : ''}>
                            ${lblTemp}
                        </label>
                    </div>
                    <div class="threshold-inputs threshold-inputs--quad">
                        <label>${lblWarn} ${lblLow} <input type="number" id="temp-warning-low" value="${th.temperature.warningLow}"></label>
                        <label>${lblDang} ${lblLow} <input type="number" id="temp-danger-low" value="${th.temperature.dangerLow}"></label>
                        <label>${lblWarn} ${lblHigh} <input type="number" id="temp-warning-high" value="${th.temperature.warningHigh}"></label>
                        <label>${lblDang} ${lblHigh} <input type="number" id="temp-danger-high" value="${th.temperature.dangerHigh}"></label>
                    </div>
                </div>
                <div class="threshold-section">
                    <div class="threshold-header">
                        <label class="threshold-label" style="cursor:pointer; display:flex; align-items:center; gap:10px;">
                            <input type="checkbox" id="toggle-qnh" ${th.qnh.enabled ? 'checked' : ''}>
                            ${lblQnh}
                        </label>
                    </div>
                    <div class="threshold-inputs threshold-inputs--quad">
                        <label>${lblWarn} ${lblLow} <input type="number" id="qnh-warning-low" value="${th.qnh.warningLow}"></label>
                        <label>${lblDang} ${lblLow} <input type="number" id="qnh-danger-low" value="${th.qnh.dangerLow}"></label>
                        <label>${lblWarn} ${lblHigh} <input type="number" id="qnh-warning-high" value="${th.qnh.warningHigh}"></label>
                        <label>${lblDang} ${lblHigh} <input type="number" id="qnh-danger-high" value="${th.qnh.dangerHigh}"></label>
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn-secondary" id="btn-reset-th">${btnReset}</button>
                <button class="btn-primary" id="btn-save-th">${btnSave}</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    if (window.lucide) window.lucide.createIcons({ root: modal });

    _lockBodyScroll();

    function closeModal() {
        modal.remove();
        _unlockBodyScroll();
    }

    document.getElementById('btn-close-th').addEventListener('click', closeModal);

    modal.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            closeModal();
        }
        if (e.key === 'Tab') {
            const focusable = modal.querySelectorAll('button, input[type="checkbox"], input[type="number"]');
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });
    
    document.getElementById('btn-reset-th').addEventListener('click', () => {
        saveThresholds(DEFAULT_THRESHOLDS);
        closeModal();
        openThresholdsModal(); 
    });

    document.getElementById('btn-save-th').addEventListener('click', () => {
        const newTh = {
            ...th,
            ceiling: {
                enabled: document.getElementById('toggle-ceiling').checked,
                warning: parseInt(document.getElementById('ceiling-warning').value, 10) || 1500,
                danger: parseInt(document.getElementById('ceiling-danger').value, 10) || 500
            },
            visibility: {
                enabled: document.getElementById('toggle-visibility').checked,
                warning: parseInt(document.getElementById('visibility-warning').value, 10) || 5000,
                danger: parseInt(document.getElementById('visibility-danger').value, 10) || 1500
            },
            wind: {
                enabled: document.getElementById('toggle-wind').checked,
                warning: parseInt(document.getElementById('wind-warning').value, 10) || 15,
                danger: parseInt(document.getElementById('wind-danger').value, 10) || 25
            },
            gusts: {
                enabled: document.getElementById('toggle-gusts').checked,
                warning: parseInt(document.getElementById('gusts-warning').value, 10) || 20,
                danger: parseInt(document.getElementById('gusts-danger').value, 10) || 30
            },
            temperature: {
                enabled: document.getElementById('toggle-temperature').checked,
                warningHigh: parseInt(document.getElementById('temp-warning-high').value, 10) || 35,
                dangerHigh: parseInt(document.getElementById('temp-danger-high').value, 10) || 40,
                warningLow: parseInt(document.getElementById('temp-warning-low').value, 10) || -10,
                dangerLow: parseInt(document.getElementById('temp-danger-low').value, 10) || -20
            },
            qnh: {
                enabled: document.getElementById('toggle-qnh').checked,
                warningHigh: parseInt(document.getElementById('qnh-warning-high').value, 10) || 1030,
                dangerHigh: parseInt(document.getElementById('qnh-danger-high').value, 10) || 1040,
                warningLow: parseInt(document.getElementById('qnh-warning-low').value, 10) || 990,
                dangerLow: parseInt(document.getElementById('qnh-danger-low').value, 10) || 980
            }
        };
        saveThresholds(newTh);
        closeModal();
        if (state.refreshCallback) state.refreshCallback();
    });
}

function _buildAlertsFromValues(v) {
    if (!v) return [];
    const th = getThresholds();
    const tr = I18N[state.lang] || {};
    const alerts = [];
    
    const txtPlafondCritique = tr.alertCeilingDang || 'Plafond critique';
    const txtPlafondBas = tr.alertCeilingWarn || 'Plafond bas';
    const txtVisiCritique = tr.alertVisiDang || 'Visibilité critique';
    const txtVisiBasse = tr.alertVisiWarn || 'Visibilité réduite';
    const txtVentCritique = tr.alertWindDang || 'Vent critique';
    const txtVentFort = tr.alertWindWarn || 'Vent fort';
    const txtRafalesCritiques = tr.alertGustDang || 'Rafales critiques';
    const txtRafalesFortes = tr.alertGustWarn || 'Rafales fortes';

    if (th.ceiling.enabled && v.ceiling !== null) {
        if (v.ceiling <= th.ceiling.danger) alerts.push({ category:'ceiling', level:'danger', icon:'arrow-down', title: txtPlafondCritique, value:v.ceiling });
        else if (v.ceiling <= th.ceiling.warning) alerts.push({ category:'ceiling', level:'warning', icon:'cloud', title: txtPlafondBas, value:v.ceiling });
    }
    
    if (th.visibility.enabled && v.visi !== null) {
        if (v.visi <= th.visibility.danger) alerts.push({ category:'visibility', level:'danger', icon:'eye-off', title: txtVisiCritique, value:v.visi });
        else if (v.visi <= th.visibility.warning) alerts.push({ category:'visibility', level:'warning', icon:'eye-off', title: txtVisiBasse, value:v.visi });
    }
    
    if (th.wind.enabled && v.windSpd !== null) {
        if (v.windSpd >= th.wind.danger) alerts.push({ category:'wind', level:'danger', icon:'wind', title: txtVentCritique, value:v.windSpd });
        else if (v.windSpd >= th.wind.warning) alerts.push({ category:'wind', level:'warning', icon:'wind', title: txtVentFort, value:v.windSpd });
    }
    
    if (th.gusts.enabled && v.windGust !== null) {
        if (v.windGust >= th.gusts.danger) alerts.push({ category:'gusts', level:'danger', icon:'wind', title: txtRafalesCritiques, value:v.windGust });
        else if (v.windGust >= th.gusts.warning) alerts.push({ category:'gusts', level:'warning', icon:'wind', title: txtRafalesFortes, value:v.windGust });
    }
    
    const txtOrage = tr.alertThunderstorm || 'Orage';
    const txtCb = tr.alertCumulonimbus || 'Cumulonimbus';
    const txtTcu = tr.alertToweringCu || 'Towering Cumulus';
    const txtGrele = tr.alertHail || 'Grêle';
    const txtGivrage = tr.alertIcing || 'Givrage';

    if (v.ts) alerts.push({ category:'phenomenon', level:'danger', icon:'cloud-lightning', title: txtOrage, value:'TS' });
    if (v.cb) alerts.push({ category:'phenomenon', level:'warning', icon:'cloud-lightning', title: txtCb, value:'CB' });
    if (v.tcu) alerts.push({ category:'phenomenon', level:'warning', icon:'cloud', title: txtTcu, value:'TCU' });
    if (v.gr) alerts.push({ category:'phenomenon', level:'danger', icon:'cloud-snow', title: txtGrele, value:'GR' });
    if (v.fz) alerts.push({ category:'phenomenon', level:'warning', icon:'snowflake', title: txtGivrage, value:'FZ' });
    
    return alerts;
}

export function analyzeWeatherAlerts(input) {
    let text = typeof input === 'string' ? input.toUpperCase() : '';
    if (!text) return [];

    const v = { windSpd: null, windGust: null, visi: null, ceiling: null, cb: false, tcu: false, ts: false, gr: false, fz: false };
    
    const windMatch = text.match(/\b(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT\b/);
    if (windMatch) { v.windSpd = parseInt(windMatch[2]); if (windMatch[3]) v.windGust = parseInt(windMatch[3]); }
    
    const visiMatch = text.match(/KT(?:\s+\d{3}V\d{3})?\s+(\d{4})\b/);
    if (visiMatch) v.visi = parseInt(visiMatch[1]) === 9999 ? 10000 : parseInt(visiMatch[1]);
    else { const visiSM = text.match(/\b(\d+(?:\/\d+)?)SM\b/); if (visiSM) v.visi = Math.round((visiSM[1].includes('/') ? parseFloat(visiSM[1].split('/')[0]) / parseFloat(visiSM[1].split('/')[1]) : parseFloat(visiSM[1])) * 1609); }
    
    const cloudMatches = [...text.matchAll(/\b(FEW|SCT|BKN|OVC)(\d{3})/g)];
    let lowestCeiling = null;
    cloudMatches.forEach(m => {
        const type = m[1], altFt = parseInt(m[2]) * 100;
        if ((type === 'BKN' || type === 'OVC') && (lowestCeiling === null || altFt < lowestCeiling)) lowestCeiling = altFt;
    });
    if (lowestCeiling !== null) v.ceiling = lowestCeiling;
    
    const vvMatch = text.match(/\bVV(\d{3})\b/);
    if (vvMatch) { const vvFt = parseInt(vvMatch[1]) * 100; if (v.ceiling === null || vvFt < v.ceiling) v.ceiling = vvFt; }
    
    const afterTimeMatch = text.match(/\d{6}Z\s+(.*)/);
    const weatherText = afterTimeMatch ? afterTimeMatch[1] : text;

    if (/TCU\b/.test(weatherText)) v.tcu = true;
    if (/CB\b/.test(weatherText)) v.cb = true;

    if (/\bTS\b|\b\+?TSRA\b|\bVCTS\b/.test(weatherText)) v.ts = true;
    if (/\bGR\b/.test(weatherText)) v.gr = true;
    if (/\bFZ/.test(weatherText)) v.fz = true;
    
    return _buildAlertsFromValues(v);
}

export function analyzeForecastAlerts(parsedData, targetHour) {
    if (!parsedData || targetHour == null) return [];
    
    const getBase = (arr) => findActiveValueAtHour(arr, targetHour) || '';

    const base = parsedData.base || {};
    let activeVent = getBase(base.vent);
    let activeVisi = getBase(base.visi);
    let activeNuage = getBase(base.nuage);
    let activeTemps = getBase(base.temps);

    if (parsedData.tempo && Array.isArray(parsedData.tempo)) {
        for (let i = parsedData.tempo.length - 1; i >= 0; i--) {
            const t = parsedData.tempo[i];
            if (targetHour >= t.start && targetHour < t.end) {
                if (t.vent) activeVent = t.vent;
                if (t.visi) activeVisi = t.visi;
                if (t.nuage) activeNuage = t.nuage;
                if (t.temps) activeTemps = t.temps;
            }
        }
    }

    const v = { windSpd: null, windGust: null, visi: null, ceiling: null, cb: false, tcu: false, ts: false, gr: false, fz: false };

    if (activeVent) {
        const wind = parseWindString(activeVent);
        if (wind) { v.windSpd = wind.speed; v.windGust = wind.gust; }
    }

    if (activeVisi) {
        v.visi = parseVisiToMeters(activeVisi);
    }

    if (activeNuage) {
        if (!activeNuage.includes('CAVOK') && !activeNuage.includes('NSC') && !activeNuage.includes('SKC') && !activeNuage.includes('NCD')) {
            v.ceiling = getCeiling(activeNuage) * 100;
            if (activeNuage.includes('CB')) v.cb = true;
            if (activeNuage.includes('TCU')) v.tcu = true;
        }
    }

    if (activeTemps) {
        const tLow = activeTemps.toLowerCase();
        if (tLow.includes('orage') || tLow.includes('thunder')) v.ts = true;
        if (tLow.includes('grêle') || tLow.includes('grésil') || tLow.includes('hail') || tLow.includes('pellets')) v.gr = true;
        if (tLow.includes('congelant') || tLow.includes('verglaçant') || tLow.includes('freezing')) v.fz = true;
    }

    return _buildAlertsFromValues(v);
}

export function displayWeatherAlerts(rawText, parsedData = null, targetHour = null, containerId = 'weather-alerts-panel') {
    const container = document.getElementById(containerId);
    if (!container) return;

    const tr = I18N[state.lang] || {};
    const titleAlerts = tr.alertsTitle || (state.lang === 'fr' ? 'ALERTES MINIMA VFR' : 'VFR MINIMA ALERTS');
    const txtConfig = tr.configThresholds || (state.lang === 'fr' ? 'Configurer' : 'Configure');
    const txtNoAlert = tr.noAlerts || "<i data-lucide='check-circle' class='icon-sm'></i> Conditions VFR OK";

    let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <div class="dash-title" style="margin:0;">${titleAlerts}</div>
        <button id="btn-config-alerts" style="background:none;border:none;cursor:pointer;color:var(--text-muted);padding:2px;opacity:0.8;transition:all 0.2s;" title="${txtConfig}" aria-label="${txtConfig}">
            <i data-lucide="settings-2" class="icon-sm" style="margin:0;"></i>
        </button>
    </div>`;

    if (!rawText || !parsedData) {
        html += `<div class="dash-alerts-ok" style="background:transparent; border:1px dashed rgba(255,255,255,0.1); color:rgba(255,255,255,0.4);">${txtNoAlert.replace('OK', '---')}</div>`;
        container.innerHTML = html;
        if (window.lucide) window.lucide.createIcons({ root: container });
        const btn = document.getElementById('btn-config-alerts');
        if (btn) btn.addEventListener('click', openThresholdsModal);
        return;
    }

    let alerts = [];
    if (parsedData.isMetar) alerts = analyzeWeatherAlerts(rawText);
    else alerts = analyzeForecastAlerts(parsedData, targetHour);

    if (alerts.length === 0) {
        html += `<div class="dash-alerts-ok">${txtNoAlert}</div>`;
    } else {
        html += `<div style="max-height: 250px; overflow-y: auto; overflow-x: hidden; padding-right: 4px; scrollbar-width: thin;">`;
        alerts.forEach(alert => {
            const lvl = alert.level === 'danger' ? 'danger' : 'warning';
            let shortText = alert.title;
            if (alert.value !== null && alert.value !== undefined && alert.category !== 'phenomenon') {
                shortText = `${alert.title.split(' ')[0]} ${alert.value}${alert.category === 'ceiling' ? ' ft' : (alert.category === 'visibility' ? ' m' : (alert.category === 'wind' || alert.category === 'gusts' ? ' kt' : ''))}`;
            }
            html += `<div class="dash-alert-row ${lvl}">
                <i data-lucide="${alert.icon}" stroke-width="2.5" class="alert-emoji"></i>
                <span class="alert-label">${shortText}</span>
            </div>`;
        });
        html += `</div>`;
    }

    container.innerHTML = html;
    if (window.lucide) window.lucide.createIcons({ root: container });
    
    const btn = document.getElementById('btn-config-alerts');
    if (btn) btn.addEventListener('click', openThresholdsModal);
}