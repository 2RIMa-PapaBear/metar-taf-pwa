/* ================================================================
 * NIGHT MODE — Préservation de la vision nocturne (rhodopsine)
 * ================================================================
 *
 * PRINCIPE AÉRONAUTIQUE
 * ----------------------
 * La vision nocturne dépend de la rhodopsine, un pigment rétinien
 * extrêmement sensible à la lumière — surtout aux longueurs d'onde
 * courtes (bleu/vert). Une exposition même brève à un écran blanc
 * détruit l'adaptation nocturne (30+ min pour la récupérer).
 *
 * La lumière rouge (>620nm) préserve la rhodopsine : c'est pourquoi
 * les cockpits et les tours de contrôle utilisent un éclairage rouge.
 *
 * IMPLÉMENTATION
 * --------------
 * On bascule une classe `.night-mode` sur <html>, qui surcharge les
 * variables CSS (--bg-color, --text-color, etc.) vers une palette
 * exclusivement rouge sombre. Le canvas et les SVG (qui utilisent
 * des couleurs codées en dur) reçoivent un filtre CSS `hue-rotate`
 * + `sepia` + `saturate` qui les pousse vers le rouge sans casser
 * la sémantique des couleurs (les catégories VFR/IFR restent
 * distinctes, juste décalées vers le spectre rouge).
 *
 * PERSISTANCE
 * -----------
 * Le choix de l'utilisateur est sauvegardé en localStorage pour
 * être restauré à la prochaine visite.
 * ================================================================ */

const STORAGE_KEY = 'night-mode-enabled';

/**
 * Indique si le mode nuit est actuellement actif.
 * @returns {boolean}
 */
export function isNightMode() {
    return document.documentElement.classList.contains('night-mode');
}

/**
 * Active ou désactive le mode nuit rouge.
 * @param {boolean} enabled
 */
export function setNightMode(enabled) {
    const root = document.documentElement;
    if (enabled) {
        root.classList.add('night-mode');
    } else {
        root.classList.remove('night-mode');
    }
    try {
        localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
    } catch {
        /* quota / mode privé — on ignore */
    }

    // Met à jour l'apparence du bouton toggle.
    const btn = document.getElementById('btn-night-mode');
    if (btn) {
        btn.setAttribute('aria-pressed', String(enabled));
        btn.classList.toggle('active', enabled);
    }
}

/**
 * Bascule le mode nuit (ON ↔ OFF).
 */
export function toggleNightMode() {
    setNightMode(!isNightMode());
}

/**
 * Restaure le mode nuit depuis le localStorage au démémarrage.
 * À appeler tôt dans l'init pour éviter un flash de lumière blanche.
 */
export function initNightMode() {
    let enabled = false;
    try {
        enabled = localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
        /* localStorage indisponible */
    }
    setNightMode(enabled);
}
