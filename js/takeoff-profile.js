/* ================================================================
 * TAKEOFF PROFILE — Schéma de décollage en coupe (SVG)
 * ================================================================
 *
 * Vue de profil du décollage, façon « coupe de piste » :
 *   - avion posé au seuil,
 *   - segment de roulement jusqu'à la rotation,
 *   - segment de montée jusqu'au franchissement des 50 ft
 *     (avion en vol à cet endroit),
 *   - marge restante (ou manque) mise en couleur.
 *
 * ALIGNEMENT AVEC LA BARRE « PLAN » — la piste occupe TOUTE la
 * largeur du panneau, du bord gauche au bord droit, avec la même
 * échelle que la barre de marge affichée sous le schéma (0 à gauche,
 * fin de piste à droite) : les deux dessins se lisent comme la même
 * piste vue de dessus et en coupe. Si le 50 ft tombe au-delà de la
 * piste, la montée est tronquée au bord droit — comme la barre borne
 * son remplissage à 100 % — et l'étiquette « manque » chiffre l'écart.
 *
 * Module SANS dépendance (fonctions pures) : insérable dans le
 * widget takeoff ET testable sous Node (QA géométrique).
 *
 * TYPOGRAPHIE — le viewBox est généré à la largeur RÉELLE du panneau
 * (mountTakeoffProfile mesure puis re-rend), donc échelle 1:1 : les
 * textes font exactement leur taille CSS (10 px, comme le reste du
 * widget) quelle que soit la largeur.
 *
 * L'échelle horizontale est proportionnelle aux distances ; la
 * hauteur « 50 ft » est schématique (une vraie échelle rendrait la
 * montée invisible : 15 m de haut pour 400 m de long).
 * ================================================================ */

// Compteur pour des ids de pattern uniques (plusieurs SVG par page).
let _uidSeq = 0;

const FT_TO_M = 0.3048;
function ftToM(ft) { return Math.round(ft * FT_TO_M); }

// Géométrie du viewBox. La largeur s'adapte au conteneur (défaut 340).
// La piste va de 0 à W : même longueur que la barre « plan » du widget.
const H = 108;
const RWY_Y = 76;  // ligne de piste
const FT50_Y = 26; // altitude 50 ft (schématique)
const CLIMB_RISE = (RWY_Y - 3) - (FT50_Y + 7); // hauteur px du segment de montée

const LEVEL_COLORS = { ok: '#10B981', caution: '#F59E0B', danger: '#EF4444', unknown: '#38BDF8' };
const MONO = "'DM Mono',monospace";

// Icône d'avion de profil en montée — tracé « plane-takeoff » de la
// bibliothèque Lucide déjà bundled (vendor/lucide.min.js, Apache-2.0),
// corps seul : la ligne de sol de l'icône est retirée, la piste du
// schéma tient ce rôle. Vue 24×24, origine ramenée au centre (12,12).
// Le ventre monte nativement de PLANE_TILT degrés vers la droite.
const PLANE_ICON_D = 'M6.36 17.4 4 17l-2-4 1.1-.55a2 2 0 0 1 1.8 0l.17.1a2 2 0 0 0 1.8 0L8 12 5 6l.9-.45a2 2 0 0 1 2.09.2l4.02 3a2 2 0 0 0 2.1.2l4.19-2.06a2.41 2.41 0 0 1 1.73-.17L21 7a1.4 1.4 0 0 1 .87 1.99l-.38.76c-.23.46-.6.84-1.07 1.08L7.58 17.2a2 2 0 0 1-1.22.18Z';
const PLANE_TILT = 26.4; // inclinaison native du ventre (nez haut)
const PLANE_DROP = 2.7;  // étendue sous le centre une fois mise à plat
const PLANE_TAIL = 3.55; // point le plus bas (empennage) SOUS la ligne de ventre
const PLANE_LIFT = 4;    // garde ventre ↔ trait (piste ou montée), idem PDF

/**
 * Calcule le layout (positions en px) du schéma pour un résultat
 * takeoff donné. Exporté pour la QA géométrique (tests Node).
 *
 * @param {{groundRoll:number, fiftyFt:number, runwayLength:number|null,
 *          margin:number|null, level:string}} r Résultat evaluateTakeoffPerformance.
 * @param {number} [width] Largeur du viewBox (= largeur du conteneur).
 * @returns {{W:number,H:number,x0:number,xR:number,rwyY:number,fiftyY:number,
 *            pxPerFt:number,liftX:number,fiftyX:number,fiftyDrawX:number,
 *            rwyEndX:number|null,labelLiftX:number,climbAngle:number,
 *            planeScale:number,col:string}}
 */
