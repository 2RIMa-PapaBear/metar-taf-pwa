/* ================================================================
 * FLEET UI — Gestion de la flotte d'avions (modal)
 * ================================================================
 *
 * Panneau modal permettant au pilote de gérer sa flotte :
 *   - Lister les avions enregistrés
 *   - Ajouter / éditer / supprimer un avion
 *   - Chaque avion : nom, immatriculation, type, distances de référence
 *     (roulement + franchissement 50ft au niveau mer/ISA), marge de
 *     sécurité personnalisée.
 *
 * Les distances de référence proviennent du manuel de vol (POH) de
 * l'avion, rubrique "performances de décollage" au niveau de la mer en
 * atmosphère standard (ISA).
 * ================================================================ */

import { state } from './core.js';
import {
    getFleet, getActiveAircraftId, setActiveAircraft,
    addAircraft, updateAircraft, deleteAircraft,
    exportFleetData, importFleetData, normalizeFleetImport,
    exportAircraftData, importAircraftData,
} from './aircraft-fleet.js';
import { searchAircraft } from './aircraft-database.js';
import {
    defaultStations, computeWb, resolveLoads, mountWbChart,
    armToMm, armFromMm, massToKg, massFromKg, armDecimals, normalizeEnvelope,
} from './wb-core.js';

let _onCloseCallback = null;

// Brouillon du bloc centrage en cours d'édition (valeurs saisies dans les
// UNITÉS D'AFFICHAGE de l'avion, converties en kg/mm à l'enregistrement).
// _wbTouched : la section a été ouverte/modifiée — seules alors les
// modifications du bloc sont enregistrées (sinon l'existant est préservé).
let _wbDraft = null;
let _wbTouched = false;
let _wbRemove = false;      // retrait explicite de la configuration (bouton)
let _wbPreviewDispose = null;
let _importOneTargetId = null;   // avion ciblé par l'import monoplace

/** Marque la section comme modifiée (annule un retrait demandé). */
function _wbTouch() { _wbTouched = true; _wbRemove = false; }

/**
 * Ouvre le modal de gestion de la flotte.
 * @param {Function} [onClose] Callback appelé à la fermeture (pour rafraîchir le widget).
 */
export function openFleetManager(onClose) {
    _onCloseCallback = onClose || null;
    _wbDraft = null;
    _wbTouched = false; _wbRemove = false;
    _ensureModal();
    _render();
    document.getElementById('fleet-overlay').style.display = 'flex';
}

/**
 * Ferme le modal.
 */
export function closeFleetManager() {
    const overlay = document.getElementById('fleet-overlay');
    if (overlay) overlay.style.display = 'none';
    _hideSuggest();
    document.removeEventListener('click', _onDocClick);
    clearTimeout(_suggestDebounce);
    if (_onCloseCallback) {
        _onCloseCallback();
        _onCloseCallback = null;
    }
}

/**
 * Crée le squelette du modal s'il n'existe pas encore.
 */
function _ensureModal() {
    if (document.getElementById('fleet-overlay')) return;

    const isFr = state.lang === 'fr';
    const overlay = document.createElement('div');
    overlay.id = 'fleet-overlay';
    overlay.className = 'fleet-overlay';
    overlay.innerHTML = `
        <div class="fleet-modal" role="dialog" aria-modal="true" aria-labelledby="fleet-title">
            <div class="fleet-modal-header">
                <h2 id="fleet-title"><i data-lucide="plane" class="icon-sm"></i>
                    <span>${isFr ? 'Ma flotte' : 'My fleet'}</span>
                </h2>
                <button id="fleet-close" class="fleet-close" aria-label="${isFr ? 'Fermer' : 'Close'}">
                    <i data-lucide="x"></i>
                </button>
            </div>
            <div id="fleet-content" class="fleet-content"></div>
        </div>
    `;
    document.body.appendChild(overlay);

    // Fermeture au clic sur l'overlay (hors du modal).
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeFleetManager();
    });
    overlay.querySelector('#fleet-close').addEventListener('click', closeFleetManager);
    if (window.lucide) window.lucide.createIcons({ root: overlay });
}

/**
 * Rend le contenu du modal (liste + formulaire).
 */
