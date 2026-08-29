/* ================================================================
 * ENGINE — Moteur de rendu : parser, renderer, soleil, rose des vents
 * VERSION ULTIME : Scrubber, Multiligne, Ferris Wheel, No Time Label
 * ================================================================ */

import { I18N, PALETTE, UNIFIED_RED, REGEX_BLOCKS_PATTERN, sunCacheGet, sunCacheSet } from './core.js';
import { state } from './core.js';
import { parseVisiToMeters, getCeiling, getFlightCategory, getWeatherIcon, inferStartYear, traduireCode, findActiveValueAtHour, surfaceLabel, SOFT_SURFACES } from './core.js';
import { getDeclinationForIcao } from './magvar.js';
import { siaRunwayFor, siaSurfaceCode } from './sia-data.js';

/**
 * Couleur de la flèche du vent, basée UNIQUEMENT sur la vitesse.
 * Cohérent avec les seuils des variables CSS --wind-* et --wind-glow.
 * (Avant : on passait la chaîne vent à calculateFlightCategoryRobust comme "visibilité",
 *  ce qui renvoyait systématiquement VFR et rendait la flèche verte hors rafales >30kt.)
 */
function getWindColorBySpeed(speed) {
    if (speed == null) return '#94A3B8'; // --wind-calm
    if (speed < 6)  return '#94A3B8';    // --wind-calm
    if (speed < 12) return '#4ADE80';    // --wind-light
    if (speed < 20) return '#FBBF24';    // --wind-moderate
    if (speed < 28) return '#F97316';    // --wind-strong
    return '#EF4444';                    // --wind-dangerous
}

function getUniqueId(prefix = 'wind') { return `${prefix}-${Math.random().toString(36).substring(7)}`; }

function _parseVent(seg) {
    const mV = seg.match(/((?:\d{3}|VRB)\d{2,3}(?:G\d{2,3})?KT)/); if (!mV) return '';
    let base = mV[0].trim().replace(/^(\d{3}|VRB)(\d{2,3}(?:G\d{2,3})?KT)/, (m, dir, spd) => (dir === 'VRB' ? 'VRB' : dir + '°') + ' ' + spd);
    // Variation de direction METAR : "170V250" suit immédiatement le groupe vent.
    // On la réinjecte pour que parseWindString et la rose des vents puissent la représenter.
    const mVar = seg.match(/(?:\d{3}|VRB)\d{2,3}(?:G\d{2,3})?KT\s?(\d{3})V(\d{3})/);
    if (mVar) base += ` ${mVar[1]}V${mVar[2]}`;
    return base;
}

function _parseVisi(seg) {
    const mVi = seg.match(/\s(\d{4}|[PM]?\d+SM|[PM]?\d+\s\d+\/\d+SM|[PM]?\d+\/\d+SM)\s/); if (!mVi) return '';
    let valVisi = mVi[1]; const visiM = parseVisiToMeters(valVisi);
    if (valVisi === '9999') valVisi = '> 10 km'; else if (/^\d{4}$/.test(valVisi)) valVisi += ' m'; else if (valVisi.includes('SM')) { const clean = valVisi.replace(/^P/, '> ').replace(/^M/, '< ').replace('SM', ' SM'); valVisi = `${clean} (${(visiM / 1000).toFixed(1)} km)`; }
    return valVisi;
}

const RE_CLOUD = /((?:FEW|SCT|BKN|OVC|VV|\/{3})(?:\d{3}|\/{3})?(?:CB|TCU|\/{3})?|NSC|NCD|CAVOK)/g;
function _parseNuage(seg) {
    const mN = [...seg.matchAll(new RegExp(RE_CLOUD.source, 'g'))];
    let valNuage = mN.map(m => {
        const s = m[0];
        if (['CAVOK','NSC','NCD'].includes(s)) return s;
        const tMatch = s.match(/FEW|SCT|BKN|OVC|VV|\/{3}/);
        const aMatch = s.match(/\d{3}/);
        const cMatch = s.match(/CB|TCU/);
        
        const type = tMatch ? tMatch[0] : '';
        const alt = aMatch ? parseInt(aMatch[0], 10) * 100 + 'ft' : '';
        const cb = cMatch ? cMatch[0] : '';
        
        if (type === '///' && !alt) return cb;
        if (type === '///') return `/// ${alt} ${cb}`.trim();
        return `${type} ${alt} ${cb}`.trim();
    }).filter(Boolean).join(' | ');
    if (seg.includes('CAVOK')) valNuage = 'CAVOK';
    return valNuage;
}

function _parsePhenomenes(seg, ignoreList) {
    const tr = I18N[state.lang], phenomenes = [];
    seg.split(/\s+/).forEach(tok => {
        if (ignoreList.some(i => tok.includes(i)) || /^(FM|TL|AT)\d{4}/.test(tok) || /^M?\d{2}\/M?\d{2}$/.test(tok) || /^Q\d{4}$/.test(tok) || /^A\d{4}$/.test(tok) || (/^\d/.test(tok) && !tok.includes('/')) || /^(BKN|OVC|SCT|FEW|VV)/.test(tok)) return;
        if (Object.keys(tr.dicoMeteo).some(k => tok.includes(k))) phenomenes.push(tok);
    });
    return traduireCode(phenomenes.join(' '));
}