export function takeoffProfileLayout(r, width = 340) {
    const W = Math.max(280, Math.round(width));
    const XR = W;

    // Échelle : piste connue → la piste occupe toute la largeur
    // (identique à la barre « plan »). Sinon (longueur inconnue),
    // on échelonne sur la distance 50 ft et la piste reste ouverte.
    const known = r.runwayLength != null && r.runwayLength > 0;
    const spanFt = known ? r.runwayLength : r.fiftyFt * 1.15;
    const pxPerFt = XR / spanFt;

    const rollFt = Math.min(r.groundRoll, r.fiftyFt); // garde-fou
    // Position de rotation (tronquée si absurde : roulement ≥ piste).
    const liftX = Math.min(rollFt * pxPerFt, XR - 30);
    // Position vraie du 50 ft — peut dépasser le cadre en danger.
    const fiftyX = r.fiftyFt * pxPerFt;
    // Position dessinée : bornée au bord droit (montée tronquée).
    const fiftyDrawX = Math.min(fiftyX, XR - 2);
    const rwyEndX = known ? XR : null;

    // Étiquette du point de rotation : bornée à droite (10 px ≈ 36 px
    // de large) pour rester lisible et dans le cadre.
    const labelLiftX = Math.max(24, Math.min(liftX, XR - 46));

    // Pente du segment de montée (assiette de l'avion en vol).
    const climbAngle = Math.atan2(CLIMB_RISE, Math.max(1, fiftyX - liftX)) * 180 / Math.PI;

    // Étiquette « 50 ft · X m » : À DROITE du repère vertical, posée au
    // bout du trait (juste au-dessus de son extrémité haute, comme le
    // PDF p3) ; bascule à gauche SOUS la montée, sur la rangée du bas
    // (même hauteur que marge/manque, cf. danger) si elle déborderait du
    // bord droit (marge faible — l'avion occupe la zone du repère).
    const fiftyTxt = `50 ft · ${ftToM(r.fiftyFt)} m`;
    const estW = fiftyTxt.length * 6.2; // DM Mono 10 px ≈ 6,2 px/car.
    let fiftyLblX, fiftyLblAnchor, fiftyLblY;
    if (fiftyX + 6 + estW <= XR - 1) {
        fiftyLblAnchor = 'start'; fiftyLblX = fiftyX + 6; fiftyLblY = FT50_Y + 5;
    } else {
        fiftyLblAnchor = 'end'; fiftyLblX = Math.min(fiftyX - 3, XR - 1); fiftyLblY = RWY_Y - 12;
    }

    // Les avions grossissent un peu sur les panneaux larges (borné).
    const planeScale = 1.18 * Math.min(1.5, Math.max(1, W / 340));

    return {
        W, H, x0: 0, xR: XR, rwyY: RWY_Y, fiftyY: FT50_Y,
        pxPerFt, liftX, fiftyX, fiftyDrawX, rwyEndX, labelLiftX,
        fiftyLblX, fiftyLblAnchor, fiftyLblY, climbAngle, planeScale,
        col: LEVEL_COLORS[r.level] || LEVEL_COLORS.unknown,
    };
}

/**
 * Rend le schéma de décollage en coupe (SVG inline).
 * @param {Object} r Résultat evaluateTakeoffPerformance.
 * @param {boolean} [isFr] Langue des étiquettes.
 * @param {number} [width] Largeur du viewBox (celle du conteneur).
 * @returns {string} HTML du SVG.
 */
