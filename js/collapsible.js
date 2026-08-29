/* ================================================================
 * COLLAPSIBLE — Helper de widgets repliables
 * ================================================================
 *
 * OBJECTIF
 * --------
 * Appliquer le mécanisme "header cliquable + body repliable" (le même
 * que celui de la carte régionale et des alternates) à n'importe quel
 * widget dont le contenu est rendu dynamiquement.
 *
 * PROBLÈME RÉSOLU
 * ---------------
 * Les widgets (takeoff, frequencies, flight-planner, go-nogo,
 * flight-window) font un `container.innerHTML = ...` complet à chaque
 * mise à jour. Si on enveloppe leur contenu dans un header+body externe,
 * le prochain rendu l'écrase. On perdrait le header.
 *
 * SOLUTION
 * --------
 * On réécrit la structure du conteneur une seule fois, avec :
 *   <aside id="widget" class="card collapsible-panel">
 *     <div class="collapsible-header" data-toggle>
 *       <i icon> <span title> <i chevron>
 *     </div>
 *     <div class="collapsible-body" data-body>
 *       <!-- le module rend ICI son innerHTML -->
 *     </div>
 *   </aside>
 *
 * Puis on renvoie au module une RÉFÉRENCE vers le body, pour qu'il
 * fasse `body.innerHTML = ...` au lieu de `container.innerHTML = ...`.
 *
 * Le toggle (clic sur le header) bascule la classe `.open`.
 *
 * MÉMORISATION DE L'ÉTAT
 * ---------------------
 * L'état ouvert/replié de chaque widget est persisté en localStorage
 * (par id), sauf pour go-nogo et flight-window qui restent toujours
 * ouverts (ce sont des alertes de sécurité — on ne les replie pas par
 * défaut, mais le pilote peut le faire manuellement).
 * ================================================================ */

const STATE_KEY_PREFIX = 'collapse-';

// Widgets qui restent ouverts par défaut (alertes de sécurité).
const ALWAYS_OPEN = new Set(['go-nogo-banner', 'flight-window-banner']);

/**
 * Prépare un conteneur en panel repliable.
 *
 * Si le conteneur n'a pas encore été préparé (pas de data-collapsible),
 * on y injecte la structure header + body. Renvoie le body pour que le
 * module appelant rende son contenu dedans.
 *
 * @param {HTMLElement} container Le conteneur du widget (.card).
 * @param {string} title Texte du header.
 * @param {string} icon Nom d'icône Lucide.
 * @returns {HTMLElement} L'élément body où rendre le contenu.
 */
export function makeCollapsible(container, title, icon) {
    if (!container) return null;

    // Déjà préparé : on retourne juste le body existant.
    const existingBody = container.querySelector('[data-body]');
    if (existingBody) {
        // Met à jour le titre/icône au cas où (langue).
        const titleEl = container.querySelector('.collapsible-title');
        if (titleEl) titleEl.textContent = title;
        const iconEl = container.querySelector('.collapsible-header-icon');
        if (iconEl) iconEl.setAttribute('data-lucide', icon);
        return existingBody;
    }

    // État initial : ouvert (sauf pour les widgets persistés fermés).
    const id = container.id;
    let open = true;
    if (!ALWAYS_OPEN.has(id)) {
        try {
            open = localStorage.getItem(STATE_KEY_PREFIX + id) !== '0';
        } catch { /* quota */ }
    }

    if (open) container.classList.add('open');

    // Sauvegarde le contenu existant (si le module a déjà rendu quelque chose).
    const existingContent = container.innerHTML;

    container.classList.add('collapsible-panel');
    container.innerHTML = `
        <div class="collapsible-header" data-toggle>
            <i data-lucide="${icon}" class="collapsible-header-icon" style="width:16px;height:16px;"></i>
            <span class="collapsible-title">${title}</span>
            <i data-lucide="chevron-down" class="collapsible-chevron"></i>
        </div>
        <div class="collapsible-body" data-body>${existingContent}</div>
    `;

    // Branche le toggle.
    const header = container.querySelector('[data-toggle]');
    header.addEventListener('click', () => {
        const isOpen = container.classList.toggle('open');
        if (!ALWAYS_OPEN.has(id)) {
            try {
                localStorage.setItem(STATE_KEY_PREFIX + id, isOpen ? '1' : '0');
            } catch { /* quota */ }
        }
    });

    if (window.lucide) window.lucide.createIcons({ root: container });

    return container.querySelector('[data-body]');
}

/**
 * Indique si un conteneur a déjà été préparé en panel repliable.
 */
export function isCollapsible(container) {
    return !!container?.querySelector('[data-body]');
}