export function analyserMETAR(rawText) {
    let metar = rawText.replace(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?(?:Z)?\s*/i, '');
    metar = metar.replace(/\s+/g, ' ').trim();
    if (metar.startsWith('METAR ')) metar = metar.substring(6).trim();
    if (metar.startsWith('SPECI ')) metar = metar.substring(6).trim();
    
    const segments = metar.replace(/(TEMPO|BECMG|NOSIG)/g, '||$1').split('||').filter(s => s.trim());
    const baseSeg = segments[0], mots = baseSeg.split(' '), codeOACI = mots[0].length === 4 ? mots[0] : '';
    const tr = I18N[state.lang], timeMatch = baseSeg.match(/\b(\d{2})(\d{2})(\d{2})Z\b/);
    
    let obsStartH = 12, validStr = '', startYear = new Date().getUTCFullYear(), startMonth = new Date().getUTCMonth() + 1, startDay = new Date().getUTCDate();
    if (timeMatch) {
        const d1 = parseInt(timeMatch[1]), h1 = parseInt(timeMatch[2]), m1 = parseInt(timeMatch[3]);
        obsStartH = h1 + m1 / 60.0; startMonth = new Date().getUTCMonth() + 1; startYear = inferStartYear(d1, startMonth); startDay = d1;
        const obsDate = new Date(Date.UTC(startYear, startMonth - 1, d1, h1, m1, 0));
        validStr = `${tr.lblObservation} ${String(obsDate.getUTCDate()).padStart(2, '0')}/${String(obsDate.getUTCMonth() + 1).padStart(2, '0')} ${tr.validAt} ${String(obsDate.getUTCHours()).padStart(2, '0')}:${String(obsDate.getUTCMinutes()).padStart(2, '0')} UTC`;
    }
    
    let valTemp = ''; const mTemp = baseSeg.match(/\b(M?\d{2})\/(M?\d{2})\b/); if (mTemp) valTemp = `${parseInt(mTemp[1].replace('M', '-'), 10)}°C / ${parseInt(mTemp[2].replace('M', '-'), 10)}°C`;
    let valQnh = ''; const mQnh = baseSeg.match(/\bQ(\d{4})\b/);
    if (mQnh) valQnh = `${parseInt(mQnh[1], 10)} hPa`; else { const mA = baseSeg.match(/\bA(\d{4})\b/); if (mA) { const inHg = parseInt(mA[1], 10) / 100; valQnh = `${Math.round(inHg * 33.8639)} hPa (${inHg.toFixed(2)} inHg)`; } }
    const baseSegPadded = ' ' + baseSeg + ' ';
    const valVent = _parseVent(baseSegPadded); let valVisi = _parseVisi(baseSegPadded); let valNuage = _parseNuage(baseSeg);
    if (baseSeg.includes('CAVOK')) { valNuage = 'CAVOK'; if (!valVisi) valVisi = '> 10 km'; }
    const valTempsTrad = _parsePhenomenes(baseSeg, ['METAR','SPECI','AUTO','KT','CAVOK','NCD','NOSIG','RMK','BECMG','TEMPO','SM']);
    const endH = obsStartH + 2; const baseLayer = { start: obsStartH, end: endH, becmgEnd: endH, type: 'BASE', prob: '', color: PALETTE[0], _lvl: 0 };
    const processedData = { temp: [{ ...baseLayer, val: valTemp }], qnh: [{ ...baseLayer, val: valQnh }], vent: [{ ...baseLayer, val: valVent }], visi: [{ ...baseLayer, val: valVisi }], temps: [{ ...baseLayer, val: valTempsTrad }], nuage: [{ ...baseLayer, val: valNuage }], soleil: [] };
    const tempoLayers = []; let paletteCounter = 0;
    
    segments.slice(1).forEach(seg => {
        if (seg.includes('NOSIG')) return;
        const isTempo = seg.includes('TEMPO'); if (!isTempo) paletteCounter++;
        const color = isTempo ? UNIFIED_RED : PALETTE[paletteCounter % PALETTE.length];
        const tVent = _parseVent(' ' + seg + ' '), tVisi = _parseVisi(' ' + seg + ' '), tNuage = _parseNuage(seg), tTemps = _parsePhenomenes(seg, ['METAR','SPECI','AUTO','KT','CAVOK','NCD','NOSIG','RMK','BECMG','TEMPO','SM']);
        let blockStart = obsStartH, blockEnd = endH;
        const mFm = seg.match(/FM(\d{2})(\d{2})/), mTl = seg.match(/TL(\d{2})(\d{2})/), mAt = seg.match(/AT(\d{2})(\d{2})/);
        if (mFm) { blockStart = parseInt(mFm[1], 10) + parseInt(mFm[2], 10) / 60.0; if (blockStart < obsStartH - 12) blockStart += 24; }
        if (mTl) { blockEnd = parseInt(mTl[1], 10) + parseInt(mTl[2], 10) / 60.0; if (blockEnd < obsStartH - 12) blockEnd += 24; }
        if (mAt) { blockStart = parseInt(mAt[1], 10) + parseInt(mAt[2], 10) / 60.0; if (blockStart < obsStartH - 12) blockStart += 24; }
        if (!mFm && !mTl && !mAt && !isTempo) blockStart = obsStartH + 1;
        const block = { start: blockStart, end: blockEnd, becmgEnd: blockEnd, type: isTempo ? 'TEMPO' : 'BECMG', prob: '', color, _lvl: 0 };
        if (isTempo) tempoLayers.push({ ...block, vent: tVent, visi: tVisi, temps: tTemps, nuage: tNuage });
        else { if (tVent) processedData.vent.push({ ...block, val: tVent }); if (tVisi) processedData.visi.push({ ...block, val: tVisi }); if (tTemps) processedData.temps.push({ ...block, val: tTemps }); if (tNuage) processedData.nuage.push({ ...block, val: tNuage }); }
    });
    return { isMetar: true, code: codeOACI, validity: validStr, flightCat: getFlightCategory(parseVisiToMeters(valVisi), getCeiling(baseSeg)), weatherIcon: getWeatherIcon(valNuage, valTempsTrad), startH: obsStartH - 0.5, endH: endH + 0.5, base: processedData, tempo: tempoLayers, tafTemps: [], startYear, startMonth, startDay };
}

export function analyserTAF(rawText) {
    let taf = rawText.replace(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?(?:Z)?\s*/i, '');
    taf = taf.replace(/\s+/g, ' ').trim(); if (!taf) return null;
    taf = taf.replace(/^(TAF\s+|AMD\s+|COR\s+)+/g, '').trim();

    const mots = taf.split(' '), codeOACI = mots[0].length === 4 ? mots[0] : '', tr = I18N[state.lang];
    const mValid = taf.match(/\s(\d{2})(\d{2})\/(\d{2})(\d{2})/); 
    
    let globalStartH = 12, globalEndH = 36, validStr = '';
    let startYear = new Date().getUTCFullYear(), startMonth = new Date().getUTCMonth() + 1, startDay = new Date().getUTCDate();
    let d1 = startDay, h1 = 12, daysInMonth = 30;

    if (mValid) {
        d1 = parseInt(mValid[1], 10); h1 = parseInt(mValid[2], 10); 
        const d2 = parseInt(mValid[3], 10), h2 = parseInt(mValid[4], 10);
        let m1 = new Date().getMonth() + 1, m2 = m1; if (d2 < d1) { m2++; if (m2 > 12) m2 = 1; }
        startYear = inferStartYear(d1, m1); startMonth = m1; startDay = d1;
        daysInMonth = new Date(startYear, startMonth, 0).getDate();
        validStr = `${tr.validFrom} ${String(d1).padStart(2, '0')}/${String(m1).padStart(2, '0')} ${tr.validAt} ${String(h1).padStart(2, '0')}${tr.validH} ${tr.validTo} ${String(d2).padStart(2, '0')}/${String(m2).padStart(2, '0')} ${tr.validAt} ${String(h2).padStart(2, '0')}${tr.validH} UTC`;
        let durationH = (d2 * 24 + h2) - (d1 * 24 + h1); if (durationH < 0) durationH += daysInMonth * 24;
        globalStartH = h1; globalEndH = h1 + durationH;
    }

    const tafTemps = [], reTempEx = /T(X|N)(M?\d{2})\/(\d{2})(\d{2})Z/g; let matchTemp;
    while ((matchTemp = reTempEx.exec(taf)) !== null) {
        const day = parseInt(matchTemp[3], 10), hour = parseInt(matchTemp[4], 10);
        let tDiffH = (day * 24 + hour) - (d1 * 24 + h1); if (tDiffH < -100) tDiffH += daysInMonth * 24;
        tafTemps.push({ type: matchTemp[1] === 'X' ? 'Max' : 'Min', val: matchTemp[2].startsWith('M') ? '-' + matchTemp[2].substring(1) : matchTemp[2], hourUTC: hour, continuousH: globalStartH + tDiffH });
    }

    const rawSegments = taf.replace(new RegExp(REGEX_BLOCKS_PATTERN.source, 'g'), '||$1').split('||').filter(s => s.trim());
    const segments = [];
    for (let i = 0; i < rawSegments.length; i++) {
        let s = rawSegments[i].trim();
        if (/^PROB\d{2}$/.test(s) && i + 1 < rawSegments.length) { segments.push(s + ' ' + rawSegments[i+1].trim()); i++; } 
        else { segments.push(s); }
    }

    const baseLayers = [], tempoLayers = []; let cursorTime = globalStartH, paletteCounter = 0;
    segments.forEach((segRaw, idx) => {
        const seg = ' ' + segRaw.trim() + ' '; 
        let type = 'BASE', start = cursorTime, end = start + 1, becmgEnd = null, isTempo = false, calcStart = null, calcEnd = null;
        const mTime = seg.match(/\s(\d{2})(\d{2})\/(\d{2})(\d{2})/);
        if (mTime) { 
            const sd = parseInt(mTime[1], 10), sh = parseInt(mTime[2], 10), ed = parseInt(mTime[3], 10), eh = parseInt(mTime[4], 10);
            let sDiffH = (sd * 24 + sh) - (d1 * 24 + h1); if (sDiffH < -100) sDiffH += daysInMonth * 24;
            let eDiffH = (ed * 24 + eh) - (d1 * 24 + h1); if (eDiffH < -100) eDiffH += daysInMonth * 24;
            calcStart = globalStartH + sDiffH; calcEnd = globalStartH + eDiffH; 
        }
        if (seg.includes('TEMPO') || /PROB\d{2}/.test(seg)) { type = 'TEMPO'; isTempo = true; if (calcStart !== null) { start = calcStart; end = calcEnd; } } 
        else if (seg.includes('BECMG')) { type = 'BECMG'; if (calcStart !== null) { start = calcStart; becmgEnd = calcEnd; cursorTime = start; } if (idx > 0) paletteCounter++; } 
        else if (seg.includes('FM')) { type = 'FM'; const mFm = seg.match(/FM(\d{2})(\d{2})\d{2}/); if (mFm) { const fd = parseInt(mFm[1], 10), fh = parseInt(mFm[2], 10); let fDiffH = (fd * 24 + fh) - (d1 * 24 + h1); if (fDiffH < -100) fDiffH += daysInMonth * 24; cursorTime = start = globalStartH + fDiffH; } if (idx > 0) paletteCounter++; }
        const block = { start, end, becmgEnd, vent: _parseVent(seg), visi: _parseVisi(seg), temps: _parsePhenomenes(seg, ['TEMPO','BECMG','PROB','FM','KT','CAVOK','NCD','NOSIG','RMK','TX','TN','SM']), nuage: _parseNuage(seg), type, prob: (seg.match(/(PROB\d{2})/) || [''])[0], color: isTempo ? UNIFIED_RED : PALETTE[paletteCounter % PALETTE.length] };
        if (isTempo) tempoLayers.push(block); else baseLayers.push(block);
    });

    const processedData = { temp: [], qnh: [], vent: [], visi: [], temps: [], nuage: [], soleil: [] };
    baseLayers.forEach((blk, i) => { 
        let nextStart = globalEndH; if (i < baseLayers.length - 1) { const nextBlk = baseLayers[i + 1]; nextStart = (nextBlk.type === 'BECMG' && nextBlk.becmgEnd) ? nextBlk.becmgEnd : nextBlk.start; } 
        ['vent', 'visi', 'temps', 'nuage'].forEach(k => processedData[k].push({ start: blk.start, end: nextStart, val: blk[k], type: blk.type, color: blk.color, _lvl: 0 })); 
    });
    
    ['vent', 'visi', 'temps', 'nuage'].forEach(k => { 
        const arr = processedData[k]; let i = 0; 
        while (i < arr.length - 1) { 
            if (!arr[i + 1].val && (arr[i + 1].type === 'BECMG' || arr[i + 1].type === 'FM')) { 
                arr[i].end = Math.max(arr[i].end, arr[i + 1].end); 
                arr.splice(i + 1, 1); 
            } else i++; 
        } 
    });
    
    return { isMetar: false, code: codeOACI, validity: validStr, startH: globalStartH, endH: globalEndH, base: processedData, tempo: tempoLayers, tafTemps, startYear, startMonth, startDay };
}

