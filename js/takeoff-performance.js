/* ================================================================
 * TAKEOFF PERFORMANCE — Distance de décollage corrigée vs piste
 * ================================================================
 *
 * POURQUOI — C'EST LE MODULE "KILLER" VFR
 * ----------------------------------------
 * La densité-altitude ne dit rien au pilote tant qu'elle reste un
 * chiffre abstrait. Ce que le pilote VFR se demande RÉELLEMENT en se
 * gauchissant sur la piste en herbe un après-midi d'été, c'est :
 *
 *   "Est-ce que je vais décoller avant le bout de la piste ?"
 *
 * Ce module traduit la densité-altitude en une réponse concrète :
 * il estime la distance de décollage corrigée et la compare à la
 * longueur de piste disponible. C'est exactement le calcul que le
 * pilote fait (ou devrait faire) avec le manuel de vol — sauf qu'ici
 * il est automatisé à partir des conditions météo live.
 *
 * APPROCHE
 * --------
 * La correction de performance selon la densité-altitude suit les
 * règles empiriques du manuel de vol du Cessna 172 (référence de
 * l'instruction), confirmées par la FAA (PHAK Ch. 11) :
 *
 *   • Pour chaque 1000 ft de densité-altitude AU-DESSUS de l'élévation
 *     standard (ISA au niveau de la mer), la distance de décollage
 *     augmente d'environ 10 %.
 *   • La distance de roulement (ground roll) augmente plus vite que la
 *     distance de franchissement des 50 ft.
 *
 * On prend comme référence un C172 moyen au niveau de la mer en ISA :
 *     ground roll  ≈ 830 ft
 *     distance 50 ft ≈ 1400 ft
 *
 * Le pilote peut ajuster :
 *   - la longueur de piste de son terrain (persistée par OACI),
 *   - la distance de référence de son avion (si connu).
 *
 * ⚠️ AIDE À LA DÉCISION — pas un manuel de vol. Le manuel de vol de
 * l'avion (POH) reste la seule référence légale.
 * ================================================================ */

import { state } from './core.js';
import { densityAltitude, getPerformanceData } from './density-altitude.js';
import { getAirportByICAO } from './ui-module.js';
import { getActiveAircraft } from './aircraft-fleet.js';
import { selectBestRunway } from './engine.js';
import { getRunwaySurface, isSoftSurface, surfaceLabel, runwayBelongsToAirport } from './runway-surface.js';

// Distance de référence C172 (ft), au niveau de la mer / ISA.
const DEFAULT_GROUND_ROLL = 830;
const DEFAULT_50FT = 1400;

// Facteur de conversion pied → mètre.
const FT_TO_M = 0.3048;

// Clé localStorage pour la longueur de piste par terrain.
const LS_RWY_LEN_PREFIX = 'rwy-length-';

/** Convertit pieds en mètres (arrondi). */
function ftToM(ft) { return Math.round(ft * FT_TO_M); }

/**
 * Récupère la longueur de piste pour un terrain, en tenant compte de la piste
 * actuellement sélectionnée dans la rose des vents.
 *
 * Priorité :
 *   1. Saisie manuelle du pilote (localStorage, par terrain) — surclasse tout.
 *   2. Piste active de la rose des vents (state.forcedRunway résolu via
 *      selectBestRunway) → longueur spécifique de CE numéro de piste.
 *   3. Piste la plus longue du terrain (fallback).
 *
 * @param {string} icao
 * @returns {number|null} Longueur en pieds, ou null si inconnue.
 */
export function getRunwayLength(icao) {
    if (!icao) return null;

    const apt = getAirportByICAO(icao);
    if (!apt) return null;

    // 1. Piste active de la rose des vents : si le pilote a cliqué une piste
    //    (state.forcedRunway = "08L-26R") ou si une piste est suggérée par le
    //    vent, on cherche la longueur de CE numéro de piste.
    const activeRwyName = _getActiveRunwayName(apt);
    if (activeRwyName && apt.runwayLengths) {
        const len = apt.runwayLengths[activeRwyName];
        if (typeof len === 'number' && len > 0) return len;
    }

    // 2. Fallback : piste la plus longue du terrain.
    if (typeof apt.longestRunway === 'number' && apt.longestRunway > 0) {
        return apt.longestRunway;
    }
    return null;
}

