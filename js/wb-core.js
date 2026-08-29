/* ================================================================
 * WB CORE — Centrage & centrogramme (weight & balance)
 * ================================================================
 *
 * OBJECTIF
 * --------
 * Calculer, pour l'avion actif, le centrage aux trois points clés du
 * vol — DÉCOLLAGE (chargement complet + carburant embarqué), ARRIVÉE
 * (carburant moins l'essence consommée estimée du plan de nav) et
 * ZFW (zéro carburant) — puis les confronter à l'enveloppe de centrage
 * saisie dans la flotte (polygone masse × bras).
 *
 * UNITÉS
 * ------
 * Le stockage et TOUS les calculs se font en kg et mm. Les unités de
 * saisie/affichage (kg|lbs, mm|m|ft|in) sont propres à chaque avion
 * (celles de sa fiche de pesée) : les conversions ne se font qu'aux
 * bords (saisie du formulaire flotte, affichage du widget, page PDF).
 *
 * Ce module est VOLONTAIREMENT SANS IMPORT et sans dépendance DOM
 * (seul mountWbChart touche au DOM), testable sous Node comme
 * takeoff-profile.js.
 * ================================================================ */

// ----------------------------------------------------------------
// Conversions unités (facteurs exacts)
// ----------------------------------------------------------------
const MM_PER_ARM = { mm: 1, m: 1000, ft: 304.8, in: 25.4 };
const LB_PER_KG = 2.2046226218;

/** Bras : unité d'affichage → mm. */
export function armToMm(v, unit) { return v * (MM_PER_ARM[unit] || 1); }
/** Bras : mm → unité d'affichage. */
export function armFromMm(v, unit) { return v / (MM_PER_ARM[unit] || 1); }
/** Masse : kg|lbs → kg. */
export function massToKg(v, unit) { return unit === 'lbs' ? v / LB_PER_KG : v; }
/** Masse : kg → kg|lbs. */
export function massFromKg(v, unit) { return unit === 'lbs' ? v * LB_PER_KG : v; }

/** Décimales d'affichage/édition d'un bras selon l'unité (m → millièmes,
 * in → centièmes, ft → dixièmes : granularité ≈ millimétrique partout). */
export function armDecimals(unit) { return { m: 3, in: 2, ft: 1 }[unit] || 0; }

// Masses maximales par défaut des postes standards (kg), réinjectées au
// sanitize quand le champ est vide : Pilote/Passagers 130 kg, Bagages 40 kg.
export const DEFAULT_STATION_MAX_KG = {
    'pilote': 130, 'passager 1': 130, 'passager 2': 130, 'passager 3': 130, 'bagages': 40,
};

/**
 * Postes de chargement proposés à la création du bloc centrage d'un
 * avion (nom + bras vide à compléter depuis la fiche de pesée).
 */
export function defaultStations() {
    return [
        { name: 'Pilote', armMm: null, maxKg: 130, fuel: false },
        { name: 'Passager 1', armMm: null, maxKg: 130, fuel: false },
        { name: 'Passager 2', armMm: null, maxKg: 130, fuel: false },
        { name: 'Passager 3', armMm: null, maxKg: 130, fuel: false },
        { name: 'Bagages', armMm: null, maxKg: 40, fuel: false },
        { name: 'Carburant', armMm: null, maxKg: null, fuel: true },
    ];
}

// ----------------------------------------------------------------
// Géométrie de l'enveloppe ([masse kg, bras mm], sens quelconque)
// ----------------------------------------------------------------