export function parseWindString(str) {
    if (!str) return null;
    // _parseVent insère "°" et un espace : "270° 15KT" ou "VRB 10G20KT",
    // et peutSuffixer la variation : "210° 06KT 170V250".
    // On retire le ° et l'espace pour que le regex classique fonctionne.
    const cleanStr = str.toUpperCase().replace(/\s+/g, '').replace(/°/g, '');
    const match = cleanStr.match(/(VRB|\d{3})(\d{2,3})(?:G(\d{2,3}))?KT/);
    if (match) {
        // Variation de direction METAR (ex. 170V250) : bornes du secteur balayé.
        const varMatch = cleanStr.match(/KT(\d{3})V(\d{3})/);
        return {
            variable: match[1] === 'VRB',
            dir: match[1] === 'VRB' ? null : parseInt(match[1], 10),
            speed: parseInt(match[2], 10) || 0,
            gust: match[3] ? parseInt(match[3], 10) : null,
            varFrom: varMatch ? parseInt(varMatch[1], 10) : null,
            varTo: varMatch ? parseInt(varMatch[2], 10) : null
        };
    }
    return null;
}

export function selectBestRunway(runways, wind, forcedId = null, magDeclination = 0) {
    if (!runways || runways.length === 0) return { active: null, list: [] };

    // Correction de déclinaison magnétique : le vent METAR est en degrés
    // VRAIS, les pistes sont en degrés MAGNÉTIQUES. On convertit la direction
    // du vent en magnétique avant de comparer aux caps de piste. Sans cette
    // correction, le calcul de traversier et le choix de piste active sont
    // faux (jusqu'à ~15-25° d'erreur au Canada / Nord-Est USA).
    // magDeclination est injecté par l'appelant (module magvar.js) pour éviter
    // une dépendance circulaire engine → magvar → ui-module → engine.
    // Convention : D = Vrai − Magnétique  →  Mag = Vrai − D.
    let magWindDir = null;
    if (wind && wind.dir !== null) {
        magWindDir = (((wind.dir - magDeclination) % 360) + 360) % 360;
    }

    const list = runways.map(rwyStr => {
        const parts = rwyStr.split('/'); if (parts.length < 2) return null;
        const m1 = parts[0].match(/(\d{2}[LRC]?)(?:.*?(\d{3})°?)?/);
        const m2 = parts[1].match(/(\d{2}[LRC]?)(?:.*?(\d{3})°?)?/);
        if(!m1 || !m2) return null;
        const name1 = m1[1].replace(/[^\dLRC]/g,''), hdg1 = m1[2] ? parseInt(m1[2], 10) : parseInt(name1, 10)*10;
        const name2 = m2[1].replace(/[^\dLRC]/g,''), hdg2 = m2[2] ? parseInt(m2[2], 10) : parseInt(name2, 10)*10;
        // Comparaison cap-magnétique vs vent-magnétique.
        let hw1 = magWindDir !== null ? wind.speed * Math.cos((magWindDir - hdg1) * Math.PI / 180) : 0;
        let hw2 = magWindDir !== null ? wind.speed * Math.cos((magWindDir - hdg2) * Math.PI / 180) : 0;
        let activeName = name1, activeHdg = hdg1, oppName = name2, oppHdg = hdg2, activeHw = hw1;
        if (hw2 > hw1) { activeName = name2; activeHdg = hdg2; oppName = name1; oppHdg = hdg1; activeHw = hw2; }
        // 'hw' = composante vent de face sur la piste active ; sert au tri ci-dessous.
        return { id: `${name1}-${name2}`, label: `(${name1}-${name2})`, name: activeName, hdg: activeHdg, oppositeName: oppName, oppositeHdg: oppHdg, hw: activeHw };
    }).filter(Boolean);

    // Trie par composante de face décroissante : la piste la plus face au vent en premier.
    if (wind && wind.dir !== null && wind.speed > 0) list.sort((a, b) => b.hw - a.hw);
    
    let active = list[0] || null;
    let topList = list.slice(0, 6);
    if (forcedId) {
        const found = list.find(r => r.id === forcedId);
        if (found) {
            active = found;
            if (!topList.find(r => r.id === forcedId)) { topList.pop(); topList.push(found); }
        }
    }
    return { active, list: topList };
}

/**
 * Catégorie de vol (VFR/MVFR/IFR/LIFR) — POINT D'ENTRÉE UNIQUE.
 * Délègue à getFlightCategory (core.js) pour garantir des seuils cohérents
 * partout dans l'app. Ne pas dupliquer les seuils 500/1000/3000 ft ici.
 */