/**
 * Renvoie le numéro de piste actif (ex: "08L") selon la rose des vents.
 * Exporté pour que l'UI puisse afficher quelle piste est concernée.
 * @param {string} icao
 * @param {Object|null} [wind] vent {dir (°VRAIS ou null si VRB), speed} —
 *   si fourni, la piste active est choisie FACE AU VENT (ex. METAR de
 *   départ pour le log de nav) ; sinon comportement historique (paire
 *   suggérée/forcée de la rose des vents, sans alignement vent).
 * @param {number} [magDeclination] déclinaison (°E+) : le vent METAR est
 *   VRAI, les pistes sont MAGNÉTIQUES.
 * @returns {string|null}
 */
export function getActiveRunwayNameForIcao(icao, wind = null, magDeclination = 0) {
    const apt = getAirportByICAO(icao);
    return _getActiveRunwayName(apt, wind, magDeclination);
}

/**
 * Détermine le numéro de piste actif (ex: "08L") selon l'état courant :
 * - Si state.forcedRunway est défini (pilote a cliqué une piste), on résout
 *   via selectBestRunway pour obtenir le nom de la piste active de cette paire.
 * - Si un vent est fourni, la piste la plus face au vent est retenue.
 * @param {Object} apt L'objet terrain (avec .runways).
 * @param {Object|null} [wind] {dir, speed} ou null.
 * @param {number} [magDeclination]
 * @returns {string|null} Numéro de piste (ex: "08L"), ou null.
 */
function _getActiveRunwayName(apt, wind = null, magDeclination = 0) {
    if (!apt || !Array.isArray(apt.runways) || apt.runways.length === 0) return null;
    // Priorité à la piste PUBLIÉE PAR LA ROSE DES VENTS (sélection du pilote
    // ou choix automatique de la vue courante) : le calcul des performances
    // doit porter sur CETTE piste. Uniquement si elle appartient à CE terrain
    // (le planificateur peut interroger un autre aérodrome que l'affiché).
    if (state.activeRunwayName && runwayBelongsToAirport(apt, state.activeRunwayName)) {
        return state.activeRunwayName;
    }
    // wind=null : selectBestRunway retourne quand même la paire (et la piste
    // active si forcedRunway est défini). C'est suffisant pour récupérer le nom.
    const rwyData = selectBestRunway(apt.runways, wind, state.forcedRunway, magDeclination);
    return rwyData?.active?.name || null;
}

/**
 * Indique si la longueur de piste provient de la base (auto) ou d'une saisie
 * manuelle. Sert à l'UI pour afficher un indice "auto".
 * @param {string} icao
 * @returns {boolean} true si la valeur vient de airports.json (non personnalisée).
 */
export function isRunwayLengthAuto(icao) {
    if (!icao) return false;
    try {
        const v = parseInt(localStorage.getItem(LS_RWY_LEN_PREFIX + icao.toUpperCase()), 10);
        if (!isNaN(v) && v > 0) return false; // saisie manuelle
    } catch { /* ignore */ }
    return true; // vient de la base
}

/**
 * Définit la longueur de piste pour un terrain.
 * @param {string} icao
 * @param {number} ft Longueur en pieds.
 */
export function setRunwayLength(icao, ft) {
    if (!icao) return;
    try {
        if (ft == null || isNaN(ft)) {
            localStorage.removeItem(LS_RWY_LEN_PREFIX + icao.toUpperCase());
        } else {
            localStorage.setItem(LS_RWY_LEN_PREFIX + icao.toUpperCase(), String(Math.round(ft)));
        }
    } catch {
        /* quota */
    }
}

/**
 * Récupère les distances de référence de l'avion actif (depuis la flotte).
 * @returns {{groundRoll: number, fiftyFt: number, name: string, safetyMargin: number}}
 */
export function getAircraftRef() {
    const ac = getActiveAircraft();
    return {
        name: ac.name,
        groundRoll: ac.groundRoll,
        fiftyFt: ac.fiftyFt,
        safetyMargin: ac.safetyMargin ?? 20,
    };
}

