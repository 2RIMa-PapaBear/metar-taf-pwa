/* ================================================================
 * AIRCRAFT FLEET — Gestion de la flotte d'avions du pilote
 * ================================================================
 *
 * OBJECTIF
 * --------
 * Le pilote VFR vole rarement sur un seul type d'avion (C172, DR400,
 * Robin, ULM...). Chacun a ses propres distances de décollage issues du
 * manuel de vol (POH). Ce module gère une FLOTTE d'avions personnels,
 * chacun avec ses paramètres, et un avion "actif" sélectionné pour le
 * calcul de performance du terrain courant.
 *
 * STOCKAGE
 * --------
 * localStorage :
 *   - 'ac-fleet'      : tableau d'avions [{id, name, registration, type, groundRoll, fiftyFt, safetyMargin, cruiseSpeedKt, fuelBurnLph}]
 *   - 'ac-active-id'  : id de l'avion actif
 *
 * MIGRATION
 * ---------
 * Si l'ancien format (ac-takeoff-ref, avion unique) existe, il est migré
 * automatiquement vers la flotte lors du premier accès.
 * ================================================================ */

import { normalizeEnvelope, DEFAULT_STATION_MAX_KG } from './wb-core.js';

const LS_FLEET = 'ac-fleet';
const LS_ACTIVE = 'ac-active-id';

// Avion de référence par défaut (C172 SP, niveau mer / ISA).
const DEFAULT_C172 = {
    name: 'Cessna 172 SP',
    registration: '',
    type: 'C172',
    groundRoll: 830,
    fiftyFt: 1400,
    safetyMargin: 20,
    cruiseSpeedKt: 110,   // vitesse de croisière TAS (planificateur de nav)
    fuelBurnLph: 35,      // consommation horaire en croisière (L/h)
};

/**
 * Génère un identifiant unique simple.
 */
