/* ================================================================
 * WB UI — Widget dashboard « Centrage »
 * ================================================================
 *
 * Panneau repliable sous « Performance décollage », relié à l'avion
 * actif de la flotte. Affiche le centrogramme (enveloppe + points
 * décollage / arrivée / ZFW), permet de saisir le chargement du jour
 * (postes de l'avion, carburant embarqué — pré-rempli du plan de nav,
 * modifiable) et donne le verdict dedans/dehors enveloppe + marge MTOW.
 * L'essence consommée n'apparaît qu'en mode NAVIGATION : lecture seule,
 * issue du plan de vol (trajet à destination). En vol local elle n'a
 * pas lieu d'être (point Arrivée confondu avec le Décollage).
 *
 * La configuration (enveloppe, postes, masse à vide, unités) se gère
 * dans la fenêtre Flotte : ce widget ne fait que consommer/afficher.
 * ================================================================ */

import { state, escapeHtml } from './core.js';
import { makeCollapsible } from './collapsible.js';
import { getFlightMode } from './flight-mode.js';
import { getActiveAircraft } from './aircraft-fleet.js';
import { openFleetManager } from './fleet-ui.js';
import {
    computeWb, resolveLoads, writeWbLoads, mountWbChart,
    armFromMm, massFromKg, massToKg, armDecimals,
} from './wb-core.js';

let _chartDispose = null;
// Pop-up « carburant insuffisant » déjà affiché pour l'épisode courant
// (reset dès que l'embarqué atteint le requis, re-alerte ensuite si rechute).
let _fuelWarnActive = false;

/** Navigation + plan actif → carburant requis {totalL, tripFuelL, reserveL}, sinon null. */
function _requiredFuel() {
    if (getFlightMode() !== 'nav') return null;
    const f = state._lastNavPlan?.plan?.fuel;
    return (f && f.totalL > 0) ? f : null;
}

/** Masse affichée (unité de l'avion) → chaîne arrondie. */
const _m = (kg, u) => Math.round(massFromKg(kg, u));
/** Bras mm → chaîne dans l'unité de l'avion (décimales selon l'unité). */
const _a = (mm, u) => String(+(armFromMm(mm, u).toFixed(armDecimals(u))));

/** Parse une saisie (accepte la virgule décimale). */
const _num = (v) => parseFloat(String(v ?? '').replace(',', '.'));

/**
 * Affiche/masque le widget centrage pour l'avion actif.
 * @param {string|null} icao Code OACI courant (null = masquer, comme
 *   les autres widgets du dashboard : le centrage se consulte en
 *   préparation de vol, une fois un terrain sélectionné).
 */
export function refreshWbWidget(icao = state.requestedIcao) {
    const container = document.getElementById('wb-widget');
    if (!container) return;

    if (!icao) {
        container.style.display = 'none';
        return;
    }
    const ac = getActiveAircraft();
    if (!ac?.wb) {
        container.style.display = 'none';
        return;
    }

    const isFr = state.lang === 'fr';
    const body = makeCollapsible(container, isFr ? 'Centrage' : 'Weight & balance', 'scale');

    // Bouton « Flotte » dans le header repliable (même pattern que le
    // widget Performance décollage) : accès direct à la configuration.
    const header = container.querySelector('.collapsible-header');
    if (header && !header.querySelector('#wb-fleet-btn')) {
        const lblManage = isFr ? 'Gérer la flotte' : 'Manage fleet';
        const fleetBtn = document.createElement('button');
        fleetBtn.id = 'wb-fleet-btn';
        fleetBtn.className = 'fleet-open-btn';
        fleetBtn.title = lblManage;
        fleetBtn.style.cssText = 'background:none; border:1px solid var(--border-color); color:var(--text-muted); border-radius:6px; padding:3px 8px; font-size:11px; cursor:pointer; display:flex; align-items:center; gap:4px; margin-left:auto; margin-right:8px;';
        fleetBtn.innerHTML = `<i data-lucide="plane" style="width:13px;height:13px;"></i> ${isFr ? 'Flotte' : 'Fleet'}`;
        fleetBtn.addEventListener('click', (e) => e.stopPropagation());
        fleetBtn.addEventListener('click', () => openFleetManager(() => { refreshWbWidget(icao); }));
        header.appendChild(fleetBtn);
        if (window.lucide) window.lucide.createIcons({ root: header });
    }

    _render(body, ac, isFr);
    container.style.display = 'block';
}