/**
 * Calcule la distance de décollage corrigée selon la densité-altitude ET
 * le revêtement de piste.
 *
 * Corrections appliquées (coefficients aéronautiques reconnus, FAA PHAK /
 * manuels Cessna-Piper) :
 *
 *   1. DENSITÉ-ALTITUDE (toujours) :
 *      +10 % par 1000 ft de DA sur la distance totale ; +2 % supplémentaire
 *      sur le roulement (plus sensible : rotation plus tardive).
 *
 *   2. REVÊTEMENT MOU (herbe, terre tassée, gravier, sable...) :
 *      Le roulement s'allonge car l'accélération est dégradée (résistance
 *      de roulement supérieure). Le franchissement 50 ft est peu affecté.
 *        - Piste molle SÈCHE    : +15 % sur le roulement
 *        - Piste molle HUMIDE   : +25 % sur le roulement (herbe mouillée)
 *        - Piste molle + PLUIE/NEIGE : +30 % sur le roulement
 *      Une piste dure (asphalte, béton) n'est pas affectée par cette
 *      correction (sauf pluie battante : +5 % par sécurité).
 *
 * @param {number} da Densité-altitude (ft).
 * @param {Object} [opts] Options de correction revêtement.
 * @param {string} [opts.surfaceCode] Code revêtement (ex: 'GRE', 'ASP').
 * @param {boolean} [opts.wet] Piste humide (bruine, pluie légère).
 * @param {boolean} [opts.contaminated] Piste contaminée (pluie forte, neige).
 * @returns {{groundRoll: number, fiftyFt: number, factor: number, surfaceFactor: number}}
 */
export function correctedTakeoffDistance(da, opts = {}) {
    const ref = getAircraftRef();

    // ---- 1. Correction densité-altitude ----
    const effectiveDa = Math.max(0, da);
    const factor = 1 + (effectiveDa / 1000) * 0.10;
    const rollFactor = factor + (effectiveDa / 1000) * 0.02;

    // ---- 2. Correction revêtement (sur le roulement uniquement) ----
    let surfaceFactor = 1; // 1 = pas de majoration.
    const soft = opts.surfaceCode ? isSoftSurface(opts.surfaceCode) : false;

    if (soft) {
        // Piste molle : la majoration dépend de l'humidité.
        if (opts.contaminated) surfaceFactor = 1.30;       // +30 % (pluie/neige)
        else if (opts.wet) surfaceFactor = 1.25;           // +25 % (humide)
        else surfaceFactor = 1.15;                          // +15 % (sèche)
    } else if (opts.contaminated) {
        // Piste dure contaminée (eau stagnante, neige) : léger allongement.
        surfaceFactor = 1.10;
    } else if (opts.wet) {
        // Piste dure humide : marginal.
        surfaceFactor = 1.05;
    }

    return {
        groundRoll: Math.round(ref.groundRoll * rollFactor * surfaceFactor),
        fiftyFt: Math.round(ref.fiftyFt * factor),
        factor,
        surfaceFactor,
    };
}

// Suffixe d'info quand le revêtement/l'humidité a majoré le calcul.
function _surfaceNote(corr, surfaceCode, isFr) {
    if (corr.surfaceFactor <= 1) return '';
    const surfLbl = surfaceCode ? surfaceLabel(surfaceCode) : '';
    const pct = Math.round((corr.surfaceFactor - 1) * 100);
    if (isSoftSurface(surfaceCode)) {
        const wet = corr.surfaceFactor === 1.25, contaminated = corr.surfaceFactor >= 1.30;
        if (contaminated) return isFr ? ` (revêtement ${surfLbl} contaminé +${pct}%)` : ` (${surfLbl} contaminated +${pct}%)`;
        if (wet) return isFr ? ` (revêtement ${surfLbl} humide +${pct}%)` : ` (wet ${surfLbl} +${pct}%)`;
        return isFr ? ` (revêtement ${surfLbl} +${pct}%)` : ` (${surfLbl} +${pct}%)`;
    }
    return isFr ? ` (piste humide/contaminée +${pct}%)` : ` (wet/contaminated +${pct}%)`;
}