function _render() {
    const content = document.getElementById('fleet-content');
    if (!content) return;

    const isFr = state.lang === 'fr';
    const fleet = getFleet();
    const activeId = getActiveAircraftId();

    // --- Liste des avions ---
    let html = `<div class="fleet-list-section">
        <div class="fleet-section-title">${isFr ? 'Avions enregistrés' : 'Registered aircraft'} (${fleet.length})</div>`;

    fleet.forEach(ac => {
        const isActive = ac.id === activeId;
        html += `
            <div class="fleet-item ${isActive ? 'fleet-item-active' : ''}" data-id="${ac.id}">
                <div class="fleet-item-info">
                    <div class="fleet-item-name">${_esc(ac.name)} ${ac.registration ? `<span class="fleet-item-reg">(${_esc(ac.registration)})</span>` : ''}${ac.wb ? ` <span class="fleet-wb-badge" title="${isFr ? 'Centrage configuré' : 'Weight & balance configured'}">${isFr ? 'centrage' : 'W&B'}</span>` : ''}</div>
                    <div class="fleet-item-stats">
                        <span title="${isFr ? 'Roulement au niveau mer/ISA' : 'Ground roll at SL/ISA'}">${ac.groundRoll} ft</span>
                        <span>·</span>
                        <span title="${isFr ? 'Franchissement 50ft' : '50ft obstacle'}">${ac.fiftyFt} ft</span>
                        <span>·</span>
                        <span title="${isFr ? 'Marge de sécurité' : 'Safety margin'}">${ac.safetyMargin}%</span>
                        ${ac.cruiseSpeedKt ? `<span>·</span><span title="${isFr ? 'Vitesse de croisière (TAS)' : 'Cruise speed (TAS)'}">${ac.cruiseSpeedKt} kt</span>` : ''}
                        ${ac.fuelBurnLph ? `<span>·</span><span title="${isFr ? 'Consommation horaire' : 'Fuel burn'}">${ac.fuelBurnLph} L/h</span>` : ''}
                    </div>
                </div>
                <div class="fleet-item-actions">
                    <button class="fleet-mini-btn fleet-activate ${isActive ? 'active' : ''}" data-action="activate" data-id="${ac.id}" title="${isFr ? 'Définir actif' : 'Set active'}">
                        <i data-lucide="${isActive ? 'check-circle-2' : 'circle'}"></i>
                    </button>
                    <button class="fleet-mini-btn" data-action="edit" data-id="${ac.id}" title="${isFr ? 'Éditer' : 'Edit'}">
                        <i data-lucide="pencil"></i>
                    </button>
                    <button class="fleet-mini-btn" data-action="export-one" data-id="${ac.id}" title="${isFr ? 'Exporter cet avion (JSON, centrage compris)' : 'Export this aircraft (JSON, W&B included)'}">
                        <i data-lucide="download"></i>
                    </button>
                    <button class="fleet-mini-btn" data-action="import-one" data-id="${ac.id}" title="${isFr ? 'Remplacer cet avion par un fichier exporté' : 'Replace this aircraft from an exported file'}">
                        <i data-lucide="upload"></i>
                    </button>
                    <button class="fleet-mini-btn fleet-delete" data-action="delete" data-id="${ac.id}" title="${isFr ? 'Supprimer' : 'Delete'}" ${fleet.length <= 1 ? 'disabled' : ''}>
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
            </div>
        `;
    });
    html += `</div>`;

    // --- Export / Import (la flotte est locale au navigateur ET au site :
    //     transfert free.fr ↔ miroir ↔ autre PC, et sauvegarde) ---
    html += `<div class="fleet-io">
        <button id="fleet-export" class="btn-secondary fleet-io-btn" title="${isFr ? 'Télécharger la flotte en JSON (sauvegarde / transfert vers un autre appareil)' : 'Download the fleet as JSON (backup / transfer to another device)'}">
            <i data-lucide="download"></i> ${isFr ? 'Exporter' : 'Export'}
        </button>
        <button id="fleet-import" class="btn-secondary fleet-io-btn" title="${isFr ? 'Charger une flotte exportée (remplace la flotte actuelle)' : 'Load an exported fleet (replaces the current one)'}">
            <i data-lucide="upload"></i> ${isFr ? 'Importer' : 'Import'}
        </button>
        <input type="file" id="fleet-import-file" accept=".json,application/json" hidden>
        <input type="file" id="fleet-import-one-file" accept=".json,application/json" hidden>
    </div>`;

    // --- Formulaire d'ajout/édition ---
    html += `<div class="fleet-form-section">
        <div class="fleet-section-title" id="fleet-form-title">${isFr ? 'Ajouter un avion' : 'Add an aircraft'}</div>
        <div class="fleet-form" id="fleet-form">
            <input type="hidden" id="fleet-edit-id" value="">
            <div class="fleet-form-row">
                <label>${isFr ? 'Nom / modèle' : 'Name / model'}<div class="fleet-name-field">
                    <input type="text" id="fleet-name" placeholder="${isFr ? 'ex: Cessna 172 SP' : 'e.g. Cessna 172 SP'}" maxlength="40" autocomplete="off">
                    <div class="fleet-suggest" id="fleet-suggest" role="listbox" hidden></div>
                </div></label>
                <label>${isFr ? 'Immatriculation' : 'Registration'}<input type="text" id="fleet-reg" placeholder="F-GABC" maxlength="12" style="text-transform:uppercase;"></label>
            </div>
            <div class="fleet-form-row">
                <label>${isFr ? 'Type' : 'Type'}<input type="text" id="fleet-type" placeholder="${isFr ? 'ex: C172, DR400, ULM' : 'e.g. C172, DR400'}" maxlength="20"></label>
                <label>${isFr ? 'Marge sécurité (%)' : 'Safety margin (%)'}<input type="number" id="fleet-margin" value="20" min="0" max="50" step="5"></label>
            </div>
            <div class="fleet-form-row">
                <label>${isFr ? 'Roulement SL/ISA (ft)' : 'Ground roll SL/ISA (ft)'}<input type="number" id="fleet-roll" placeholder="830" min="0" step="10"></label>
                <label>${isFr ? 'Franch. 50ft SL/ISA (ft)' : '50ft obstacle SL/ISA (ft)'}<input type="number" id="fleet-50ft" placeholder="1400" min="0" step="10"></label>
            </div>
            <div class="fleet-form-row">
                <label>${isFr ? 'Vitesse croisière (kt)' : 'Cruise speed (kt)'}<input type="number" id="fleet-cruise" placeholder="110" min="0" step="5"></label>
                <label>${isFr ? 'Conso croisière (L/h)' : 'Cruise burn (L/h)'}<input type="number" id="fleet-burn" placeholder="35" min="0" step="1"></label>
            </div>
            <details class="fleet-wb" id="fleet-wb-section">
                <summary>
                    <i data-lucide="scale" class="icon-sm"></i>
                    <span>${isFr ? 'Centrage' : 'Weight & balance'}</span>
                    <span class="fleet-wb-state" id="fleet-wb-state"></span>
                </summary>
                <div class="fleet-wb-body" id="fleet-wb-body"></div>
            </details>
            <div class="fleet-form-hint">
                <i data-lucide="info"></i>
                <span>${isFr
                    ? 'Distances issues du manuel de vol (POH) au niveau de la mer en atmosphère standard. La vitesse et la consommation de croisière alimentent la feuille de calcul de navigation (temps de vol, carburant).'
                    : 'Distances from the POH at sea level / standard atmosphere. Cruise speed and fuel burn feed the navigation flight plan (ETE, fuel).'}</span>
            </div>
            <div id="fleet-form-error" style="min-height:0; color:var(--danger); font-size:12px; padding:0 2px;" aria-live="polite"></div>
            <div class="fleet-form-actions">
                <button id="fleet-save" class="btn-primary"><i data-lucide="save"></i> ${isFr ? 'Enregistrer' : 'Save'}</button>
                <button id="fleet-cancel-form" class="btn-secondary" style="display:none;">${isFr ? 'Annuler' : 'Cancel'}</button>
            </div>
        </div>
    </div>`;

    content.innerHTML = html;
    if (window.lucide) window.lucide.createIcons({ root: content });

    // Le re-render complet repart d'un formulaire vierge : le brouillon
    // centrage repart à défaut (sauf _fillForm juste après, mode édition).
    if (!_wbDraft) _wbDraft = _defaultWbDraft();
    _wbTouched = false; _wbRemove = false;
    _renderWbSection();

    // --- Branchement des actions ---
    content.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            const id = btn.dataset.id;
            if (action === 'activate') { setActiveAircraft(id); _render(); }
            else if (action === 'edit') { _fillForm(id); }
            else if (action === 'delete') { _doDelete(id); }
            else if (action === 'export-one') {
                const data = exportAircraftData(id);
                if (!data) return;
                const ac = data.fleet[0];
                const slug = (ac.registration || ac.name || 'avion').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'avion';
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `avion-${slug}.json`;
                a.click();
                URL.revokeObjectURL(url);
            }
            else if (action === 'import-one') {
                _importOneTargetId = id;
                content.querySelector('#fleet-import-one-file').click();
            }
        });
    });

    content.querySelector('#fleet-save').addEventListener('click', _doSave);
    content.querySelector('#fleet-cancel-form').addEventListener('click', _resetForm);

    // --- Import d'UN avion (remplace l'avion ciblé, id et statut actif
    //     conservés ; le fichier doit contenir un seul avion). ---
    const oneInput = content.querySelector('#fleet-import-one-file');
    oneInput.addEventListener('change', async () => {
        const file = oneInput.files?.[0];
        oneInput.value = '';
        const id = _importOneTargetId;
        _importOneTargetId = null;
        if (!file || !id) return;
        const cur = getFleet().find(a => a.id === id);
        if (!cur) return;
        try {
            const data = JSON.parse(await file.text());
            const single = data && Array.isArray(data.fleet) && data.fleet.length === 1 ? data.fleet[0] : null;
            if (!single) {
                alert(isFr
                    ? 'Ce fichier ne contient pas un avion unique (flotte multiple ou invalide) — utilisez le bouton Importer de la flotte pour un fichier complet.'
                    : 'This file does not contain a single aircraft (multi-aircraft or invalid) — use the fleet Import button for a full file.');
                return;
            }
            const nom = String(single.name || 'Avion');
            const msg = isFr
                ? `Remplacer « ${cur.name}${cur.registration ? ' (' + cur.registration + ')' : ''} » par « ${nom} » (fichier) ?`
                : `Replace "${cur.name}" with "${nom}" (file)?`;
            if (!confirm(msg)) return;
            const res = importAircraftData(id, data);
            if (res.ok) _render();
            else alert(isFr ? 'Import impossible (avion introuvable).' : 'Import failed (aircraft not found).');
        } catch {
            alert(isFr ? 'Impossible de lire ce fichier (JSON attendu).' : 'Cannot read this file (JSON expected).');
        }
    });

    // --- Export / Import ---
    content.querySelector('#fleet-export').addEventListener('click', () => {
        const data = exportFleetData();
        const d = new Date().toISOString().slice(0, 10);
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `flotte-${d}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });
    const fileInput = content.querySelector('#fleet-import-file');
    content.querySelector('#fleet-import').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        fileInput.value = '';   // permettre de re-choisir le même fichier
        if (!file) return;
        try {
            const data = JSON.parse(await file.text());
            const norm = normalizeFleetImport(data);
            if (!norm) {
                alert(isFr ? 'Fichier de flotte invalide (attendu : un JSON exporté par le bouton Exporter).' : 'Invalid fleet file (expected: JSON exported via the Export button).');
                return;
            }
            const cur = getFleet();
            const msg = isFr
                ? `Remplacer la flotte actuelle (${cur.length} avion${cur.length > 1 ? 's' : ''}) par celle du fichier (${norm.fleet.length} avion${norm.fleet.length > 1 ? 's' : ''}) ?`
                : `Replace the current fleet (${cur.length} aircraft) with the file's (${norm.fleet.length})?`;
            if (!confirm(msg)) return;
            if (importFleetData(data)) _render();
        } catch {
            alert(isFr ? 'Impossible de lire ce fichier (JSON attendu).' : 'Cannot read this file (JSON expected).');
        }
    });

    _setupNameAutocomplete();
}

