import { state, escapeHtml, fetchAvecRelais } from './core.js';
import { getAirportByICAO, enrichAirport } from './ui-module.js';
import { getActiveAircraftId, getActiveAircraft, getFleet, updateAircraft } from './aircraft-fleet.js';
import { getActiveRunwayNameForIcao, evaluateTakeoffFromRaw, getAircraftRef } from './takeoff-performance.js';
import { drawNavLogPdf } from './navlog-pdf.js';
import { computeWb, resolveLoads, normalizeEnvelope } from './wb-core.js';
import { makeCollapsible } from './collapsible.js';
import { computeFlightPlan, computeMultiLegFlightPlan, getDefaultAircraftPerf, greatCircleDistanceNm, RESERVES } from './flight-planner.js';
import { getActiveRunwaySurfaceInfo, isSoftSurface } from './runway-surface.js';
import { getEnRouteAlternates } from './alternates.js';
import { renderElevationChart, clearElevationChart } from './elevation-chart.js';
import { fetchAirportByIcao } from './openaip.js';
import { loadFreqSources, getAirportFreqs } from './freq-sia.js';
import { getSiaAirfield } from './sia-data.js';

const LS_PERF_PREFIX = 'ac-perf-';

// Retourne la fréquence principale (TWR/AFIS) d'un terrain, ou null si non disponible.
function _getMainFreq(icao) {
    const apt = getAirportByICAO(icao);
    if (!apt?.frequencies?.length) return null;
    const primary = apt.frequencies.find(f => f.primary) || apt.frequencies.find(f => f.type === 'TWR' || f.type === 'AFIS');
    return primary || apt.frequencies[0];
}

/** Meilleure fréquence d'une étape pour le « Détail des waypoints » :
 *  SIA officiel en priorité (types RÉELS : TWR, AFIS, APP, FIS, ATIS…),
 *  à défaut openAIP (types souvent génériques COM/UNK). Un terrain
 *  FRANÇAIS connu sans fréquence fixe reçoit 123.500 MHz (fréquence
 *  standard VFR en l'absence de fréquence spécifique). Retourne
 *  { freq, type } ou null. */
function _legMainFreq(icao) {
    const { source, freqs } = getAirportFreqs(icao, getAirportByICAO(icao)?.frequencies || []);
    if (freqs.length) {
        // Ordre de préférence : tour/AFIS du terrain, puis approche, FIS,
        // ATIS, et enfin A/A (air-air : seul service de nombreux petits
        // terrains — Ploërmel, LFEV…).
        const prio = ['TWR', 'AFIS', 'APP', 'FIS', 'ATIS', 'A/A'];
        for (const t of prio) {
            let f = freqs.find(x => x.type === t);
            // Plusieurs A/A publiées (ex. LFOM : « SAINT LAURENT » 123.500
            // ET « LESSAY » 128.930) : celle au nom du terrain d'abord,
            // sinon une valeur différente de la standard 123.500.
            if (t === 'A/A') {
                const cands = freqs.filter(x => x.type === t);
                if (cands.length > 1) {
                    const apt = getAirportByICAO(icao);
                    const word = (apt?.name || '').split(/[\s-]/)[0]?.toUpperCase();
                    f = cands.find(x => word && (x.name || '').toUpperCase().includes(word))
                        || cands.find(x => Math.abs((x.freq || 0) - 123.5) > 0.001)
                        || cands[0];
                }
            }
            if (f) return f;
        }
        return freqs[0];
    }
    if (/^LF/.test(String(icao || '')) && getAirportByICAO(icao)) {
        return { freq: 123.5, type: 'STD' };
    }
    return null;
}

// Charge les fréquences manquantes des waypoints en arrière-plan, puis re-rend le panneau.
function _preloadWaypointFreqs(plan, reRenderFn) {
    if (!plan?.waypoints) return;
    const missing = plan.waypoints.filter(w => !_getMainFreq(w.icao));
    if (!missing.length) return;
    Promise.all(missing.map(w =>
        fetchAirportByIcao(w.icao).then(e => { if (e) enrichAirport(w.icao, e); }).catch(() => {})
    )).then(() => { if (typeof reRenderFn === 'function') reRenderFn(); });
}

// Perf nav (TAS, conso) : la FLOTTE est la source de vérité — champs
// « Vitesse croisière / Conso croisière » des caractéristiques de l'avion.
// L'ancien stockage ac-perf-<id> (saisies du planificateur) est relu une
// dernière fois pour les avions qui n'ont pas encore ces champs, puis la
// première saisie le recopie dans la flotte et vide l'ancienne clé.
function _readPerf(acId) {
    const def = getDefaultAircraftPerf();
    if (!acId) return def;
    const ac = getFleet().find(a => a.id === acId) || {};
    let tasKt = typeof ac.cruiseSpeedKt === 'number' ? ac.cruiseSpeedKt : null;
    let fuelBurnLph = typeof ac.fuelBurnLph === 'number' ? ac.fuelBurnLph : null;
    if (tasKt == null || fuelBurnLph == null) {
        try {
            const raw = localStorage.getItem(LS_PERF_PREFIX + acId);
            if (raw) {
                const p = JSON.parse(raw);
                if (tasKt == null && typeof p.tasKt === 'number') tasKt = p.tasKt;
                if (fuelBurnLph == null && typeof p.fuelBurnLph === 'number') fuelBurnLph = p.fuelBurnLph;
            }
        } catch {   }
    }
    return { tasKt: tasKt ?? def.tasKt, fuelBurnLph: fuelBurnLph ?? def.fuelBurnLph };
}

function _writePerf(acId, tasKt, fuelBurnLph) {
    if (!acId) return;
    // Persiste dans les caractéristiques de l'avion (flotte) et retire
    // l'ancienne clé ac-perf (migration effectuée).
    updateAircraft(acId, { cruiseSpeedKt: tasKt, fuelBurnLph });
    try { localStorage.removeItem(LS_PERF_PREFIX + acId); } catch {   }
}

// Garde-fou anti-récursion PARTAGÉ : le callback de _preloadWaypointFreqs (dans
// showFlightPlanner) et recalc (dans _wireInputs) doivent voir le MÊME flag.
// Déclaré au niveau module — sinon ReferenceError dans le callback de re-render.
let _recalculating = false;