/** Point (masse, bras) strictement à l'intérieur du polygone ? (ray-casting) */
export function pointInEnvelope(envelope, mass, arm) {
    let inside = false;
    for (let i = 0, j = envelope.length - 1; i < envelope.length; j = i++) {
        const [yi, xi] = envelope[i], [yj, xj] = envelope[j]; // y = masse, x = bras
        if ((yi > mass) !== (yj > mass) &&
            arm < ((xj - xi) * (mass - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

/**
 * Bras des limites AVANT (min) et ARRIÈRE (max) de l'enveloppe pour une
 * masse donnée (interpolation des arêtes croisées). null si la masse est
 * hors de la plage couverte par l'enveloppe.
 */
export function armLimitsAt(envelope, mass) {
    let fwd = null, aft = null;
    for (let i = 0; i < envelope.length; i++) {
        const [am, aa] = envelope[i], [bm, ba] = envelope[(i + 1) % envelope.length];
        if (am === bm) continue;
        if ((am - mass) * (bm - mass) <= 0) {
            const arm = aa + ((ba - aa) * (mass - am)) / (bm - am);
            if (fwd === null || arm < fwd) fwd = arm;
            if (aft === null || arm > aft) aft = arm;
        }
    }
    return { fwdMm: fwd, aftMm: aft };
}

/**
 * Réordonne les points d'une enveloppe en polygone SIMPLE (tri angulaire
 * autour du centroïde). Neutralise les saisies « ligne à ligne » du tableau
 * du manuel de vol (masse par masse : avant, arrière, avant, arrière…)
 * qui traceraient un polygone en zigzag auto-croisé — dessin aberrant et
 * limites avant/arrière trompeuses. Sans effet sur une enveloppe déjà
 * parcourue en périmètre.
 */
export function normalizeEnvelope(points) {
    if (!Array.isArray(points) || points.length < 3) return points ? points.slice() : [];
    const pts = points.slice();
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    // Départ stable : sommet le plus bas-gauche, puis parcours angulaire.
    pts.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
    const p0 = pts[0];
    const ref = Math.atan2(p0[1] - cy, p0[0] - cx);
    const rel = (p) => {
        const a = Math.atan2(p[1] - cy, p[0] - cx) - ref;
        return ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    };
    return pts.slice().sort((a, b) => rel(a) - rel(b));
}

// ----------------------------------------------------------------
// Calcul du centrage
// ----------------------------------------------------------------

/**
 * Calcule les points de centrage d'un vol.
 * @param {Object} wb bloc centrage de l'avion (voir aircraft-fleet.js)
 * @param {Object} loads chargement du jour :
 *   { masses: { [nomStation]: masse kg }, fuelL: litres embarqués,
 *     burnL: litres consommés estimés }
 * @returns {Object} {
 *   rows[]        lignes d'affichage {name, armMm, massKg, fuel, empty}
 *                 (masse à vide puis chaque poste, carburant inclus),
 *   empty/zfw/takeoff/arrival : {massKg, cgMm} (cgMm null si masse nulle),
 *   fuelKg, burnKg, arrivalFuelKg,
 *   points        {takeoff, arrival, zfw} → {inside, fwdMm, aftMm}
 *                 (marges : distance CG→limite, positives = dedans),
 *   mtowOk        true si pas de MTOW ou masse décollage ≤ MTOW,
 *   level         'ok' | 'danger' (un point hors enveloppe ou MTOW dépassé)
 * }
 */
export function computeWb(wb, loads = {}) {
    const density = (wb.fuelDensity > 0.5 && wb.fuelDensity < 1.2) ? wb.fuelDensity : 0.72;
    const fuelL = Math.max(0, Number(loads.fuelL) || 0);
    const burnL = Math.max(0, Number(loads.burnL) || 0);

    const rows = [{ name: 'empty', armMm: wb.emptyArmMm, massKg: wb.emptyMassKg, empty: true, fuel: false }];
    let zfM = wb.emptyMassKg, zfMom = wb.emptyMassKg * wb.emptyArmMm;
    let fuelKg = 0, fuelMom = 0;
    for (const st of wb.stations) {
        // Poste sans bras (saisie incomplète) : conservé dans la flotte mais
        // ignoré par le calcul et les tableaux d'affichage.
        if (st.armMm == null || !isFinite(st.armMm)) continue;
        let massKg;
        if (st.fuel) {
            massKg = fuelL * density;
            fuelKg = massKg;
            fuelMom = massKg * st.armMm;
        } else {
            massKg = Math.max(0, Number(loads.masses?.[st.name]) || 0);
            zfM += massKg;
            zfMom += massKg * st.armMm;
        }
        rows.push({ ...st, massKg, fuel: !!st.fuel });
    }

    // L'essence consommée ne peut excéder le carburant embarqué.
    const burnKg = Math.min(fuelKg, burnL * density);
    const cg = (m, mom) => (m > 0 ? mom / m : null);

    const zfw = { massKg: zfM, cgMm: cg(zfM, zfMom) };
    const toM = zfM + fuelKg, toMom = zfMom + fuelMom;
    const takeoff = { massKg: toM, cgMm: cg(toM, toMom) };
    const arM = zfM + fuelKg - burnKg, arMom = zfMom + fuelMom * (fuelKg > 0 ? (fuelKg - burnKg) / fuelKg : 0);
    const arrival = { massKg: arM, cgMm: cg(arM, arMom) };

    const judge = (p) => {
        const { fwdMm, aftMm } = armLimitsAt(wb.envelope, p.massKg);
        const inside = fwdMm != null && aftMm != null &&
            p.cgMm != null && p.cgMm >= fwdMm && p.cgMm <= aftMm &&
            pointInEnvelope(wb.envelope, p.massKg, p.cgMm);
        return { inside, fwdMm: p.cgMm != null && fwdMm != null ? p.cgMm - fwdMm : null,
                 aftMm: p.cgMm != null && aftMm != null ? aftMm - p.cgMm : null };
    };
    const points = { takeoff: judge(takeoff), arrival: judge(arrival), zfw: judge(zfw) };
    const mtowOk = !(wb.mtowKg > 0) || toM <= wb.mtowKg + 1e-9;
    const level = (mtowOk && points.takeoff.inside && points.arrival.inside && points.zfw.inside) ? 'ok' : 'danger';

    return { rows, empty: { massKg: wb.emptyMassKg, cgMm: wb.emptyArmMm }, zfw, takeoff, arrival,
             fuelKg, burnKg, arrivalFuelKg: fuelKg - burnKg, points, mtowOk, level };
}

// ----------------------------------------------------------------
// Chargement du jour : persistance par avion + défauts du plan
// ----------------------------------------------------------------

/**
 * Lit le chargement mémorisé pour un avion (localStorage
 * 'ac-wb-loads-<id>'). Retourne null si rien de mémorisé.
 */
export function readWbLoads(acId) {
    try {
        const raw = localStorage.getItem('ac-wb-loads-' + acId);
        if (!raw) return null;
        const v = JSON.parse(raw);
        if (!v || typeof v !== 'object') return null;
        return { masses: (v.masses && typeof v.masses === 'object') ? v.masses : {},
                 fuelL: Number(v.fuelL) || 0, burnL: Number(v.burnL) || 0 };
    } catch { return null; }
}

/** Mémorise le chargement d'un avion. */
export function writeWbLoads(acId, loads) {
    try {
        localStorage.setItem('ac-wb-loads-' + acId, JSON.stringify({
            masses: loads?.masses || {}, fuelL: Number(loads?.fuelL) || 0, burnL: Number(loads?.burnL) || 0,
        }));
    } catch { /* quota */ }
}

/**
 * Charge utile effective d'un avion : masses des postes et carburant
 * embarqué mémorisés s'ils existent (sinon défauts du plan), mais
 * l'ESSENCE CONSOMMÉE suit TOUJOURS le plan de vol courant quand il
 * existe (conso × temps de vol) — un chargement mémorisé d'un autre vol
 * ne doit pas figer cette valeur dans le widget ni dans le PDF.
 * @param {Object|null} plan plan de vol (state._lastNavPlan?.plan) avec
 *   fuel { totalL, tripFuelL }, ou null.
 */
export function resolveLoads(acId, plan) {
    const saved = readWbLoads(acId);
    const burnL = (plan?.fuel?.tripFuelL > 0)
        ? Math.round(plan.fuel.tripFuelL)
        : (saved ? saved.burnL : 0);
    if (saved) return { masses: saved.masses, fuelL: saved.fuelL, burnL };
    return {
        masses: {},
        fuelL: (plan?.fuel?.totalL > 0) ? Math.round(plan.fuel.totalL) : 0,
        burnL,
    };
}

// ----------------------------------------------------------------
// Centrogramme SVG (écran) — même discipline que takeoff-profile.js :
// fonctions pures (layout + svg) et un mount avec ResizeObserver qui
// re-rend à la largeur réelle pour garder les textes à 10 px.
// ----------------------------------------------------------------
const PAD_T = 10, PAD_B = 30;
let _uidSeq = 0;

const CHART_COLORS = {
    grid: 'rgba(255,255,255,0.08)',
    tick: 'var(--text-muted, #94A3B8)',
    axis: 'rgba(255,255,255,0.25)',
    envFill: 'rgba(56,189,248,0.12)',
    envStroke: '#38BDF8',
    mtow: '#EF4444',
    ptTakeoff: '#34D399',
    ptArrival: '#FBBF24',
    ptZfw: '#F87171',
    ptEmpty: '#94A3B8',
};

/** Formate un nombre pour un tick d'axe (décimales selon l'unité, sans .0). */
function _fmtTick(v, unit) {
    const dec = unit === 'm' ? 2 : (unit === 'in' ? 1 : 0);
    let s = v.toFixed(dec);
    if (s.endsWith('.0')) s = s.slice(0, -2);
    return s;
}

/**
 * Calcule les échelles et positions px du centrogramme.
 * @returns layout {W,H,xOf,yOf,ticksX[],ticksY[],axisPad} (positions en px)
 */
export function wbChartLayout(wb, calc, width = 340) {
    const unitArm = wb.units?.arm || 'mm';
    const unitMass = wb.units?.mass || 'kg';
    // Échelles calées sur les données UTILES : enveloppe + points
    // décollage/arrivée/ZFW + MTOW. Le point « à vide » n'est plus tracé
    // ni inclus (il tirait les axes sous la masse mini de l'enveloppe et
    // écrasait le dessin).
    const arms = [...wb.envelope.map(p => p[1])];
    const masses = [...wb.envelope.map(p => p[0])];
    for (const p of [calc.takeoff, calc.arrival, calc.zfw]) {
        if (p.cgMm != null && isFinite(p.cgMm)) arms.push(p.cgMm);
        masses.push(p.massKg);
    }
    let aMin = Math.min(...arms), aMax = Math.max(...arms);
    let mMin = Math.min(...masses), mMax = Math.max(...masses);
    if (wb.mtowKg > 0) mMax = Math.max(mMax, wb.mtowKg);
    // Marge minimale de respiration (5 %) autour des min/max réels.
    const padA = (aMax - aMin) * 0.05 || 20;
    const padM = (mMax - mMin) * 0.05 || 20;
    aMin -= padA; aMax += padA; mMin = Math.max(0, mMin - padM); mMax += padM;

    // Dimensions ADAPTÉES à la largeur : hauteur ~1/3 de la largeur (bornée)
    // et marges horizontales SYMÉTRIQUES — à gauche les labels de masse +
    // titre d'axe, à droite la place des étiquettes de points. Le rectangle
    // de tracé reste ainsi centré dans le panneau, quelle que soit sa largeur.
    const W = width;
    const CH = Math.max(170, Math.min(260, Math.round(W * 0.33)));
    const yLabels = [];
    for (let i = 0; i <= 4; i++) {
        yLabels.push(_fmtTick(massFromKg(mMin + (mMax - mMin) * i / 4, unitMass), unitMass));
    }
    const labelW = Math.max(...yLabels.map(s => s.length)) * 5.4;
    const PAD = Math.max(42, Math.min(64, Math.round(labelW + 22)));
    const H = CH + PAD_T + PAD_B;
    const xL = PAD, xR = W - PAD, yT = PAD_T, yB = PAD_T + CH;
    const xOf = a => xL + ((a - aMin) / (aMax - aMin)) * (xR - xL);
    const yOf = m => yT + (1 - (m - mMin) / (mMax - mMin)) * CH;

    const ticksX = [], ticksY = [];
    for (let i = 0; i <= 4; i++) {
        const f = i / 4;
        ticksX.push({ px: xL + f * (xR - xL),
                      label: _fmtTick(armFromMm(aMin + f * (aMax - aMin), unitArm), unitArm) });
        ticksY.push({ px: yT + (1 - f) * CH, label: yLabels[i] });
    }
    return { W, H, CH, xL, xR, yT, yB, xOf, yOf, ticksX, ticksY, unitArm, unitMass, labelW,
             armRange: [aMin, aMax], massRange: [mMin, mMax] };
}

/**
 * Génère le SVG du centrogramme (string). Étiquettes des points :
 * Décollage à droite, Arrivée à GAUCHE à sa hauteur, ZFW à droite,
 * À vide discret — mise en page validée en maquette.
 * @param {Object} [opts] { hidePointLabels: true } pour l'aperçu compact.
 */
export function wbChartSvg(wb, calc, isFr = true, width = 340, opts = {}) {
    const L = wbChartLayout(wb, calc, width);
    const uid = 'wb' + (++_uidSeq);
    const C = CHART_COLORS;
    const fmt = (v, dec = 0) => {
        const s = v.toFixed(dec);
        return isFr ? s.replace('.', ',') : s;
    };
    const val = (kg) => fmt(massFromKg(kg, L.unitMass));

    // Les 3 points : nom + masse AVEC son unité (le CG n'est pas répété sur
    // le graphe — il est dans les lignes de résultats / cellules du PDF).
    // Décollage/ZFW à droite, Arrivée à gauche, avec BASCULE de côté si
    // l'étiquette déborderait du graphe et décalage vertical de 11 px entre
    // étiquettes d'un même côté (points proches).
    // opts.hideArrival (vol local) : pas de point Arrivée — confondu avec
    // le Décollage, on ne le trace pas.
    const defs = [
        { p: calc.takeoff, col: C.ptTakeoff, r: 3.2, text: `${isFr ? 'Décollage' : 'Takeoff'} ${val(calc.takeoff.massKg)} ${L.unitMass}`, side: 'right' },
        ...(opts.hideArrival ? [] : [{ p: calc.arrival, col: C.ptArrival, r: 2.8, text: `${isFr ? 'Arrivée' : 'Landing'} ${val(calc.arrival.massKg)} ${L.unitMass}`, side: 'left' }]),
        { p: calc.zfw, col: C.ptZfw, r: 2.8, text: `ZFW ${val(calc.zfw.massKg)} ${L.unitMass}`, side: 'right' },
    ].filter(d => d.p.cgMm != null && isFinite(d.p.cgMm));

    let ptsSvg = defs.map(d =>
        `<circle cx="${L.xOf(d.p.cgMm).toFixed(1)}" cy="${L.yOf(d.p.massKg).toFixed(1)}" r="${d.r}" fill="${d.col}"/>`).join('');
    if (!opts.hidePointLabels) {
        const labs = defs.map(d => {
            const x = L.xOf(d.p.cgMm), y = L.yOf(d.p.massKg);
            const w = d.text.length * 5.9 + 2;
            let side = d.side;
            if (side === 'right' && x + 8 + w > L.xR - 2) side = 'left';
            else if (side === 'left' && x - 8 - w < L.xL + 2) side = 'right';
            return { x, y, w, side, text: d.text, col: d.col };
        });
        for (const side of ['right', 'left']) {
            const group = labs.filter(l => l.side === side).sort((a, b) => a.y - b.y);
            for (let i = 1; i < group.length; i++) {
                if (Math.abs(group[i].y - group[i - 1].y) < 11) group[i].y = group[i - 1].y + 11;
            }
        }
        ptsSvg += labs.map(l =>
            `<text x="${(l.x + (l.side === 'left' ? -8 : 8)).toFixed(1)}" y="${(l.y + 3).toFixed(1)}" text-anchor="${l.side === 'left' ? 'end' : 'start'}" fill="${l.col}" font-size="10">${l.text}</text>`).join('');
    }

    // Enveloppe (polygone fermé) — points réordonnés en polygone simple.
    const envPts = normalizeEnvelope(wb.envelope)
        .map(([m, a]) => `${L.xOf(a).toFixed(1)},${L.yOf(m).toFixed(1)}`).join(' ');
    // Ligne MTOW (rouge pointillée).
    const mtowY = (wb.mtowKg > 0 && wb.mtowKg >= L.massRange[0] && wb.mtowKg <= L.massRange[1])
        ? `<line x1="${L.xL}" y1="${L.yOf(wb.mtowKg).toFixed(1)}" x2="${L.xR}" y2="${L.yOf(wb.mtowKg).toFixed(1)}" stroke="${C.mtow}" stroke-width="1" stroke-dasharray="5 3" opacity="0.9"/>` +
          `<text x="${(L.xR - 2).toFixed(1)}" y="${(L.yOf(wb.mtowKg) - 4).toFixed(1)}" text-anchor="end" fill="${C.mtow}" font-size="9">MTOW ${val(wb.mtowKg)}</text>`
        : '';

    const grid = L.ticksX.map(t =>
        `<line x1="${t.px.toFixed(1)}" y1="${L.yT}" x2="${t.px.toFixed(1)}" y2="${L.yB}" stroke="${C.grid}" stroke-width="1"/>` +
        `<text x="${t.px.toFixed(1)}" y="${(L.yB + 13).toFixed(1)}" text-anchor="middle" fill="${C.tick}" font-size="9">${t.label}</text>`).join('') +
        L.ticksY.map(t =>
            `<line x1="${L.xL}" y1="${t.px.toFixed(1)}" x2="${L.xR}" y2="${t.px.toFixed(1)}" stroke="${C.grid}" stroke-width="1"/>` +
            `<text x="${(L.xL - 5).toFixed(1)}" y="${(t.px + 3).toFixed(1)}" text-anchor="end" fill="${C.tick}" font-size="9">${t.label}</text>`).join('');

    const axisTitle = isFr ? `Bras de levier (${L.unitArm})` : `Arm (${L.unitArm})`;
    const massTitle = isFr ? `Masse (${L.unitMass})` : `Weight (${L.unitMass})`;

    return `<svg viewBox="0 0 ${L.W} ${L.H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block;" role="img" aria-label="Centrogramme">
<g>${grid}</g>
<line x1="${L.xL}" y1="${L.yT}" x2="${L.xL}" y2="${L.yB}" stroke="${C.axis}" stroke-width="1"/>
<line x1="${L.xL}" y1="${L.yB}" x2="${L.xR}" y2="${L.yB}" stroke="${C.axis}" stroke-width="1"/>
<polygon points="${envPts}" fill="${C.envFill}" stroke="${C.envStroke}" stroke-width="1.5"/>
${mtowY}
<g>${ptsSvg}</g>
<text x="${((L.xL + L.xR) / 2).toFixed(1)}" y="${(L.H - 3).toFixed(1)}" text-anchor="middle" fill="${C.tick}" font-size="10" font-weight="600">${axisTitle}</text>
<text x="${Math.max(9, L.xL - 5 - Math.round(L.labelW) - 12).toFixed(1)}" y="${((L.yT + L.yB) / 2).toFixed(1)}" text-anchor="middle" fill="${C.tick}" font-size="10" font-weight="600" transform="rotate(-90 ${Math.max(9, L.xL - 5 - Math.round(L.labelW) - 12).toFixed(1)} ${(L.yT + L.yB) / 2})">${massTitle}</text>
</svg>`;
}

/**
 * Monte le centrogramme dans un hôte HTML : rend initial à 340 px puis
 * re-rend à la largeur réelle (textes 10 px à l'échelle 1:1), suivi
 * par ResizeObserver. Retourne une fonction de démontage.
 */
export function mountWbChart(host, wb, calc, isFr = true, opts = {}) {
    if (!host) return () => {};
    let ro = null;
    const render = (width) => { host.innerHTML = wbChartSvg(wb, calc, isFr, Math.max(240, Math.round(width)), opts); };
    render(340);
    const w = host.clientWidth;
    if (w > 0 && Math.abs(w - 340) > 8) render(w);
    if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver((entries) => {
            const cw = entries[0]?.contentRect?.width;
            if (cw > 0) render(cw);
        });
        ro.observe(host);
    }
    return () => { if (ro) ro.disconnect(); host.innerHTML = ''; };
}