/* ----------------------------------------------------------------
 * Autocomplétion du champ nom : propose les avions de la base
 * (aircraft-database.js) et pré-remplit type / roulement / 50ft.
 * ---------------------------------------------------------------- */
let _suggestDebounce = null;

function _setupNameAutocomplete() {
    const input = document.getElementById('fleet-name');
    const box = document.getElementById('fleet-suggest');
    if (!input || !box) return;

    input.addEventListener('input', () => {
        clearTimeout(_suggestDebounce);
        const q = input.value.trim();
        if (q.length < 2) { _hideSuggest(); return; }
        _suggestDebounce = setTimeout(() => _renderSuggest(q), 180);
    });

    input.addEventListener('focus', () => {
        const q = input.value.trim();
        if (q.length >= 2) _renderSuggest(q);
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { _hideSuggest(); input.blur(); }
        if (e.key === 'Enter' && !box.hidden) {
            const first = box.querySelector('.fleet-suggest-item');
            if (first) { e.preventDefault(); first.click(); }
        }
    });

    // Ferme la liste si l'on clique en dehors. Enregistré une seule fois
    // (le même _render peut être appelé plusieurs fois sans fermer le modal).
    document.removeEventListener('click', _onDocClick);
    document.addEventListener('click', _onDocClick);
}