export async function showFlightPlanner(fromIcao, toIcao) {
    const container = document.getElementById('flight-planner-panel');
    if (!container) return;
    loadFreqSources();   // SIA + overrides : fréquences réelles des étapes

    if (!fromIcao || !toIcao || fromIcao === toIcao) {
        container.style.display = 'none';
        return;
    }

    const isFr = state.lang === 'fr';
    const acId = getActiveAircraftId();
    const perf = _readPerf(acId);

    const body = makeCollapsible(container, isFr ? 'Calcul de navigation' : 'Flight plan', 'navigation');

    let cruiseAlt = 2500;
    const altInput = body.querySelector('#fp-cruise-alt');
    if (altInput && altInput.value) cruiseAlt = parseInt(altInput.value, 10);
    const tasInput = body.querySelector('#fp-tas');
    let tasKt = tasInput?.value ? parseInt(tasInput.value, 10) : perf.tasKt;
    const burnInput = body.querySelector('#fp-burn');
    let burn = burnInput?.value ? parseInt(burnInput.value, 10) : perf.fuelBurnLph;
    const nightInput = body.querySelector('#fp-night');
    const isNight = nightInput ? nightInput.checked : false;

    _renderLoading(body, fromIcao, toIcao, cruiseAlt, tasKt, burn, isNight, isFr);

    // Multi-waypoints si state.route est défini (≥3 OACI), sinon plan A→B simple.
    const route = (Array.isArray(state.route) && state.route.length >= 3)
        ? state.route : [fromIcao, toIcao];
    const plan = route.length >= 3
        ? await computeMultiLegFlightPlan(route, { cruiseAltFt: cruiseAlt, tasKt, fuelBurnLph: burn, isNight })
        : await computeFlightPlan(fromIcao, toIcao, { cruiseAltFt: cruiseAlt, tasKt, fuelBurnLph: burn, isNight });

    if (!plan) {
        _renderError(body, fromIcao, toIcao, isFr);
        container.style.display = 'block';
        return;
    }

    _writePerf(acId, tasKt, burn);

    _renderResult(body, plan, isFr, isNight, cruiseAlt, tasKt, burn);
    container.style.display = 'block';

    // Pré-charge les fréquences des waypoints en arrière-plan puis re-rend.
    if (plan.isMultiLeg && plan.waypoints) {
        _preloadWaypointFreqs(plan, () => {
            if (!_recalculating) _renderResult(body, plan, isFr, isNight, cruiseAlt, tasKt, burn);
        });
    }

    if (plan.elevationProfile) {
        // En multi-leg, passe les waypoints intermédiaires pour les afficher
        // sur le profil — sous leur vrai nom pour les repères ZZxx.
        const waypoints = (plan.isMultiLeg && plan.waypoints)
            ? plan.waypoints.map(w => ({ icao: w.icao, name: _wpDisplayName(w.icao), lat: w.lat, lon: w.lon }))
            : null;
        renderElevationChart('elevation-profile-container', plan.elevationProfile, cruiseAlt, fromIcao, toIcao, waypoints, plan.routeAirspaces);
    } else {
        clearElevationChart('elevation-profile-container');
    }
}

function _renderLoading(container, from, to, alt, tas, burn, isNight, isFr) {
    const fromName = getAirportByICAO(from)?.name || from;
    const toName = getAirportByICAO(to)?.name || to;

    container.innerHTML = `
        <div style="font-size:11px; color:var(--text-muted); font-family:'DM Mono',monospace; margin-bottom:8px;">${escapeHtml(from)} → ${escapeHtml(to)}</div>
        ${_renderInputs(from, to, fromName, toName, alt, tas, burn, isNight, isFr)}
        <div class="fp-loading" style="padding:20px; text-align:center; color:var(--text-muted); font-size:12px;">
            <i data-lucide="loader-2" style="width:18px;height:18px;animation:spin 1s linear infinite;vertical-align:middle;margin-right:6px;"></i>
            ${isFr ? 'Récupération des vents et du relief...' : 'Fetching winds and terrain...'}
        </div>
    `;
    if (window.lucide) window.lucide.createIcons({ root: container });
    _wireInputs(container, from, to);
}

// Export PDF du log de nav A5 (d'après le modèle papier du pilote).
// Collecte les données connues de l'app : avion actif de la flotte, METAR de
// départ frais (QNH + vent pour l'en-tête, code brut pour la 1re ligne des
// Notes), piste en service, tronçons du plan avec Z sécu calculée (relief max
// du tronçon + 1000 ft, arrondi aux 500 ft sup). Les champs inconnus (pilote,
// c/sign, heures, horamètres, HEA/HRA) restent vides à remplir à la main.
async function _generateNavLogPdf() {
    // L'onglet est ouvert immédiatement, pendant que le geste utilisateur est
    // encore actif (la génération attend un METAR : un window.open tardif serait
    // bloqué comme popup). Le PDF s'y chargera une fois généré ; en cas
    // d'échec, l'onglet est refermé.
    const tab = window.open('', '_blank');
    try {
        await _generateNavLogPdfInto(tab);
    } catch (err) {
        console.error('Nav log PDF generation failed:', err);
        try { tab?.close(); } catch { /* déjà fermé */ }
    }
}

