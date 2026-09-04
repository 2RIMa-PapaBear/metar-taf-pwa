/* ================================================================
 * THÈME CLAIR / THÈME SOMBRE — remplace l'ancien « mode nuit rouge »
 * ================================================================
 *
 * PRINCIPE
 * --------
 * L'app naît sombre (palette bleu nuit). Le bouton « Thème » de
 * l'en-tête bascule l'ENSEMBLE de l'interface vers un thème clair
 * (jour, salle de briefing) et inversement :
 *   - la classe .theme-light sur <html> surcharge les variables CSS ;
 *   - les CANVAS et SVG (graphique METAR/TAF, profil d'élévation,
 *     rose des vents), qui ne lisent pas les variables CSS, pigent
 *     leurs couleurs de fond/texte/grille via themeTokens() ;
 *   - un événement 'theme-changed' est émis pour que l'app redessine
 *     les canvas concernés.
 *
 * PERSISTANCE
 * -----------
 * Le choix est sauvegardé en localStorage ('theme-mode') et restauré
 * au démarrage — sans flash grâce à l'init précoce.
 * ================================================================ */

const STORAGE_KEY = 'theme-mode';

/**
 * Thème clair actif ?
 * @returns {boolean}
 */
export function isLightTheme() {
    return document.documentElement.classList.contains('theme-light');
}

/**
 * Couleurs des rendus canvas/SVG selon le thème (ils ne lisent pas
 * les variables CSS). À appeler À CHAQUE tracé, pas une fois pour
 * toutes — le thème peut basculer à tout moment.
 */
export function themeTokens() {
    return isLightTheme()
        ? {
            bg: '#FFFFFF',            // fond canvas
            text: '#1E293B',          // texte principal
            muted: '#64748B',         // texte secondaire
            dim: 'rgba(15, 23, 42, 0.45)',
            grid: 'rgba(15, 23, 42, 0.10)',
            gridStrong: 'rgba(15, 23, 42, 0.22)',
        }
        : {
            bg: '#0F172A',
            text: '#E2E8F0',
            muted: '#94A3B8',
            dim: 'rgba(255, 255, 255, 0.35)',
            grid: 'rgba(255, 255, 255, 0.08)',
            gridStrong: 'rgba(255, 255, 255, 0.15)',
        };
}

/**
 * Applique le thème.
 * @param {'light'|'dark'} mode
 */
export function setTheme(mode) {
    const light = mode === 'light';
    const root = document.documentElement;
    root.classList.toggle('theme-light', light);
    // Nettoyage de l'ancien mode nuit rouge (migration une fois).
    root.classList.remove('night-mode');
    try {
        localStorage.setItem(STORAGE_KEY, light ? 'light' : 'dark');
        localStorage.removeItem('night-mode-enabled');
    } catch {
        /* quota / mode privé — on ignore */
    }

    // Apparence du bouton : libellé (l'icône suit via CSS).
    const btn = document.getElementById('btn-theme');
    if (btn) {
        btn.setAttribute('aria-pressed', String(light));
        const lbl = btn.querySelector('.theme-lbl');
        if (lbl) {
            const fr = (document.documentElement.lang || 'fr') === 'fr';
            lbl.textContent = light
                ? (fr ? 'Sombre' : 'Dark')
                : (fr ? 'Clair' : 'Light');
        }
        btn.title = light
            ? 'Passer en thème sombre'
            : 'Passer en thème clair';
    }

    // Les canvas/SVG se redessinent avec les nouveaux tokens.
    document.dispatchEvent(new CustomEvent('theme-changed', { detail: { light } }));
}

/**
 * Bascule clair ↔ sombre.
 */
export function toggleTheme() {
    setTheme(isLightTheme() ? 'dark' : 'light');
}

/**
 * Restaure le thème au démarrage (sans flash). Pas d'événement ici :
 * les canvas se dessinent après l'init, avec les bons tokens d'emblée.
 */
export function initTheme() {
    let mode = 'dark';
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved === 'light' || saved === 'dark') mode = saved;
        // Ancien mode nuit rouge → on retombe sur le thème sombre.
        localStorage.removeItem('night-mode-enabled');
    } catch {
        /* localStorage indisponible */
    }
    document.documentElement.classList.toggle('theme-light', mode === 'light');
    const btn = document.getElementById('btn-theme');
    if (btn) btn.setAttribute('aria-pressed', String(mode === 'light'));
    try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* quota */ }
}