export function calculateFlightCategoryRobust(visiStr, nuageStr) {
    const visiM = parseVisiToMeters(visiStr || '');
    // getCeiling renvoie des centaines de ft (999 = illimité) ; getFlightCategory
    // attend ce même format, donc on ne multiplie PAS.
    const ceilHundFt = getCeiling(nuageStr || '');
    return getFlightCategory(visiM, ceilHundFt);
}

export function getForecastAtHour(tafData, targetHour) {
    let activeVisiStr  = '> 10 km', activeNuageStr = 'CAVOK', activeTempsStr = '';
    const baseVisi = findActiveValueAtHour(tafData.base.visi, targetHour); if (baseVisi) activeVisiStr = baseVisi;
    const baseNuage = findActiveValueAtHour(tafData.base.nuage, targetHour); if (baseNuage) activeNuageStr = baseNuage;
    const baseTemps = findActiveValueAtHour(tafData.base.temps, targetHour); if (baseTemps) activeTempsStr = baseTemps;
    
    const baseCatObj = getFlightCategory(parseVisiToMeters(activeVisiStr), getCeiling(activeNuageStr));
    
    let worstTempoCatObj = null;
    let worstTempoProb = '';

    for (let i = tafData.tempo.length - 1; i >= 0; i--) {
        const b = tafData.tempo[i];
        if (targetHour >= b.start && targetHour < b.end) {
            const tVisi = b.visi || activeVisiStr;
            const tNuage = b.nuage || activeNuageStr;
            const tCatObj = getFlightCategory(parseVisiToMeters(tVisi), getCeiling(tNuage));
            
            if (tCatObj.cat !== 'VFR') {
                const getSev = (c) => c === 'LIFR' ? 4 : (c === 'IFR' ? 3 : (c === 'MVFR' ? 2 : 1));
                if (!worstTempoCatObj || getSev(tCatObj.cat) > getSev(worstTempoCatObj.cat)) {
                    worstTempoCatObj = tCatObj;
                    let p = b.prob || '';
                    worstTempoProb = (b.type === 'TEMPO') ? (p ? p + ' TEMPO' : 'TEMPO') : p;
                }
            }
        }
    }
    
    return {
        catObj: baseCatObj,
        icon: getWeatherIcon(activeNuageStr, activeTempsStr),
        tempoCatObj: worstTempoCatObj,
        tempoProb: worstTempoProb.trim()
    };
}

export function dessinerGraphique(data, hppValue, activeTzOffset) {
    const canvas = document.getElementById('tafCanvas'), container = document.getElementById('graphScroll');
    const ctx = canvas.getContext('2d');
    if (!ctx || !container) return;
    const tr = I18N[state.lang];

    // Support HiDPI (Retina)
    const dpr = window.devicePixelRatio || 1;
    const availableWidth = Math.max(container.clientWidth, 300);
    const PADDING_LEFT = 95, PADDING_RIGHT = 65, PADDING_TOP = 80, PADDING_BOTTOM = 35, OFFSET_STEP = 30;
    const pxPerH = (availableWidth - PADDING_LEFT - PADDING_RIGHT) / Math.max(data.endH - data.startH, 0.1);

    state.graphMetrics = {
        startX: PADDING_LEFT,
        endX: availableWidth - PADDING_RIGHT,
        startH: data.startH,
        endH: data.endH,
        pxPerH: pxPerH
    };
    state.sunLineHitboxes = [];

    const stackOrder = data.isMetar ? ['vent', 'visi', 'temps', 'nuage', 'temp', 'qnh', 'soleil'] : (data.tafTemps && data.tafTemps.length > 0 ? ['vent', 'visi', 'temps', 'nuage', 'tafTemp', 'soleil'] : ['vent', 'visi', 'temps', 'nuage', 'soleil']);
    const labelsMap = { soleil: tr.lblSun, nuage: tr.lblCloud, temps: tr.lblWeather, visi: tr.lblVisi, vent: tr.lblWind, temp: tr.lblTemp, qnh: tr.lblQnh, tafTemp: tr.lblTafTemp };

    // 1. Calcul des dispositions verticales (lignes/niveaux) de chaque catégorie.
    const yConfig = _computeRowLayout(stackOrder, data, PADDING_TOP, OFFSET_STEP);

    const logicalHeight = Object.values(yConfig).reduce((acc, c) => Math.max(acc, c.yStart + c.height), PADDING_TOP) + PADDING_BOTTOM;
    canvas.width = availableWidth * dpr; canvas.height = logicalHeight * dpr;
    canvas.style.width = availableWidth + 'px'; canvas.style.height = logicalHeight + 'px';
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#0F172A'; ctx.fillRect(0, 0, availableWidth, logicalHeight);
    ctx.font = 'bold 12px Arial';
    const getX = h => PADDING_LEFT + (h - data.startH) * pxPerH, AXIS_Y = PADDING_TOP - OFFSET_STEP;
    const geom = { ctx, getX, AXIS_Y, availableWidth, logicalHeight, PADDING_LEFT, PADDING_RIGHT, OFFSET_STEP, pxPerH, yConfig };

    // 2. Couche soleil (dégradé nuit, courbe, lignes lever/coucher).
    _drawSunLayer(geom, data, tr);

    // 3. Axes temporels (grille + étiquettes).
    _drawTimeAxis(geom, data);

    // 4. Catégories météo (vent, visi, temps, nuage, températures).
    _drawWeatherLayers(geom, data, stackOrder, labelsMap);

    // 5. Curseur d'heure d'arrivée (HPP).
    _drawArrivalCursor(geom, data, hppValue, tr);

    // 6. Mention du fuseau horaire.
    ctx.fillStyle = 'rgba(148, 163, 184, 0.7)'; ctx.font = 'italic 11px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(tr.lblGraphTz, availableWidth / 2, logicalHeight - 8);

    return data.code;
}

/**
 * Calcule la position/hauteur de chaque ligne de catégorie et assigne
 * les niveaux (_lvl) aux blocs base et tempo pour éviter les chevauchements.
 */
function _computeRowLayout(stackOrder, data, PADDING_TOP, OFFSET_STEP) {
    const yConfig = {};
    let currentY = PADDING_TOP;
    stackOrder.forEach(key => {
        if (key === 'soleil' || key === 'tafTemp') {
            const rowHeight = key === 'soleil' ? OFFSET_STEP * 3 : OFFSET_STEP;
            yConfig[key] = { yStart: currentY, height: rowHeight, baseLineY: currentY + rowHeight / 2 };
            currentY += rowHeight;
            return;
        }
        const levelsOccupied = {}; let maxLvl = 0;
        (data.base[key] || []).forEach(item => {
            if (!item.val && key !== 'nuage') return;
            let lvl = item.type === 'BECMG' ? 1 : 0;
            while ((levelsOccupied[lvl] || []).some(r => Math.max(item.start, r[0]) < Math.min(item.end, r[1]))) lvl++;
            if (!levelsOccupied[lvl]) levelsOccupied[lvl] = [];
            levelsOccupied[lvl].push([item.start, item.end]);
            item._lvl = lvl;
            maxLvl = Math.max(maxLvl, lvl);
        });
        const startLvlTempo = maxLvl + 1;
        data.tempo.forEach(tBlk => {
            if (!tBlk[key]) return;
            let lvl = startLvlTempo;
            while ((levelsOccupied[lvl] || []).some(r => Math.max(tBlk.start, r[0]) <= Math.min(tBlk.end, r[1]))) lvl++;
            if (!levelsOccupied[lvl]) levelsOccupied[lvl] = [];
            levelsOccupied[lvl].push([tBlk.start, tBlk.end]);
            if (!tBlk._lvlMap) tBlk._lvlMap = {};
            tBlk._lvlMap[key] = lvl;
            maxLvl = Math.max(maxLvl, lvl);
        });
        yConfig[key] = { yStart: currentY, height: (maxLvl + 1) * OFFSET_STEP, baseLineY: currentY + maxLvl * OFFSET_STEP };
        currentY += (maxLvl + 1) * OFFSET_STEP;
    });
    return yConfig;
}