async function _generateNavLogPdfInto(tab) {
    const stash = state._lastNavPlan;
    if (!stash?.plan) return;
    const { plan, tas } = stash;
    if (!window.jspdf?.jsPDF) { console.warn('jsPDF indisponible (vendor/jspdf.umd.min.js)'); return; }

    const isMulti = Array.isArray(plan.legs) && plan.legs.length > 0;
    const legs = isMulti ? plan.legs : [{
        from: plan.from, to: plan.to, distanceNm: plan.distanceNm,
        trueCourse: plan.trueCourse, magHeading: plan.magHeading, legTimeMin: plan.legTimeMin,
    }];
    const fromIcao = legs[0].from.icao;
    const toIcao = legs[legs.length - 1].to.icao;
    const totalNm = isMulti ? plan.totalDistanceNm : plan.distanceNm;
    const totalMin = isMulti ? plan.totalTimeMin : plan.legTimeMin;

    // METAR de départ frais : QNH + vent pour l'en-tête, code brut pour les Notes.
    let metarRaw = '', qnh = '', windDir = null, windKt = null;
    try {
        metarRaw = String(await fetchAvecRelais(`https://aviationweather.gov/api/data/metar?ids=${fromIcao}&format=raw`) || '').trim().split('\n')[0] || '';
        const mQ = metarRaw.match(/\bQ(\d{4})\b/);
        if (mQ) qnh = parseInt(mQ[1], 10);
        const mW = metarRaw.match(/\b(\d{3}|VRB)(\d{2})(?:G\d{2})?KT\b/);
        if (mW) { windDir = mW[1] === 'VRB' ? 'VRB' : parseInt(mW[1], 10); windKt = parseInt(mW[2], 10); }
    } catch { /* hors ligne : champs laissés vides à compléter à la main */ }

    const ac = getActiveAircraft() || {};
    const decl = plan.declination ?? 0;
    // Piste en service alignée sur le vent RÉEL du METAR de départ (les
    // numéros de piste sont magnétiques, le vent METAR est vrai → correction
    // de déclinaison). Sans METAR : comportement historique (rose des vents).
    const rwyWind = (windKt != null && windDir != null)
        ? { dir: windDir === 'VRB' ? null : windDir, speed: windKt }
        : null;
    const runway = getActiveRunwayNameForIcao(fromIcao, rwyWind, decl) || '';
    const zRet = plan.cruiseAltFt;

    // Z sécu par tronçon : les points du profil portent un frac [0..1] sur la
    // distance TOTALE du trajet — on regarde ceux qui tombent dans le tronçon.
    const prof = plan.elevationProfile;
    let cum = 0;
    const bounds = legs.map(lg => { const b = [cum, cum + lg.distanceNm]; cum += lg.distanceNm; return b; });
    const zSecuFor = (i) => {
        if (!prof?.points?.length || cum <= 0) return '';
        const [a, b] = bounds[i];
        let max = -Infinity;
        for (const p of prof.points) {
            if (p.frac == null) continue;
            const f = p.frac * cum;
            if (f >= a - 1 && f <= b + 1 && p.elevFt > max) max = p.elevFt;
        }
        return max === -Infinity ? '' : Math.ceil((max + 1000) / 500) * 500;
    };

    let remain = totalNm;
    const rows = legs.map((lg, i) => {
        const rm = ((Math.round((lg.trueCourse ?? 0) - decl) % 360) + 360) % 360;
        const row = {
            from: _wpDisplayName(lg.from.icao), to: _wpDisplayName(lg.to.icao),
            // Distances arrondies au NM entier — lisibilité du log papier.
            distRemain: Math.round(remain), dist: Math.round(lg.distanceNm),
            zSecu: zSecuFor(i), zRet: zRet ?? '',
            rm: String(rm).padStart(3, '0'), cm: String(lg.magHeading ?? '').padStart(3, '0'),
            tsv: (tas && lg.distanceNm) ? Math.round(lg.distanceNm / tas * 60) : '',
            tav: lg.legTimeMin ?? '',
        };
        remain -= lg.distanceNm;
        return row;
    });

    const h = Math.floor((totalMin || 0) / 60), m = Math.round((totalMin || 0) % 60);
    const timeLabel = totalMin ? (h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`) : '';

    // ---- Page 2 « Calcul de navigation » : mêmes données que le bloc écran ----
    const firstLeg = legs[0];
    const wc = (isMulti ? firstLeg.windCorrection : plan.windCorrection) || {};
    const fuel = plan.fuel || {};
    const fmtEte = (min) => {
        if (!min || min < 0) return '—';
        const eh = Math.floor(min / 60), em = Math.round(min % 60);
        return eh > 0 ? `${eh}h${String(em).padStart(2, '0')}` : `${em} min`;
    };
    const legFreq = (icao) => {
        const f = _legMainFreq(icao);
        return f ? `${f.freq.toFixed(3)} ${f.type}` : '';
    };
    const calc = {
        isFr: state.lang === 'fr',
        fromIcao, toIcao,
        fromName: getAirportByICAO(fromIcao)?.name || fromIcao,
        toName: getAirportByICAO(toIcao)?.name || toIcao,
        waypoints: (isMulti && plan.waypoints?.length > 2)
            ? plan.waypoints.slice(1, -1).map(w => _wpDisplayName(w.icao)).join(' ') : '',
        cruiseAltFt: stash.alt ?? plan.cruiseAltFt, tasKt: tas,
        fuelBurnLph: stash.burn ?? '', isNight: !!stash.isNight,
        distanceNm: totalNm != null ? Math.round(totalNm) : '',
        distanceKm: (() => { const km = isMulti ? plan.totalDistanceKm : plan.distanceKm; return km != null ? Math.round(km) : ''; })(),
        trueCourse: firstLeg.trueCourse ?? '', magHeading: firstLeg.magHeading ?? '',
        declination: plan.declination ?? 0,
        wind: plan.wind || null, driftDeg: wc.driftDeg,
        groundSpeed: firstLeg.groundSpeed ?? '',
        timeLabel,
        fuel: {
            tripL: fuel.tripFuelL, reserveL: fuel.reserveL, totalL: fuel.totalL,
            reserveMin: stash.isNight ? RESERVES.NIGHT_MIN : RESERVES.DAY_MIN,
        },
        clearance: plan.clearance ? {
            maxFt: plan.elevationProfile?.maxFt ?? '',
            minClearanceFt: plan.clearance.minClearanceFt, level: plan.clearance.level,
        } : null,
        isMultiLeg: isMulti,
        legs: legs.map(lg => ({
            from: _wpDisplayName(lg.from.icao), to: _wpDisplayName(lg.to.icao), dist: Math.round(lg.distanceNm),
            hdg: lg.magHeading, eteLabel: fmtEte(lg.legTimeMin),
            fuelL: lg.fuel?.tripFuelL ?? '', freq: legFreq(lg.to.icao),
        })),
    };

    // ---- Page 3 « Performances et terrain » ----
    const FT_TO_M = ft => Math.round(ft * 0.3048);
    const isFr3 = state.lang === 'fr';

    // Perfs décollage du DÉPART, calculées sur le METAR frais récupéré
    // ci-dessus (l'état de l'app peut être affiché sur un autre terrain).
    // OAT extraite du groupe température/point de rosée (« 18/12 », « M05/… »).
    let takeoff = null;
    const mT = metarRaw.match(/\s(M?\d{2})\/M?\d{2}\s/);
    const oat = mT ? (mT[1].startsWith('M') ? -parseInt(mT[1].slice(1), 10) : parseInt(mT[1], 10)) : null;
    if (qnh != null && oat != null) {
        const t = evaluateTakeoffFromRaw(fromIcao, {
            raw: metarRaw, qnh, oat,
            // Élévation OFFICIELLE SIA (France) en priorité, sinon openAIP.
            elevationFt: getSiaAirfield(fromIcao)?.elevFt ?? getAirportByICAO(fromIcao)?.elevation ?? null,
        });
        if (t) {
            const surf = getActiveRunwaySurfaceInfo(fromIcao);
            const acRef = getAircraftRef();
            takeoff = {
                da: t.da,
                groundRollM: FT_TO_M(t.groundRoll), fiftyFtM: FT_TO_M(t.fiftyFt),
                runwayLengthM: t.runwayLength != null ? FT_TO_M(t.runwayLength) : null,
                marginM: t.margin != null ? FT_TO_M(t.margin) : null,
                level: t.level, message: t.message,
                refLabel: `${FT_TO_M(acRef.groundRoll)}/${FT_TO_M(acRef.fiftyFt)}`,
                surfaceLabel: surf ? surf.label : '—',
                surfaceSoft: surf ? isSoftSurface(surf.code) : false,
                surfacePct: t.surfaceFactor > 1 ? Math.round((t.surfaceFactor - 1) * 100) : 0,
            };
        }
    }

    // Profil d'élévation : mêmes points que le graphique écran ; les waypoints
    // intermédiaires sont localisés par le point de profil le plus proche.
    let profile = null;
    if (prof?.points?.length) {
        const first = prof.points[0], last = prof.points[prof.points.length - 1];
        profile = {
            fromIcao, toIcao,
            distTotalKm: Math.round(greatCircleDistanceNm(first.lat, first.lon, last.lat, last.lon) * 1.852),
            minFt: prof.minFt, maxFt: prof.maxFt,
            cruiseAltFt: stash.alt ?? plan.cruiseAltFt,
            points: prof.points.map(pt => ({ frac: pt.frac, elevFt: pt.elevFt })),
            waypoints: (isMulti && plan.waypoints?.length > 2)
                ? plan.waypoints.slice(1, -1).map(w => {
                    let frac = null, bestD = Infinity;
                    for (const pt of prof.points) {
                        if (pt.lat == null || pt.lon == null) continue;
                        const d = greatCircleDistanceNm(pt.lat, pt.lon, w.lat, w.lon);
                        if (d < bestD) { bestD = d; frac = pt.frac; }
                    }
                    return { icao: w.icao, name: _wpDisplayName(w.icao), frac };
                }).filter(w => w.frac != null)
                : [],
            routeAirspaces: plan.routeAirspaces ?? null,
        };
    }

    // Alternates viables à ± 25 NM de la route (départ → waypoints → dest.),
    // tous aérodromes (openAIP) — METAR de la station la plus proche si le
    // terrain n'en émet pas (marqué « * » dans le PDF).
    const routePts = (isMulti && plan.waypoints?.length)
        ? plan.waypoints.map(w => ({ icao: w.icao, lat: w.lat, lon: w.lon }))
        : [plan.from, plan.to].map(a => ({ icao: a.icao, lat: a.lat, lon: a.lon }));
    const altRows = await getEnRouteAlternates(routePts, 25, 6).catch(() => null);
    let alternates = null;
    if (altRows?.length) {
        alternates = {
            maxOffsetNm: 25,
            rows: altRows.map(r => ({
                code: r.code, name: r.name, cat: r.cat.cat,
                visiStr: r.cat.visiM >= 10000 ? '>10 km' : `${r.cat.visiM} m`,
                ceilStr: r.cat.ceilHund === 999 ? '—' : `${r.cat.ceilHund * 100} ft`,
                windStr: r.cat.wind
                    ? `${r.cat.wind.dir == null ? 'VRB' : String(r.cat.wind.dir).padStart(3, '0') + '°'} ${r.cat.wind.speed}${r.cat.wind.gust ? 'G' + r.cat.wind.gust : ''} kt`
                    : '—',
                offsetNm: Math.round(r.offsetNm),
                side: r.side >= 0 ? (isFr3 ? 'D' : 'R') : (isFr3 ? 'G' : 'L'),
                metarFrom: r.metarFrom || null, metarDistNm: r.metarDistNm ?? null,
            })),
        };
    }
    const perf = { isFr: isFr3, fromIcao, toIcao, runway, takeoff, profile, alternates };

    // Centrage : si l'avion actif a un bloc wb configuré (fenêtre Flotte),
    // la page 4 « Centrage » est ajoutée — chargement mémorisé s'il existe,
    // sinon carburant embarqué / essence consommée pré-remplis du plan.
    let centro = null;
    if (ac?.wb) {
        const loads = resolveLoads(ac.id, plan);
        centro = {
            isFr: isFr3, fromIcao,
            reg: ac.registration || ac.name, type: ac.type || '',
            wb: { ...ac.wb, envelope: normalizeEnvelope(ac.wb.envelope) },
            calc: computeWb(ac.wb, loads),
            fuelL: loads.fuelL, burnL: loads.burnL,
        };
    }

    const doc = drawNavLogPdf(window.jspdf.jsPDF, {
        isFr: state.lang === 'fr',
        aircraftType: ac.type || '', aircraftReg: ac.registration || '',
        qnh, windDir, windKt, runway,
        distanceNm: totalNm ?? '', timeLabel,
        metarRaw, rows, calc, perf, centro,
    });
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `Log-nav_${fromIcao}-${toIcao}_${today}.pdf`;
    // Le PDF s'ouvre dans un onglet, dans une PAGE HTML HABILLÉE : il y est
    // embarqué en <iframe src="data:application/pdf;base64,…">. En HTTPS le
    // visualiseur du navigateur l'affiche ; surtout, sur une origine HTTP
    // (Free.fr, pas de TLS possible) Chrome REFUSE d'afficher un blob: PDF
    // issu d'une page non sécurisée et le fait télécharger — l'iframe data:
    // contourne ce refus et rend l'aperçu. Repli : navigation blob: directe,
    // puis téléchargement classique.
    if (tab && !tab.closed) {
        try {
            const dataUri = doc.output('datauristring');
            const blobUrl = URL.createObjectURL(doc.output('blob'));
            const title = isFr3 ? `Log de nav ${fromIcao}-${toIcao}` : `Nav log ${fromIcao}-${toIcao}`;
            tab.document.open();
            tab.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>html,body{margin:0;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%}
#dl{position:fixed;right:10px;bottom:10px;z-index:9;font:12px/1 sans-serif;color:#e2e8f0;background:#1e293bdd;padding:7px 12px;border-radius:8px;text-decoration:none;border:1px solid #475569}
#dl:hover{background:#334155dd}</style></head>
<body><iframe src="${dataUri}" title="${title}"></iframe>
<a id="dl" href="${blobUrl}" download="${filename}">${isFr3 ? '⤓ Télécharger le PDF' : '⤓ Download PDF'}</a></body></html>`);
            tab.document.close();
            return;
        } catch (e) {
            try { tab.location.href = doc.output('bloburl'); return; } catch { /* on referme */ }
            try { tab.close(); } catch { /* déjà fermé */ }
        }
    }
    doc.save(filename);
}