function _onDocClick(e) {
    const field = document.querySelector('.fleet-name-field');
    if (field && !field.contains(e.target)) _hideSuggest();
}

function _renderSuggest(query) {
    const box = document.getElementById('fleet-suggest');
    if (!box) return;
    const results = searchAircraft(query, 6);
    if (results.length === 0) { _hideSuggest(); return; }
    const isFr = state.lang === 'fr';
    box.innerHTML = results.map((ac, i) => `
        <div class="fleet-suggest-item" role="option" data-idx="${i}">
            <span class="fleet-suggest-name">${_esc(ac.name)}</span>
            <span class="fleet-suggest-dist">${ac.groundRoll}/${ac.fiftyFt} ft</span>
        </div>
    `).join('');
    box.hidden = false;

    box.querySelectorAll('.fleet-suggest-item').forEach(el => {
        el.addEventListener('click', () => {
            _applySuggestion(results[parseInt(el.dataset.idx, 10)]);
        });
    });
}

function _applySuggestion(ac) {
    const nameEl = document.getElementById('fleet-name');
    if (!ac) return;
    // On ne remplit que les champs vides : ne pas écraser ce que le pilote
    // a déjà saisi (ex: s'il a déjà mis son immatriculation ou ajusté la marge).
    if (nameEl && !nameEl.value.trim()) nameEl.value = ac.name;
    const typeEl = document.getElementById('fleet-type');
    if (typeEl && !typeEl.value.trim()) typeEl.value = ac.type;
    const rollEl = document.getElementById('fleet-roll');
    if (rollEl && !rollEl.value.trim()) rollEl.value = ac.groundRoll;
    const ftEl = document.getElementById('fleet-50ft');
    if (ftEl && !ftEl.value.trim()) ftEl.value = ac.fiftyFt;
    _hideSuggest();
    nameEl?.focus();
}

function _hideSuggest() {
    const box = document.getElementById('fleet-suggest');
    if (box) { box.hidden = true; box.innerHTML = ''; }
}

/**
 * Remplit le formulaire avec les données d'un avion (mode édition).
 */
function _fillForm(id) {
    const ac = getFleet().find(a => a.id === id);
    if (!ac) return;
    const isFr = state.lang === 'fr';

    document.getElementById('fleet-edit-id').value = ac.id;
    document.getElementById('fleet-name').value = ac.name || '';
    document.getElementById('fleet-reg').value = ac.registration || '';
    document.getElementById('fleet-type').value = ac.type || '';
    document.getElementById('fleet-margin').value = ac.safetyMargin ?? 20;
    document.getElementById('fleet-roll').value = ac.groundRoll || '';
    document.getElementById('fleet-50ft').value = ac.fiftyFt || '';
    document.getElementById('fleet-cruise').value = ac.cruiseSpeedKt || '';
    document.getElementById('fleet-burn').value = ac.fuelBurnLph || '';

    _wbDraft = ac.wb ? _wbDraftFrom(ac) : _defaultWbDraft();
    _wbTouched = false; _wbRemove = false;
    _renderWbSection();

    document.getElementById('fleet-form-title').textContent = isFr ? 'Modifier l\'avion' : 'Edit aircraft';
    document.getElementById('fleet-cancel-form').style.display = 'inline-block';
}