export function takeoffProfileSvg(r, isFr = true, width = 340) {
    const L = takeoffProfileLayout(r, width);
    const uid = 'tp' + (++_uidSeq);
    const muted = 'var(--text-muted)';
    const known = L.rwyEndX != null;
    const p = [];

    const aria = isFr
        ? 'Profil de décollage : roulement, rotation puis montée au franchissement des 50 ft'
        : 'Takeoff profile: ground roll, rotation then climb to 50 ft';

    // ---- Hachures de coupe de sol (pattern unique par instance) ----
    p.push(`<defs><pattern id="${uid}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">`
        + `<line x1="0" y1="0" x2="0" y2="6" stroke="#64748B" stroke-width="1.3" opacity="0.35"/></pattern></defs>`);

    // ---- Sol : ligne de piste (0 → W, comme la barre) + coupe hachurée ----
    // Caps « butt » pour tomber pile sur les bords du viewBox ; les
    // jalons de seuil/fin sont rentrés d'1 px pour n'être pas rognés.
    p.push(`<line data-rwy="1" x1="0" y1="${RWY_Y}" x2="${L.xR}" y2="${RWY_Y}" stroke="#64748B" stroke-width="2"${known ? '' : ' stroke-dasharray="5 4"'}/>`);
    p.push(`<rect x="0" y="${RWY_Y + 3}" width="${L.xR}" height="7" fill="url(#${uid})"/>`);
    p.push(`<line x1="1" y1="${RWY_Y - 5}" x2="1" y2="${RWY_Y + 2}" stroke="#64748B" stroke-width="1.5"/>`);
    if (known) p.push(`<line x1="${L.xR - 1}" y1="${RWY_Y - 5}" x2="${L.xR - 1}" y2="${RWY_Y + 2}" stroke="#64748B" stroke-width="1.5"/>`);

    // ---- Trajectoire : roulement puis montée ----
    p.push(`<line x1="2" y1="${RWY_Y - 2.5}" x2="${L.liftX}" y2="${RWY_Y - 2.5}" stroke="${L.col}" stroke-width="3" stroke-linecap="round"/>`);
    // Fin de la montée : point 50 ft s'il est dans le cadre, sinon le
    // bord droit (tronqué, comme la barre borne son remplissage).
    const climbEndY = L.fiftyDrawX >= L.fiftyX - 0.5
        ? FT50_Y + 7
        : (RWY_Y - 3) - ((L.fiftyDrawX - L.liftX) / Math.max(1, L.fiftyX - L.liftX)) * CLIMB_RISE;
    p.push(`<line x1="${L.liftX}" y1="${RWY_Y - 3}" x2="${L.fiftyDrawX}" y2="${climbEndY}" stroke="${L.col}" stroke-width="2.5" stroke-linecap="round"/>`);

    const inFrame = L.fiftyX <= L.xR - 1; // point 50 ft visible ?
    if (inFrame) {
        // Repère de hauteur au point 50 ft.
        p.push(`<line x1="${L.fiftyX}" y1="${FT50_Y + 8}" x2="${L.fiftyX}" y2="${RWY_Y}" stroke="${muted}" stroke-width="1" stroke-dasharray="2 3" opacity="0.6"/>`);
    }

    // ---- Positions des avions (calculées avant les étiquettes : le
    // « manque » se place AU-DESSUS de l'avion en vol) ----
    const s = L.planeScale;
    // Posé : icône mise à plat (ventre parallèle à la piste), flottant de
    // PLANE_LIFT au-dessus du trait — même écart que l'avion au 50 ft.
    const groundedY = RWY_Y - 1 - (PLANE_DROP + PLANE_LIFT) * s;
    let airX, airY;
    if (inFrame) {
        // En vol : assiette alignée sur la pente de montée.
        airX = L.fiftyX - 10.5 * s; airY = FT50_Y - 2.1 * s;
    } else {
        // Fin de segment tronqué : centre à distance perpendiculaire
        // constante du trait de montée (garde du posé + point bas de
        // l'empennage) — sinon l'icône recouvre le trait.
        const th = L.climbAngle * Math.PI / 180;
        airX = L.fiftyDrawX - 12 * s;
        airY = climbEndY - ((PLANE_DROP + PLANE_TAIL + PLANE_LIFT) * s
            + (airX - L.fiftyDrawX) * Math.sin(th)) / Math.cos(th);
    }

    // ---- Marge restante / manque ----
    if (known && r.margin != null) {
        if (r.margin >= 0) {
            const mw = L.rwyEndX - L.fiftyX - 6;
            if (mw > 4) {
                p.push(`<rect x="${L.fiftyX + 3}" y="${RWY_Y - 8}" width="${mw}" height="3.5" rx="1.5" fill="${L.col}" opacity="0.5"/>`);
                if (mw >= 46) {
                    p.push(`<text x="${(L.fiftyX + L.rwyEndX) / 2}" y="${RWY_Y - 12}" text-anchor="middle" font-family="${MONO}" font-size="10" fill="${L.col}">+${ftToM(r.margin)} m</text>`);
                }
            }
        } else {
            // Tout le « manque » est au-delà du bord droit : chiffre
            // l'écart AU-DESSUS de l'avion (zone dégagée en haut de la
            // montée tronquée ; en bas l'étiquette croisait la pente et
            // l'avion), borné au cadre.
            const manqueY = Math.max(11, airY - 12 * s);
            p.push(`<text x="${L.fiftyDrawX + 2}" y="${manqueY}" text-anchor="end" font-family="${MONO}" font-size="10" fill="#EF4444">${isFr ? 'manque' : 'short'} ${ftToM(Math.abs(r.margin))} m</text>`);
        }
    }

    // ---- Avions ----
    p.push(planeGrounded(15 * s, groundedY, s));
    p.push(planeAirborne(airX, airY, s, L.col, L.climbAngle));

    // ---- Étiquettes (10 px, comme la barre ; « 0 » et longueur
    // viennent de la barre elle-même, juste dessous) ----
    p.push(`<text x="${L.labelLiftX}" y="${RWY_Y + 20}" text-anchor="middle" font-family="${MONO}" font-size="10" fill="${muted}">${ftToM(Math.min(r.groundRoll, r.fiftyFt))} m</text>`);
    if (inFrame) {
        p.push(`<text x="${L.fiftyLblX}" y="${L.fiftyLblY}" text-anchor="${L.fiftyLblAnchor}" font-family="${MONO}" font-size="10" fill="${L.col}">50 ft · ${ftToM(r.fiftyFt)} m</text>`);
    }
    if (!known) {
        p.push(`<text x="${L.xR - 1}" y="${RWY_Y + 20}" text-anchor="end" font-family="'DM Sans',sans-serif" font-size="10" font-style="italic" fill="${muted}">${isFr ? 'longueur piste ?' : 'runway length ?'}</text>`);
    }

    return `<svg viewBox="0 0 ${L.W} ${H}" role="img" aria-label="${aria}" style="width:100%; height:auto; display:block;">${p.join('')}</svg>`;
}

