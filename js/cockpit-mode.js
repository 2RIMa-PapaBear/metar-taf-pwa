/* ================================================================
 * COCKPIT MODE — Briefing express ultra-lisible
 * ================================================================
 *
 * OBJECTIF
 * --------
 * En aéroclub ou en instruction, le pilote ne veut pas scroller dans
 * un dashboard complet : il veut UNE réponse claire, en gros, visible
 * à 2 mètres de la tablette posée sur la table de briefing.
 *
 * Ce mode « Briefing express » bascule le layout en une seule colonne
 * centrée qui ne montre QUE l'essentiel :
 *   - La bannière GO/NO-GO (le verdict).
 *   - La catégorie de vol.
 *   - Le vent et la piste active.
 *   - Le créneau de vol jour.
 *
 * Tout le reste (favoris, historique, carte, graphique, takeoff, etc.)
 * est masqué pour réduire la charge visuelle. Un bouton permet de
 * revenir au mode complet.
 *
 * PERSISTANCE
 * -----------
 * Le choix est sauvegardé en localStorage et restauré au prochain
 * chargement (utile si le pilote ouvre l'app directement au club).
 *
 * IMPLÉMENTATION
 * --------------
 * On ajoute une classe `.cockpit-mode` sur <body>. Le CSS associé
 * masque les éléments secondaires et agrandit les essentiels. Aucune
 * donnée n'est perdue : les widgets sont juste cachés, pas déchargés.
 * ================================================================ */

const STORAGE_KEY = 'cockpit-mode';

// Sélecteurs CSS des éléments à MASQUER en cockpit mode.
// Le préfixe "body.cockpit-mode" est ajouté par le CSS.
// Liste des sélecteurs (le CSS fait le travail de masquage).
const HIDDEN_SELECTORS = [
    '.side-column',              // favoris + historique
    '#route-planner',            // barre Départ → Destination (nav déjà décidée)
    '#regional-map-panel',       // carte (trop chargée)
    '.legend-bar-bottom',        // légende nuages
    '.aero-legend-bar',          // bandeau heures aéro
    '#alertes-meteo',            // alertes détaillées (synthèse dans GO/NO-GO)
    '#takeoff-widget',           // décollage (trop technique pour briefing)
    '#frequencies-widget',       // fréquences (déjà connues au briefing)
    '#alternates-container',     // alternates (déjà décidé)
    '#flight-planner-panel',     // planner
    '.audio-controls',           // boutons audio/PDF (déjà faits)
];

/**
 * Indique si le mode cockpit est actif.
 * @returns {boolean}
 */
export function isCockpitMode() {
    return document.body.classList.contains('cockpit-mode');
}

/**
 * Active ou désactive le mode cockpit.
 * @param {boolean} enabled
 */
export function setCockpitMode(enabled) {
    document.body.classList.toggle('cockpit-mode', enabled);
    try {
        localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
    } catch { /* quota / mode privé */ }

    // Met à jour le bouton toggle.
    const btn = document.getElementById('btn-cockpit-mode');
    if (btn) {
        btn.setAttribute('aria-pressed', String(enabled));
        btn.classList.toggle('active', enabled);
    }

    // En cockpit mode, on recentre la vue sur le GO/NO-GO.
    if (enabled) {
        const banner = document.getElementById('go-nogo-banner');
        if (banner && banner.style.display !== 'none') {
            banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
}

/**
 * Bascule le mode cockpit (ON ↔ OFF).
 */
export function toggleCockpitMode() {
    setCockpitMode(!isCockpitMode());
}

/**
 * Restaure le mode cockpit depuis localStorage au démarrage.
 * À appeler dans le DOMContentLoaded.
 */
export function initCockpitMode() {
    let enabled = false;
    try {
        enabled = localStorage.getItem(STORAGE_KEY) === '1';
    } catch { /* localStorage indisponible */ }
    setCockpitMode(enabled);

    // Branche le bouton.
    const btn = document.getElementById('btn-cockpit-mode');
    if (btn) {
        btn.addEventListener('click', toggleCockpitMode);
    }
}

export { HIDDEN_SELECTORS };