/**
 * Réinitialise le formulaire (mode ajout).
 */
function _resetForm() {
    const isFr = state.lang === 'fr';
    document.getElementById('fleet-edit-id').value = '';
    document.getElementById('fleet-name').value = '';
    document.getElementById('fleet-reg').value = '';
    document.getElementById('fleet-type').value = '';
    document.getElementById('fleet-margin').value = 20;
    document.getElementById('fleet-roll').value = '';
    document.getElementById('fleet-50ft').value = '';
    document.getElementById('fleet-cruise').value = '';
    document.getElementById('fleet-burn').value = '';
    _wbDraft = _defaultWbDraft();
    _wbTouched = false; _wbRemove = false;
    _renderWbSection();
    document.getElementById('fleet-form-title').textContent = isFr ? 'Ajouter un avion' : 'Add an aircraft';
    document.getElementById('fleet-cancel-form').style.display = 'none';
    const errEl = document.getElementById('fleet-form-error');
    if (errEl) errEl.textContent = '';
    _hideSuggest();
}

/**
 * Affiche un message d'erreur de validation DANS le formulaire (non bloquant,
 * contrairement à alert() qui figeait le handler le temps du popup et
 * déclenchait un « [Violation] click handler took Xms » dans la console).
 */
function _formError(msg) {
    const el = document.getElementById('fleet-form-error');
    if (!el) return;
    el.textContent = msg;
    document.getElementById('fleet-name')?.focus();
}

/* ----------------------------------------------------------------
 * Section CENTRAGE du formulaire : brouillon en unités d'affichage
 * (celles de l'avion), converti en kg/mm à l'enregistrement.
 * ---------------------------------------------------------------- */

/** Brouillon vierge : unités kg/mm, postes standards, enveloppe vide. */
function _defaultWbDraft() {
    return {
        units: { mass: 'kg', arm: 'mm' },
        emptyMass: '', emptyArm: '', mtow: '', density: '0.72',
        stations: defaultStations().map(s => ({ ...s, arm: '', max: '' })),
        envelope: [],
    };
}

/** Brouillon initialisé depuis le bloc wb existant d'un avion (converti). */
function _wbDraftFrom(ac) {
    const wb = ac.wb, u = wb.units;
    const d = _defaultWbDraft();
    d.units = { mass: u.mass, arm: u.arm };
    d.emptyMass = String(+massFromKg(wb.emptyMassKg, u.mass).toFixed(1));
    d.emptyArm = String(+armFromMm(wb.emptyArmMm, u.arm).toFixed(armDecimals(u.arm)));
    d.mtow = wb.mtowKg ? String(Math.round(massFromKg(wb.mtowKg, u.mass))) : '';
    d.density = String(wb.fuelDensity);
    d.stations = wb.stations.map(s => ({
        name: s.name, fuel: !!s.fuel,
        arm: (s.armMm != null && isFinite(s.armMm))
            ? String(+armFromMm(s.armMm, u.arm).toFixed(armDecimals(u.arm))) : '',
        max: s.maxKg ? (s.fuel ? String(s.maxKg) : String(Math.round(massFromKg(s.maxKg, u.mass)))) : '',
    }));
    d.envelope = wb.envelope.map(([m, a]) => [
        +massFromKg(m, u.mass).toFixed(1),
        +armFromMm(a, u.arm).toFixed(armDecimals(u.arm)),
    ]);
    return d;
}

/** Parse un nombre saisi (accepte la virgule décimale). */
function _num(v) { return parseFloat(String(v ?? '').replace(',', '.')); }

/**
 * Convertit le brouillon en bloc interne kg/mm. null si le bloc est
 * incomplet (masse à vide manquante ou enveloppe < 3 points) — le
 * sanitize de aircraft-fleet.js revalidera à l'enregistrement.
 */
function _draftToWb() {
    const d = _wbDraft;
    if (!d) return null;
    const u = d.units;
    const em = _num(d.emptyMass), ea = _num(d.emptyArm);
    if (!isFinite(em) || em <= 0 || !isFinite(ea)) return null;
    const envelope = normalizeEnvelope(d.envelope
        .map(p => [_num(p[0]), _num(p[1])])
        .filter(p => isFinite(p[0]) && p[0] > 0 && isFinite(p[1]))
        .map(p => [massToKg(p[0], u.mass), armToMm(p[1], u.arm)]));
    if (envelope.length < 3) return null;
    // Les postes sans bras sont conservés (armMm null) : ignorés au calcul
    // par wb-core, la saisie partielle n'est jamais perdue. Le max du poste
    // CARBURANT est en LITRES (capacité, stocké brut) — les autres en masse
    // (convertie en kg).
    const stations = d.stations
        .map(s => ({ name: String(s.name || '').trim() || 'Poste', fuel: !!s.fuel,
                     arm: _num(s.arm), max: _num(s.max) }))
        .map(s => ({ name: s.name, fuel: s.fuel,
                     armMm: isFinite(s.arm) ? armToMm(s.arm, u.arm) : null,
                     maxKg: (isFinite(s.max) && s.max > 0)
                         ? (s.fuel ? s.max : massToKg(s.max, u.mass)) : null }));
    const mt = _num(d.mtow), de = _num(d.density);
    return {
        units: { mass: u.mass, arm: u.arm },
        emptyMassKg: massToKg(em, u.mass), emptyArmMm: armToMm(ea, u.arm),
        mtowKg: (isFinite(mt) && mt > 0) ? massToKg(mt, u.mass) : null,
        fuelDensity: (isFinite(de) && de > 0.5 && de < 1.2) ? de : 0.72,
        envelope, stations,
    };
}