// Verdict commun : compare la distance corrigée à la longueur de piste et
// construit le message (FR/EN). Partagé par evaluateTakeoffPerformance (état
// courant de l'app) et evaluateTakeoffFromRaw (METAR brut, ex. log de nav).
function _takeoffVerdict(icao, daResult, corr, surfaceCode) {
    const acRef = getAircraftRef();
    const rwyLen = getRunwayLength(icao);
    const isFr = state.lang === 'fr';
    const surfaceNote = _surfaceNote(corr, surfaceCode, isFr);

    // Pas de longueur de piste configurée → on donne la distance corrigée
    // brute (informatif) sans verdict de marge.
    if (rwyLen == null) {
        return {
            da: Math.round(daResult.da),
            groundRoll: corr.groundRoll,
            fiftyFt: corr.fiftyFt,
            runwayLength: null,
            margin: null,
            level: 'unknown',
            aircraftName: acRef.name,
            surfaceNote,
            message: isFr
                ? `Roulement estimé ${ftToM(corr.groundRoll)} m (DA ${Math.round(daResult.da)} ft)${surfaceNote} — renseignez la longueur de piste`
                : `Est. roll ${ftToM(corr.groundRoll)} m (DA ${Math.round(daResult.da)} ft)${surfaceNote} — set runway length`,
        };
    }

    // Marge : longueur de piste - distance franchissement 50 ft.
    // On compare au franchissement 50 ft car c'est le critère opérationnel
    // (être airborne avant la fin de piste).
    const margin = rwyLen - corr.fiftyFt;
    const marginPct = (margin / rwyLen) * 100;
    // Le seuil de prudence (caution) est personnalisable par avion.
    const cautionThreshold = acRef.safetyMargin ?? 20;

    let level;
    if (margin < 0) {
        level = 'danger';
    } else if (marginPct < cautionThreshold) {
        level = 'caution';
    } else {
        level = 'ok';
    }

    const messages = {
        ok: isFr
            ? `Décollage OK — ${acRef.name}: roulement ${ftToM(corr.groundRoll)} m, piste ${ftToM(rwyLen)} m (marge ${ftToM(margin)} m)${surfaceNote}`
            : `Takeoff OK — ${acRef.name}: roll ${ftToM(corr.groundRoll)} m, rwy ${ftToM(rwyLen)} m (margin ${ftToM(margin)} m)${surfaceNote}`,
        caution: isFr
            ? `Marge faible — ${acRef.name}: roulement ${ftToM(corr.groundRoll)} m / ${ftToM(corr.fiftyFt)} m (50ft), piste ${ftToM(rwyLen)} m${surfaceNote}`
            : `Tight margin — ${acRef.name}: roll ${ftToM(corr.groundRoll)} m / ${ftToM(corr.fiftyFt)} m (50ft), rwy ${ftToM(rwyLen)} m${surfaceNote}`,
        danger: isFr
            ? `DÉCOLLAGE CRITIQUE — ${acRef.name}: ${ftToM(corr.fiftyFt)} m nécessaires (50ft), piste ${ftToM(rwyLen)} m (manque ${ftToM(Math.abs(margin))} m)${surfaceNote}`
            : `CRITICAL TAKEOFF — ${acRef.name}: ${ftToM(corr.fiftyFt)} m needed (50ft), rwy ${ftToM(rwyLen)} m (short by ${ftToM(Math.abs(margin))} m)${surfaceNote}`,
    };

    return {
        da: Math.round(daResult.da),
        groundRoll: corr.groundRoll,
        fiftyFt: corr.fiftyFt,
        runwayLength: rwyLen,
        margin: Math.round(margin),
        level,
        surfaceNote,
        surfaceFactor: corr.surfaceFactor,
        message: messages[level],
    };
}

/**
 * Évalue la performance de décollage pour le terrain courant :
 * calcule la distance corrigée, la compare à la longueur de piste
 * configurée, et retourne un verdict.
 *
 * @param {string} icao Code OACI du terrain.
 * @returns {{
 *   da: number,
 *   groundRoll: number,
 *   fiftyFt: number,
 *   runwayLength: number|null,
 *   margin: number|null,
 *   level: 'ok'|'caution'|'danger'|'unknown',
 *   message: string
 * }|null} null si les données météo sont indisponibles.
 */
export function evaluateTakeoffPerformance(icao) {
    const perf = getPerformanceData();
    if (!perf) return null;

    const daResult = densityAltitude(perf.elevationFt, perf.qnh, perf.oat);
    if (!daResult) return null;

    // ---- Détection du revêtement et de l'humidité ----
    const surfaceCode = getRunwaySurface(icao);
    const { wet, contaminated } = _detectWetFromMetar();

    const corr = correctedTakeoffDistance(daResult.da, { surfaceCode, wet, contaminated });
    return _takeoffVerdict(icao, daResult, corr, surfaceCode);
}