function _renderResult(container, plan, isFr, isNight, alt, tas, burn) {
    // Gère les deux formats de plan :
    //   - single-leg : { from, to, distanceNm, trueCourse, magHeading, windCorrection, legTimeMin, ... }
    //   - multi-leg  : { waypoints[], legs[], totalDistanceNm, totalTimeMin, fuel, declination, ... }
    // On normalise vers une vue synthétique (1re jambe pour cap/vent, totaux pour distance/temps/fuel).
    const isMulti = Array.isArray(plan.legs) && plan.legs.length > 0;
    const firstLeg = isMulti ? plan.legs[0] : plan;
    const fromIcao = isMulti ? (plan.waypoints?.[0]?.icao || '') : (plan.from?.icao || '');
    const toIcao = isMulti ? (plan.waypoints?.[plan.waypoints.length - 1]?.icao || '') : (plan.to?.icao || '');

    const from = fromIcao;
    const to = toIcao;
    const fromName = getAirportByICAO(from)?.name || from;
    const toName = getAirportByICAO(to)?.name || to;

    const fmtTime = (min) => {
        if (!min || min < 0) return '—';
        const h = Math.floor(min / 60);
        const m = Math.round(min % 60);
        return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
    };

    const wind = plan.wind;
    const wc = isMulti ? (firstLeg.windCorrection || {}) : plan.windCorrection;
    const cl = plan.clearance;

    // Champs unifiés single-leg / multi-leg.
    const distanceNm = isMulti ? plan.totalDistanceNm : plan.distanceNm;
    const distanceKm = isMulti ? plan.totalDistanceKm : plan.distanceKm;
    const trueCourse = isMulti ? firstLeg.trueCourse : plan.trueCourse;
    const magHeading = isMulti ? firstLeg.magHeading : plan.magHeading;
    const declination = plan.declination ?? 0;
    const cruiseAltFt = plan.cruiseAltFt;
    const groundSpeed = isMulti ? firstLeg.groundSpeed : plan.groundSpeed;
    const legTimeMin = isMulti ? plan.totalTimeMin : plan.legTimeMin;
    const fuel = plan.fuel;

    const clearColor = cl?.level === 'danger' ? '#EF4444' : (cl?.level === 'caution' ? '#F59E0B' : '#10B981');

    // Mémorise le dernier plan rendu pour l'export PDF du log de nav (navlog-pdf.js).
    // alt/burn/isNight/isFr servent à la page 2 « Calcul de navigation ».
    state._lastNavPlan = { plan, tas, alt, burn, isNight, isFr };
    // Le widget centrage suit la consommation du plan (lecture seule en
    // navigation) : on lui signale qu'un plan vient d'être (re)calculé.
    window.dispatchEvent(new CustomEvent('navplan-changed'));

    container.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; gap:8px;">
            <div style="font-size:11px; color:var(--text-muted); font-family:'DM Mono',monospace;">${escapeHtml(from)} → ${escapeHtml(to)}</div>
            <button id="fp-navlog-pdf" class="fp-print-btn" title="${isFr ? 'Génère et ouvre le log A5 à imprimer (plan de vol + METAR de départ)' : 'Generates and opens the printable A5 nav log (flight plan + departure METAR)'}"><i data-lucide="printer"></i> ${isFr ? 'Imprimer le log de nav' : 'Print nav log'}</button>
        </div>
        ${_renderInputs(from, to, fromName, toName, alt, tas, burn, isNight, isFr)}

        <div class="fp-grid" style="gap:8px 16px; margin-top:10px;">
            <div class="fp-cell">
                <div class="fp-label">${isFr ? 'Distance' : 'Distance'}</div>
                <div class="fp-value">${distanceNm} NM <span style="color:var(--text-muted); font-size:10px;">(${distanceKm} km)</span></div>
            </div>
            <div class="fp-cell">
                <div class="fp-label">${isFr ? 'Cap vrai (TC)' : 'True course'}</div>
                <div class="fp-value">${String(trueCourse).padStart(3, '0')}°</div>
            </div>
            <div class="fp-cell">
                <div class="fp-label">${isFr ? 'Cap magnétique' : 'Magnetic heading'}</div>
                <div class="fp-value" style="color:var(--primary); font-size:16px; font-weight:800;">${String(magHeading).padStart(3, '0')}°</div>
            </div>
            <div class="fp-cell">
                <div class="fp-label">${isFr ? 'Déclinaison' : 'Declination'}</div>
                <div class="fp-value">${declination > 0 ? '+' : ''}${declination}°</div>
            </div>
        </div>

        <div class="fp-section" style="margin-top:10px; padding-top:10px; border-top:1px solid var(--border-color);">
            <div class="fp-section-title">${isFr ? 'Vent à ' + cruiseAltFt + ' ft' : 'Wind at ' + cruiseAltFt + ' ft'}</div>
            ${wind ? `
                <div class="fp-grid" style="margin-top:6px;">
                    <div class="fp-cell">
                        <div class="fp-label">${isFr ? 'Vent' : 'Wind'}</div>
                        <div class="fp-value">${String(wind.dir).padStart(3, '0')}° / ${wind.speedKt} kt</div>
                    </div>
                    <div class="fp-cell">
                        <div class="fp-label">${isFr ? 'Dérive' : 'Drift'}</div>
                        <div class="fp-value" style="color:${Math.abs(wc.driftDeg) >= 10 ? '#F59E0B' : 'var(--text-color)'};">
                            ${wc.driftDeg > 0 ? '+' : ''}${wc.driftDeg}°
                        </div>
                    </div>
                </div>
            ` : `<div style="font-size:11px; color:var(--text-muted); margin-top:4px;">${isFr ? 'Vent indisponible' : 'Wind unavailable'}</div>`}
        </div>

        <div class="fp-section" style="margin-top:10px; padding-top:10px; border-top:1px solid var(--border-color);">
            <div class="fp-grid">
                <div class="fp-cell">
                    <div class="fp-label">${isFr ? 'Vitesse sol (GS)' : 'Ground speed'}</div>
                    <div class="fp-value">${groundSpeed} kt</div>
                </div>
                <div class="fp-cell">
                    <div class="fp-label">${isFr ? 'Temps de vol' : 'Flight time'}</div>
                    <div class="fp-value" style="color:var(--secondary); font-weight:800;">${fmtTime(legTimeMin)}</div>
                </div>
            </div>
        </div>

        <div class="fp-section" style="margin-top:10px; padding-top:10px; border-top:1px solid var(--border-color);">
            <div class="fp-section-title">${isFr ? 'Carburant' : 'Fuel'}</div>
            <div class="fp-grid fp-grid-3" style="margin-top:6px;">
                <div class="fp-cell">
                    <div class="fp-label">${isFr ? 'Trajet' : 'Trip'}</div>
                    <div class="fp-value">${fuel.tripFuelL} L</div>
                </div>
                <div class="fp-cell">
                    <div class="fp-label">${isFr ? 'Réserve' : 'Reserve'} (${isNight ? RESERVES.NIGHT_MIN : RESERVES.DAY_MIN}min)</div>
                    <div class="fp-value">${fuel.reserveL} L</div>
                </div>
                <div class="fp-cell">
                    <div class="fp-label">${isFr ? 'Total requis' : 'Total req.'}</div>
                    <div class="fp-value" style="color:var(--primary); font-weight:800; font-size:15px;">${fuel.totalL} L</div>
                </div>
            </div>
        </div>

        ${cl ? `
            <div class="fp-section" style="margin-top:10px; padding-top:10px; border-top:1px solid var(--border-color);">
                <div class="fp-section-title">${isFr ? 'Relief sous la route' : 'Terrain clearance'}</div>
                <div class="fp-grid" style="margin-top:6px;">
                    <div class="fp-cell">
                        <div class="fp-label">${isFr ? 'Altitude max sol' : 'Max terrain'}</div>
                        <div class="fp-value">${plan.elevationProfile.maxFt} ft</div>
                    </div>
                    <div class="fp-cell">
                        <div class="fp-label">${isFr ? 'Marge mini' : 'Min clearance'}</div>
                        <div class="fp-value" style="color:${clearColor}; font-weight:700;">
                            ${cl.minClearanceFt >= 0 ? '+' : ''}${cl.minClearanceFt} ft
                        </div>
                    </div>
                </div>
                ${cl.level !== 'ok' ? `
                    <div style="margin-top:6px; padding:6px 10px; background:rgba(${cl.level === 'danger' ? '239,68,68' : '245,158,11'},0.1); border-radius:6px; font-size:11px; color:${clearColor};">
                        <i data-lucide="${cl.level === 'danger' ? 'alert-octagon' : 'alert-triangle'}" style="width:13px;height:13px;vertical-align:middle;"></i>
                        ${cl.level === 'danger'
                            ? (isFr ? 'Altitude de croisière SOUS le relief — augmentez l\'altitude' : 'Cruise altitude BELOW terrain — climb higher')
                            : (isFr ? 'Marge de franchissement réduite (< 1000 ft)' : 'Reduced terrain clearance (< 1000 ft)')}
                    </div>
                ` : ''}
            </div>
        ` : ''}

        ${plan.isMultiLeg && plan.legs?.length ? `
            <div class="fp-section" style="margin-top:10px; padding-top:10px; border-top:1px solid var(--border-color);">
                <div class="fp-section-title">${isFr ? 'Détail des waypoints (' + plan.legs.length + ')' : 'Leg details (' + plan.legs.length + ')'}</div>
                <table class="fp-navlog" style="margin-top:6px;">
                    <thead>
                        <tr>
                            <th>${isFr ? 'Tronçon' : 'Leg'}</th>
                            <th>${isFr ? 'Dist' : 'Dist'}</th>
                            <th>${isFr ? 'Cap' : 'Hdg'}</th>
                            <th>ETE</th>
                            <th>${isFr ? 'Conso' : 'Fuel'}</th>
                            <th>${isFr ? 'Fréq' : 'Freq'}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${plan.legs.map(lg => {
                            const f = _legMainFreq(lg.to.icao);
                            return `
                            <tr>
                                <td><b>${escapeHtml(_wpDisplayName(lg.from.icao))}</b> → <b>${escapeHtml(_wpDisplayName(lg.to.icao))}</b></td>
                                <td>${lg.distanceNm} NM</td>
                                <td>${String(lg.magHeading).padStart(3,'0')}°</td>
                                <td>${fmtTime(lg.legTimeMin)}</td>
                                <td>${lg.fuel.tripFuelL} L</td>
                                <td class="freq-cell">${f ? f.freq.toFixed(3) + ' ' + escapeHtml(f.type) : '—'}</td>
                            </tr>`;
                        }).join('')}
                        <tr class="total">
                            <td>${isFr ? 'TOTAL' : 'TOTAL'}</td>
                            <td>${plan.totalDistanceNm} NM</td>
                            <td>—</td>
                            <td>${fmtTime(plan.totalTimeMin)}</td>
                            <td>${plan.fuel.tripFuelL} L</td>
                            <td>—</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        ` : ''}

        <div style="font-size:10px; color:var(--text-muted); margin-top:10px; line-height:1.4;">
            <i data-lucide="info" style="width:11px;height:11px;vertical-align:middle;"></i>
            ${isFr
                ? 'Calculs basés sur le vent Open-Meteo à l\'altitude de croisière et l\'élévation du relief. Le POH de l\'avion reste la référence légale.'
                : 'Computations based on Open-Meteo winds at cruise altitude and terrain elevation. The aircraft POH remains the legal reference.'}
        </div>
    `;
    if (window.lucide) window.lucide.createIcons({ root: container });
    container.querySelector('#fp-navlog-pdf')?.addEventListener('click', async () => {
        if (await _confirmNavLogPdf(isFr)) _generateNavLogPdf();
    });
    _wireInputs(container, from, to);
}

// Fenêtre de confirmation avant génération du log de nav PDF : rappelle que le
// document est calculé automatiquement et liste ce que le pilote doit vérifier
// avant de l'utiliser en vol. Promesse → true si l'utilisateur confirme.
function _confirmNavLogPdf(isFr) {
    return new Promise(resolve => {
        document.getElementById('navlog-confirm-modal')?.remove();
        const modal = document.createElement('div');
        modal.id = 'navlog-confirm-modal';
        modal.className = 'modal-overlay visible';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');

        const items = isFr ? [
            ['compass', '<b>Caps (RM/CM) et dérive</b> — recalculés avec le vent <i>estimé</i> au moment du calcul, pas le vent réel'],
            ['mountain', '<b>Altitudes</b> — Z sécu (relief + 1000 ft) et altitude retenue, à confronter au relief réel et aux zones réglementées'],
            ['clock', '<b>Temps de vol (Tsv/Tav) et vitesse sol</b> — dépendants du vent réel rencontré'],
            ['fuel', '<b>Carburant</b> — trajet et réserve à recouper avec le POH de l\'avion et la consommation réelle'],
            ['radio', '<b>Fréquences et piste en service</b> — à confirmer sur une carte VAC / NOTAM à jour'],
            ['gauge', '<b>QNH et vent de départ</b> — METAR capturé à l\'instant de la génération, souvent périmé au décollage'],
        ] : [
            ['compass', '<b>Headings (MH/CH) and drift</b> — computed with the <i>estimated</i> wind at calculation time, not the actual wind'],
            ['mountain', '<b>Altitudes</b> — MSA (terrain + 1000 ft) and chosen level, to be checked against actual terrain and restricted areas'],
            ['clock', '<b>ETE and ground speed</b> — depend on the actual wind encountered'],
            ['fuel', '<b>Fuel</b> — trip and reserve to be cross-checked against the aircraft POH and actual consumption'],
            ['radio', '<b>Frequencies and runway in use</b> — confirm against an up-to-date VAC chart / NOTAM'],
            ['gauge', '<b>Departure QNH and wind</b> — METAR captured when generated, likely outdated at takeoff'],
        ];

        modal.innerHTML = `
            <div class="modal-content" style="max-width:540px;">
                <div class="modal-header">
                    <h2 style="display:flex;align-items:center;gap:10px;">
                        <i data-lucide="alert-triangle" style="width:20px;height:20px;color:#F59E0B;"></i>
                        ${isFr ? 'À vérifier avant d\'imprimer' : 'Verify before printing'}
                    </h2>
                    <button class="btn-close-modal" data-cancel title="${isFr ? 'Annuler' : 'Cancel'}" aria-label="${isFr ? 'Annuler' : 'Cancel'}"><i data-lucide="x"></i></button>
                </div>
                <div class="modal-body" style="font-size:12.5px; line-height:1.55; color:var(--text-color);">
                    <p style="margin:0 0 10px 0;">
                        ${isFr
                            ? 'Ce log de nav est <b>généré automatiquement</b> à partir des données du planificateur (vent Open-Meteo estimé à l\'altitude de croisière, relief, performances saisies). Ces valeurs sont une <b>aide à la préparation, pas une garantie</b>. Avant tout usage en vol, vérifiez chaque valeur :'
                            : 'This nav log is <b>generated automatically</b> from the flight planner data (estimated Open-Meteo wind at cruise altitude, terrain, entered performance). These values are a <b>preparation aid, not a guarantee</b>. Before any in-flight use, verify every value:'}
                    </p>
                    <div style="display:flex; flex-direction:column; gap:7px; margin:0 0 10px 0;">
                        ${items.map(([icon, txt]) => `
                            <div style="display:flex; gap:9px; align-items:flex-start;">
                                <i data-lucide="${icon}" style="width:14px;height:14px;color:var(--primary);flex-shrink:0;margin-top:2px;"></i>
                                <span>${txt}</span>
                            </div>`).join('')}
                    </div>
                    <p style="margin:0 0 10px 0; color:var(--text-muted);">
                        ${isFr
                            ? 'Les champs laissés vides (pilote, c/sign, heures, horomètres, HEA/HRA, checks) sont à <b>compléter à la main</b>.'
                            : 'Empty fields (pilot, c/sign, times, hobbs, ETA/ATA, checks) must be <b>filled in by hand</b>.'}
                    </p>
                    <div style="padding:9px 12px; background:rgba(245,158,11,0.12); border:1px solid rgba(245,158,11,0.35); border-radius:8px; color:#FBBF24; font-size:12px;">
                        <i data-lucide="scale" style="width:13px;height:13px;vertical-align:middle;"></i>
                        ${isFr
                            ? ' Ce document ne remplace ni le POH de l\'avion, ni les cartes officielles, ni la préparation réglementaire du vol. <b>Le commandant de bord reste seul responsable</b> de la vérification des informations et de ses décisions.'
                            : ' This document does not replace the aircraft POH, official charts or the regulatory flight preparation. <b>The pilot-in-command remains solely responsible</b> for verifying the information and for their decisions.'}
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" data-cancel>${isFr ? 'Annuler' : 'Cancel'}</button>
                    <button class="btn-primary" data-ok>
                        <i data-lucide="printer" style="width:14px;height:14px;"></i>
                        ${isFr ? 'J\'ai vérifié — générer et ouvrir' : 'Verified — generate & open'}
                    </button>
                </div>
            </div>`;

        document.body.appendChild(modal);
        if (window.lucide) window.lucide.createIcons({ root: modal });

        const onKey = (e) => { if (e.key === 'Escape') done(false); };
        const done = (val) => {
            document.removeEventListener('keydown', onKey);
            modal.remove();
            resolve(val);
        };
        modal.querySelectorAll('[data-cancel]').forEach(b => b.addEventListener('click', () => done(false)));
        modal.querySelector('[data-ok]').addEventListener('click', () => done(true));
        modal.addEventListener('click', e => { if (e.target === modal) done(false); });
        document.addEventListener('keydown', onKey);
        modal.querySelector('[data-ok]').focus();
    });
}

function _renderError(container, from, to, isFr) {
    container.innerHTML = `
        <div style="padding:14px; text-align:center; color:var(--text-muted); font-size:12px;">
            <i data-lucide="map-pin-off" style="width:20px;height:20px;"></i>
            <div style="margin-top:6px;">${isFr ? 'Coordonnées des terrains indisponibles. Chargez d\'abord la météo de chaque terrain.' : 'Airport coordinates unavailable. Load weather for each airport first.'}</div>
        </div>
    `;
    if (window.lucide) window.lucide.createIcons({ root: container });
}

// Nom d'affichage d'une étape : les repères libres (pseudo-codes ZZxx)
// s'affichent sous leur VRAI nom (VOR « BNE », NDB, point VFR « E2 »…),
// le code restant technique (permalien, pipeline).
// Exporté pour navlog-pdf via le sample (rows/waypoints portent `name`).
export function _wpDisplayName(code) {
    if (!/^ZZ[A-Z]{2}$/.test(code)) return code;
    const apt = getAirportByICAO(code);
    const n = (apt?.name || '').trim();
    if (!n || n === code) return code;
    // Premier mot utile, majuscules, ≤ 9 caractères (colonnes du log).
    const first = n.split(/\s+/)[0].replace(/[^\w-]/g, '');
    return (first || code).toUpperCase().slice(0, 9);
}

// Le champ Waypoints affiche les VRAIS noms des repères libres (VOR, NDB,
// points VFR…) au lieu de leurs codes techniques ZZxx. Le parse inverse
// (nom saisi → code) s'appuie sur le registre des repères de la carte,
// injecté ici par regional-map (pas d'import croisé).
let _resolveFreeWpToken = null;
export function registerFreeWpResolver(fn) { _resolveFreeWpToken = fn; }

/** Valeur du champ Waypoints → codes (OACI ou ZZxx), sans doublon.
 *  Un token invalide qui ne résout aucun repère connu est écarté. */
export function parseWaypointsField(value) {
    const out = [];
    for (const t of String(value || '').toUpperCase().split(/\s+/)) {
        if (!t) continue;
        if (/^[A-Z][A-Z0-9]{3}$/.test(t)) { out.push(t); continue; }
        const code = _resolveFreeWpToken?.(t);
        if (code && /^[A-Z][A-Z0-9]{3}$/.test(code)) out.push(code);
    }
    return [...new Set(out)];
}

/** Codes → valeur affichée dans le champ (noms réels des repères ZZxx). */
export function formatWaypointsField(codes) {
    return (Array.isArray(codes) ? codes : [])
        .map(c => /^[A-Z][A-Z0-9]{3}$/.test(c) ? c : _wpDisplayName(c))
        .join(' ');
}

function _renderInputs(from, to, fromName, toName, alt, tas, burn, isNight, isFr) {
    const waypointsValue = (state.route && state.route.length > 2)
        ? formatWaypointsField(state.route.slice(1, -1)) : '';
    // Liste lisible des étapes : code + nom de l'aérodrome (ou nom du repère),
    // avec crayon de renommage pour les repères libres (pseudo-codes ZZxx).
    const wps = (state.route && state.route.length > 2) ? state.route.slice(1, -1) : [];
    const wpListHtml = wps.length ? `
        <div id="fp-waypoint-list" class="fp-waypoint-list">
            ${wps.map((code, i) => {
                const apt = getAirportByICAO(code);
                const name = apt?.name || code;
                const renamable = /^ZZ[A-Z]{2}$/.test(code);
                const display = renamable ? _wpDisplayName(code) : code;
                return `<div class="fp-wp-row">
                    <span class="fp-wp-num">${i + 1}.</span>
                    <span class="fp-wp-code">${escapeHtml(display)}</span>
                    ${renamable && display !== name ? `<span class="fp-wp-name">${escapeHtml(name)}</span>` : (renamable ? '' : `<span class="fp-wp-name">${escapeHtml(name)}</span>`)}
                    ${renamable ? `<button class="fp-wp-rename" data-icao="${escapeHtml(code)}" title="${isFr ? 'Renommer ce repère' : 'Rename this waypoint'}"><i data-lucide="pencil" style="width:12px;height:12px;"></i></button>` : ''}
                    <button class="fp-wp-del" data-icao="${escapeHtml(code)}" title="${isFr ? 'Retirer ce waypoint du plan' : 'Remove this waypoint from the plan'}"><i data-lucide="x" style="width:12px;height:12px;"></i></button>
                </div>`;
            }).join('')}
        </div>` : '';
    return `
        <div class="fp-route" style="display:flex; align-items:center; gap:8px; margin-bottom:10px; font-size:12px;">
            <div style="flex:1; min-width:0;">
                <div style="color:var(--text-muted); font-size:9px; text-transform:uppercase; letter-spacing:1px;">${isFr ? 'Départ' : 'From'}</div>
                <div style="font-weight:700; color:var(--secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(from)} · ${escapeHtml(fromName)}</div>
            </div>
            <i data-lucide="arrow-right" style="width:16px;height:16px;color:var(--text-muted);flex-shrink:0;"></i>
            <div style="flex:1; min-width:0;">
                <div style="color:var(--text-muted); font-size:9px; text-transform:uppercase; letter-spacing:1px;">${isFr ? 'Destination' : 'To'}</div>
                <div style="font-weight:700; color:var(--secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(to)} · ${escapeHtml(toName)}</div>
            </div>
        </div>
        <div class="fp-inputs">
            <label class="fp-input-label" style="grid-column: 1 / -1;" title="${isFr ? 'Waypoints intermédiaires (codes OACI séparés par espaces)' : 'Intermediate waypoints (ICAO codes, space-separated)'}">
                <span>${isFr ? 'Waypoints (optionnel)' : 'Waypoints (optional)'}</span>
                <input type="text" id="fp-waypoints" value="${escapeHtml(waypointsValue)}" placeholder="${isFr ? 'LFPB LFOB puis Tab' : 'LFPB LFOB then Tab'}" class="fp-input" style="font-family:'DM Mono',monospace; text-transform:uppercase;">
            </label>
            <label class="fp-input-label">
                <span>${isFr ? 'Alt. croisière (ft)' : 'Cruise alt (ft)'}</span>
                <input type="number" id="fp-cruise-alt" value="${alt}" min="0" step="500" class="fp-input">
            </label>
            <label class="fp-input-label">
                <span>${isFr ? 'Vitesse air (kt)' : 'TAS (kt)'}</span>
                <input type="number" id="fp-tas" value="${tas}" min="0" step="5" class="fp-input">
            </label>
            <label class="fp-input-label">
                <span>${isFr ? 'Conso (L/h)' : 'Burn (L/h)'}</span>
                <input type="number" id="fp-burn" value="${burn}" min="0" step="1" class="fp-input">
            </label>
            <label class="fp-night-label" title="${isFr ? 'Vol de nuit (réserve 45 min au lieu de 30)' : 'Night flight (45 min reserve)'}">
                <input type="checkbox" id="fp-night" ${isNight ? 'checked' : ''}>
                <span>${isFr ? 'Nuit' : 'Night'}</span>
            </label>
        </div>
        ${wpListHtml}
    `;
}

function _wireInputs(container, from, to) {
    // Garde-fou anti-récursion : showFlightPlanner recrée le DOM et rewire les inputs,
    // ce qui peut redéclencher 'change' et boucler (OOM). Le flag est module-level
    // (partagé avec le callback de pré-chargement des fréquences de showFlightPlanner).
    const recalc = () => {
        if (_recalculating) return;   // évite la récursion pendant le re-render
        _recalculating = true;
        try {
            // Lit les waypoints saisis (codes OACI ou noms de repères libres
            // affichés dans le champ) et peuple state.route pour le multi-leg.
            const wpInput = container.querySelector('#fp-waypoints');
            if (wpInput) {
                const wps = parseWaypointsField(wpInput.value);
                state.route = wps.length ? [from, ...wps, to] : null;
            }
            showFlightPlanner(from, to);
            // Notifie la carte régionale de redessiner la route avec les waypoints.
            // setTimeout(0) : attend que le DOM du panneau soit recréé avant de notifier,
            // pour éviter que le re-render ne détruise le champ waypoints en cours de saisie.
            setTimeout(() => window.dispatchEvent(new CustomEvent('route-changed')), 0);
        } finally {
            _recalculating = false;
        }
    };
    // change/blur : recalc immédiat (l'utilisateur a fini de saisir).
    container.querySelector('#fp-cruise-alt')?.addEventListener('change', recalc);
    container.querySelector('#fp-tas')?.addEventListener('change', recalc);
    container.querySelector('#fp-burn')?.addEventListener('change', recalc);
    container.querySelector('#fp-night')?.addEventListener('change', recalc);
    // IMPORTANT : on n'écoute QUE 'change' (déclenché à la perte de focus / Entrée),
    // jamais 'input' (frappe clavier). Sinon showFlightPlanner recrée le DOM et
    // détruit le champ en cours de saisie → l'utilisateur ne peut pas taper ses waypoints.
    container.querySelector('#fp-waypoints')?.addEventListener('change', recalc);

    // Renommage d'un repère (ZZxx) depuis la liste des étapes du plan.
    container.querySelectorAll('.fp-wp-rename').forEach(btn => {
        btn.addEventListener('click', async () => {
            const icao = btn.dataset.icao;
            const apt = getAirportByICAO(icao);
            const name = await _promptRenameWaypoint(icao, apt?.name || icao);
            if (name) {
                // regional-map met à jour le registre, l'étiquette carte et
                // re-rend le plan (dispatch 'change') pour afficher le nouveau nom.
                document.dispatchEvent(new CustomEvent('rename-free-waypoint', { detail: { icao, name } }));
            }
        });
    });

    // Retrait d'un waypoint du plan (croix de la liste des étapes) : retire
    // le code du champ Waypoints et relance le calcul (les repères libres
    // restent sur la carte, réutilisables via leur popup « + Plan »).
    container.querySelectorAll('.fp-wp-del').forEach(btn => {
        btn.addEventListener('click', () => {
            const icao = btn.dataset.icao;
            const wpInput = container.querySelector('#fp-waypoints');
            if (!icao || !wpInput) return;
            const wps = parseWaypointsField(wpInput.value).filter(w => w !== icao);
            wpInput.value = formatWaypointsField(wps);
            wpInput.dispatchEvent(new Event('change'));
        });
    });
}

// Petite modale de renommage d'un waypoint libre (promise → nouveau nom ou null).
function _promptRenameWaypoint(icao, currentName) {
    return new Promise(resolve => {
        document.getElementById('wp-rename-modal')?.remove();
        const modal = document.createElement('div');
        modal.id = 'wp-rename-modal';
        modal.className = 'modal-overlay visible';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        const isFr = state.lang === 'fr';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:360px;">
                <div class="modal-header">
                    <h2 style="display:flex;align-items:center;gap:8px;font-size:15px;">
                        <i data-lucide="pencil" style="width:16px;height:16px;color:var(--primary);"></i>
                        ${isFr ? 'Renommer le waypoint' : 'Rename waypoint'}
                    </h2>
                    <button class="btn-close-modal" data-cancel aria-label="${isFr ? 'Annuler' : 'Cancel'}"><i data-lucide="x"></i></button>
                </div>
                <div class="modal-body">
                    <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--text-muted);">
                        <span><span style="font-family:'DM Mono',monospace;color:var(--primary);font-weight:600;">${escapeHtml(icao)}</span> — ${isFr ? 'nouveau nom' : 'new name'}</span>
                        <input type="text" id="wp-rename-input" maxlength="24" value="${escapeHtml(currentName)}" style="background:var(--input-bg);border:1px solid var(--border-color);color:var(--text-color);border-radius:6px;padding:8px 10px;font-size:13px;outline:none;">
                    </label>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" data-cancel>${isFr ? 'Annuler' : 'Cancel'}</button>
                    <button class="btn-primary" data-ok>${isFr ? 'Renommer' : 'Rename'}</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        if (window.lucide) window.lucide.createIcons({ root: modal });

        const input = modal.querySelector('#wp-rename-input');
        input?.focus();
        input?.select();

        const onKey = (e) => {
            if (e.key === 'Escape') done(null);
            if (e.key === 'Enter') { e.preventDefault(); done(input.value.trim().slice(0, 24) || null); }
        };
        const done = (val) => {
            document.removeEventListener('keydown', onKey);
            modal.remove();
            resolve(val);
        };
        modal.querySelectorAll('[data-cancel]').forEach(b => b.addEventListener('click', () => done(null)));
        modal.querySelector('[data-ok]').addEventListener('click', () => done(input.value.trim().slice(0, 24) || null));
        modal.addEventListener('click', e => { if (e.target === modal) done(null); });
        document.addEventListener('keydown', onKey);
    });
}