/**
 * Dessine la couche solaire : dégradé de nuit sur fond, courbe de hauteur du soleil,
 * et lignes verticales pointillées aux heures de lever/coucher.
 */
function _drawSunLayer(geom, data, tr) {
    const { ctx, getX, AXIS_Y, availableWidth, logicalHeight, PADDING_LEFT, PADDING_RIGHT, yConfig } = geom;
    if (!data.code || !state.memo[data.code] || state.memo[data.code].lat == null || typeof SunCalc === 'undefined') return;

    const { lat, lon } = state.memo[data.code];
    const conf = yConfig['soleil'], horizonY = conf.baseLineY, amplitudeMax = conf.height / 2 - 5;
    const sunData = getSunData(lat, lon, data.startYear, data.startMonth, data.startDay, data.startH, data.endH);

    // Dégradé de nuit sur l'ensemble du graphique.
    ctx.save();
    ctx.beginPath();
    ctx.rect(PADDING_LEFT, AXIS_Y, availableWidth - PADDING_LEFT - PADDING_RIGHT, logicalHeight - AXIS_Y);
    ctx.clip();
    const nightGradient = ctx.createLinearGradient(PADDING_LEFT, 0, availableWidth - PADDING_RIGHT, 0);
    sunData.gradientStops.forEach(({ relPos, alt }) => {
        if (alt > 0) nightGradient.addColorStop(relPos, 'rgba(15, 23, 42, 0)');
        else nightGradient.addColorStop(relPos, `rgba(20, 25, 50, ${Math.min(Math.abs(alt) * 2, 0.5)})`);
    });
    ctx.fillStyle = nightGradient;
    ctx.fillRect(PADDING_LEFT, AXIS_Y, availableWidth - PADDING_LEFT - PADDING_RIGHT, logicalHeight - AXIS_Y);
    ctx.restore();

    // Courbe de hauteur du soleil.
    ctx.save();
    ctx.beginPath();
    ctx.rect(PADDING_LEFT, conf.yStart, availableWidth - PADDING_LEFT - PADDING_RIGHT, conf.height);
    ctx.clip();
    const pts = sunData.curvePts.map(p => ({ x: getX(p.h), y: horizonY - (p.alt / 1.5) * amplitudeMax }));
    ctx.beginPath();
    pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.strokeStyle = '#FDE047'; ctx.lineWidth = 2; ctx.stroke();
    ctx.lineTo(pts[pts.length - 1].x, horizonY);
    ctx.lineTo(pts[0].x, horizonY);
    ctx.fillStyle = 'rgba(253, 224, 71, 0.12)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(PADDING_LEFT, horizonY); ctx.lineTo(availableWidth - PADDING_RIGHT, horizonY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Lignes de lever / coucher du soleil.
    sunData.sunEvents.forEach(evt => {
        if (evt.val < data.startH || evt.val > data.endH) return;
        const x = getX(evt.val);
        state.sunLineHitboxes.push({ x, type: evt.type });
        const { hh, mm } = _hourToTimeParts(evt.val);
        const lineColor = evt.type === 'sunrise' ? '#F59E0B' : '#60A5FA';
        ctx.strokeStyle = lineColor; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(x, AXIS_Y); ctx.lineTo(x, logicalHeight); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = lineColor; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.font = 'bold 11px Arial';
        ctx.fillText(`${hh}:${mm}Z`, x, AXIS_Y - 15);
    });
}

/**
 * Dessine la grille verticale et les étiquettes d'heures en haut du graphique.
 */
function _drawTimeAxis(geom, data) {
    const { ctx, getX, AXIS_Y, logicalHeight } = geom;
    let stepH = data.isMetar ? 0.5 : 2;
    if (!data.isMetar) {
        if (geom.pxPerH < 8) stepH = 6;
        else if (geom.pxPerH < 15) stepH = 4;
    }

    // Grille verticale.
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let h = Math.floor(data.startH); h <= Math.ceil(data.endH); h += stepH) {
        if (h < data.startH || h > data.endH) continue;
        const x = getX(h); ctx.moveTo(x, AXIS_Y); ctx.lineTo(x, logicalHeight);
    }
    ctx.stroke();

    // Étiquettes d'heures.
    for (let h = Math.floor(data.startH); h <= Math.ceil(data.endH); h += stepH) {
        if (h < data.startH || h > data.endH) continue;
        const x = getX(h);
        ctx.fillStyle = '#94A3B8'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.font = 'bold 11px Arial';
        const { hh, mm } = _hourToTimeParts(h);
        ctx.fillText(`${hh}h${mm}Z`, x, AXIS_Y - 4);
    }

    // Ligne d'axe horizontale.
    ctx.strokeStyle = '#334155'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(geom.PADDING_LEFT, AXIS_Y); ctx.lineTo(geom.availableWidth - geom.PADDING_RIGHT, AXIS_Y); ctx.stroke();
}

/**
 * Dessine toutes les catégories météo : étiquettes de ligne, valeurs de base,
 * valeurs temporaires (TEMPO) et températures TAF (TX/TN).
 */
function _drawWeatherLayers(geom, data, stackOrder, labelsMap) {
    const { ctx, PADDING_LEFT, OFFSET_STEP, pxPerH, availableWidth, getX, yConfig } = geom;

    stackOrder.forEach(key => {
        ctx.fillStyle = '#94A3B8'; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';

        const labelY = key === 'soleil' ? yConfig[key].baseLineY : yConfig[key].yStart;
        const textToDraw = labelsMap[key] || '';
        const lignesLabel = textToDraw.split('\n');

        if (lignesLabel.length > 1) {
            ctx.fillText(lignesLabel[0], PADDING_LEFT - 10, labelY - 7);
            ctx.fillText(lignesLabel[1], PADDING_LEFT - 10, labelY + 7);
        } else {
            ctx.fillText(textToDraw, PADDING_LEFT - 10, labelY);
        }

        if (key === 'soleil') return;

        if (key === 'tafTemp') {
            data.tafTemps.forEach(t => {
                if (t.continuousH < data.startH || t.continuousH > data.endH) return;
                const x = getX(t.continuousH), y = yConfig[key].baseLineY;
                ctx.fillStyle = t.type === 'Max' ? '#EF4444' : '#3B82F6';
                ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#E2E8F0'; ctx.font = 'bold 11px Arial'; ctx.textBaseline = 'bottom'; ctx.textAlign = 'center';
                ctx.fillText(`${t.val}°C`, x, y - 6);
            });
            return;
        }

        // Blocs de base.
        (data.base[key] || []).forEach(item => {
            if (!item.val && key !== 'nuage') return;
            const y = yConfig[key].yStart + item._lvl * OFFSET_STEP, x1 = getX(item.start), x2 = Math.max(getX(item.end) - 10, x1 + pxPerH * 0.5);
            ctx.strokeStyle = ctx.fillStyle = item.color; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
            ctx.beginPath(); ctx.arc(x1, y, 3, 0, Math.PI * 2); ctx.fill();
            if (item.val) {
                ctx.fillStyle = '#E2E8F0'; ctx.font = 'bold 11px Arial'; ctx.textBaseline = 'bottom';
                ctx.textAlign = x1 + 100 > availableWidth ? 'right' : 'left';
                ctx.fillText(item.val, x1 + (ctx.textAlign === 'right' ? -6 : 6), y - 4);
            }
        });

        // Blocs TEMPO (en pointillés rouges).
        data.tempo.forEach(tBlk => {
            if (!tBlk[key]) return;
            const y = yConfig[key].yStart + (tBlk._lvlMap?.[key] ?? 0) * OFFSET_STEP, x1 = getX(tBlk.start), x2 = Math.max(getX(tBlk.end) - 10, x1 + pxPerH * 0.5);
            ctx.strokeStyle = ctx.fillStyle = '#EF4444'; ctx.lineWidth = 2.5; ctx.setLineDash([4, 3]);
            ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke(); ctx.setLineDash([]);
            const label = `${tBlk.prob || ''} ${tBlk[key]}`.trim();
            ctx.fillStyle = '#E2E8F0'; ctx.font = 'bold 11px Arial'; ctx.textBaseline = 'bottom';
            ctx.textAlign = x1 + 100 > availableWidth ? 'right' : 'left';
            ctx.fillText(label, x1 + (ctx.textAlign === 'right' ? -6 : 6), y - 4);
        });
    });
}