/** Rend le corps de la section Centrage depuis le brouillon. */
function _renderWbSection() {
    const body = document.getElementById('fleet-wb-body');
    if (!body || !_wbDraft) return;
    const isFr = state.lang === 'fr';
    const d = _wbDraft;
    const u = d.units;

    const stRows = d.stations.map((s, i) => `
        <div class="wb-tbl-row" data-i="${i}">
            <input name="wb-st-name" aria-label="Nom du poste" class="wb-st-name${s.fuel ? ' wb-st-fuel' : ''}" type="text" maxlength="24" value="${_esc(s.name)}" placeholder="${isFr ? 'poste' : 'station'}"${s.fuel ? ` title="${isFr ? 'Poste carburant : saisie en litres dans le widget (densité appliquée)' : 'Fuel station: entered in litres in the widget (density applied)'}"` : ''}>
            <input name="wb-st-arm" aria-label="Bras du poste" class="wb-st-arm" type="number" step="any" value="${s.arm}" placeholder="—">
            <input name="wb-st-max" aria-label="Masse maxi du poste" class="wb-st-max" type="number" step="any" value="${s.max}" placeholder="${s.fuel ? 'L' : u.mass}"${s.fuel ? ` title="${isFr ? 'Capacité en litres' : 'Capacity in litres'}"` : ''}>
            <button class="wb-del" data-del="st" data-i="${i}" title="${isFr ? 'Supprimer' : 'Delete'}">×</button>
        </div>`).join('');
    const envRows = d.envelope.map((p, i) => `
        <div class="wb-tbl-row" data-i="${i}">
            <input name="wb-env-masse" aria-label="Masse du point enveloppe" class="wb-env-m" type="number" step="any" value="${p[0]}" placeholder="${isFr ? 'masse' : 'mass'}">
            <input name="wb-env-bras" aria-label="Bras du point enveloppe" class="wb-env-a" type="number" step="any" value="${p[1]}" placeholder="${isFr ? 'bras' : 'arm'}">
            <button class="wb-del" data-del="env" data-i="${i}" title="${isFr ? 'Supprimer' : 'Delete'}">×</button>
        </div>`).join('');

    body.innerHTML = `
        <div class="fleet-wb-row fleet-wb-units">
            <label>${isFr ? 'Unité masse' : 'Mass unit'}
                <select id="wb-mass-unit">${['kg', 'lbs'].map(v => `<option value="${v}" ${u.mass === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
            </label>
            <label>${isFr ? 'Unité bras' : 'Arm unit'}
                <select id="wb-arm-unit">${['mm', 'm', 'ft', 'in'].map(v => `<option value="${v}" ${u.arm === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
            </label>
            <span class="fleet-wb-note">${isFr ? 'stockage interne : kg / mm' : 'internal storage: kg / mm'}</span>
        </div>
        <div class="fleet-wb-row fleet-wb-4">
            <label>${isFr ? 'Masse à vide' : 'Empty weight'} (<span class="wb-mu">${u.mass}</span>)<input type="number" step="any" id="wb-empty-mass" value="${d.emptyMass}" placeholder="628"></label>
            <label>${isFr ? 'CG à vide' : 'Empty CG'} (<span class="wb-au">${u.arm}</span>)<input type="number" step="any" id="wb-empty-arm" value="${d.emptyArm}" placeholder="295"></label>
            <label>MTOW (<span class="wb-mu">${u.mass}</span>)<input type="number" step="any" id="wb-mtow" value="${d.mtow}" placeholder="${isFr ? 'option' : 'optional'}"></label>
            <label>${isFr ? 'Densité carb. (kg/L)' : 'Fuel density (kg/L)'}<input type="number" step="0.01" id="wb-density" value="${d.density}" placeholder="0.72"></label>
        </div>
        <div class="fleet-wb-grid">
            <div>
                <div class="fleet-wb-sub">${isFr ? 'Postes de chargement' : 'Load stations'}</div>
                <div class="wb-tbl-head"><span>${isFr ? 'nom' : 'name'}</span><span>${isFr ? 'bras' : 'arm'} (${u.arm})</span><span>max (${u.mass} / L)</span><span></span></div>
                <div id="wb-stations">${stRows || `<div class="wb-empty-note">${isFr ? 'aucun poste' : 'no station'}</div>`}</div>
                <button class="wb-add" id="wb-add-station">+ ${isFr ? 'Ajouter un poste' : 'Add station'}</button>
                <div class="fleet-wb-note">${isFr ? `max en ${u.mass} — carburant : litres (capacité)` : `max in ${u.mass} — fuel: litres (capacity)`}</div>
            </div>
            <div>
                <div class="fleet-wb-sub">${isFr ? 'Enveloppe de centrage' : 'CG envelope'}</div>
                <div class="wb-tbl-head"><span>${isFr ? `masse (${u.mass})` : `mass (${u.mass})`}</span><span>${isFr ? `bras (${u.arm})` : `arm (${u.arm})`}</span><span></span></div>
                <div id="wb-envelope">${envRows || `<div class="wb-empty-note">${isFr ? 'aucun point' : 'no point'}</div>`}</div>
                <button class="wb-add" id="wb-add-point">+ ${isFr ? 'Point' : 'Point'}</button>
                <div class="fleet-wb-note">${isFr ? 'polygone fermé (sens horaire)' : 'closed polygon (clockwise)'}</div>
            </div>
        </div>
        <div class="fleet-wb-sub">${isFr ? 'Aperçu du centrogramme' : 'Centrogram preview'}</div>
        <div id="wb-preview" class="wb-preview"></div>
        <button class="wb-remove-btn" id="wb-remove-btn">
            <i data-lucide="trash-2" style="width:11px;height:11px;"></i>
            ${isFr ? 'Retirer le centrage de cet avion' : 'Remove this aircraft W&B'}
        </button>
    `;

    if (window.lucide) window.lucide.createIcons({ root: body });

    // Retrait explicite de la configuration (wb = null à l'enregistrement).
    const rmBtn = body.querySelector('#wb-remove-btn');
    if (rmBtn) rmBtn.addEventListener('click', () => {
        if (!confirm(isFr ? 'Retirer la configuration de centrage de cet avion ?'
                          : 'Remove this aircraft\'s weight & balance configuration?')) return;
        _wbDraft = _defaultWbDraft();
        _wbRemove = true;
        _wbTouched = true;
        _renderWbSection();
    });

    // La section dépliée (ou modifiée) marque le brouillon comme touché :
    // c'est seulement alors que l'enregistrement écrit le bloc wb.
    const details = document.getElementById('fleet-wb-section');
    if (details) details.addEventListener('toggle', () => { if (details.open) _wbTouch(); });

    // Unités : convertit les valeurs du brouillon vers la nouvelle unité.
    const convertDraftUnits = () => {
        const oldArm = u.arm, oldMass = u.mass;
        const newArm = body.querySelector('#wb-arm-unit').value;
        const newMass = body.querySelector('#wb-mass-unit').value;
        if (newArm === oldArm && newMass === oldMass) return;
        const convArm = v => (v === '' || v == null || !isFinite(_num(v))) ? v
            : String(+armFromMm(armToMm(_num(v), oldArm), newArm).toFixed(armDecimals(newArm)));
        const convMass = v => (v === '' || v == null || !isFinite(_num(v))) ? v
            : String(+massFromKg(massToKg(_num(v), oldMass), newMass).toFixed(1));
        u.arm = newArm; u.mass = newMass;
        d.emptyMass = convMass(d.emptyMass);
        d.emptyArm = convArm(d.emptyArm);
        d.mtow = convMass(d.mtow);
        for (const s of d.stations) { s.arm = convArm(s.arm); s.max = convMass(s.max); }
        d.envelope = d.envelope.map(p => [_num(p[0]) || 0, _num(p[1]) || 0])
            .map(([m, a]) => [+massFromKg(massToKg(m, oldMass), newMass).toFixed(1),
                              +armFromMm(armToMm(a, oldArm), newArm).toFixed(armDecimals(newArm))]);
        _wbTouch();
        _renderWbSection();
    };
    body.querySelector('#wb-mass-unit').addEventListener('change', convertDraftUnits);
    body.querySelector('#wb-arm-unit').addEventListener('change', convertDraftUnits);

    // Champs simples : maj du brouillon + aperçu (sans re-render).
    const bind = (sel, prop) => {
        const el = body.querySelector(sel);
        if (el) el.addEventListener('input', () => {
            d[prop] = el.value;
            _wbTouch();
            _refreshWbPreview();
        });
    };
    bind('#wb-empty-mass', 'emptyMass');
    bind('#wb-empty-arm', 'emptyArm');
    bind('#wb-mtow', 'mtow');
    bind('#wb-density', 'density');

    // Lignes postes / enveloppe : saisie en place (délégué), suppression.
    const stationsEl = body.querySelector('#wb-stations');
    stationsEl.addEventListener('input', (e) => {
        const row = e.target.closest('.wb-tbl-row');
        const s = d.stations[parseInt(row?.dataset.i, 10)];
        if (!s) return;
        if (e.target.classList.contains('wb-st-name')) s.name = e.target.value;
        if (e.target.classList.contains('wb-st-arm')) s.arm = e.target.value;
        if (e.target.classList.contains('wb-st-max')) s.max = e.target.value;
        _wbTouch();
        _refreshWbPreview();
    });
    const envEl = body.querySelector('#wb-envelope');
    envEl.addEventListener('input', (e) => {
        const row = e.target.closest('.wb-tbl-row');
        const p = d.envelope[parseInt(row?.dataset.i, 10)];
        if (!p) return;
        if (e.target.classList.contains('wb-env-m')) p[0] = e.target.value;
        if (e.target.classList.contains('wb-env-a')) p[1] = e.target.value;
        _wbTouch();
        _refreshWbPreview();
    });
    body.addEventListener('click', (e) => {
        if (!e.target.classList.contains('wb-del')) return;
        const i = parseInt(e.target.dataset.i, 10);
        if (e.target.dataset.del === 'st') d.stations.splice(i, 1);
        else d.envelope.splice(i, 1);
        _wbTouch();
        _renderWbSection();
    });
    body.querySelector('#wb-add-station')?.addEventListener('click', () => {
        d.stations.push({ name: '', fuel: false, arm: '', max: '' });
        _wbTouch();
        _renderWbSection();
    });
    body.querySelector('#wb-add-point')?.addEventListener('click', () => {
        d.envelope.push(['', '']);
        _wbTouch();
        _renderWbSection();
    });

    _refreshWbPreview();
}

/** Met à jour l'aperçu du centrogramme et l'état « configuré ». */
function _refreshWbPreview() {
    const stateEl = document.getElementById('fleet-wb-state');
    const host = document.getElementById('wb-preview');
    const isFr = state.lang === 'fr';
    const internal = _draftToWb();
    if (stateEl) {
        stateEl.textContent = internal
            ? (isFr ? '· configuré' : '· configured')
            : (isFr ? '· non configuré' : '· not configured');
        stateEl.classList.toggle('ok', !!internal);
    }
    if (!host) return;
    if (_wbPreviewDispose) { _wbPreviewDispose(); _wbPreviewDispose = null; }
    if (!internal) {
        host.innerHTML = `<div class="wb-preview-empty">${isFr
            ? 'Complétez la masse à vide, le CG à vide et au moins 3 points d\'enveloppe pour afficher le centrogramme.'
            : 'Fill in empty weight, empty CG and at least 3 envelope points to display the chart.'}</div>`;
        return;
    }
    const editId = document.getElementById('fleet-edit-id')?.value;
    const loads = editId ? resolveLoads(editId, state._lastNavPlan?.plan) : { masses: {}, fuelL: 0, burnL: 0 };
    const calc = computeWb(internal, loads);
    _wbPreviewDispose = mountWbChart(host, internal, calc, isFr, { hidePointLabels: false });
}

/**
 * Enregistre (ajout ou édition) l'avion du formulaire.
 */
function _doSave() {
    const isFr = state.lang === 'fr';
    document.getElementById('fleet-form-error').textContent = '';
    const name = document.getElementById('fleet-name').value.trim();
    const roll = document.getElementById('fleet-roll').value.trim();
    const ft50 = document.getElementById('fleet-50ft').value.trim();

    if (!name) {
        _formError(isFr ? 'Veuillez saisir un nom.' : 'Please enter a name.');
        return;
    }
    if (!roll || !ft50) {
        _formError(isFr ? 'Veuillez saisir les distances de référence (roulement et 50ft).' : 'Please enter reference distances (roll and 50ft).');
        return;
    }

    // Champs optionnels : vides → null (retour aux défauts du planificateur).
    const cruise = document.getElementById('fleet-cruise').value.trim();
    const burn = document.getElementById('fleet-burn').value.trim();

    const data = {
        name,
        registration: document.getElementById('fleet-reg').value.trim(),
        type: document.getElementById('fleet-type').value.trim(),
        safetyMargin: document.getElementById('fleet-margin').value,
        groundRoll: roll,
        fiftyFt: ft50,
        cruiseSpeedKt: cruise || null,
        fuelBurnLph: burn || null,
    };
    // Bloc centrage : écrit seulement si la section a été touchée — sinon
    // l'édition d'un autre champ préserve la configuration existante. Un
    // centrage incomplet BLOQUE l'enregistrement avec un message (plus
    // jamais d'effacement silencieux).
    if (_wbRemove) {
        data.wb = null;
    } else if (_wbTouched) {
        const wbBlock = _draftToWb();
        if (!wbBlock) {
            _formError(isFr
                ? 'Centrage incomplet : la masse à vide, le CG à vide et au moins 3 points d\'enveloppe sont obligatoires (les postes sans bras sont simplement ignorés).'
                : 'Incomplete weight & balance: empty weight, empty CG and at least 3 envelope points are required (stations without arm are ignored).');
            return;
        }
        data.wb = wbBlock;
    }

    const editId = document.getElementById('fleet-edit-id').value;
    if (editId) {
        updateAircraft(editId, data);
    } else {
        const created = addAircraft(data);
        setActiveAircraft(created.id);
    }

    _resetForm();
    _render();
}

/**
 * Supprime un avion (avec confirmation).
 */
function _doDelete(id) {
    const isFr = state.lang === 'fr';
    const ac = getFleet().find(a => a.id === id);
    if (!ac) return;
    if (!confirm(isFr
        ? `Supprimer « ${ac.name} » de la flotte ?`
        : `Delete "${ac.name}" from the fleet?`)) return;
    deleteAircraft(id);
    _render();
}

function _esc(text) {
    const el = document.createElement('div');
    el.textContent = String(text || '');
    return el.innerHTML;
}
