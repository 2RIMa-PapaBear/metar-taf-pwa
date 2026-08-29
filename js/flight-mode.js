/* ================================================================
 * FLIGHT MODE — Bascule Vol local / Navigation
 * ================================================================
 *
 * OBJECTIF
 * --------
 * Le pilote VFR en aéroclub a deux cas d'usage très différents :
 *
 *  VOL LOCAL (instruction, tour de piste, balette) :
 *    - Priorité à : observation METAR temps réel, vent/piste active,
 *      densité altitude, créneau jour, dégradation imminente.
 *    - L'heure d'arrivée n'a pas de sens → on reste sur "maintenant".
 *
 *  NAVIGATION (cross-country) :
 *    - Priorité à : prévision TAF à l'heure d'arrivée, alternates,
 *      météo en route, fenêtre de vol à destination.
 *    - Le scrubber temporel (HPP) devient central.
 *
 * Ce module gère l'état du toggle (persisté en localStorage) et expose
 * des hooks pour que les autres modules adaptent leur affichage.
 *
 * Les comportements concrets (réorganiser le dashboard, afficher des
 * widgets dédiés) seront branchés progressivement dans les sprints
 * suivants. Pour l'instant, le toggle :
 *   1. Persiste le choix.
 *   2. Met à jour l'apparence du bouton.
 *   3. Ajoute une classe sur <body> (.mode-local / .mode-nav) pour
 *      permettre au CSS d'adapter le layout.
 *   4. Force un rafraîchissement du dashboard.
 * ================================================================ */

import { state } from './core.js';
import { showAlternates } from './alternates.js';
import { clearElevationChart } from './elevation-chart.js';
import { openRegionalMap } from './regional-map.js';

const STORAGE_KEY = 'flight-mode';

/**
 * @returns {'local'|'nav'} Le mode de vol courant.
 */
export function getFlightMode() {
    try {
        const m = localStorage.getItem(STORAGE_KEY);
        return m === 'nav' ? 'nav' : 'local';
    } catch {
        return 'local';
    }
}

/**
 * Définit le mode de vol et met à jour l'UI.
 * @param {'local'|'nav'} mode
 */
export function setFlightMode(mode) {
    try {
        localStorage.setItem(STORAGE_KEY, mode);
    } catch {
        /* quota / mode privé */
    }

    document.body.classList.remove('mode-local', 'mode-nav');
    document.body.classList.add(mode === 'nav' ? 'mode-nav' : 'mode-local');

    // En navigation, la barre Départ → Destination PREND LA PLACE de la
    // rangée Code OACI / METAR-TAF (qui descend d'un cran) : on la déplace
    // DANS la carte d'en-tête, entre le titre et le champ OACI. En vol
    // local, elle retourne à sa place d'origine dans la colonne (les
    // écouteurs suivent l'élément, aucun recâblage nécessaire).
    const rp = document.getElementById('route-planner');
    const search = document.querySelector('.center-column > header.card .hpp-group.search-group');
    if (rp && search) {
        if (mode === 'nav') {
            rp._homeParent ??= rp.parentElement;
            rp._homeNext ??= rp.nextSibling;
            search.parentElement.insertBefore(rp, search);
        } else if (rp._homeParent && rp.parentElement !== rp._homeParent) {
            rp._homeParent.insertBefore(rp, rp._homeNext);
        }
    }

    // Le bandeau « Fenêtre de vol » monte lui aussi dans la carte d'en-tête,
    // JUSTE SOUS la rangée titre, dans les DEUX modes : en navigation il
    // s'intercale entre le titre et la barre Départ → Destination, en vol
    // local entre le titre et la rangée Code OACI / METAR-TAF.
    const banner = document.getElementById('flight-window-banner');
    const headerRow = document.querySelector('.center-column > header.card .header-row');
    if (banner && headerRow && banner.parentElement !== headerRow.parentElement) {
        headerRow.parentElement.insertBefore(banner, headerRow.nextSibling);
    }

    // Met à jour le toggle.
    const toggle = document.getElementById('flight-mode-toggle');
    if (toggle) {
        toggle.setAttribute('data-mode', mode);
        toggle.setAttribute('aria-pressed', String(mode === 'nav'));

        // Met à jour les labels des segments.
        updateToggleLabels();
    }

    // En mode navigation, on s'assure que l'heure d'arrivée (HPP) est
    // remise à "maintenant" pour ne pas garder une ancienne valeur.
    // Le pilote ajustera via le scrubber.
    if (mode === 'local') {
        state.manualTargetHour = null;
        // Nettoie la destination, le planificateur, le profil d'élévation
        // et la route sur la carte (retour au vol local pur).
        const toInput = document.getElementById('route-to-input');
        if (toInput) toInput.value = '';
        const toName = document.getElementById('route-to-name');
        if (toName) toName.textContent = '';
        const fpPanel = document.getElementById('flight-planner-panel');
        if (fpPanel) fpPanel.style.display = 'none';
        clearElevationChart('elevation-profile-container');
        // Réinitialise le toggle Départ/Destination sur Départ.
        document.querySelectorAll('.dep-dest-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.side === 'dep');
        });
        // Rafraîchit la carte pour effacer la route précédente (via événement).
        document.dispatchEvent(new CustomEvent('clear-route'));
    }

    // Réapplique la logique des alternates selon le mode :
    // - Navigation : affiche le comparateur d'alternates pour le terrain courant.
    // - Local : le masque (un pilote en local n'a pas besoin de déroutement).
    const altC = document.getElementById('alternates-container');
    if (mode === 'nav') {
        if (state.requestedIcao) showAlternates(state.requestedIcao);
        // Guide le pilote : ouvre la carte régionale et place le curseur dans
        // le champ Destination (sans faire défiler). Au permalien nav, le
        // METAR du départ arrive APRÈS la bascule : la carte s'ouvre quand
        // même et se remplira à son tour.
        openRegionalMap();
        setTimeout(() => document.getElementById('route-to-input')?.focus({ preventScroll: true }), 120);
    } else if (altC) {
        altC.style.display = 'none';
    }

    // Force un rafraîchissement du dashboard.
    if (state.refreshCallback) {
        state.lastRenderState = null;
        state.refreshCallback();
    }
}

/**
 * Bascule entre les deux modes.
 */
export function toggleFlightMode() {
    setFlightMode(getFlightMode() === 'nav' ? 'local' : 'nav');
}

/**
 * Met à jour les libellés du toggle selon la langue active.
 */
function updateToggleLabels() {
    const toggle = document.getElementById('flight-mode-toggle');
    if (!toggle) return;
    const lang = state.lang || 'fr';
    const localLbl = toggle.querySelector('.seg-local');
    const navLbl = toggle.querySelector('.seg-nav');
    if (localLbl) localLbl.textContent = lang === 'fr' ? 'Local' : 'Local';
    if (navLbl) navLbl.textContent = lang === 'fr' ? 'Navigation' : 'Nav';
}

/**
 * Initialise le toggle au démarrage.
 */
export function initFlightMode() {
    // Au démarrage, on force toujours le mode 'local' (vol local par défaut).
    setFlightMode('local');

    const toggle = document.getElementById('flight-mode-toggle');
    if (toggle) {
        toggle.addEventListener('click', toggleFlightMode);
        updateToggleLabels();
    }
}