/** Construit le widget une fois, puis recalcule à chaque saisie. */
function _render(body, ac, isFr) {
    const wb = ac.wb;
    const u = wb.units;
    const plan = state._lastNavPlan?.plan;
    const loads = resolveLoads(ac.id, plan);
    // L'essence consommée n'existe qu'en navigation (lecture seule, plan
    // de vol) : en vol local le point Arrivée est confondu avec le Décollage.
    const isNav = getFlightMode() === 'nav';

    // Postes sans bras (saisie incomplète côté flotte) : ignorés ici.
    const usable = (s) => s.armMm != null && isFinite(s.armMm);
    const stations = wb.stations.filter(s => !s.fuel && usable(s));
    const fuelSt = wb.stations.find(s => s.fuel && usable(s));

    // Grille « chargement du jour » : 4 postes MAX par ligne ; le carburant
    // (et la consommée en navigation) ouvre TOUJOURS la ligne suivante,
    // accompagné des postes restants (ex. Bagages 1/2).
    const stCell = (s) => `
        <label class="wb-load">
            <span class="wb-load-lab"><span class="lab">${escapeHtml(s.name)}</span>${s.maxKg ? ` <span class="val">Max ${_m(s.maxKg, u.mass)}</span>` : ''}</span>
            <input type="number" step="any" min="0" name="wb-load" aria-label="Masse embarquée au poste" class="wb-load-in" data-key="st:${escapeHtml(s.name)}" data-max="${s.maxKg || ''}" value="${loads.masses[s.name] ?? ''}" placeholder="0">
            <input type="range" name="wb-load-range" aria-label="Réglage de la masse" class="wb-load-range" data-key="st:${escapeHtml(s.name)}" min="0" max="${s.maxKg ? Math.max(1, Math.round(massFromKg(s.maxKg, u.mass))) : 150}" step="1" value="${Math.round(massFromKg(loads.masses[s.name] || 0, u.mass))}">
        </label>`;
    const fuelCell = fuelSt ? `
        <label class="wb-load wb-load-fuel" title="${isFr
            ? (isNav
                ? 'Quantité totale embarquée au décollage — pré-remplie du plan de nav (trajet + réserve), modifiable.'
                : 'Quantité totale embarquée au décollage — saisie libre, mémorisée pour cet avion.')
            : (isNav
                ? 'Total fuel at takeoff — pre-filled from the nav plan (trip + reserve), editable.'
                : 'Total fuel at takeoff — free entry, saved for this aircraft.')}">
            <span class="wb-load-lab"><span class="lab">${isFr ? 'Carburant embarqué (L)' : 'Fuel on board (L)'}</span>${fuelSt.maxKg ? ` <span class="val">Max ${fuelSt.maxKg}</span>` : ''}</span>
            <input type="number" step="any" min="0" id="wb-fuel-l" data-key="fuel" data-max="${fuelSt.maxKg || ''}" value="${loads.fuelL || ''}" placeholder="0">
            <input type="range" name="wb-load-range" aria-label="Réglage de la masse" class="wb-load-range" data-key="fuel" min="0" max="${fuelSt.maxKg ? Math.max(1, Math.round(fuelSt.maxKg)) : 200}" step="1" value="${Math.round(loads.fuelL || 0)}">
        </label>` : '';
    const burnCell = (fuelSt && isNav) ? `
        <label class="wb-load wb-load-fuel" title="${isFr ? 'Essence consommée jusqu\u2019à destination, issue du plan de vol (trajet, sans la réserve) — non modifiable. Le point Arrivée est calculé avec le carburant restant (embarqué − consommée).' : 'Fuel burned to destination, from the flight plan (trip, no reserve) — read-only. The landing point uses the remaining fuel (on board − burned).'}">
            <span class="wb-load-lab"><span class="lab">${isFr ? 'Consommée (L)' : 'Burned (L)'}</span> <span class="val dim">${isFr ? 'plan de vol' : 'flight plan'}</span></span>
            <input type="hidden" id="wb-burn-l" data-key="burn" value="${loads.burnL || ''}">
            <div class="wb-burn-ro">${loads.burnL || 0}</div>
        </label>` : '';
    const line1 = stations.slice(0, 4);
    const rest = stations.slice(4);

    body.innerHTML = `
        <div class="wb-ac-line">
            <span class="wb-ac-reg">${escapeHtml(ac.registration || ac.name)}${ac.type ? ' · ' + escapeHtml(ac.type) : ''}</span>
            <span class="wb-units">${u.mass} / ${u.arm}</span>
        </div>
        <div class="fleet-wb-sub">${isFr ? `CHARGEMENT DU JOUR (${u.mass.toUpperCase()})` : `TODAY'S LOADING (${u.mass.toUpperCase()})`}</div>
        ${line1.length ? `<div class="wb-load-grid">${line1.map(stCell).join('')}</div>` : ''}
        ${(rest.length || fuelCell || burnCell) ? `<div class="wb-load-grid">${rest.map(stCell).join('')}${fuelCell}${burnCell}</div>` : ''}
        <div class="wb-chart-host"></div>
        <div class="wb-results">
            <div class="wb-res"><span class="wb-dot wb-dot-to"></span><span class="wb-res-val" id="wb-res-to"></span></div>
            ${isNav ? `<div class="wb-res"><span class="wb-dot wb-dot-ar"></span><span class="wb-res-val" id="wb-res-ar"></span></div>` : ''}
            <div class="wb-res"><span class="wb-dot wb-dot-zf"></span><span class="wb-res-val" id="wb-res-zf"></span></div>
        </div>
        <div class="wb-verdict" id="wb-verdict"></div>
        <div class="wb-note">
            <i data-lucide="info" style="width:11px;height:11px;vertical-align:middle;"></i>
            ${isFr
                ? (isNav
                    ? 'Carburant embarqué pré-rempli du plan de nav (modifiable) ; essence consommée = trajet du plan de vol (non modifiable). Point Arrivée = carburant embarqué − essence consommée. Enveloppe, postes et masse à vide : fenêtre Flotte.'
                    : 'Carburant embarqué : saisie libre, mémorisée pour cet avion. Enveloppe, postes et masse à vide : fenêtre Flotte.')
                : (isNav
                    ? 'Fuel on board pre-filled from the nav plan (editable); fuel burned = flight plan trip (read-only). Landing point = fuel on board − fuel burned. Envelope, stations and empty weight: Fleet window.'
                    : 'Fuel on board: free entry, saved for this aircraft. Envelope, stations and empty weight: Fleet window.')}
        </div>
    `;
    if (window.lucide) window.lucide.createIcons({ root: body });

    body.querySelectorAll('.wb-load-in, #wb-fuel-l').forEach(input => {
        input.addEventListener('input', () => _recalc(body, ac, isFr));
    });
    // Sliders : pilotent le champ numérique associé (même data-key).
    body.querySelectorAll('input[type="range"].wb-load-range').forEach(rng => {
        rng.addEventListener('input', () => {
            const num = body.querySelector(`input[type="number"][data-key="${CSS.escape(rng.dataset.key)}"]`);
            if (num) num.value = rng.value;
            _recalc(body, ac, isFr);
        });
    });

    _recalc(body, ac, isFr);

    // Pop-up de sécurité (une seule fois par épisode) : carburant embarqué
    // insuffisant vs total requis du plan de vol. Le champ reste rouge
    // (géré dans _recalc) jusqu'à ce que la quantité soit suffisante.
    const req = _requiredFuel();
    if (req) {
        const fl2 = _num(body.querySelector('#wb-fuel-l')?.value);
        const under = !(isFinite(fl2) && fl2 + 0.05 >= req.totalL);
        if (under && !_fuelWarnActive) {
            _fuelWarnActive = true;
            const plan = state._lastNavPlan.plan;
            const route = (plan?.from?.icao && plan?.to?.icao) ? ` (${plan.from.icao} → ${plan.to.icao})` : '';
            window.alert(isFr
                ? `⚠ CARBURANT INSUFFISANT${route}\n\nEmbarqué : ${isFinite(fl2) ? fl2 : 0} L\nRequis : ${req.totalL} L (trajet ${req.tripFuelL} L + réserve ${req.reserveL} L)\n\nLe champ « Carburant embarqué » restera rouge jusqu'à ce que la quantité embarquée atteigne le total requis.`
                : `⚠ INSUFFICIENT FUEL${route}\n\nOn board: ${isFinite(fl2) ? fl2 : 0} L\nRequired: ${req.totalL} L (trip ${req.tripFuelL} L + reserve ${req.reserveL} L)\n\nThe "Fuel on board" field stays red until the quantity on board reaches the required total.`);
        }
    }
}