/**
 * Dessine le curseur d'heure d'arrivée (HPP) : disque solaire + étiquette d'heure.
 */
function _drawArrivalCursor(geom, data, hppValue, tr) {
    if (hppValue === null || hppValue < data.startH || hppValue > data.endH) return;
    const { ctx, getX, PADDING_TOP, yConfig } = geom;
    const xHpp = getX(hppValue);
    let sunY = yConfig['soleil'] ? yConfig['soleil'].baseLineY : PADDING_TOP;

    // Position du soleil à l'heure d'arrivée.
    if (data.code && state.memo[data.code] && state.memo[data.code].lat != null && typeof SunCalc !== 'undefined') {
        const { lat, lon } = state.memo[data.code];
        const d = new Date(Date.UTC(data.startYear, data.startMonth - 1, data.startDay, Math.floor(hppValue), Math.floor((hppValue % 1) * 60), 0));
        const alt = SunCalc.getPosition(d, lat, lon).altitude || 0;
        const conf = yConfig['soleil'];
        sunY = conf.baseLineY - (alt / 1.5) * (conf.height / 2 - 5);

        ctx.beginPath();
        ctx.arc(xHpp, sunY, 6, 0, Math.PI * 2);
        if (alt > 0) {
            ctx.fillStyle = '#FDE047'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#CA8A04'; ctx.stroke();
        } else {
            ctx.fillStyle = '#E2E8F0'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#94A3B8'; ctx.stroke();
        }
    }

    // Étiquette d'heure (masquée pendant le drag pour éviter le clignotement).
    if (!state.isDragging && !data.isMetar) {
        const { hh, mm } = _hourToTimeParts(hppValue);
        const labelText = `${tr.lblPlannedArrival} ${hh}h${mm}Z`;

        ctx.fillStyle = '#FFFFFF'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        const txtWidth = ctx.measureText(labelText).width;
        const labelDrawY = sunY + 20;

        ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(xHpp - txtWidth / 2 - 8, labelDrawY - 2, txtWidth + 16, 20, 4);
        } else {
            ctx.fillRect(xHpp - txtWidth / 2 - 8, labelDrawY - 2, txtWidth + 16, 20);
        }
        ctx.fill();

        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(labelText, xHpp, labelDrawY);
    }
}

/**
 * Convertit une heure décimale (ex: 14.25) en parties { hh: "14", mm: "15" }
 * avec gestion du modulo 24h et des arrondis à 60 minutes.
 */
function _hourToTimeParts(hourVal) {
    let h = Math.floor(hourVal) % 24;
    if (h < 0) h += 24;
    let m = Math.round((hourVal - Math.floor(hourVal)) * 60);
    if (m === 60) { m = 0; h = (h + 1) % 24; }
    return { hh: String(h).padStart(2, '0'), mm: String(m).padStart(2, '0') };
}

export function getSunData(lat, lon, startYear, startMonth, startDay, startH, endH) {
    const key = `${lat},${lon},${startYear},${startMonth},${startDay},${startH},${endH}`;
    const cached = sunCacheGet(key); if (cached) return cached;
    const duration = Math.max(endH - startH, 0.1), totalMinutes = duration * 60;
    const gradientStops = [], curvePts = [], sunEvents = [];
    
    for (let i = 0; i <= Math.ceil(totalMinutes / 30); i++) {
        const m = Math.min(i * 30, totalMinutes);
        const d = new Date(Date.UTC(startYear, startMonth - 1, startDay, Math.floor(startH + m / 60), Math.floor(((startH + m / 60) % 1) * 60), 0));
        gradientStops.push({ relPos: m / totalMinutes, alt: SunCalc.getPosition(d, lat, lon).altitude || 0 });
    }
    
    for (let hCur = startH; hCur <= endH; hCur += 5 / 60) {
        const d = new Date(Date.UTC(startYear, startMonth - 1, startDay, Math.floor(hCur), Math.floor((hCur % 1) * 60), 0));
        curvePts.push({ h: hCur, alt: SunCalc.getPosition(d, lat, lon).altitude || 0 });
    }
    
    const baseTime = Date.UTC(startYear, startMonth - 1, startDay, 0, 0, 0);
    for (let dayOffset = 0; dayOffset <= 2; dayOffset++) {
        const d = new Date(Date.UTC(startYear, startMonth - 1, startDay + dayOffset, 12, 0, 0));
        const times = SunCalc.getTimes(d, lat, lon);
        if (times.sunrise) {
            let srH = (times.sunrise.getTime() - baseTime) / 3600000 - 0.5;
            let ssH = (times.sunset.getTime() - baseTime) / 3600000 + 0.5;
            sunEvents.push({ type: 'sunrise', val: srH });
            sunEvents.push({ type: 'sunset', val: ssH });
        }
    }
    
    const res = { gradientStops, curvePts, sunEvents }; 
    sunCacheSet(key, res); 
    return res;
}

export function isAeroNight(lat, lon, dateUTC) {
    if (typeof SunCalc === 'undefined' || lat == null || lon == null) return false;
    const times = SunCalc.getTimes(dateUTC, lat, lon); if (!times.sunrise) return false;
    const t = dateUTC.getTime(); return (t < times.sunrise.getTime() - 30 * 60000 || t > times.sunset.getTime() + 30 * 60000);
}