/**
 * Monte le schéma dans un hôte : rendu initial à 340, mesure de la
 * largeur réelle, re-rendu à l'échelle 1:1 (textes à leur taille CSS)
 * et suivi des redimensionnements (panneau qui devient visible,
 * fenêtre retaillée…).
 *
 * @param {HTMLElement} host Conteneur (son innerHtml est remplacé).
 * @param {Object} r Résultat evaluateTakeoffPerformance.
 * @param {boolean} [isFr] Langue des étiquettes.
 */
export function mountTakeoffProfile(host, r, isFr = true) {
    if (host._tpRo) host._tpRo.disconnect();

    const render = (width) => { host.innerHTML = takeoffProfileSvg(r, isFr, width); };
    render(340);

    const fit = () => {
        const w = host.clientWidth;
        // Re-rend seulement si l'écart dépasse 8 px (sinon boucle).
        if (!w || Math.abs(w - host.querySelector('svg')?.viewBox.baseVal.width) <= 8) return;
        render(w);
    };
    fit();

    // Au montage le widget peut être masqué (display:none → clientWidth
    // 0) : le ResizeObserver re-déclenche le fit quand il s'affiche.
    if (typeof ResizeObserver !== 'undefined') {
        host._tpRo = new ResizeObserver(fit);
        host._tpRo.observe(host);
    }
}

/**
 * Avion posé au seuil — icône Lucide tournée de PLANE_TILT pour être
 * parallèle à la piste, ventre sur la ligne (origine = centre icône).
 */
function planeGrounded(x, y, scale) {
    return `<g transform="translate(${x} ${y}) rotate(${PLANE_TILT}) scale(${scale}) translate(-12 -12)"`
        + ` fill="none" stroke="var(--text-color)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.9">`
        + `<path d="${PLANE_ICON_D}"/></g>`;
}

/**
 * Avion en vol au 50 ft — même icône, assiette alignée sur la pente de
 * montée (l'inclinaison native est compensée : rotation ≈ 0 quand la
 * pente vaut PLANE_TILT).
 */
function planeAirborne(x, y, scale, col, angle) {
    const r = (PLANE_TILT - angle).toFixed(1);
    return `<g transform="translate(${x} ${y}) rotate(${r}) scale(${scale}) translate(-12 -12)"`
        + ` fill="none" stroke="${col}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">`
        + `<path d="${PLANE_ICON_D}"/></g>`;
}