/** Relit les saisies, recalcule, rafraîchit graphe + résultats + verdict. */
function _recalc(body, ac, isFr) {
    const wb = ac.wb;
    const u = wb.units;
    // Vol local : pas de point/ligne Arrivée (confondu avec le Décollage).
    const isNav = getFlightMode() === 'nav';

    // Saisies → chargement interne (kg / litres). data-key : "st:Nom" pour
    // les postes, "fuel"/"burn" pour le carburant.
    const loads = { masses: {}, fuelL: 0, burnL: 0 };
    body.querySelectorAll('.wb-load-in').forEach(inp => {
        const name = (inp.dataset.key || '').startsWith('st:') ? inp.dataset.key.slice(3) : null;
        if (!name) return;
        const v = _num(inp.value);
        if (isFinite(v) && v > 0) loads.masses[name] = massToKg(v, u.mass);
        // Pastille ambre si le max du poste est dépassé.
        const max = _num(inp.dataset.max);
        const over = max > 0 && isFinite(v) && v > massFromKg(max, u.mass) + 1e-9;
        inp.classList.toggle('wb-over', over);
    });
    const fl = _num(body.querySelector('#wb-fuel-l')?.value);
    const bl = _num(body.querySelector('#wb-burn-l')?.value);
    loads.fuelL = (isFinite(fl) && fl > 0) ? fl : 0;
    loads.burnL = (isFinite(bl) && bl > 0) ? bl : 0;
    // Carburant : pastille ambre si la capacité (max du poste, en litres) est dépassée.
    const fuelIn = body.querySelector('#wb-fuel-l');
    if (fuelIn) {
        const maxL = _num(fuelIn.dataset.max);
        fuelIn.classList.toggle('wb-over', maxL > 0 && isFinite(fl) && fl > maxL + 1e-9);
        // Sécurité (navigation) : rouge tant que l'embarqué est inférieur au
        // total requis du plan de vol (trajet + réserve).
        const req = _requiredFuel();
        const under = !!req && loads.fuelL + 0.05 < req.totalL;
        fuelIn.classList.toggle('wb-under', under);
        if (!under) _fuelWarnActive = false;
    }
    writeWbLoads(ac.id, loads);

    const calc = computeWb(wb, loads);

    // Graphe (remonté à chaque saisie : léger) — en vol local le point
    // Arrivée n'est pas tracé (superposé au Décollage).
    if (_chartDispose) { _chartDispose(); _chartDispose = null; }
    const host = body.querySelector('.wb-chart-host');
    if (host) _chartDispose = mountWbChart(host, wb, calc, isFr, isNav ? {} : { hideArrival: true });

    // Résultats : Décollage (vert) / Arrivée (orange) / ZFW (rouge) — masse
    // et CG seuls (le bandeau verdict ci-dessous porte marges et alertes).
    const burnL = Math.round(calc.burnKg / (wb.fuelDensity || 0.72));
    const mkLine = (label, p) => {
        const cgTxt = p.cgMm == null ? '—' : `${_a(p.cgMm, u.arm)} ${u.arm}`;
        return `<b>${label}</b> ${_m(p.massKg, u.mass)} ${u.mass} · CG ${cgTxt}`;
    };
    const set = (sel, html) => { const el = body.querySelector(sel); if (el) el.innerHTML = html; };
    set('#wb-res-to', mkLine(isFr ? 'Décollage :' : 'Takeoff:', calc.takeoff));
    set('#wb-res-ar', mkLine(burnL > 0
        ? (isFr ? `Arrivée (−${burnL} L) :` : `Landing (−${burnL} L):`)
        : (isFr ? 'Arrivée :' : 'Landing:'), calc.arrival));
    set('#wb-res-zf', mkLine(isFr ? 'ZFW (zéro carburant) :' : 'ZFW (zero fuel):', calc.zfw));

    // Bandeau verdict.
    const vEl = body.querySelector('#wb-verdict');
    if (!vEl) return;
    if (calc.level === 'ok') {
        const p = calc.points.takeoff;
        const U = u.arm.toUpperCase();
        vEl.className = 'wb-verdict ok';
        vEl.innerHTML = isFr
            ? `CG DÉCOLLAGE ${_a(calc.takeoff.cgMm, u.arm)} ${U} · DANS L'ENVELOPPE · MARGE AVANT ${_a(p.fwdMm, u.arm)} ${U} / ARRIÈRE ${_a(p.aftMm, u.arm)} ${U}`
            : `TAKEOFF CG ${_a(calc.takeoff.cgMm, u.arm)} ${U} · IN ENVELOPE · FWD ${_a(p.fwdMm, u.arm)} ${U} / AFT ${_a(p.aftMm, u.arm)} ${U}`;
    } else {
        const reasons = [];
        if (!calc.mtowOk) reasons.push(isFr
            ? `masse décollage > MTOW (${_m(calc.takeoff.massKg, u.mass)} > ${_m(wb.mtowKg, u.mass)} ${u.mass})`
            : `takeoff weight > MTOW (${_m(calc.takeoff.massKg, u.mass)} > ${_m(wb.mtowKg, u.mass)} ${u.mass})`);
        for (const [k, lbl] of [['takeoff', isFr ? 'décollage' : 'takeoff'],
                                 ...(isNav ? [['arrival', isFr ? 'arrivée' : 'landing']] : []),
                                 ['zfw', 'ZFW']]) {
            if (!calc.points[k].inside) reasons.push(`${lbl} ${isFr ? 'hors enveloppe' : 'out of envelope'}`);
        }
        vEl.className = 'wb-verdict danger';
        vEl.innerHTML = `${isFr ? 'HORS LIMITES' : 'OUT OF LIMITS'} — ${reasons.join(' · ')}`;
    }

    // Resynchronise les sliders sur les valeurs saisies.
    body.querySelectorAll('input[type="range"].wb-load-range').forEach(rng => {
        const num = body.querySelector(`input[type="number"][data-key="${CSS.escape(rng.dataset.key)}"]`);
        if (!num) return;
        const v = _num(num.value);
        rng.value = (isFinite(v) && v > 0) ? Math.min(v, Number(rng.max)) : 0;
    });
}