export function renderWindCompass(containerId, windStr, runways = null, forcedId = null, apt = null) {
    const host = document.getElementById(containerId);
    if (!host) return;
    const isFr = state.lang === 'fr';
    const wind = parseWindString(windStr);

    if (!wind) {
        state.activeRunwayName = null;   // sans vent : plus de piste active publiée
        host.innerHTML = `<div class="dash-title">${isFr ? 'Vent' : 'Wind'}</div><div style="flex:1;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.3);">—</div>`;
        return;
    }
    
    const color = getWindColorBySpeed(wind.speed);
    
    const CX = 130, CY = 140, R_OUTER = 100;
    const uid = getUniqueId();
    
    const rwyData = selectBestRunway(runways, wind, forcedId, getDeclinationForIcao(state.requestedIcao || state.lastParsed?.code));
    const bestRwy = rwyData.active;
    const rwyList = rwyData.list;

    // Publie la piste active (source de vérité unique : la rose) pour les
    // widgets qui l'affichent (Performance décollage…). null sans données.
    state.activeRunwayName = bestRwy?.name || null;

    // Revêtement de la piste active : OFFICIEL SIA en priorité (France),
    // sinon openAIP (si l'objet terrain est passé par l'appelant).
    let surfCode = null;
    if (bestRwy) {
        const siaRw = siaRunwayFor(state.requestedIcao || state.lastParsed?.code, bestRwy.name);
        surfCode = (siaRw && siaSurfaceCode(siaRw.surf))
            || (apt && apt.runwaySurfaces ? (apt.runwaySurfaces[bestRwy.name] || apt.surface) : null)
            || null;
    }
    let surfHtml = '';
    if (bestRwy && surfCode) {
        const surfText = surfaceLabel(surfCode, state.lang);
        const isSoft = SOFT_SURFACES.has(surfCode);
        const surfColor = isSoft ? '#FBBF24' : '#94A3B8';
        surfHtml = `<div style="font-size:10px; color:${surfColor}; margin-top:6px; display:flex; align-items:center; gap:4px; justify-content:center;">
            ${isSoft ? `<i data-lucide="alert-triangle" style="width:11px;height:11px;"></i>` : `<i data-lucide="layers" style="width:11px;height:11px;"></i>`}
            <span>${surfText}</span>
        </div>`;
    }

    const ticksSvg = Array.from({ length: 36 }, (_, i) => {
        const a = i * 10; const r = (a - 90) * Math.PI / 180; const isMain = a % 30 === 0;
        return `<line x1="${CX + Math.cos(r) * R_OUTER}" y1="${CY + Math.sin(r) * R_OUTER}" x2="${CX + Math.cos(r) * (R_OUTER - (isMain ? 5 : 2))}" y2="${CY + Math.sin(r) * (R_OUTER - (isMain ? 5 : 2))}" stroke="rgba(255,255,255,${isMain ? 0.4 : 0.2})" stroke-width="${isMain ? 2 : 1.5}"/>`;
    }).join('');

    const cardsSvg = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map(a => {
        const r = (a - 90) * Math.PI / 180; 
        let R_TEXT = R_OUTER + 16;
        let l = a;
        let fontSize = 10;
        let fontWeight = 600;
        let fill = 'rgba(255,255,255,0.4)';
        
        if (a === 0) { l = 'N'; fontSize = 15; fontWeight = 800; fill = 'rgba(255,255,255,0.85)'; }
        else if (a === 90) { l = 'E'; fontSize = 15; fontWeight = 800; fill = 'rgba(255,255,255,0.85)'; }
        else if (a === 180) { l = 'S'; fontSize = 15; fontWeight = 800; fill = 'rgba(255,255,255,0.85)'; }
        else if (a === 270) { l = isFr ? 'O' : 'W'; fontSize = 15; fontWeight = 800; fill = 'rgba(255,255,255,0.85)'; }
        else {
            l = a.toString().padStart(3, '0');
            R_TEXT = R_OUTER + 12;
        }
        
        const x = CX + Math.cos(r) * R_TEXT; 
        const y = CY + Math.sin(r) * R_TEXT + (fontSize === 15 ? 5 : 3);
        return `<text x="${x}" y="${y}" text-anchor="middle" fill="${fill}" font-size="${fontSize}" font-weight="${fontWeight}" font-family="system-ui">${l}</text>`;
    }).join('');

    const runwaySvg = bestRwy ? `
        <g transform="rotate(${bestRwy.hdg}, ${CX}, ${CY})">
            <rect x="${CX - 12}" y="${CY - 85}" width="24" height="170" fill="#1E293B" rx="2" stroke="rgba(255,255,255,0.1)"/>
            <line x1="${CX}" y1="${CY - 50}" x2="${CX}" y2="${CY + 50}" stroke="#94A3B8" stroke-width="2" stroke-dasharray="10,8" opacity="0.6" />
            <line x1="${CX - 9}" y1="${CY - 78}" x2="${CX + 9}" y2="${CY - 78}" stroke="#94A3B8" stroke-width="2" opacity="0.7" />
            <text x="${CX}" y="${CY - 60}" text-anchor="middle" fill="#94A3B8" font-size="13" font-weight="800" font-family="system-ui" opacity="0.7" transform="rotate(180, ${CX}, ${CY - 64})">${bestRwy.oppositeName}</text>
            <line x1="${CX - 9}" y1="${CY + 78}" x2="${CX + 9}" y2="${CY + 78}" stroke="#4ADE80" stroke-width="3" opacity="0.9" />
            <text x="${CX}" y="${CY + 75}" text-anchor="middle" fill="#4ADE80" font-size="13" font-weight="900">${bestRwy.name}</text>
        </g>` : '';

    let arrowSvg = '';
    let gustTextSvg = '';

    if (wind.dir !== null && wind.speed > 0) {
        const speedCap = Math.min(wind.speed, 50);
        const dLength = 20 + (speedCap / 50) * 85; 
        const yBase = CY - R_OUTER, yPointe = yBase + dLength;

        const glowBlur = 3 + (speedCap / 50) * 8;
        const glowOpacity = Math.min(0.4 + (speedCap / 50), 0.8);

        let gustLineSvg = '';
        if (wind.gust && wind.gust > wind.speed) {
            const gustCap = Math.min(wind.gust, 60);
            const gustLength = 20 + (gustCap / 60) * 85;
            const gustY = CY - R_OUTER + gustLength;
            
            gustLineSvg = `<line x1="${CX - 5}" y1="${gustY}" x2="${CX + 5}" y2="${gustY}" stroke="${color}" stroke-width="2.5" stroke-dasharray="2,2" opacity="0.8" stroke-linecap="round"/>`;
            
            const gustRadius = R_OUTER - gustLength;
            const rad = wind.dir * Math.PI / 180;
            const markScreenX = CX + gustRadius * Math.sin(rad);
            const markScreenY = CY - gustRadius * Math.cos(rad);

            let gustOffsetX = 12;
            let gustAnchor = "start";
            if (wind.dir > 0 && wind.dir < 180) {
                gustOffsetX = -12;
                gustAnchor = "end";
            }
            
            gustTextSvg = `<text x="${markScreenX + gustOffsetX}" y="${markScreenY + 5}" fill="${color}" font-size="14" font-weight="900" text-anchor="${gustAnchor}" font-family="'DM Mono', monospace" style="filter: drop-shadow(0px 1px 2px rgba(0,0,0,0.8));">G${wind.gust}</text>`;
        }

        arrowSvg = `
        <defs>
            <filter id="${uid}-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="${glowBlur}" />
            </filter>
            <linearGradient id="${uid}-grad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" style="stop-color:${color};stop-opacity:0.6" />
                <stop offset="60%" style="stop-color:${color};stop-opacity:1" />
                <stop offset="100%" style="stop-color:${color};stop-opacity:0.9" />
            </linearGradient>
        </defs>
        <line x1="${CX}" y1="${CY - R_OUTER}" x2="${CX}" y2="${CY + R_OUTER}" stroke="${color}" stroke-width="1" opacity="0.4" transform="rotate(${wind.dir}, ${CX}, ${CY})"/>
        
        <g class="wind-arrow" style="transform-origin: ${CX}px ${CY}px; transform: rotate(${wind.dir}deg);" data-wind-dir="${wind.dir}" data-cx="${CX}" data-cy="${CY}">
            <circle cx="${CX}" cy="${yBase}" r="7" fill="none" stroke="${color}" stroke-width="2" opacity="${glowOpacity}" filter="url(#${uid}-glow)"/>
            <circle cx="${CX}" cy="${yBase}" r="3.5" fill="${color}"/>
            <line x1="${CX}" y1="${yBase}" x2="${CX}" y2="${yPointe}" stroke="url(#${uid}-grad)" stroke-width="3" stroke-linecap="round"/>
            <path d="M ${CX - 6},${yPointe - 9} L ${CX},${yPointe} L ${CX + 6},${yPointe - 9} Z" fill="${color}"/>
            ${gustLineSvg}
        </g>`;
    } else if (wind.variable && wind.speed > 0) {
        arrowSvg = `<circle cx="${CX}" cy="${CY}" r="45" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="6,4" opacity="0.7"/>`;
    }

    // Secteur de variation METAR (ex. 170V250) : deux pointes de flèche sur le
    // cercle extérieur, pointant vers le centre, + arc fin reliant les bornes.
    // Rendu identique que le vent soit directionnel (21006KT 170V250) ou VRB.
    let varRangeSvg = '';
    if (wind.varFrom != null && wind.varTo != null) {
        const a1 = wind.varFrom, a2 = wind.varTo;
        const r1 = a1 * Math.PI / 180, r2 = a2 * Math.PI / 180;
        const p1x = CX + R_OUTER * Math.sin(r1), p1y = CY - R_OUTER * Math.cos(r1);
        const p2x = CX + R_OUTER * Math.sin(r2), p2y = CY - R_OUTER * Math.cos(r2);
        // Arc mineur le long du cercle (le secteur METAR fait toujours < 180°).
        const delta = ((a2 - a1) % 360 + 360) % 360;
        const sweep = delta <= 180 ? 1 : 0;
        const arcPath = `M ${p1x.toFixed(1)} ${p1y.toFixed(1)} A ${R_OUTER} ${R_OUTER} 0 0 ${sweep} ${p2x.toFixed(1)} ${p2y.toFixed(1)}`;
        // Pointe radiale pointant vers le centre, à cheval sur le cercle extérieur.
        const tip = a => {
            const rad = a * Math.PI / 180, s = Math.sin(rad), c = Math.cos(rad), w = 4;
            const baseX = CX + (R_OUTER + 6) * s, baseY = CY - (R_OUTER + 6) * c;
            const tX = CX + (R_OUTER - 3) * s, tY = CY - (R_OUTER - 3) * c;
            return `M ${(baseX + w * c).toFixed(1)} ${(baseY + w * s).toFixed(1)} L ${tX.toFixed(1)} ${tY.toFixed(1)} L ${(baseX - w * c).toFixed(1)} ${(baseY - w * s).toFixed(1)} Z`;
        };
        // Petite étiquette de cap, juste à l'extérieur de chaque pointe.
        const lbl = a => {
            const rad = a * Math.PI / 180;
            const lx = CX + (R_OUTER + 15) * Math.sin(rad);
            const ly = CY - (R_OUTER + 15) * Math.cos(rad) + 3;
            return `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" fill="${color}" font-size="9" font-weight="800" font-family="'DM Mono', monospace" opacity="0.95">${a}°</text>`;
        };
        varRangeSvg = `
        <path d="${arcPath}" fill="none" stroke="${color}" stroke-width="2.5" opacity="0.55" stroke-linecap="round"/>
        <path d="${tip(a1)}" fill="${color}"/>
        <path d="${tip(a2)}" fill="${color}"/>
        ${lbl(a1)}${lbl(a2)}`;
    }

    let bubblesHtml = '';
    if (rwyList.length > 1) {
        bubblesHtml = rwyList.map(rwy => {
            const isActive = bestRwy && bestRwy.id === rwy.id;
            const bg = isActive ? 'rgba(74, 222, 128, 0.15)' : 'rgba(30, 41, 59, 0.5)';
            const col = isActive ? '#4ADE80' : '#94A3B8';
            const border = isActive ? '#4ADE80' : 'rgba(255,255,255,0.1)';
            return `<div class="rwy-bubble" data-rwy-id="${rwy.id}" style="cursor:pointer;background:${bg};color:${col};border:1px solid ${border};padding:4px 10px;border-radius:12px;font-size:11px;font-weight:700;font-family:system-ui;transition:all 0.2s;">${rwy.label}</div>`;
        }).join('');
    }

    const windText = wind.speed === 0 ? (isFr ? 'CALME' : 'CALM') : `${wind.dir === null ? 'VRB' : String(wind.dir).padStart(3,'0') + '°'} · ${wind.speed}${wind.gust ? 'G' + wind.gust : ''} KT`;

    host.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;">
            <svg viewBox="0 -15 260 295" style="width:100%;max-width:280px;overflow:visible;">
                <circle cx="${CX}" cy="${CY}" r="${R_OUTER}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1.5"/>
                ${ticksSvg}${cardsSvg}${runwaySvg}${arrowSvg}${varRangeSvg}
                ${gustTextSvg}
            </svg>
            <div style="color:${color};font-weight:500;font-size:15px;margin-top:2px;font-family:'DM Mono', monospace;background:#1E293B;padding:6px 12px;border-radius:6px;border:1px solid ${color}; text-align: center; letter-spacing: 0.5px;">${windText}</div>
            ${wind.varFrom != null && wind.varTo != null ? `<div style="color:rgba(255,255,255,0.55);font-size:10px;margin-top:3px;font-family:'DM Mono', monospace;letter-spacing:0.3px;">${isFr ? 'Var.' : 'Var.'} ${wind.varFrom}°–${wind.varTo}°</div>` : ''}
            ${bubblesHtml ? `<div style="display:flex;flex-wrap:wrap;justify-content:center;gap:6px;max-width:300px;margin-top:8px;">${bubblesHtml}</div>` : ''}
            ${surfHtml}
        </div>
    `;
    if (window.lucide && surfHtml) window.lucide.createIcons({ root: host });
}

/**
 * Recalcule et publie la piste active de façon SYNCHRONE (vent de la vue
 * courante + paire forcée). Appelé au clic sur une bulle de piste AVANT le
 * re-rendu global : les widgets rendus juste après (Performance décollage…)
 * voient déjà la nouvelle piste, sans attendre le requestAnimationFrame de
 * la rose (sans cela, il fallait cliquer deux fois pour voir le changement).
 * @param {Object|null} apt Terrain courant (getAirportByICAO côté appelant).
 */
export function publishActiveRunway(apt) {
    const parsed = state.lastParsed;
    if (!apt || !Array.isArray(apt.runways) || !parsed) return;
    let windStr = null;
    if (parsed.isMetar) windStr = parsed.base?.vent?.[0]?.val || null;
    else {
        const h = state.manualTargetHour;
        if (h == null) windStr = parsed.base?.vent?.[0]?.val || null;
        else {
            windStr = findActiveValueAtHour(parsed.base?.vent, h);
            const tempoArr = parsed.tempo || [];
            for (let i = tempoArr.length - 1; i >= 0; i--) {
                if (h >= tempoArr[i].start && h < tempoArr[i].end && tempoArr[i].vent) { windStr = tempoArr[i].vent; break; }
            }
        }
    }
    const rwyData = selectBestRunway(apt.runways, parseWindString(windStr), state.forcedRunway,
        getDeclinationForIcao(state.requestedIcao || parsed.code));
    state.activeRunwayName = rwyData.active?.name || null;
}

export function updateWindCompass(parsedData, targetHour, timeLabel, runways = null, forcedId = null, apt = null) {
    if (!parsedData) return renderWindCompass('wind-compass-container', null);
    let windStr = null;
    if (parsedData.isMetar) windStr = parsedData.base?.vent?.[0]?.val || null;
    else {
        const h = targetHour; if (h == null) windStr = parsedData.base?.vent?.[0]?.val || null;
        else {
            windStr = findActiveValueAtHour(parsedData.base?.vent, h);
            const tempoArr = parsedData.tempo || [];
            for (let i = tempoArr.length - 1; i >= 0; i--) if (h >= tempoArr[i].start && h < tempoArr[i].end && tempoArr[i].vent) { windStr = tempoArr[i].vent; break; }
        }
    }
    renderWindCompass('wind-compass-container', windStr, runways, forcedId, apt);
}