/**
 * Même calcul qu'evaluateTakeoffPerformance, mais à partir d'un METAR brut
 * fourni (ex. METAR de départ frais au moment de générer le log de nav PDF)
 * au lieu de l'état courant de l'app — qui peut être affiché sur un autre
 * terrain. L'humidité/contamination est détectée par tokens dans le brut.
 *
 * @param {string} icao Code OACI du terrain.
 * @param {{raw:string, qnh:number, oat:number, elevationFt:number|null}} metar
 * @returns {Object|null} même forme qu'evaluateTakeoffPerformance.
 */
export function evaluateTakeoffFromRaw(icao, metar) {
    if (!icao || !metar || metar.qnh == null || metar.oat == null) return null;
    const daResult = densityAltitude(metar.elevationFt ?? 0, metar.qnh, metar.oat);
    if (!daResult) return null;

    const surfaceCode = getRunwaySurface(icao);
    const { wet, contaminated } = _wetFromTokens(metar.raw || '');
    const corr = correctedTakeoffDistance(daResult.da, { surfaceCode, wet, contaminated });
    return _takeoffVerdict(icao, daResult, corr, surfaceCode);
}

// Détection des phénomènes humides/contaminants par tokens dans un METAR
// brut (les codes RA/SN/... sont des groupes délimités par des espaces).
// Équivalent simplifié de _detectWetFromMetar, sans accès au DOM/état.
// Exporté pour les tests.
export function _wetFromTokens(raw) {
    // Ne garde que les groupes plausibles (lettres, préfixe intensité/vicinité)
    // contenant un code météo connu — écarte KT, Q1013, FEW035, NOSIG...
    const groups = String(raw || '').toUpperCase().split(/\s+/)
        .filter(t => /^[-+VC]{0,2}[A-Z]{2,8}$/.test(t))
        .map(t => t.replace(/^VC/, ''))
        .filter(t => /RA|SN|SG|PL|GR|GS|DZ|BR|SH|FZ|TS/.test(t));
    const contaminated = groups.some(g => /\+RA|SH|FZ|TS|SN|SG|PL|GR|GS/.test(g));
    const wet = !contaminated && groups.some(g => /RA|DZ|BR/.test(g));
    return { wet, contaminated };
}

/**
 * Détecte l'humidité/contamination de la piste depuis les phénomènes du
 * METAR courant (pluie, bruine, neige, bruine verglaçante).
 * @returns {{wet: boolean, contaminated: boolean}}
 */
function _detectWetFromMetar() {
    const parsed = state.lastParsed;
    if (!parsed || !parsed.base) return { wet: false, contaminated: false };

    // On cherche les codes phénomènes dans le METAR/TAF brut. Une simple
    // recherche de sous-chaîne suffit (les codes sont des tokens délimités
    // par des espaces). On normalise en majuscules.
    const raw = (typeof document !== 'undefined'
        ? document.getElementById('tafInput')?.value
        : '') || '';
    const rawUpper = raw.toUpperCase();
    const tempsStr = (parsed.base.temps?.[0]?.val || '').toLowerCase();

    // Helper : teste si un code phénomène apparaît comme token dans le brut
    // OU si sa traduction FR/EN est présente dans le champ temps.
    const has = (code, translations) => {
        // Token exact dans le brut : on entoure d'espaces pour éviter les
        // faux positifs (ex: "RA" dans "BRRA" ne doit pas matcher "BR").
        if (new RegExp(`(^|\\s)${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(rawUpper)) return true;
        return translations.some(t => tempsStr.includes(t));
    };

    // Phénomènes contaminants (forte impact sur le roulement).
    const contaminated =
        has('+RA', ['pluie forte']) || has('SHRA', ['averse']) ||
        has('SN', ['neige']) || has('SG', ['neige en grains']) ||
        has('PL', ['granules de glace']) || has('FZRA', ['pluie se congelant', 'pluie verglaçante']) ||
        has('FZDZ', ['bruine verglaçante', 'bruine se congelant']) || has('GR', ['grêle']) || has('GS', ['grésil']);

    // Phénomènes humides (impact modéré) — seulement si pas contaminé.
    const wet = !contaminated && (
        has('RA', ['pluie']) || has('DZ', ['bruine']) || has('BR', ['brume'])
    );

    return { wet, contaminated };
}