function _uid() {
    return 'ac_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

/**
 * Lit la flotte depuis localStorage.
 * Gère la migration depuis l'ancien format (avion unique ac-takeoff-ref).
 * @returns {Array<Object>} Liste des avions.
 */
export function getFleet() {
    let fleet = _readLs(LS_FLEET, []);

    // Migration : si la flotte est vide mais l'ancien avion unique existe.
    if (fleet.length === 0) {
        const oldRef = _readLs('ac-takeoff-ref', null);
        if (oldRef && typeof oldRef.groundRoll === 'number') {
            const migrated = {
                id: _uid(),
                ...DEFAULT_C172,
                name: 'Mon avion',
                groundRoll: oldRef.groundRoll,
                fiftyFt: oldRef.fiftyFt,
                safetyMargin: 20,
            };
            fleet = [migrated];
            _writeLs(LS_FLEET, fleet);
            _writeLs(LS_ACTIVE, migrated.id);
        }
    }

    // Flotte vide → on crée l'avion par défaut (C172) pour ne jamais
    // laisser le pilote sans référence.
    if (fleet.length === 0) {
        const def = { id: _uid(), ...DEFAULT_C172 };
        fleet = [def];
        _writeLs(LS_FLEET, fleet);
        _writeLs(LS_ACTIVE, def.id);
    }

    // RÉPARATION (bug du 2026-08-19 : updateAircraft écrasait l'id → avion
    // inéditable et insélectionnable). On réassigne un id aux enregistrements
    // touchés ; si l'avion actif ne se résout plus, on retombe sur le premier
    // réparé (c'était généralement l'actif — le planificateur sauvegardait
    // sa perf dedans à chaque calcul).
    let firstRepaired = null;
    for (const a of fleet) {
        if (typeof a.id !== 'string' || !a.id) {
            a.id = _uid();
            if (!firstRepaired) firstRepaired = a;
        }
    }
    if (firstRepaired) {
        _writeLs(LS_FLEET, fleet);
        const activeId = _readLs(LS_ACTIVE, null);
        if (!fleet.some(a => a.id === activeId)) _writeLs(LS_ACTIVE, firstRepaired.id);
    }

    return fleet;
}

/**
 * Retourne l'avion actuellement actif (sélectionné pour le calcul).
 * Si l'id actif n'existe plus dans la flotte, retombe sur le premier.
 * @returns {Object} L'avion actif.
 */
export function getActiveAircraft() {
    const fleet = getFleet();
    const activeId = _readLs(LS_ACTIVE, null);
    let active = activeId ? fleet.find(a => a.id === activeId) : null;
    if (!active) {
        active = fleet[0];
        _writeLs(LS_ACTIVE, active.id);
    }
    return active;
}

/**
 * Retourne l'id de l'avion actif.
 */
export function getActiveAircraftId() {
    return _readLs(LS_ACTIVE, null) || getFleet()[0]?.id || null;
}

/**
 * Définit l'avion actif par son id.
 * @param {string} id
 */
export function setActiveAircraft(id) {
    const fleet = getFleet();
    if (fleet.some(a => a.id === id)) {
        _writeLs(LS_ACTIVE, id);
    }
}

/**
 * Ajoute un avion à la flotte.
 * @param {Object} data {name, registration, type, groundRoll, fiftyFt, safetyMargin}
 * @returns {Object} L'avion créé (avec id).
 */
export function addAircraft(data) {
    const fleet = getFleet();
    const aircraft = { id: _uid(), ..._sanitize(data) };
    fleet.push(aircraft);
    _writeLs(LS_FLEET, fleet);
    return aircraft;
}

/**
 * Met à jour un avion existant. Accepte les mises à jour PARTIELLES : les
 * champs absents conservent leur valeur actuelle (sanitize appliqué à
 * l'enregistrement fusionné, pas aux seules données reçues).
 * @param {string} id
 * @param {Object} data
 * @returns {Object|null} L'avion mis à jour, ou null si introuvable.
 */
export function updateAircraft(id, data) {
    const fleet = getFleet();
    const idx = fleet.findIndex(a => a.id === id);
    if (idx === -1) return null;
    fleet[idx] = _sanitize({ ...fleet[idx], ...data, id });
    _writeLs(LS_FLEET, fleet);
    return fleet[idx];
}

/**
 * Supprime un avion de la flotte. Garde toujours au moins un avion.
 * @param {string} id
 * @returns {boolean} true si supprimé.
 */
export function deleteAircraft(id) {
    const fleet = getFleet();
    if (fleet.length <= 1) return false; // toujours au moins 1
    const idx = fleet.findIndex(a => a.id === id);
    if (idx === -1) return false;
    fleet.splice(idx, 1);
    _writeLs(LS_FLEET, fleet);
    // Si l'avion supprimé était actif, on active le premier restant.
    if (getActiveAircraftId() === id) {
        _writeLs(LS_ACTIVE, fleet[0].id);
    }
    return true;
}

/* ----------------------------------------------------------------
 * Bloc centrage (wb = weight & balance), OPTIONNEL par avion.
 * Stockage interne TOUJOURS en kg et mm (conversions à la saisie /
 * l'affichage, voir wb-core.js) ; enveloppe = polygone [masse kg,
 * bras mm] ; stations = postes de chargement (une seule de type
 * carburant, saisie en litres via fuelDensity).
 * ---------------------------------------------------------------- */
const WB_MASS_UNITS = ['kg', 'lbs'];
const WB_ARM_UNITS = ['mm', 'm', 'ft', 'in'];

/**
 * Valide/normalise le bloc centrage. Retourne null si le bloc est
 * absent ou inutilisable (masse à vide ou enveloppe manquante) —
 * la section Centrage reste alors masquée pour cet avion.
 */
function _sanitizeWb(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const num = (v) => (typeof v === 'number' && isFinite(v) ? v : NaN);
    const emptyMassKg = num(raw.emptyMassKg);
    const emptyArmMm = num(raw.emptyArmMm);
    if (!(emptyMassKg > 0) || !isFinite(emptyArmMm)) return null;

    // Enveloppe : 3 à 16 points [masse kg, bras mm] tous finis, RÉORDONNÉS
    // en polygone simple (une saisie « ligne à ligne » du POH tracerait un
    // zigzag auto-croisé — dessin aberrant et limites trompeuses).
    const envelope = normalizeEnvelope(
        (Array.isArray(raw.envelope) ? raw.envelope : [])
            .map(p => (Array.isArray(p) ? [num(p[0]), num(p[1])] : [NaN, NaN]))
            .filter(p => p[0] > 0 && isFinite(p[1]))
            .slice(0, 16));
    if (envelope.length < 3) return null;

    // Postes : 0 à 12 ; bras FACULTATIF (poste en cours de saisie, ignoré au
    // calcul par wb-core) ; un seul poste carburant conservé.
    const stations = [];
    let fuelSeen = false;
    for (const s of (Array.isArray(raw.stations) ? raw.stations : []).slice(0, 12)) {
        if (!s || typeof s !== 'object') continue;
        const armMm = num(s.armMm);
        const fuel = s.fuel === true && !fuelSeen;
        if (s.fuel === true) fuelSeen = true;
        const maxKg = num(s.maxKg);
        const name = String(s.name || '').slice(0, 24).trim() || 'Poste';
        stations.push({
            name,
            armMm: isFinite(armMm) ? armMm : null,
            // Max saisi, sinon valeur standard du poste (Pilote/Pax 130 kg,
            // Bagages 40 kg) — le garde-fou d'affichage reste ainsi rempli.
            maxKg: maxKg > 0 ? maxKg : (DEFAULT_STATION_MAX_KG[name.toLowerCase()] ?? null),
            fuel,
        });
    }

    const mtowKg = num(raw.mtowKg);
    const density = num(raw.fuelDensity);
    return {
        units: {
            mass: WB_MASS_UNITS.includes(raw.units?.mass) ? raw.units.mass : 'kg',
            arm: WB_ARM_UNITS.includes(raw.units?.arm) ? raw.units.arm : 'mm',
        },
        emptyMassKg,
        emptyArmMm,
        mtowKg: mtowKg > 0 ? mtowKg : null,
        fuelDensity: density > 0.5 && density < 1.2 ? density : 0.72,
        envelope,
        stations,
    };
}

/**
 * Nettoie/valide les données d'un avion. cruiseSpeedKt / fuelBurnLph sont
 * OPTIONNELS (null si absents ou invalides → le planificateur retombe sur
 * ses valeurs par défaut) : tous les avions n'ont pas encore ces infos.
 * wb (centrage) est optionnel de la même façon. L'id, s'il est valide, est
 * CONSERVÉ (le perdre rendrait l'avion inéditable et insélectionnable).
 */
function _sanitize(data) {
    const gr = parseInt(data.groundRoll, 10);
    const ft = parseInt(data.fiftyFt, 10);
    const sm = parseInt(data.safetyMargin, 10);
    const cs = parseInt(data.cruiseSpeedKt, 10);
    const fb = parseInt(data.fuelBurnLph, 10);
    const out = {
        name: String(data.name || 'Avion').slice(0, 40),
        registration: String(data.registration || '').slice(0, 12).toUpperCase(),
        type: String(data.type || '').slice(0, 20),
        groundRoll: isNaN(gr) || gr <= 0 ? DEFAULT_C172.groundRoll : gr,
        fiftyFt: isNaN(ft) || ft <= 0 ? DEFAULT_C172.fiftyFt : ft,
        safetyMargin: isNaN(sm) ? 20 : Math.max(0, Math.min(50, sm)),
        cruiseSpeedKt: isNaN(cs) || cs <= 0 ? null : cs,
        fuelBurnLph: isNaN(fb) || fb <= 0 ? null : fb,
        wb: _sanitizeWb(data.wb),
    };
    // Uniquement si valide : ne pas écraser l'{ id: _uid(), ..._sanitize() }
    // de addAircraft par un id undefined.
    if (typeof data.id === 'string' && data.id) out.id = data.id;
    return out;
}

// ----------------------------------------------------------------
// Helpers localStorage
// ----------------------------------------------------------------
function _readLs(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (raw == null) return fallback;
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

function _writeLs(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        /* quota */
    }
}
