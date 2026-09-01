// Log de nav VFR — génération PDF A5, reproduction du modèle « Log de nav A5 v2 ».
//
// Ce module est VOLONTAIREMENT SANS IMPORT : drawNavLogPdf() est une fonction
// pure (constructeur jsPDF + données normalisées), testable sous Node sans DOM.
// La collecte des données applicatives (plan de vol, flotte, METAR, piste)
// est faite par l'appelant (flight-planner-ui.js).
//
// Typographie harmonisée : corps 9 pt partout (libellés, valeurs, transpondeur,
// fréquences, cellules, légende), titres de sections 10 pt, titre du document
// 11 pt. Seuls les en-têtes du tableau restent à 8 pt (libellés denses) et le
// METAR en courier 7,5 pt (code).
//
// Structure (coordonnées en points, relevées sur le modèle puis ajustées) :
//   - bandeau titre noir « VFR Flight Log »
//   - bande sections « Pilote / Détail vol » + « Avion » + « Paramètres »
//   - bloc gauche : pilote, heures, horomètres, distance, temps de vol
//     (valeurs collées après le libellé : « Distance : 142 NM »)
//   - bloc transpondeur vert (7500/7600/7700/7000) + fréquences (121.5 rouge)
//   - Notes : 1re ligne = METAR de départ en code, puis lignes vierges
//   - tableau de nav (RM/CM élargie, HEA/HRA égalisées) :
//     FROM/TO · Dist restante · Distance · Z sécu · Z retenue · RM/CM · Tsv/Tav · HEA · HRA
//   - 3 cadres Check (Croisière / Point Tournant / Vent Arrière) + légende
//     6 mnémoniques par colonne, séparées par des filets verticaux
//
// Page 2 — « Calcul de navigation » : reproduction compacte du bloc écran du
// planificateur (flight-planner-ui.js, _renderResult), sans le bouton
// « Log de nav PDF » : ligne Départ → Destination, paramètres saisis, puis
// lignes denses de cellules (Distance/Caps/Déclinaison, Vent à l'altitude de
// croisière + dérive + GS + temps de vol, Carburant, Relief — titres de
// section repliés dans les libellés), tableau des waypoints et note de bas
// de page. La compaction verticale laisse au tableau la place d'afficher
// 8 à 10 tronçons. Les couleurs claires du thème sombre sont assombries
// d'un cran pour rester lisibles sur papier blanc.
//
// Page 3 — « Performances et terrain » :
//   - performances de décollage du terrain de DÉPART (METAR frais capturé à
//     la génération) : cellules Roulement / 50 ft / densité-altitude / réf.
//     avion, revêtement, longueur de piste et marge, + barre visuelle
//     roulement vs piste disponible (reproduction du widget écran),
//   - profil d'élévation de la route redessiné (même langage visuel que le
//     canvas elevation-chart.js : aire orangée, ligne de croisière bleue
//     pointillée, waypoints ambre),
//   - tableau des alternates viables à ± 50 NM de la route (catégorie de vol,
//     visi, plafond, vent, écart gauche/droite).
//
// Chaque page porte en pied, SOUS le cadre extérieur (bande de marge), un
// court avertissement d'utilisation.

const PAGE = { w: 419.53, h: 595.32 };

const INK = [17, 24, 39];        // #111827
const MUTED = [107, 114, 128];   // #6B7280
const LINE = [156, 163, 175];    // #9CA3AF
const DARK = [55, 65, 81];       // #374151 (bandes)
const BANDL = [229, 231, 235];   // #E5E7EB (en-tête tableau)
const GREEN_BG = [232, 245, 233];
const GREEN_INK = [27, 94, 32];
const GREEN_BD = [102, 187, 106];
const RED = [220, 38, 38];

// Palette page 2 : équivalents « impression » des couleurs du thème écran.
const BLUE = [2, 132, 199];       // --primary #38BDF8 → sky-600 (valeurs, freq, totaux)
const TEAL = [13, 148, 136];      // --secondary #2DD4BF → teal-600 (temps de vol)
const AMBER = [180, 83, 9];       // #F59E0B → amber-700 (dérive forte, marge réduite)
const GREEN = [5, 150, 105];      // #10B981 → emerald-600 (marge ok)
const REDTX = [185, 28, 28];      // #EF4444 → red-700 (marge dangereuse)
const CELL_BG = [243, 244, 246];  // fond fp-cell (#F3F4F6)

// Palette page 3 : profil de relief + alternates (écran → papier).
const ORANGE_BG = [254, 234, 215];   // aire sous la courbe (#FB923C 35 % → orange-100)
const ORANGE = [234, 88, 12];        // ligne de terrain (#FB923C → orange-600)
const AMBER_LN = [245, 158, 11];     // marqueurs waypoints (#FBBF24 → amber-500)
const PLOT_BG = [248, 250, 252];     // fond du graphique
const SIV_MAP_LN = [56, 189, 248];   // limites des zones sur le profil — bleu IDENTIQUE à la carte (#38BDF8)
const SIV_TX = [10, 80, 140];        // étiquettes des zones
const CAT_PRINT = {                  // CAT_COLORS écran → équivalents papier
    VFR: [5, 150, 105], MVFR: [2, 132, 199], IFR: [185, 28, 28], LIFR: [146, 22, 138],
};
// Tailles de police harmonisées.
const SZ = { body: 9, title: 10, doc: 11, thead: 8 };

// Colonnes du tableau de nav : en-têtes « Dist restante » et « Z retenue » sur
// deux lignes → colonnes compactes, FROM/TO élargie. RM/CM large, HEA = HRA.
const COLS = [17.8, 114, 146, 184, 214, 248, 290, 327.7, 365.2, 402.7];
const ROW_H = 22;
const N_ROWS = 9;   // lignes du tableau (remplies puis vierges à compléter en vol)

function _setInk(doc, rgb) { doc.setTextColor(rgb[0], rgb[1], rgb[2]); }

// Découpe un texte long (METAR) pour tenir dans une largeur donnée.
function _wrap(doc, text, maxW) {
    const words = String(text || '').split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
        const t = cur ? cur + ' ' + w : w;
        if (doc.getTextWidth(t) > maxW && cur) { lines.push(cur); cur = w; }
        else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
}

// Coupe un texte (nom d'aérodrome, waypoints) à la largeur disponible.
function _trunc(doc, text, maxW) {
    let t = String(text ?? '');
    if (doc.getTextWidth(t) <= maxW) return t;
    while (t.length > 1 && doc.getTextWidth(t + '…') > maxW) t = t.slice(0, -1);
    return t + '…';
}

// Avertissement d'utilisation, identique sur les 3 pages : une seule ligne
// 6 pt centrée dans la bande de marge sous le cadre extérieur.
function _footer(doc, isFr) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6); _setInk(doc, MUTED);
    doc.text(isFr
        ? 'Document généré automatiquement — aide à la préparation. Vérifiez chaque valeur avant le vol (météo, POH, VAC, NOTAM).'
        : 'Automatically generated preparation aid — verify every value before flight (weather, POH, charts, NOTAM).',
        PAGE.w / 2, 590.2, { align: 'center' });
}

// ---------------------------------------------------------------------------
// Helpers partagés pages 2 et 3 (reproduction des styles écran .fp-cell /
// .fp-section) — prennent doc en 1er paramètre (module sans état).
// ---------------------------------------------------------------------------

// Cellule .fp-cell : fond gris clair arrondi, libellé majuscule grisé,
// valeur en gras (couleur/taille pilotables — surbrillances écran).
function _cell(doc, x, yc, w, h, label, value, opt = {}) {
    doc.setFillColor(...CELL_BG); doc.setDrawColor(...LINE); doc.setLineWidth(0.5);
    doc.roundedRect(x, yc, w, h, 2.5, 2.5, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); _setInk(doc, MUTED);
    doc.text(String(label).toUpperCase(), x + 7, yc + 9, { charSpace: 0.5 });
    doc.setFont('courier', 'bold'); doc.setFontSize(opt.size || 10.5);
    _setInk(doc, opt.color || INK);
    doc.text(_trunc(doc, value ?? '—', w - 14), x + 7, yc + h - 7);
}

// Section .fp-section : filet supérieur + titre majuscule grisé éventuel.
// Retourne l'ordonnée de départ du contenu.
function _section(doc, L, R, title, ys) {
    doc.setDrawColor(...LINE); doc.setLineWidth(0.5);
    doc.line(L, ys, R, ys);
    if (title) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); _setInk(doc, MUTED);
        doc.text(String(title).toUpperCase(), L + 1.5, ys + 11, { charSpace: 0.6 });
        return ys + 16;
    }
    return ys + 6;
}

// Bandeau d'alerte (marge réduite / décollage critique) — même style que le
// bandeau « relief » de la page 2. Retourne l'ordonnée après le bandeau.
function _alertBanner(doc, L, R, W, y, danger, text) {
    const lines = _wrap(doc, text, W - 14);
    const h = Math.max(15, lines.length * 9 + 7);
    doc.setFillColor(...(danger ? [254, 226, 226] : [254, 243, 199]));
    doc.setDrawColor(...(danger ? [248, 113, 113] : [245, 158, 11]));
    doc.setLineWidth(0.5);
    doc.roundedRect(L, y, W, h, 2.5, 2.5, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
    _setInk(doc, danger ? REDTX : AMBER);
    lines.forEach((l, i) => doc.text(l, L + 7, y + 10 + i * 9));
    return y + h + 8;
}

/**
 * Dessine le log de nav et retourne le document jsPDF (non sauvegardé).
 * @param {Function} jsPDFCtor constructeur jsPDF (window.jspdf.jsPDF)
 * @param {Object} d  données normalisées :
 *   aircraftType, aircraftReg, qnh, windDir, windKt, runway,
 *   distanceNm, timeLabel, metarRaw,
 *   rows[] { from, to, distRemain, dist, zSecu, zRet, rm, cm, tsv, tav },
 *   calc (optionnel) → ajoute une 2e page « Calcul de navigation » :
 *   { isFr, fromIcao, fromName, toIcao, toName, waypoints, cruiseAltFt,
 *     tasKt, fuelBurnLph, isNight, distanceNm, distanceKm, trueCourse,
 *     magHeading, declination, wind {dir,speedKt}|null, driftDeg,
 *     groundSpeed, timeLabel, fuel {tripL,reserveL,totalL,reserveMin},
 *     clearance {maxFt,minClearanceFt,level}|null, isMultiLeg,
 *     legs[] {from,to,dist,hdg,eteLabel,fuelL,freq} },
 *   perf (optionnel) → ajoute une 3e page « Performances et terrain » :
 *   { isFr, fromIcao, toIcao, runway,
 *     takeoff { da, groundRollM, fiftyFtM, runwayLengthM, marginM, level,
 *               message, refLabel, surfaceLabel, surfaceSoft, surfacePct } | null,
 *     profile { fromIcao, toIcao, distTotalKm, minFt, maxFt, cruiseAltFt,
 *               points[{frac,elevFt}], waypoints[{icao,frac}] } | null,
 *     alternates { maxOffsetNm, rows[{code,name,cat,visiStr,ceilStr,
 *                 windStr,offsetNm,side}] } | null },
 *   centro (optionnel) → ajoute une 4e page « Centrage » (avion actif
 *   configuré dans la flotte) : { isFr, fromIcao, reg, type,
 *     wb { units{mass,arm}, emptyMassKg, emptyArmMm, mtowKg, fuelDensity,
 *          envelope[[massKg,armMm]], ... },
 *     calc { rows[{name,armMm,massKg,fuel,empty}], zfw/takeoff/arrival
 *            {massKg,cgMm}, fuelKg, burnKg, points{...}, mtowOk, level },
 *     fuelL, burnL }
 *   Les valeurs sont reçues en kg/mm (brutes de wb-core.js) et converties
 *   localement dans les unités d'affichage de l'avion.
 */
export function drawNavLogPdf(jsPDFCtor, d) {
    const doc = new jsPDFCtor({ unit: 'pt', format: [PAGE.w, PAGE.h], orientation: 'portrait' });
    doc.setFont('helvetica', 'normal');
    // Page 1 bilingue : la langue vient du niveau document (les pages 2/3 ont
    // la leur dans d.calc/d.perf, historiquement).
    const fr = d.isFr !== false;

    // Champ « Libellé : valeur » — la valeur (gras) est collée au libellé avec
    // une espace : « Distance : 142 NM ». Retourne l'abscisse de fin de valeur.
    const _field = (label, value, x, y) => {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(SZ.body); _setInk(doc, INK);
        doc.text(label, x, y);
        const vx = x + doc.getTextWidth(label) + 3;
        if (value != null && value !== '') {
            doc.setFont('helvetica', 'bold');
            doc.text(String(value), vx, y);
        }
        return vx;
    };
    // Trait de saisie manuelle (sous un champ laissé vide).
    const _rule = (x1, x2, y) => { doc.setDrawColor(...LINE); doc.setLineWidth(0.4); doc.line(x1, y + 1.2, x2, y + 1.2); };

    // ---- Bandeau titre ----
    doc.setFillColor(17, 24, 39);
    doc.rect(16.4, 14.3, 386.3, 16.2, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(SZ.doc); _setInk(doc, [255, 255, 255]);
    doc.text('VFR Flight Log', PAGE.w / 2, 25.2, { align: 'center' });

    // ---- Cadre extérieur + bande sections ----
    doc.setDrawColor(...INK); doc.setLineWidth(0.8);
    doc.rect(15, 29.9, 388.6, 551.9, 'S');
    doc.setFillColor(...DARK);
    doc.rect(16.4, 35.4, 386.3, 14.3, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(SZ.title); _setInk(doc, [255, 255, 255]);
    doc.text(fr ? 'Pilote / Détail vol' : 'Pilot / Flight details', 46.1, 45.4);
    // « Avion » et « Paramètres » centrés sur les colonnes du dessous
    // (transpondeur 175-290, fréquences 290-403), elles-mêmes rétrécies pour
    // laisser la largeur au bloc « Pilote / Détail vol » (17,8 → 175).
    doc.text(fr ? 'Avion' : 'Aircraft', 242.5, 45.4, { align: 'center' });
    doc.text(fr ? 'Paramètres' : 'Parameters', 346.3, 45.4, { align: 'center' });

    // ---- Bloc gauche : libellés + valeurs collées / zones à remplir ----
    // Structure : Pilote 17,8→195 (large), Avion = transpondeur (195→290),
    // Paramètres = fréquences (290→403). Bordures verticales prolongées jusqu'aux
    // blocs du dessous. Toujours 6 pt d'espace entre un cadre et son texte.
    const PAD = 6;
    doc.setDrawColor(...LINE); doc.setLineWidth(0.4);
    doc.line(195, 49.7, 195, 92);
    doc.line(290, 49.7, 290, 92);

    const ROWS_Y = [50.9, 65.1, 79.2, 93.4, 107.5, 121.7, 135.9];
    // Baseline centrée verticalement dans sa ligne (ligne ~14,2 pt, capitale ~6,5 pt).
    const B = i => ROWS_Y[i] + 10.4;

    // Colonne 1 (Pilote / détail vol) — champs inconnus : trait à remplir à la main.
    let vx = _field(fr ? 'Pilote :' : 'Pilot:', '', 17.8, B(0)); _rule(vx + 2, 188, B(0));
    vx = _field(fr ? 'Hr Départ :' : 'Dep time:', '', 17.8, B(1)); _rule(vx + 2, 188, B(1));
    vx = _field(fr ? 'Hr Arrivée :' : 'Arr time:', '', 17.8, B(2)); _rule(vx + 2, 188, B(2));
    vx = _field(fr ? 'Horomètre Départ :' : 'Hobbs start:', '', 17.8, B(3)); _rule(vx + 2, 188, B(3));
    vx = _field(fr ? 'Horamètre Arrivée :' : 'Hobbs end:', '', 17.8, B(4)); _rule(vx + 2, 188, B(4));
    _field(fr ? 'Distance :' : 'Distance:', `${d.distanceNm ?? ''} NM`, 17.8, B(5));
    _field(fr ? 'Temps de vol :' : 'Flight time:', d.timeLabel ?? '', 17.8, B(6));

    // Colonne 2 (Avion) — alignée sur le bloc transpondeur (x=195), texte à PAD du cadre.
    _field(fr ? 'Type :' : 'Type:', d.aircraftType || '', 195 + PAD, B(0));
    _field(fr ? 'Immat :' : 'Reg:', d.aircraftReg || '', 195 + PAD, B(1));
    vx = _field('C/sign:', '', 195 + PAD, B(2)); _rule(vx + 2, 290 - PAD, B(2));

    // Colonne 3 (Paramètres) — alignée sur le bloc fréquences (x=290).
    _field('QNH:', d.qnh || '', 290 + PAD, B(0));
    _field(fr ? 'Vent :' : 'Wind:', d.windDir != null ? `${d.windDir}/${String(d.windKt ?? '').padStart(2, '0')} Kt` : '', 290 + PAD, B(1));
    _field(fr ? 'Piste en service :' : 'Runway:', d.runway || '', 290 + PAD, B(2));

    // ---- Bloc transpondeur (fond vert, x=195 aligné sur la colonne Avion) ----
    // Texte aligné à GAUCHE avec marge : « 7500 : Détournement ».
    doc.setFillColor(...GREEN_BG); doc.setDrawColor(...GREEN_BD); doc.setLineWidth(0.6);
    doc.rect(195, 92, 95, 56.8, 'FD');
    const TSP = fr
        ? [['7500', 'Détournement'], ['7600', 'Panne radio'], ['7700', 'Détresse'], ['7000', 'VFR']]
        : [['7500', 'Diversion'], ['7600', 'Radio failure'], ['7700', 'Emergency'], ['7000', 'VFR']];
    TSP.forEach(([code, lab], i) => {
        const y = [93.4, 107.5, 121.2, 135.4][i] + 10.2;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(SZ.body); _setInk(doc, INK);
        doc.text(code, 195 + PAD, y);
        const w = doc.getTextWidth(code);
        doc.setFont('helvetica', 'normal'); _setInk(doc, GREEN_INK);
        doc.text(` : ${lab}`, 195 + PAD + w, y);
    });

    // ---- Bloc fréquences (121.500 en rouge, x=290 aligné sur Paramètres) ----
    doc.setDrawColor(...LINE); doc.setLineWidth(0.5);
    doc.rect(290, 92, 112.7, 56.8, 'S');
    const FRQ = fr
        ? [
            ['123.500', 'Aérodrome', false],
            ['130.000', 'Fréq. montagne', false],
            ['123.450', 'Comm/aéronefs', false],
            ['121.500', 'Fréq. détresse', true],
        ]
        : [
            ['123.500', 'Airfield', false],
            ['130.000', 'Mountain', false],
            ['123.450', 'Air-to-air', false],
            ['121.500', 'Distress', true],
        ];
    FRQ.forEach(([f, lab, isRed], i) => {
        const y = [93.4, 108.2, 122.4, 136.5][i] + 10.2;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(SZ.body);
        _setInk(doc, isRed ? RED : INK);
        doc.text(f, 290 + PAD, y);
        doc.setFont('helvetica', 'normal');
        _setInk(doc, isRed ? RED : MUTED);
        doc.text(lab, 334, y);
    });

    // ---- Notes : METAR de départ en 1re ligne, puis lignes vierges ----
    doc.setFont('helvetica', 'bold'); doc.setFontSize(SZ.title); _setInk(doc, INK);
    doc.text(fr ? 'Notes :' : 'Notes:', 18.2, 175.4);
    doc.setFont('courier', 'normal'); doc.setFontSize(7.5); _setInk(doc, INK);
    const noteLines = d.metarRaw ? _wrap(doc, d.metarRaw, 380) : [];
    noteLines.slice(0, 2).forEach((l, i) => doc.text(l, 17.9, 184.5 + i * 13));
    if (noteLines.length > 2) doc.text('…', 380, 210.5);
    doc.setDrawColor(...LINE); doc.setLineWidth(0.4);
    for (let i = 0; i < 6; i++) doc.line(17.9, 188 + i * 13, 402.7, 188 + i * 13);

    // ---- Tableau de nav ----
    const T_TOP = 256, T_HEAD_H = 27;
    // En-têtes bilingues : HEA/HRA → ETA/ATA, Z sécu → MSA (abréviations OACI).
    const headers = fr
        ? [['FROM/TO'], ['Dist', 'restante'], ['Distance'], ['Z sécu'], ['Z', 'retenue'], ['RM/CM'], ['Tsv/Tav'], ['HEA'], ['HRA']]
        : [['FROM/TO'], ['Dist', 'rem.'], ['Distance'], ['MSA'], ['Alt', 'sel'], ['RM/CM'], ['ETE', 'c/w'], ['ETA'], ['ATA']];
    doc.setFillColor(...BANDL);
    doc.rect(COLS[0], T_TOP, COLS[COLS.length - 1] - COLS[0], T_HEAD_H, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(SZ.thead); _setInk(doc, INK);
    headers.forEach((lines, i) => {
        const cx = (COLS[i] + COLS[i + 1]) / 2;
        if (lines.length === 2) {
            // En-tête sur deux lignes, bloc centré verticalement dans la bande.
            doc.text(lines[0], cx, T_TOP + 12.5, { align: 'center' });
            doc.text(lines[1], cx, T_TOP + 21.5, { align: 'center' });
        } else {
            doc.text(lines[0], cx, T_TOP + 17, { align: 'center' });
        }
    });
    // Lignes de données puis lignes vierges.
    const nData = Math.min((d.rows || []).length, N_ROWS);
    for (let r = 0; r < N_ROWS; r++) {
        const yTop = T_TOP + T_HEAD_H + r * ROW_H;
        const base = yTop + 14.5;
        if (r < nData) {
            const row = d.rows[r];
            doc.setFont('helvetica', 'bold'); doc.setFontSize(SZ.body); _setInk(doc, INK);
            doc.text(`${row.from}-${row.to}`, (COLS[0] + COLS[1]) / 2, base, { align: 'center' });
            doc.setFont('helvetica', 'normal');
            const cells = [row.distRemain, row.dist, row.zSecu, row.zRet, `${row.rm}/${row.cm}`, '', '', ''];
            cells.forEach((v, i) => {
                if (v !== '' && v != null) doc.text(String(v), (COLS[i + 1] + COLS[i + 2]) / 2, base, { align: 'center' });
            });
            // Tsv/Tav : « 21/19 » — le temps AVEC vent (Tav) est en gras.
            if (row.tsv !== '' && row.tav !== '') {
                const cx = (COLS[6] + COLS[7]) / 2;
                const sep = `${row.tsv}/`;
                doc.setFont('helvetica', 'normal');
                const w1 = doc.getTextWidth(sep);
                doc.setFont('helvetica', 'bold');
                const w2 = doc.getTextWidth(String(row.tav));
                const x0 = cx - (w1 + w2) / 2;
                doc.setFont('helvetica', 'normal'); _setInk(doc, INK);
                doc.text(sep, x0, base);
                doc.setFont('helvetica', 'bold');
                doc.text(String(row.tav), x0 + w1, base);
            }
        }
        doc.setDrawColor(...LINE); doc.setLineWidth(0.4);
        doc.line(COLS[0], yTop + ROW_H, COLS[COLS.length - 1], yTop + ROW_H);
    }
    // Grille verticale + contour.
    doc.setDrawColor(...LINE); doc.setLineWidth(0.4);
    for (let i = 1; i < COLS.length - 1; i++) doc.line(COLS[i], T_TOP, COLS[i], T_TOP + T_HEAD_H + N_ROWS * ROW_H);
    doc.setDrawColor(...INK); doc.setLineWidth(0.6);
    doc.rect(COLS[0], T_TOP, COLS[COLS.length - 1] - COLS[0], T_HEAD_H + N_ROWS * ROW_H, 'S');

    // ---- Cadres Check + légende : GRILLE COMMUNE de 3 colonnes de même
    // largeur (gouttière 5 pt) — bandes titres et colonnes mnémoniques
    // (PAGER / TRAMER / DRAGER) alignées verticalement. ----
    const GUT = 5;
    const COL_W = (386.3 - 2 * GUT) / 3;
    const colX = (k) => 16.4 + k * (COL_W + GUT);
    const CHECKS = fr
        ? ['Check Croisière', 'Check Point Tournant', 'Check Vent Arrière']
        : ['Cruise check', 'Turning point check', 'Downwind check'];
    CHECKS.forEach((lab, k) => {
        doc.setFillColor(...DARK);
        doc.rect(colX(k), 486.7, COL_W, 12.1, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(SZ.title); _setInk(doc, [255, 255, 255]);
        doc.text(lab, colX(k) + COL_W / 2, 496.2, { align: 'center' });
    });

    // ---- Légende des mnémoniques (6 lettres par colonne, filets séparateurs
    // placés au milieu des gouttières de la grille) ----
    doc.setDrawColor(...LINE); doc.setLineWidth(0.5);
    doc.rect(16.4, 503.8, 386.3, 77.1, 'S');
    for (let k = 1; k <= 2; k++) doc.line(colX(k) - GUT / 2, 503.8, colX(k) - GUT / 2, 580.9);
    const LEGEND = fr
        ? [
            [['P', 'Paramètres'], ['I', 'Instruments'], ['A', 'Altitude'], ['G', 'Gyro / Cap'], ['E', 'Essence'], ['R', 'Radio/Radio Nav']],
            [['T', 'Top / Estimé Point Suiv.'], ['R', 'Route / Cap'], ['A', 'Altitude'], ['M', 'Moteur / Météo'], ['E', 'Essence'], ['R', 'Radio/Radio Nav']],
            [['D', 'Dégivrage'], ['R', 'Richesse'], ['A', 'Altitude'], ['G', 'Gyro / Cap'], ['E', 'Essence'], ['R', 'Radio/Radio Nav']],
        ]
        : [
            [['P', 'Parameters'], ['I', 'Instruments'], ['A', 'Altitude'], ['G', 'Gyro / Hdg'], ['E', 'Fuel'], ['R', 'Radio/Nav']],
            [['T', 'ETA next WPT'], ['R', 'Route / Hdg'], ['A', 'Altitude'], ['M', 'Engine / Wx'], ['E', 'Fuel'], ['R', 'Radio/Nav']],
            [['D', 'De-ice'], ['R', 'Mixture'], ['A', 'Altitude'], ['G', 'Gyro / Hdg'], ['E', 'Fuel'], ['R', 'Radio/Nav']],
        ];
    const LEG_X = [0, 1, 2].map(k => colX(k) + 4);
    LEGEND.forEach((col, c) => {
        col.forEach(([letter, meaning], r) => {
            const y = 512.3 + r * 11.5;
            doc.setFont('helvetica', 'bold'); doc.setFontSize(SZ.body); _setInk(doc, INK);
            doc.text(letter, LEG_X[c], y);
            doc.setFont('helvetica', 'normal');
            doc.text(`: ${meaning}`, LEG_X[c] + 8, y);
        });
    });

    _footer(doc, !(d.calc?.isFr === false || d.perf?.isFr === false));

    // ---- Page 2 : « Calcul de navigation » (bloc écran du planificateur) ----
    if (d.calc) _drawCalcPage(doc, d.calc);

    // ---- Page 3 : « Performances et terrain » ----
    if (d.perf) _drawPerfPage(doc, d.perf);

    // ---- Page 4 : « Centrage » (avion actif configuré dans la flotte) ----
    if (d.centro) _drawCentroPage(doc, d.centro);

    return doc;
}

// ---------------------------------------------------------------------------
// Page 2 — « Calcul de navigation » : reproduction du bloc écran du
// planificateur (flight-planner-ui.js, _renderResult), SANS le bouton
// « Log de nav PDF ». Mêmes bandeau/cadre que la page 1 pour former une
// paire cohérente ; cellules gris clair façon .fp-cell, valeurs en gras
// (courier ≈ DM Mono à l'écran), sections séparées par un filet comme les
// .fp-section (border-top).
// ---------------------------------------------------------------------------
function _drawCalcPage(doc, c) {
    const fr = c.isFr !== false;
    doc.addPage([PAGE.w, PAGE.h], 'portrait');
    doc.setFont('helvetica', 'normal');

    const L = 16.4, R = 402.7, W = R - L, MID = (L + R) / 2;
    const FRAME_BOT = 581.8;                    // bas du cadre extérieur
    const pad3 = (v) => String(v ?? '').padStart(3, '0');
    const cell = (x, yc, w, h, label, value, opt) => _cell(doc, x, yc, w, h, label, value, opt);
    const section = (title, ys) => _section(doc, L, R, title, ys);

    // ---- Bandeau titre + cadre extérieur (identiques à la page 1) ----
    doc.setFillColor(17, 24, 39);
    doc.rect(16.4, 14.3, 386.3, 16.2, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(SZ.doc); _setInk(doc, [255, 255, 255]);
    doc.text(fr ? 'Calcul de navigation' : 'Flight plan', MID, 25.2, { align: 'center' });
    doc.setDrawColor(...INK); doc.setLineWidth(0.8);
    doc.rect(15, 29.9, 388.6, 551.9, 'S');

    // ---- Ligne mono « LFPB → LFRM » (en-tête du bloc écran) ----
    doc.setFont('courier', 'normal'); doc.setFontSize(8); _setInk(doc, MUTED);
    doc.text(`${c.fromIcao} → ${c.toIcao}`.replace('→', '-'), L + 1.5, 45);

    // ---- Ligne Départ → Destination (libellés + noms complets + flèche) ----
    const RIGHT_X = MID + 12, HALF_W = 180;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); _setInk(doc, MUTED);
    doc.text(fr ? 'DÉPART' : 'FROM', L + 1.5, 57, { charSpace: 0.6 });
    doc.text(fr ? 'DESTINATION' : 'TO', RIGHT_X, 57, { charSpace: 0.6 });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); _setInk(doc, INK);
    doc.text(_trunc(doc, `${c.fromIcao} · ${c.fromName}`, HALF_W), L + 1.5, 69);
    doc.text(_trunc(doc, `${c.toIcao} · ${c.toName}`, HALF_W), RIGHT_X, 69);
    // Flèche entre les deux (pas de glyphe → en helvetica standard : tracée).
    doc.setDrawColor(...MUTED); doc.setLineWidth(0.9);
    doc.line(MID - 6, 65.5, MID + 7, 65.5);
    doc.line(MID + 2.5, 61.5, MID + 7, 65.5);
    doc.line(MID + 2.5, 69.5, MID + 7, 65.5);

    // ---- Paramètres saisis (inputs écran, valeurs en bleu « saisie ») ----
    // Mise en page COMPACTE : les cellules résultats sont regroupées en
    // lignes de 4 / 3 / 2 (titres de section repliés dans les libellés) pour
    // laisser au tableau des waypoints la place d'afficher 8 à 10 tronçons.
    let y = 80;
    cell(L, y, W, 29, fr ? 'Waypoints (optionnel)' : 'Waypoints (optional)',
         c.waypoints || '—', { color: c.waypoints ? BLUE : MUTED });
    y += 33;
    const pw = (W - 3 * 7 - 68) / 3;
    cell(L, y, pw, 29, fr ? 'Alt. croisière (ft)' : 'Cruise alt (ft)', c.cruiseAltFt ?? '—', { color: BLUE });
    cell(L + pw + 7, y, pw, 29, fr ? 'Vitesse air (kt)' : 'TAS (kt)', c.tasKt ?? '—', { color: BLUE });
    cell(L + 2 * (pw + 7), y, pw, 29, fr ? 'Conso (L/h)' : 'Burn (L/h)', c.fuelBurnLph ?? '—', { color: BLUE });
    cell(L + 3 * (pw + 7), y, 68, 29, fr ? 'Vol de nuit' : 'Night',
         c.isNight ? (fr ? 'Oui' : 'Yes') : (fr ? 'Non' : 'No'), { color: BLUE });
    y += 35;

    // ---- Ligne résultats : Distance / Cap vrai / Cap magnétique / Déclinaison ----
    const cw4 = (W - 3 * 7) / 4;
    y = section(null, y);
    cell(L, y, cw4, 29, fr ? 'Distance' : 'Distance', `${c.distanceNm ?? '—'} NM`, { size: 9.5 });
    cell(L + cw4 + 7, y, cw4, 29, fr ? 'Cap vrai (TC)' : 'True course', `${pad3(c.trueCourse)}°`);
    cell(L + 2 * (cw4 + 7), y, cw4, 29, fr ? 'Cap magnétique' : 'Magnetic heading',
         `${pad3(c.magHeading)}°`, { color: BLUE, size: 12 });
    cell(L + 3 * (cw4 + 7), y, cw4, 29, fr ? 'Déclinaison' : 'Declination',
         `${(c.declination ?? 0) > 0 ? '+' : ''}${c.declination ?? 0}°`);
    y += 33;

    // ---- Ligne vent / dérive / vitesse sol / temps de vol ----
    y = section(null, y);
    cell(L, y, cw4, 29, fr ? `Vent à ${c.cruiseAltFt ?? ''} ft` : `Wind at ${c.cruiseAltFt ?? ''} ft`,
         c.wind ? `${pad3(c.wind.dir)}° / ${c.wind.speedKt} kt` : '—', { size: 9.5 });
    const dr = c.driftDeg;
    cell(L + cw4 + 7, y, cw4, 29, fr ? 'Dérive' : 'Drift',
         c.wind ? `${(dr ?? 0) > 0 ? '+' : ''}${dr ?? '—'}°` : '—',
         Math.abs(dr ?? 0) >= 10 ? { color: AMBER, size: 9.5 } : { size: 9.5 });
    cell(L + 2 * (cw4 + 7), y, cw4, 29, fr ? 'Vitesse sol (GS)' : 'Ground speed', `${c.groundSpeed ?? '—'} kt`, { size: 9.5 });
    cell(L + 3 * (cw4 + 7), y, cw4, 29, fr ? 'Temps de vol' : 'Flight time',
         c.timeLabel || '—', { color: TEAL, size: 11 });
    y += 33;

    // ---- Ligne carburant : Trajet / Réserve / Total requis ----
    y = section(null, y);
    const fw = (W - 2 * 12) / 3;
    cell(L, y, fw, 29, fr ? 'Trajet' : 'Trip', `${c.fuel?.tripL ?? '—'} L`);
    cell(L + fw + 12, y, fw, 29, `${fr ? 'Réserve' : 'Reserve'} (${c.fuel?.reserveMin ?? ''} min)`, `${c.fuel?.reserveL ?? '—'} L`);
    cell(L + 2 * (fw + 12), y, fw, 29, fr ? 'Total requis' : 'Total req.', `${c.fuel?.totalL ?? '—'} L`, { color: BLUE, size: 12 });
    y += 33;

    // ---- Ligne relief (si disponible) : Altitude max sol / Marge mini ----
    const cl = c.clearance;
    if (cl) {
        const clColor = cl.level === 'danger' ? REDTX : (cl.level === 'caution' ? AMBER : GREEN);
        const cw = (W - 16) / 2;
        y = section(null, y);
        cell(L, y, cw, 29, fr ? 'Altitude max sol' : 'Max terrain', `${cl.maxFt ?? '—'} ft`);
        cell(L + cw + 16, y, cw, 29, fr ? 'Marge mini' : 'Min clearance',
             `${(cl.minClearanceFt ?? 0) >= 0 ? '+' : ''}${cl.minClearanceFt ?? '—'} ft`, { color: clColor });
        y += 33;
        if (cl.level !== 'ok') {
            const danger = cl.level === 'danger';
            y = _alertBanner(doc, L, R, W, y, danger,
                danger
                    ? (fr ? 'Altitude de croisière SOUS le relief — augmentez l\'altitude' : 'Cruise altitude BELOW terrain — climb higher')
                    : (fr ? 'Marge de franchissement réduite (< 1000 ft)' : 'Reduced terrain clearance (< 1000 ft)')) - 2;
        }
    }

    // ---- Tableau Détail des waypoints (multi-waypoints uniquement) ----
    const legs = (c.isMultiLeg && Array.isArray(c.legs)) ? c.legs : [];
    if (legs.length) {
        y = section(`${fr ? 'Détail des waypoints' : 'Leg details'} (${legs.length})`, y);
        // Colonnes compactées à GAUCHE et textes alignés à gauche — même
        // règle que le tableau « Chargement » de la page Centrage : le blanc
        // résiduel va à droite, après la dernière colonne (Fréq).
        const COLR = [L + 95, L + 140, L + 182, L + 230, L + 272];
        const FREQ_W = R - 5 - COLR[4];
        const HEADS = fr ? ['Tronçon', 'Dist', 'Cap', 'ETE', 'Conso', 'Fréq']
                         : ['Leg', 'Dist', 'Hdg', 'ETE', 'Fuel', 'Freq'];
        doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); _setInk(doc, MUTED);
        doc.text(HEADS[0].toUpperCase(), L + 1.5, y + 8, { charSpace: 0.4 });
        for (let i = 1; i < HEADS.length; i++) {
            doc.text(HEADS[i].toUpperCase(), COLR[i - 1], y + 8, { charSpace: 0.4 });
        }
        const headBot = y + 11;
        doc.setDrawColor(...LINE); doc.setLineWidth(0.5);
        doc.line(L, headBot, R, headBot);

        // Hauteur de ligne adaptative : tout faire tenir au-dessus de la note
        // de bas de page (2 lignes + marge). Filets de séparation discrets.
        const FOOT_TOP = FRAME_BOT - 24;
        let rowH = Math.min(13.5, Math.floor((FOOT_TOP - headBot) / (legs.length + 1)));
        if (rowH < 10) rowH = 10;
        const rowLine = (row, idx) => {
            const base = headBot + idx * rowH + rowH - 3.5;
            doc.setFont('courier', 'bold'); doc.setFontSize(8); _setInk(doc, INK);
            doc.text(`${row.from} → ${row.to}`.replace('→', '-'), L + 1.5, base);
            const vals = [`${row.dist} NM`, `${pad3(row.hdg)}°`, row.eteLabel, `${row.fuelL} L`];
            doc.setFont('courier', 'normal');
            vals.forEach((v, i) => doc.text(String(v ?? '—'), COLR[i], base));
            if (row.freq) { _setInk(doc, BLUE); doc.text(_trunc(doc, row.freq, FREQ_W), COLR[4], base); }
        };
        legs.forEach((lg, i) => {
            rowLine(lg, i);
            if (i < legs.length - 1) {
                doc.setDrawColor(...BANDL); doc.setLineWidth(0.3);
                doc.line(L, headBot + (i + 1) * rowH, R, headBot + (i + 1) * rowH);
            }
        });
        // Ligne TOTAL (gras, bleu, filet supérieur — comme tr.total à l'écran).
        const totBase = headBot + (legs.length + 1) * rowH - 3.5;
        doc.setDrawColor(...LINE); doc.setLineWidth(0.6);
        doc.line(L, headBot + legs.length * rowH, R, headBot + legs.length * rowH);
        doc.setFont('courier', 'bold'); doc.setFontSize(8); _setInk(doc, BLUE);
        doc.text(fr ? 'TOTAL' : 'TOTAL', L + 1.5, totBase);
        const tots = [`${c.distanceNm ?? '—'} NM`, '—', c.timeLabel || '—', `${c.fuel?.tripL ?? '—'} L`];
        tots.forEach((v, i) => doc.text(String(v), COLR[i], totBase));
        doc.text('—', COLR[4], totBase);
        y = headBot + (legs.length + 1) * rowH + 10;
    }

    // ---- Note de bas de page (référence POH, comme à l'écran) ----
    // Ancrée en bas du cadre : avec la mise en page compacte, le tableau des
    // waypoints est plus ou moins long mais la note reste au même endroit.
    const note = fr
        ? 'Calculs basés sur le vent Open-Meteo à l\'altitude de croisière et l\'élévation du relief. Le POH de l\'avion reste la référence légale.'
        : 'Computations based on Open-Meteo winds at cruise altitude and terrain elevation. The aircraft POH remains the legal reference.';
    const fy = FRAME_BOT - 24;
    doc.setDrawColor(...MUTED); doc.setLineWidth(0.5);
    doc.circle(L + 3.5, fy + 1, 3.2, 'S');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); _setInk(doc, MUTED);
    doc.text('i', L + 3.5, fy + 3.2, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); _setInk(doc, MUTED);
    _wrap(doc, note, W - 13).slice(0, 2).forEach((l, i) => doc.text(l, L + 11, fy + 2.5 + i * 9));

    _footer(doc, fr);
}

// ---------------------------------------------------------------------------
// Page 3 — « Performances et terrain » : perfs de décollage du départ
// (widget écran takeoff-ui.js), profil d'élévation de la route
// (elevation-chart.js) et alternates à ± 50 NM de la route (alternates.js).
// Mêmes bandeau/cadre/cellules que la page 2 pour former un document cohérent.
// ---------------------------------------------------------------------------
function _drawPerfPage(doc, p) {
    const fr = p.isFr !== false;
    doc.addPage([PAGE.w, PAGE.h], 'portrait');
    doc.setFont('helvetica', 'normal');

    const L = 16.4, R = 402.7, W = R - L, MID = (L + R) / 2;
    const cell = (x, yc, w, h, label, value, opt) => _cell(doc, x, yc, w, h, label, value, opt);
    const section = (title, ys) => _section(doc, L, R, title, ys);

    // ---- Bandeau titre + cadre extérieur (identiques aux pages 1-2) ----
    doc.setFillColor(17, 24, 39);
    doc.rect(16.4, 14.3, 386.3, 16.2, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(SZ.doc); _setInk(doc, [255, 255, 255]);
    doc.text(fr ? 'Performances et terrain' : 'Performance & terrain', MID, 25.2, { align: 'center' });
    doc.setDrawColor(...INK); doc.setLineWidth(0.8);
    doc.rect(15, 29.9, 388.6, 551.9, 'S');

    // ---- Ligne mono « LFPB → LFRM » (même en-tête que la page 2) ----
    doc.setFont('courier', 'normal'); doc.setFontSize(8); _setInk(doc, MUTED);
    doc.text(`${p.fromIcao} → ${p.toIcao}`.replace('→', '-'), L + 1.5, 45);

    let y = 56;

    // ---- Section 1 : performances de décollage (terrain de départ) ----
    const rwyTxt = p.runway ? ` · RWY ${p.runway}` : '';
    y = section(fr ? `Performances de décollage — ${p.fromIcao}${rwyTxt}` : `Takeoff performance — ${p.fromIcao}${rwyTxt}`, y);
    const t = p.takeoff;
    if (t) {
        const lvl = t.level === 'danger' ? 'danger' : (t.level === 'caution' ? 'caution' : 'ok');
        const lvlColor = lvl === 'danger' ? REDTX : (lvl === 'caution' ? AMBER : GREEN);

        const cw4 = (W - 3 * 7) / 4;
        cell(L, y, cw4, 29, fr ? 'Roulement' : 'Ground roll', `${t.groundRollM} m`);
        cell(L + cw4 + 7, y, cw4, 29, fr ? 'Franch. 50 ft' : '50 ft obstacle', `${t.fiftyFtM} m`);
        cell(L + 2 * (cw4 + 7), y, cw4, 29, fr ? 'Densité-alt.' : 'Density alt.', `${t.da} ft`);
        cell(L + 3 * (cw4 + 7), y, cw4, 29, fr ? 'Réf. avion (m)' : 'A/C ref (m)', t.refLabel, { size: 9.5 });
        y += 35;

        const cw3 = (W - 2 * 7) / 3;
        cell(L, y, cw3, 29, fr ? 'Longueur piste' : 'Runway length',
             t.runwayLengthM != null ? `${t.runwayLengthM} m` : '—');
        // État de piste explicite quand la majoration ne s'explique pas par
        // le seul revêtement (piste dure humide/contaminée, herbe mouillée).
        const surfStateMap = fr
            ? { 5: 'humide', 10: 'contaminée', 25: 'humide', 30: 'contaminée' }
            : { 5: 'wet', 10: 'contaminated', 25: 'wet', 30: 'contaminated' };
        const surfState = t.surfacePct && surfStateMap[t.surfacePct] ? ' · ' + surfStateMap[t.surfacePct] : '';
        const surfTxt = t.surfacePct ? `${t.surfaceLabel}${surfState} +${t.surfacePct} %` : (t.surfaceLabel || '—');
        cell(L + cw3 + 7, y, cw3, 29, fr ? 'Revêtement' : 'Surface', surfTxt,
             { color: t.surfaceSoft ? AMBER : INK, size: surfTxt.length > 13 ? 9 : 10.5 });
        cell(L + 2 * (cw3 + 7), y, cw3, 29, fr ? 'Marge (50 ft)' : 'Margin (50 ft)',
             t.marginM != null ? `${t.marginM >= 0 ? '+' : ''}${t.marginM} m` : '—',
             { color: t.marginM != null ? lvlColor : MUTED, size: 12 });
        y += 35;

        // Coupe de la piste (avion au seuil, roulement, montée au 50 ft,
        // marge/manque) — plus visuelle que la barre en plan qu'elle remplace.
        if (t.runwayLengthM != null && t.runwayLengthM > 0) {
            y = _drawTakeoffProfile(doc, t, L, R, y + 2, fr);
        } else {
            y += 4;
        }

        // Bandeau d'alerte si la marge est réduite ou critique.
        if (lvl !== 'ok' && t.marginM != null) {
            y = _alertBanner(doc, L, R, W, y, lvl === 'danger', t.message);
        } else {
            y += 2;
        }
    } else {
        doc.setFont('helvetica', 'italic'); doc.setFontSize(8); _setInk(doc, MUTED);
        doc.text(fr ? 'Performances de décollage indisponibles (METAR de départ inaccessible)'
                    : 'Takeoff performance unavailable (no departure METAR)', L + 1.5, y + 6);
        y += 14;
    }

    // ---- Section 2 : profil d'élévation de la route ----
    // (tiret entre les OACI : le glyphe → n'existe pas en WinAnsi)
    const pr = p.profile;
    y = section(fr ? `Profil d'élévation — ${pr?.fromIcao ?? p.fromIcao} - ${pr?.toIcao ?? p.toIcao}`
                   : `Elevation profile — ${pr?.fromIcao ?? p.fromIcao} - ${pr?.toIcao ?? p.toIcao}`, y);
    if (pr?.points?.length) {
        y = _drawElevationChart(doc, pr, L, R, y, fr);
    } else {
        doc.setFont('helvetica', 'italic'); doc.setFontSize(8); _setInk(doc, MUTED);
        doc.text(fr ? 'Profil d\'élévation indisponible (relief Open-Meteo inaccessible)'
                    : 'Elevation profile unavailable (Open-Meteo terrain unavailable)', L + 1.5, y + 6);
        y += 14;
    }

    // ---- Section 3 : alternates viables le long de la route ----
    const al = p.alternates;
    y = section(fr ? `Alternates le long de la route (± ${al?.maxOffsetNm ?? 50} NM)`
                   : `En-route alternates (± ${al?.maxOffsetNm ?? 50} NM)`, y);
    if (al?.rows?.length) {
        // Colonnes compactées à GAUCHE et textes alignés à gauche — même
        // règle que « Chargement » : le blanc résiduel va à droite, après
        // la dernière colonne (Écart). Le nom du terrain est tronqué sur
        // la place qui reste avant la colonne Cat.
        const CX = { cat: L + 128, visi: L + 172, ceil: L + 216, wind: L + 262, off: L + 345 };
        const HEADS = fr ? ['Terrain', 'Cat.', 'Visi', 'Plafond', 'Vent', 'Écart']
                         : ['Airfield', 'Cat.', 'Vis', 'Ceiling', 'Wind', 'Off rte'];
        doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); _setInk(doc, MUTED);
        doc.text(HEADS[0].toUpperCase(), L + 1.5, y + 8, { charSpace: 0.4 });
        const cols = [CX.cat, CX.visi, CX.ceil, CX.wind, CX.off];
        for (let i = 1; i < HEADS.length; i++) {
            doc.text(HEADS[i].toUpperCase(), cols[i - 1], y + 8, { charSpace: 0.4 });
        }
        const headBot = y + 11;
        doc.setDrawColor(...LINE); doc.setLineWidth(0.5);
        doc.line(L, headBot, R, headBot);

        const ROW_H = 15;
        al.rows.forEach((r, i) => {
            const base = headBot + i * ROW_H + ROW_H - 4;
            // Code OACI gras (« * » si le METAR vient de la station la plus
            // proche, terrain sans émission propre) + nom tronqué en gris,
            // suivi du tag « · METAR LFxx » de substitution (le nom est
            // tronqué en priorité pour que le tag reste entier).
            const code = r.code ? r.code + (r.metarFrom ? '*' : '') : '';
            doc.setFont('courier', 'bold'); doc.setFontSize(8); _setInk(doc, INK);
            doc.text(code, L + 1.5, base);
            const nameX = L + 1.5 + doc.getTextWidth(code) + 5;
            doc.setFont('helvetica', 'normal'); doc.setFontSize(7); _setInk(doc, MUTED);
            const maxW = CX.cat - 6 - nameX;
            const tag = r.metarFrom ? ` · METAR ${r.metarFrom}` : '';
            const nameTxt = tag
                ? _trunc(doc, r.name, Math.max(14, maxW - doc.getTextWidth(tag))) + tag
                : _trunc(doc, r.name, maxW);
            doc.text(nameTxt, nameX, base);
            // Catégorie colorée (palette écran adaptée au papier).
            doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
            _setInk(doc, CAT_PRINT[r.cat] || MUTED);
            doc.text(r.cat, CX.cat, base);
            doc.setFont('courier', 'normal'); doc.setFontSize(7.5); _setInk(doc, INK);
            doc.text(r.visiStr, CX.visi, base);
            doc.text(r.ceilStr, CX.ceil, base);
            doc.text(r.windStr, CX.wind, base);
            doc.setFont('courier', 'bold');
            doc.text(`${r.offsetNm} NM ${r.side}`, CX.off, base);
            if (i < al.rows.length - 1) {
                doc.setDrawColor(...BANDL); doc.setLineWidth(0.3);
                doc.line(L, headBot + (i + 1) * ROW_H, R, headBot + (i + 1) * ROW_H);
            }
        });
        y = headBot + al.rows.length * ROW_H + 4;

        doc.setFont('helvetica', 'italic'); doc.setFontSize(7); _setInk(doc, MUTED);
        const note = fr
            ? `Terrains de dérivation à moins de ${al.maxOffsetNm} NM de la route prévue, triés par catégorie de vol puis écart. METAR capturés à la génération du PDF.`
            : `Diversion fields within ${al.maxOffsetNm} NM of the planned route, sorted by flight category then offset. METARs captured when the PDF was generated.`;
        _wrap(doc, note, W - 4).slice(0, 2).forEach((l, i) => doc.text(l, L + 1.5, y + 7 + i * 8.5));
        y += 12;
    } else {
        doc.setFont('helvetica', 'italic'); doc.setFontSize(8); _setInk(doc, MUTED);
        doc.text(fr ? 'Alternates indisponibles (stations ou METAR inaccessibles)'
                    : 'Alternates unavailable (stations or METARs unavailable)', L + 1.5, y + 6);
        y += 14;
    }

    _footer(doc, fr);
}

// ---------------------------------------------------------------------------
// Coupe de la piste (page 3) — avion au seuil, roulement, montée au 50 ft
// et marge/manque, même langage visuel que le schéma écran du widget
// (takeoff-profile.js) : piste pleine largeur, hauteur du 50 ft
// schématique, montée tronquée au bord en danger. Retourne l'ordonnée Y
// après le schéma.
// ---------------------------------------------------------------------------
// Icône d'avion de profil — tracé « plane-takeoff » de Lucide (Apache-2.0)
// aplatî en polyligne (arcs et cubiques échantillonnés), centré sur
// l'origine, y vers le BAS (repère écran PDF). Le ventre monte
// nativement de 26,4° vers la droite ; PLANE_DROP = étendue sous le
// centre une fois l'icône mise à plat (posée sur la piste).
const PLANE_ICON_PTS = [
    [-5.64, 5.4], [-8, 5], [-10, 1], [-8.9, 0.45], [-8.69, 0.36], [-8.46, 0.29],
    [-8.23, 0.25], [-8, 0.24], [-7.77, 0.25], [-7.54, 0.29], [-7.31, 0.36],
    [-7.1, 0.45], [-6.93, 0.55], [-6.72, 0.64], [-6.49, 0.71], [-6.26, 0.75],
    [-6.03, 0.76], [-5.8, 0.75], [-5.57, 0.71], [-5.34, 0.64], [-5.13, 0.55],
    [-4, 0], [-7, -6], [-6.1, -6.45], [-5.84, -6.55], [-5.58, -6.62],
    [-5.3, -6.65], [-5.03, -6.65], [-4.75, -6.6], [-4.49, -6.52], [-4.24, -6.4],
    [-4.01, -6.25], [0.01, -3.25], [0.24, -3.1], [0.49, -2.98], [0.76, -2.9],
    [1.03, -2.85], [1.31, -2.84], [1.58, -2.87], [1.85, -2.94], [2.11, -3.05],
    [6.3, -5.11], [6.5, -5.2], [6.71, -5.27], [6.93, -5.32], [7.15, -5.36],
    [7.37, -5.37], [7.59, -5.36], [7.81, -5.33], [8.03, -5.28], [9, -5],
    [9.29, -4.88], [9.54, -4.71], [9.75, -4.48], [9.91, -4.21], [10, -3.92],
    [10.02, -3.61], [9.98, -3.3], [9.87, -3.01], [9.49, -2.25], [9.4, -2.08],
    [9.29, -1.92], [9.17, -1.77], [9.05, -1.63], [8.9, -1.5], [8.75, -1.38],
    [8.59, -1.27], [8.42, -1.17], [-4.42, 5.2], [-4.56, 5.26], [-4.71, 5.32],
    [-4.86, 5.36], [-5.02, 5.39], [-5.17, 5.4], [-5.33, 5.41], [-5.48, 5.4],
    [-5.64, 5.38],
];
const PLANE_TILT = 26.4;
const PLANE_DROP = 2.7;
const PLANE_TAIL = 3.55; // point le plus bas (empennage) SOUS la ligne de ventre
const PLANE_LIFT = 4;    // garde ventre ↔ trait (piste ou montée), idem écran

function _planeIcon(doc, cx, cy, scale, rotDeg) {
    const th = (rotDeg * Math.PI) / 180, cos = Math.cos(th), sin = Math.sin(th);
    const p = PLANE_ICON_PTS.map(([x, y]) =>
        [cx + (x * cos - y * sin) * scale, cy + (x * sin + y * cos) * scale]);
    const segs = p.slice(1).map((q, k) => [q[0] - p[k][0], q[1] - p[k][1]]);
    doc.setDrawColor(...INK);
    doc.setLineWidth(1.15 * scale);            // ≈ Lucide : 2/24 de la taille
    doc.setLineJoin('round'); doc.setLineCap('round');
    doc.lines(segs, p[0][0], p[0][1], [1, 1], 'S', true);
}

function _drawTakeoffProfile(doc, t, L, R, yTop, fr) {
    const lvl = t.level === 'danger' ? 'danger' : (t.level === 'caution' ? 'caution' : 'ok');
    const lvlColor = lvl === 'danger' ? REDTX : (lvl === 'caution' ? AMBER : GREEN);
    const W = R - L;
    const yBase = yTop + 44;                    // ligne de piste
    const TOP50 = yTop + 12;                    // hauteur 50 ft (laisse la
                                                // place au « manque » au-
                                                // dessus de l'avion, comme
                                                // à l'écran)
    const pxPerM = W / t.runwayLengthM;
    const rollX = L + t.groundRollM * pxPerM;
    const fiftyDrawX = Math.min(L + t.fiftyFtM * pxPerM, R - 6);   // tronquée au bord en danger

    // Sol hachuré sous la ligne de piste (coupe).
    doc.setDrawColor(...BANDL); doc.setLineWidth(0.4);
    for (let x = L + 3; x < R - 4; x += 7) doc.line(x, yBase + 6, x + 4, yBase + 2);
    doc.setDrawColor(...LINE); doc.setLineWidth(0.7);
    doc.line(L, yBase, R, yBase);

    // Roulement (double trait en couleur du verdict) puis montée au 50 ft.
    doc.setDrawColor(...lvlColor); doc.setLineWidth(2.4);
    doc.line(L, yBase + 1.2, Math.min(rollX, R), yBase + 1.2);
    doc.setLineWidth(1.3);
    doc.line(rollX, yBase, fiftyDrawX, TOP50);
    // Repère du point 50 ft : filet pointillé jusqu'à la piste.
    doc.setDrawColor(...LINE); doc.setLineWidth(0.4);
    doc.setLineDashPattern([2, 2], 0);
    doc.line(fiftyDrawX, TOP50 + 3, fiftyDrawX, yBase);
    doc.setLineDashPattern([], 0);

    // Avions : posé au seuil (icône à plat, ventre flottant de PLANE_LIFT
    // au-dessus du trait — même écart qu'à l'écran), puis en montée au
    // point 50 ft : assiette sur la pente réelle, centre à distance
    // perpendiculaire constante du trait (garde du posé + empennage),
    // décalé pour ne pas mordre le bord droit.
    _planeIcon(doc, L + 16, yBase - 0.35 - (PLANE_DROP + PLANE_LIFT), 1, PLANE_TILT);
    const climbDeg = Math.atan2(yBase - TOP50, Math.max(10, fiftyDrawX - rollX)) * 180 / Math.PI;
    const ax = Math.min(fiftyDrawX - 10, R - 16);
    const thP = climbDeg * Math.PI / 180;
    const ay = TOP50 - ((PLANE_DROP + PLANE_TAIL + PLANE_LIFT) * 0.9
        + (ax - fiftyDrawX) * Math.sin(thP)) / Math.cos(thP);
    _planeIcon(doc, ax, ay, 0.9, PLANE_TILT - climbDeg);

    // Étiquettes : roulement sous la piste à gauche, 50 ft au bout du
    // repère (bascule à gauche SOUS la montée si elle déborderait du
    // cadre, même hauteur relative que l'écran), marge : positive sous
    // la piste, négative AU-DESSUS de l'avion (comme « manque » écran).
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); _setInk(doc, INK);
    doc.text(`${fr ? 'Roulement' : 'Roll'} ${t.groundRollM} m`, L + 1.5, yBase + 14);
    const lbl50 = `${fr ? 'Franch. 50 ft' : '50 ft obstacle'} : ${t.fiftyFtM} m`;
    if (fiftyDrawX + 6 + doc.getTextWidth(lbl50) <= R - 2) {
        doc.text(lbl50, fiftyDrawX + 6, TOP50 + 2.5);
    } else {
        doc.text(lbl50, fiftyDrawX - 5, yBase - 12, { align: 'right' });
    }
    if (t.marginM != null) {
        const marge = `${fr ? 'Marge' : 'Margin'} ${t.marginM >= 0 ? '+' : ''}${t.marginM} m · ${fr ? 'piste' : 'runway'} ${t.runwayLengthM} m`;
        _setInk(doc, t.marginM >= 0 ? lvlColor : REDTX);
        doc.text(marge, R - 2, t.marginM >= 0 ? yBase + 14 : ay - 12 * 0.9, { align: 'right' });
    }

    return yBase + 20;
}

// ---------------------------------------------------------------------------
// Page 4 — « Centrage » : chargement du jour + centrogramme de l'avion actif
// (bloc wb de la flotte). Valeurs reçues en kg/mm (brutes de wb-core.js) et
// converties localement dans les unités d'affichage de l'avion — facteurs
// miroir de wb-core.js, le module restant volontairement sans import.
// ---------------------------------------------------------------------------
const WB_MM_PER_ARM = { mm: 1, m: 1000, ft: 304.8, in: 25.4 };
const WB_LB_PER_KG = 2.2046226218;
const WB_GREEN = [5, 150, 105], WB_AMBER = [180, 83, 9], WB_RED = [185, 28, 28];

function _drawCentroPage(doc, c) {
    const fr = c.isFr !== false;
    doc.addPage([PAGE.w, PAGE.h], 'portrait');
    doc.setFont('helvetica', 'normal');

    const L = 16.4, R = 402.7, W = R - L, MID = (L + R) / 2;
    const FRAME_BOT = 581.8;
    const u = c.wb.units || { mass: 'kg', arm: 'mm' };
    const dec = u.arm === 'm' ? 3 : (u.arm === 'in' ? 2 : (u.arm === 'ft' ? 1 : 0));
    const th = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    const fmtA = (mm) => {
        let s = (mm / WB_MM_PER_ARM[u.arm]).toFixed(dec);
        if (s.endsWith('.0')) s = s.slice(0, -2);
        return s;
    };
    const fmtM = (kg) => th(u.mass === 'lbs' ? kg * WB_LB_PER_KG : kg);

    // ---- Bandeau titre + cadre extérieur (identiques aux pages 1-3) ----
    doc.setFillColor(17, 24, 39);
    doc.rect(16.4, 14.3, 386.3, 16.2, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(SZ.doc); _setInk(doc, [255, 255, 255]);
    doc.text(fr ? 'Centrage' : 'Weight & balance', MID, 25.2, { align: 'center' });
    doc.setDrawColor(...INK); doc.setLineWidth(0.8);
    doc.rect(15, 29.9, 388.6, 551.9, 'S');

    doc.setFont('courier', 'normal'); doc.setFontSize(8); _setInk(doc, MUTED);
    doc.text(`${c.fromIcao} · ${c.reg}${c.type ? ' · ' + c.type : ''}`, L + 1.5, 45);

    // ---- Section 1 : tableau de chargement (décollage) ----
    // Colonnes alignées à GAUCHE et compactées (POSTE, BRAS, MASSE, MOMENT) :
    // l'espace vide reste à droite, après la colonne Moment.
    const rows = c.calc.rows || [];
    let y = _section(doc, L, R, fr ? 'Chargement' : 'Loading', 54);
    const CX = { arm: L + 135, mass: L + 195, mom: L + 255 };
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); _setInk(doc, MUTED);
    doc.text(fr ? 'POSTE' : 'STATION', L + 1.5, y + 8, { charSpace: 0.4 });
    doc.text(`${fr ? 'BRAS' : 'ARM'} (${u.arm.toUpperCase()})`, CX.arm, y + 8, { charSpace: 0.4 });
    doc.text(`${fr ? 'MASSE' : 'WEIGHT'} (${u.mass.toUpperCase()})`, CX.mass, y + 8, { charSpace: 0.4 });
    doc.text(`${fr ? 'MOMENT' : 'MOMENT'} (${u.mass.toUpperCase()}·${u.arm.toUpperCase()})`, CX.mom, y + 8, { charSpace: 0.4 });
    const headBot = y + 11;
    doc.setDrawColor(...LINE); doc.setLineWidth(0.5);
    doc.line(L, headBot, R, headBot);
    const RH = rows.length > 8 ? 10 : 12.6;
    rows.forEach((r, i) => {
        const base = headBot + i * RH + RH - 3;
        const name = r.empty ? (fr ? 'Masse à vide' : 'Empty weight')
            : (r.fuel ? `${r.name} (${c.fuelL} L)` : r.name);
        doc.setFont('helvetica', r.empty ? 'bold' : 'normal'); doc.setFontSize(RH > 10 ? 7.5 : 7);
        _setInk(doc, r.empty ? INK : MUTED);
        doc.text(_trunc(doc, name, 245), L + 1.5, base);
        doc.setFont('courier', r.empty ? 'bold' : 'normal'); _setInk(doc, INK);
        doc.text(fmtA(r.armMm), CX.arm, base);
        doc.text(fmtM(r.massKg), CX.mass, base);
        doc.text(th((u.mass === 'lbs' ? r.massKg * WB_LB_PER_KG : r.massKg) * (r.armMm / WB_MM_PER_ARM[u.arm])),
            CX.mom, base);
        doc.setDrawColor(...BANDL); doc.setLineWidth(0.3);
        doc.line(L, headBot + (i + 1) * RH, R, headBot + (i + 1) * RH);
    });
    const totBase = headBot + rows.length * RH + RH - 3;
    doc.setDrawColor(...LINE); doc.setLineWidth(0.6);
    doc.line(L, headBot + rows.length * RH, R, headBot + rows.length * RH);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); _setInk(doc, INK);
    doc.text(fr ? `TOTAL — CG décollage : ${fmtA(c.calc.takeoff.cgMm)} ${u.arm}`
                : `TOTAL — takeoff CG: ${fmtA(c.calc.takeoff.cgMm)} ${u.arm}`, L + 1.5, totBase);
    doc.setFont('courier', 'bold'); _setInk(doc, BLUE);
    doc.text(fmtM(c.calc.takeoff.massKg), CX.mass, totBase);
    doc.text(th((u.mass === 'lbs' ? c.calc.takeoff.massKg * WB_LB_PER_KG : c.calc.takeoff.massKg)
        * (c.calc.takeoff.cgMm / WB_MM_PER_ARM[u.arm])), CX.mom, totBase);

    // Essence consommée (plan de nav) → point arrivée.
    if (c.fuelL > 0 && c.burnL > 0) {
        doc.setFont('courier', 'normal'); doc.setFontSize(6.5); _setInk(doc, MUTED);
        const bk = u.mass === 'lbs'
            ? th(c.calc.burnKg * WB_LB_PER_KG)
            : (c.calc.burnKg < 100 ? c.calc.burnKg.toFixed(1).replace('.', ',') : th(c.calc.burnKg));
        doc.text(fr ? `Essence consommée estimée (plan de nav) : ${c.burnL} L · ${bk} ${u.mass} — carburant à l'arrivée : ${Math.max(0, c.fuelL - c.burnL)} L`
                    : `Estimated fuel burned (nav plan): ${c.burnL} L · ${bk} ${u.mass} — fuel at landing: ${Math.max(0, c.fuelL - c.burnL)} L`,
            L + 1.5, totBase + 11);
    }
    y = totBase + 18;

    // ---- Section 2 : centrogramme ----
    y = _section(doc, L, R, fr ? 'Centrogramme — enveloppe de centrage' : 'Centrogram — CG envelope', y);
    y = _drawCentroChart(doc, c, L + 62, R - 40, y + 2, 150);

    // ---- Cellules résultats ----
    y = _section(doc, L, R, null, y + 2);
    const cw3 = (W - 2 * 7) / 3;
    _cell(doc, L, y, cw3, 29, fr ? 'CG décollage' : 'Takeoff CG', `${fmtA(c.calc.takeoff.cgMm)} ${u.arm}`,
        { color: WB_GREEN, size: 12 });
    _cell(doc, L + cw3 + 7, y, cw3, 29, fr ? 'CG arrivée' : 'Landing CG', `${fmtA(c.calc.arrival.cgMm)} ${u.arm}`,
        { color: WB_AMBER, size: 12 });
    _cell(doc, L + 2 * (cw3 + 7), y, cw3, 29, fr ? 'CG zéro carburant' : 'Zero fuel CG', `${fmtA(c.calc.zfw.cgMm)} ${u.arm}`,
        { color: WB_RED, size: 12 });
    y += 33;
    const mtow = c.wb.mtowKg > 0 ? c.wb.mtowKg : null;
    _cell(doc, L, y, cw3, 29, fr ? 'Masse décollage' : 'Takeoff weight', `${fmtM(c.calc.takeoff.massKg)} ${u.mass}`);
    _cell(doc, L + cw3 + 7, y, cw3, 29, 'MTOW', mtow ? `${fmtM(mtow)} ${u.mass}` : '—');
    _cell(doc, L + 2 * (cw3 + 7), y, cw3, 29, fr ? 'Enveloppe' : 'Envelope',
        c.calc.level === 'ok' ? (fr ? 'Dans les limites' : 'In limits') : (fr ? 'HORS LIMITES' : 'OUT OF LIMITS'),
        { color: c.calc.level === 'ok' ? WB_GREEN : WB_RED, size: 9.5 });
    y += 37;

    // Légende (pastilles couleur, comme la barre de marge décollage p3).
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); _setInk(doc, MUTED);
    let lx = L + 1;
    const LEG = [
        [WB_GREEN, fr ? 'Décollage' : 'Takeoff'], [WB_AMBER, fr ? 'Arrivée' : 'Landing'],
        [WB_RED, 'ZFW'], [BLUE, fr ? 'Enveloppe' : 'Envelope'],
        [[220, 38, 38], 'MTOW'],
    ];
    for (const [col, lab] of LEG) {
        doc.setFillColor(...col); doc.setDrawColor(...LINE); doc.setLineWidth(0.4);
        doc.circle(lx + 2.5, y - 5, 2.5, 'F');
        doc.text(lab, lx + 9, y - 2.6);
        lx += 11 + doc.getTextWidth(lab) + 9;
    }

    // Note POH ancrée en bas du cadre.
    const fy = FRAME_BOT - 24;
    doc.setDrawColor(...MUTED); doc.setLineWidth(0.5);
    doc.circle(L + 3.5, fy + 1, 3.2, 'S');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); _setInk(doc, MUTED);
    doc.text('i', L + 3.5, fy + 3.2, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); _setInk(doc, MUTED);
    const note = fr
        ? 'Centrogramme établi à partir des données de la flotte (masse à vide, enveloppe, postes) et du chargement saisi. La fiche de pesée et le manuel de vol restent la référence légale.'
        : 'Centrogram built from fleet data (empty weight, envelope, stations) and the entered loading. The weighing sheet and POH remain the legal reference.';
    _wrap(doc, note, W - 13).slice(0, 2).forEach((l, i) => doc.text(l, L + 11, fy + 2.5 + i * 9));

    _footer(doc, fr);
}

// ---------------------------------------------------------------------------
// Centrogramme vectoriel A5 — X = bras (unité de l'avion), Y = masse.
// Échelles automatiques (enveloppe ∪ points ∪ masse à vide ∪ MTOW) comme le
// widget écran wb-core.js. Retourne l'ordonnée Y après le graphique.
// ---------------------------------------------------------------------------
function _drawCentroChart(doc, c, xL, xR, yT, CH) {
    const fr = c.isFr !== false;
    const u = c.wb.units || { mass: 'kg', arm: 'mm' };
    const dec = u.arm === 'm' ? 3 : (u.arm === 'in' ? 2 : (u.arm === 'ft' ? 1 : 0));
    const th = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    const fmtA = (mm) => {
        let s = (mm / WB_MM_PER_ARM[u.arm]).toFixed(dec);
        if (s.endsWith('.0')) s = s.slice(0, -2);
        return s;
    };
    const fmtM = (kg) => th(u.mass === 'lbs' ? kg * WB_LB_PER_KG : kg);

    // Plage : enveloppe ∪ 3 points de vol ∪ MTOW (point « à vide » exclu),
    // avec marge minimale de respiration (5 %) autour des min/max réels.
    const arms = [...c.wb.envelope.map(p => p[1])];
    const masses = [...c.wb.envelope.map(p => p[0])];
    for (const p of [c.calc.takeoff, c.calc.arrival, c.calc.zfw]) {
        if (p.cgMm != null && isFinite(p.cgMm)) arms.push(p.cgMm);
        masses.push(p.massKg);
    }
    if (c.wb.mtowKg > 0) masses.push(c.wb.mtowKg);
    let aMin = Math.min(...arms), aMax = Math.max(...arms);
    let mMin = Math.min(...masses), mMax = Math.max(...masses);
    const padA = (aMax - aMin) * 0.05 || 12, padM = (mMax - mMin) * 0.05 || 12;
    aMin -= padA; aMax += padA; mMin = Math.max(0, mMin - padM); mMax += padM;

    const yB = yT + CH, plotW = xR - xL;
    const xOf = a => xL + ((a - aMin) / (aMax - aMin)) * plotW;
    const yOf = m => yT + (1 - (m - mMin) / (mMax - mMin)) * CH;

    // Fond + grille (5 lignes × 5 colonnes) avec labels convertis.
    doc.setFillColor(...PLOT_BG);
    doc.rect(xL, yT, plotW, CH, 'F');
    doc.setFont('courier', 'normal'); doc.setFontSize(6.5);
    let maxYLabW = 0;   // largeur du plus long label de graduation masse
    for (let i = 0; i <= 4; i++) {
        const gy = yT + (1 - i / 4) * CH;
        doc.setDrawColor(...BANDL); doc.setLineWidth(0.4);
        doc.line(xL, gy, xR, gy);
        _setInk(doc, MUTED);
        const yLab = fmtM(mMin + (mMax - mMin) * i / 4);
        maxYLabW = Math.max(maxYLabW, doc.getTextWidth(yLab));
        doc.text(yLab, xL - 5, gy + 2.2, { align: 'right' });   // comme à l'écran (xL-5)
        const gx = xL + (i / 4) * plotW;
        doc.line(gx, yT, gx, yB);
        doc.text(fmtA(aMin + (aMax - aMin) * i / 4), gx, yB + 8, { align: 'center' });
    }
    doc.setDrawColor(...LINE); doc.setLineWidth(0.5);
    doc.line(xL, yT, xL, yB); doc.line(xL, yB, xR, yB);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); _setInk(doc, MUTED);
    doc.text(`${fr ? 'Bras de levier' : 'Arm'} (${u.arm})`, (xL + xR) / 2, yB + 19, { align: 'center' });
    // Titre de l'axe masse VERTICAL, À GAUCHE des labels de graduations
    // — GÉOMÉTRIE UNIFIÉE AVEC L'ÉCRAN (wbChartSvg) : graduations finissant
    // à xL-5 du graphe, titre à ~10 pt avant leur début, taille 7 pt.
    doc.setFontSize(7);
    doc.text(`${fr ? 'Masse' : 'Weight'} (${u.mass})`, xL - 5 - maxYLabW - 10, (yT + yB) / 2, { align: 'center', angle: 90 });

    // Enveloppe (polygone rempli + trait bleu).
    const pts = c.wb.envelope.map(([m, a]) => [xOf(a), yOf(m)]);
    const segs = pts.slice(1).map((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]]);
    doc.setFillColor(227, 242, 253); doc.setDrawColor(...BLUE); doc.setLineWidth(1.2);
    doc.lines(segs, pts[0][0], pts[0][1], [1, 1], 'FD', true);

    // Ligne MTOW (rouge pointillée).
    if (c.wb.mtowKg > 0 && c.wb.mtowKg >= mMin && c.wb.mtowKg <= mMax) {
        doc.setDrawColor(220, 38, 38); doc.setLineWidth(0.9);
        doc.setLineDashPattern([5, 3], 0);
        doc.line(xL, yOf(c.wb.mtowKg), xR, yOf(c.wb.mtowKg));
        doc.setLineDashPattern([], 0);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); _setInk(doc, [220, 38, 38]);
        doc.text(`MTOW ${fmtM(c.wb.mtowKg)} ${u.mass}`, xR - 3, yOf(c.wb.mtowKg) - 3, { align: 'right' });
    }

    // Points : Décollage (vert) / Arrivée (orange, étiquette à GAUCHE) /
    // ZFW (rouge) — mise en page validée, avec bascule de côté si l'étiquette
    // déborderait du graphe et décalage vertical entre étiquettes d'un même
    // côté (points proches). Le point « à vide » n'est pas tracé.
    const P = [
        { p: c.calc.takeoff, col: WB_GREEN, r: 3.2, lab: `${fr ? 'Décollage' : 'Takeoff'} ${fmtM(c.calc.takeoff.massKg)} ${u.mass}`, side: 'right' },
        { p: c.calc.arrival, col: WB_AMBER, r: 2.8, lab: `${fr ? 'Arrivée' : 'Landing'} ${fmtM(c.calc.arrival.massKg)} ${u.mass}`, side: 'left' },
        { p: c.calc.zfw, col: WB_RED, r: 2.8, lab: `ZFW ${fmtM(c.calc.zfw.massKg)} ${u.mass}`, side: 'right' },
    ].filter(q => q.p.cgMm != null && isFinite(q.p.cgMm));
    for (const q of P) {
        doc.setFillColor(...q.col);
        doc.circle(xOf(q.p.cgMm), yOf(q.p.massKg), q.r, 'F');
    }
    doc.setFont('courier', 'bold'); doc.setFontSize(7);
    const labs = P.map(q => {
        const x = xOf(q.p.cgMm), y = yOf(q.p.massKg);
        const w = doc.getTextWidth(q.lab);
        let side = q.side;
        if (side === 'right' && x + 8 + w > xR - 2) side = 'left';
        else if (side === 'left' && x - 6 - w < xL + 13) side = 'right';   // bande du titre « Masse »
        return { x, y, w, side, lab: q.lab, col: q.col };
    });
    for (const side of ['right', 'left']) {
        const group = labs.filter(l => l.side === side).sort((a, b) => a.y - b.y);
        for (let i = 1; i < group.length; i++) {
            if (Math.abs(group[i].y - group[i - 1].y) < 9) group[i].y = group[i - 1].y + 9;
        }
    }
    for (const l of labs) {
        _setInk(doc, l.col === MUTED ? MUTED : l.col);
        doc.text(l.lab, l.x + (l.side === 'left' ? -6 : 8), l.y + 2, l.side === 'left' ? { align: 'right' } : undefined);
    }

    return yB + 24;
}

// ---------------------------------------------------------------------------
// Profil d'élévation redessiné en jsPDF — même langage visuel que le canvas
// elevation-chart.js (aire orangée sous la courbe, ligne de croisière bleue
// pointillée, waypoints ambre, grille + labels ft/km), adapté au papier blanc.
// Retourne l'ordonnée Y après le graphique.
// ---------------------------------------------------------------------------
function _drawElevationChart(doc, pr, L, R, yTopSection, fr) {
    const xL = L + 42, xR = R - 6;
    // 15 pt sous le titre : rangée(s) des codes OACI des waypoints, AU-DESSUS
    // du cadre (lisibilité, consigne pilote) — le graphe commence plus bas.
    const yT = yTopSection + 19, CH = 128, yB = yT + CH;
    const plotW = xR - xL;

    // Échelle Y : englobe le terrain + l'altitude de croisière (comme le web)
    // avec une RÉSERVE au-dessus de la croisière (+600 ft) : les cadres de
    // zones au plafond tronqué par l'échelle restent séparés de la ligne
    // de croisière et de son libellé (sinon 200 ft ≈ 4 pt : collés).
    let yMin = Math.min(pr.minFt, pr.cruiseAltFt) - 200;
    let yMax = Math.max(pr.maxFt, pr.cruiseAltFt) + 600;
    if (yMax - yMin < 500) yMax = yMin + 500;
    const xOf = f => xL + f * plotW;
    const yOf = e => yT + (1 - (e - yMin) / (yMax - yMin)) * CH;

    // Croisière — calculée tôt : son libellé (à droite) et sa ligne servent
    // de repère aux rangées d'étiquettes.
    const cruiseDrawn = pr.cruiseAltFt > yMin && pr.cruiseAltFt < yMax;
    const yc = cruiseDrawn ? yOf(pr.cruiseAltFt) : null;

    // Fond + grille horizontale avec labels (5 lignes).
    doc.setFillColor(...PLOT_BG);
    doc.rect(xL, yT, plotW, CH, 'F');
    doc.setFont('courier', 'normal'); doc.setFontSize(6.5);
    const ySteps = 4;
    for (let i = 0; i <= ySteps; i++) {
        const elev = yMin + (yMax - yMin) * i / ySteps;
        const gy = yT + (1 - i / ySteps) * CH;
        doc.setDrawColor(...BANDL); doc.setLineWidth(0.4);
        doc.line(xL, gy, xR, gy);
        _setInk(doc, MUTED);
        doc.text(`${Math.round(elev)} ft`, xL - 4, gy + 2.2, { align: 'right' });
    }

    // CADRES d'altitude des zones traversées NON-SIV (CTA, TMA, CTR, R/D/P…)
    // — même langage que la version site : rectangle sur la bande
    // plancher→plafond de la zone pour chaque tronçon traversé, fond bleu
    // pâle, bord haut pointillé si le plafond dépasse l'échelle,
    // séparateurs pointillés entre secteurs d'un même organisme, et nom +
    // fréquence (en dessous) écrits À L'HORIZONTALE dans le cadre, par
    // secteur. Dessiné SOUS le terrain (comme le canvas elevation-chart).
    // Les SIV ont leur propre traitement (limites verticales + étiquettes
    // horizontales AU-DESSUS DU RELIEF, plus bas dans la fonction).
    const _zones = Array.isArray(pr.routeAirspaces) ? pr.routeAirspaces : null;
    const _isSiv = (g) => /^SIV\b/i.test(g.segs?.[0]?.zone || g.name || '');
    // Index des fréquences disponibles par tronçon (groupes SIV/FIS avec
    // fréquence) : un cadre TMA/CTA/CTR sans fréquence propre emprunte
    // celle du secteur sous-jacent sur le même tronçon — les frontières
    // de secteurs APP/FIS/SIV coïncident géographiquement avec celles des
    // TMA (vérifié RENNES : même bascule à 34,7 %).
    const _freqByIdx = [];
    if (_zones) for (const g of _zones) {
        if (!g.freq) continue;
        for (const [fa, fb] of g.ranges) _freqByIdx.push({ fa, fb, freq: g.freq });
    }
    const _borrowFreq = (fa, fb) => {
        let best = 0, freq = null;
        for (const e of _freqByIdx) {
            const ov = Math.min(fb, e.fb) - Math.max(fa, e.fa);
            if (ov > best) { best = ov; freq = e.freq; }
        }
        return freq;
    };
    const _boxLabels = [];   // dessinées après tous les cadres (anti-collision)
    if (_zones?.length) {
        for (const g of _zones) {
            if (_isSiv(g)) continue;
            const clamped = g.up > yMax;
            const byT = Math.max(yOf(Math.min(g.up, yMax)), yT);
            const byB = Math.min(Math.max(yOf(g.lo), yT), yB);
            if (byB - byT < 3) continue;
            for (const [fa, fb] of g.ranges) {
                const x0 = Math.max(xOf(fa), xL), x1 = Math.min(xOf(fb), xR);
                if (x1 - x0 < 2) continue;
                doc.setFillColor(232, 246, 253);
                doc.rect(x0, byT, x1 - x0, byB - byT, 'F');
                doc.setDrawColor(...SIV_MAP_LN); doc.setLineWidth(0.7);
                doc.rect(x0, byT, x1 - x0, byB - byT, 'S');
                if (clamped) {   // plafond au-dessus de l'échelle : bord haut pointillé
                    doc.setLineDashPattern([3, 2], 0); doc.setLineWidth(0.7);
                    doc.line(x0 + 1, byT, x1 - 1, byT);
                    doc.setLineDashPattern([], 0);
                }
                // Séparateurs entre secteurs du même organisme (ex. RENNES 2/4).
                for (let i = 1; i < g.segs.length; i++) {
                    const sx = xOf((g.segs[i - 1].fb + g.segs[i].fa) / 2);
                    if (sx <= x0 || sx >= x1) continue;
                    doc.setLineDashPattern([2.5, 2], 0); doc.setLineWidth(0.5);
                    doc.setDrawColor(...SIV_MAP_LN);
                    doc.line(sx, byT + 1, sx, byB - 1);
                    doc.setLineDashPattern([], 0);
                }
                // Étiquette par SECTEUR : nom (gras) puis fréquence dessous,
                // horizontales, centrées dans le cadre — collectées puis
                // dessinées après tous les cadres avec anti-collision.
                const twoLines = byB - byT >= 11;
                const cy = (byT + byB) / 2;
                for (const s of g.segs) {
                    const zone = (s.zone && s.zone.toUpperCase() !== g.name.toUpperCase())
                        ? s.zone : g.name.replace(/ INFO$/, '');
                    if (!zone) continue;
                    const bx0 = Math.max(xOf(s.fa), x0), bx1 = Math.min(xOf(s.fb), x1);
                    if (bx1 - bx0 < 2) continue;
                    // Seconde ligne du cadre : fréquence radio (TMA/CTA/CTR
                    // — propre ou empruntée au secteur sous-jacent), sinon
                    // ACTIVITÉ officielle des zones R/D/P (« Parachutage »).
                    // Uniquement si le cadre est assez haut pour deux lignes.
                    const freq = !twoLines ? null
                        : (g.freq || (/^(TMA|CTA|CTR)\b/i.test(zone) ? _borrowFreq(s.fa, s.fb) : null));
                    const sub = freq || (/^(R|D|P)\b/i.test(zone) ? (s.act || null) : null);
                    _boxLabels.push({
                        label: zone.replace(/\s+partie\s+/i, ' '),
                        freq: sub,
                        cx: (bx0 + bx1) / 2,
                        boxW: bx1 - bx0,
                        cy: byB - byT >= 11 ? cy - 1.5 : cy + 2,
                    });
                }
            }
        }
        // Anti-collision horizontale : le nom peut déborder du cadre — la
        // limite voisin ne s'applique qu'entre étiquettes de la MÊME ligne
        // (±9 pt) ; sur des lignes différentes (bandes d'altitude
        // distinctes) seule la largeur du graphe borne. Un tronçon de
        // 30 pt ne contient pas « TMA RENNES 2 » à taille lisible.
        _boxLabels.sort((a, b) => a.cx - b.cx);
        const sameLine = (a, b) => a && b && Math.abs(a.cy - b.cy) < 9;
        for (let i = 0; i < _boxLabels.length; i++) {
            const b = _boxLabels[i];
            const bndR = Math.max(6, xR - 4 - b.cx);
            const bndL = Math.max(6, 2 * (b.cx - xL + 3));   // léger débord gauche toléré
            const gapL = sameLine(b, _boxLabels[i - 1]) ? b.cx - _boxLabels[i - 1].cx - 4 : bndR;
            const gapR = sameLine(b, _boxLabels[i + 1]) ? _boxLabels[i + 1].cx - b.cx - 4 : bndR;
            const allowed = Math.max(b.boxW - 2, Math.min(gapL, gapR, bndL, bndR));
            doc.setFont('helvetica', 'bold'); doc.setFontSize(6);
            const name = doc.getTextWidth(b.label) > allowed ? _trunc(doc, b.label, allowed) : b.label;
            _setInk(doc, SIV_TX);
            doc.text(name, Math.min(b.cx, xR - 4), b.cy, { align: 'center' });
            if (b.freq) {
                doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5);
                const fq = doc.getTextWidth(b.freq) > allowed ? _trunc(doc, b.freq, allowed) : b.freq;
                doc.text(fq, Math.min(b.cx, xR - 4), b.cy + 5, { align: 'center' });
            }
        }
    }

    // Aire sous la courbe (polygone fermé vers le bas du graphe).
    const pts = pr.points;
    const segs = [[0, yOf(pts[0].elevFt) - yB]];           // montée au 1er point
    for (let i = 1; i < pts.length; i++) {
        const px = xOf(pts[i].frac) - xOf(pts[i - 1].frac);
        const py = yOf(pts[i].elevFt) - yOf(pts[i - 1].elevFt);
        segs.push([px, py]);
    }
    segs.push([0, yB - yOf(pts[pts.length - 1].elevFt)]);  // retour au bas
    doc.setFillColor(...ORANGE_BG);
    doc.lines(segs, xOf(pts[0].frac), yB, [1, 1], 'F', false);

    // Ligne de terrain.
    const lineSegs = segs.slice(1, -1);
    doc.setDrawColor(...ORANGE); doc.setLineWidth(1.4);
    doc.lines(lineSegs, xOf(pts[0].frac), yOf(pts[0].elevFt), [1, 1], 'S', false);

    // Axe X bas + labels distance : NM PAR TRONÇON entre waypoints (même
    // langage que l'écran — plus de graduations km), centrés sous chaque
    // segment et bornés dans le graphe pour ne pas déborder du cadre.
    doc.setDrawColor(...LINE); doc.setLineWidth(0.5);
    doc.line(xL, yB, xR, yB);
    doc.setFont('courier', 'normal'); doc.setFontSize(6.5); _setInk(doc, MUTED);
    const bornes = [0];
    if (pr.waypoints?.length) {
        for (const w of pr.waypoints) {
            if (typeof w.frac === 'number' && w.frac > 0 && w.frac < 1) bornes.push(w.frac);
        }
        bornes.sort((a, b) => a - b);
    }
    bornes.push(1);
    for (let i = 0; i < bornes.length - 1; i++) {
        const nm = Math.round((bornes[i + 1] - bornes[i]) * pr.distTotalKm / 1.852);
        const lab = `${nm} NM`;
        const w = doc.getTextWidth(lab);
        const mid = (bornes[i] + bornes[i + 1]) / 2;
        const lx = Math.max(xL + w / 2 + 1, Math.min(xOf(mid), xR - w / 2 - 1));
        doc.text(lab, lx, yB + 10, { align: 'center' });
    }

    // Waypoints intermédiaires : codes OACI AU-DESSUS DU CADRE (lisibilité,
    // consigne pilote) — rangée sous le titre, 2e rangée si deux codes se
    // disputent la même largeur. Filet vertical pointillé du code jusqu'au
    // bas du graphe, pastille ambre en haut du cadre.
    const yWpRow1 = yTopSection + 6.5, yWpRow2 = yTopSection + 13.5;
    const wpLabels = [];
    if (pr.waypoints?.length) {
        for (const wp of pr.waypoints) {
            if (wp.frac == null) continue;
            wpLabels.push({ txt: wp.name || wp.icao, x: xOf(wp.frac), align: 'center' });
        }
    }

    // Ligne altitude de croisière (pointillée bleue) + label au-dessus, à
    // DROITE (à gauche il entre en collision avec les étiquettes des cadres
    // de zones du premier tronçon, ex. « R 146 A »).
    if (cruiseDrawn) {
        doc.setDrawColor(...BLUE); doc.setLineWidth(1.2);
        doc.setLineDashPattern([6, 4], 0);
        doc.line(xL, yc, xR, yc);
        doc.setLineDashPattern([], 0);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7); _setInk(doc, BLUE);
        doc.text(`${Math.round(pr.cruiseAltFt)} ft`, xR - 4, yc - 4, { align: 'right' });
    }

    // Codes waypoints : rangement gauche → droite, 2e rangée en cas de
    // collision, puis filet (part du code) + pastille en haut du cadre.
    wpLabels.forEach(l => {
        l.font ??= 'helvetica'; l.size ??= 6.5; l.ink ??= AMBER;
        doc.setFont(l.font, 'bold'); doc.setFontSize(l.size);
        l.w = doc.getTextWidth(l.txt);
    });
    wpLabels.sort((a, b) => a.x - b.x);
    let prevEdge = -Infinity;
    for (const l of wpLabels) {
        const lEdge = l.align === 'right' ? l.x - l.w : (l.align === 'center' ? l.x - l.w / 2 : l.x);
        const clash = lEdge < prevEdge + 3;
        l.y = clash ? yWpRow2 : yWpRow1;
        doc.setFont(l.font, 'bold'); doc.setFontSize(l.size); _setInk(doc, l.ink);
        doc.text(l.txt, l.x, l.y, { align: 'center' });
        prevEdge = Math.max(prevEdge, lEdge + l.w);
        // Filet seul, SANS pastille (consigne pilote) : le code au-dessus du
        // cadre suffit à repérer le waypoint.
        doc.setDrawColor(...AMBER_LN); doc.setLineWidth(0.8);
        doc.setLineDashPattern([3, 3], 0);
        doc.line(l.x, l.y + 1.8, l.x, yB);
        doc.setLineDashPattern([], 0);
    }

    // Zones SIV traversées : LIMITES en traits verticaux pleins fins, bleu
    // identique à la carte (#38BDF8), à chaque entrée/sortie de zone ; nom
    // du secteur + fréquence à L'HORIZONTALE, centrés ENTRE LES LIMITES,
    // AU-DESSUS DU RELIEF — si le texte dépasse la largeur entre limites,
    // il passe à la ligne. (Les autres familles — CTA, TMA, CTR, R/D/P… —
    // sont dessinées plus haut en CADRES d'altitude horizontaux, comme la
    // version site.)
    const zones = (Array.isArray(pr.routeAirspaces) ? pr.routeAirspaces : [])
        .filter(g => /^SIV\b/i.test(g.segs?.[0]?.zone || g.name || ''));
    if (zones.length) {
        // Limites : débuts/fins de traversée (ranges fusionnés), doublons
        // proches écartés (zones imbriquées qui partagent un bord).
        const bxs = [];
        for (const g of zones) {
            for (const [fa, fb] of g.ranges) {
                for (const f of [fa, fb]) {
                    const x = Math.max(xL, Math.min(xOf(f), xR));
                    if (!bxs.some(b => Math.abs(b - x) <= 1.5)) bxs.push(x);
                }
            }
        }
        bxs.sort((a, b) => a - b);
        doc.setDrawColor(...SIV_MAP_LN); doc.setLineWidth(0.7);
        for (const x of bxs) doc.line(x, yT, x, yB);
    }

    // Étiquettes SIV (une par secteur, à l'horizontale, centrées ENTRE LEURS
    // LIMITES) posées AU-DESSUS DU RELIEF : première ligne 12 pt au-dessus du
    // point le plus haut du terrain (consigne pilote 10-15 px), lignes
    // suivantes empilées vers le haut. Codes départ/arrivée : AU NIVEAU DU
    // SOL, bas du graphe. Anti-collision par RANGÉES (compteurs indépendants
    // par groupe) : quand deux textes de la même hauteur se chevauchent
    // (secteurs imbriqués type SEINE 6/7 dans PARIS OUEST), le plus tardif
    // monte d'une rangée — chaque étiquette garde son centrage, seule la
    // hauteur s'ajuste.
    const ROW_H = 5.5;                    // écart de rangée (> pénétration QA 1,4 pt)
    const rowFree = (spans, row, a, b) => !(spans.get(row) || []).some(o => a < o.b - 1.2 && o.a < b - 1.2);
    const occupyRow = (spans, row, a, b) => spans.set(row, [...(spans.get(row) || []), { a, b }]);
    // Plus petite rangée de départ où TOUTES les lignes du bloc (bas → haut,
    // rangées consécutives) sont libres ; ancre = ordonnée de la 1re ligne.
    const placeBlock = (spans, lines, yAnchor) => {
        outer: for (let r0 = 0; r0 < 24; r0++) {
            for (let i = 0; i < lines.length; i++) {
                if (!rowFree(spans, r0 + i, lines[i].a, lines[i].b)) continue outer;
            }
            lines.forEach((l, i) => occupyRow(spans, r0 + i, l.a, l.b));
            lines.forEach((l, i) => { l.y = yAnchor - (r0 + i) * ROW_H; });
            return true;
        }
        return false;
    };

    // — Départ / arrivée d'abord : priorité sur la rangée du sol.
    doc.setFont('courier', 'bold'); doc.setFontSize(7.5);
    const endLines = [];
    const addEnd = (txt, alignRight) => {
        const w = doc.getTextWidth(txt);
        const a = alignRight ? xR - 2 - w : xL + 2;
        endLines.push({ txt, a, b: a + w, x: alignRight ? xR - 2 : xL + 2, alignRight });
    };
    addEnd(pr.fromIcao, false);
    addEnd(pr.toIcao, true);
    // MÊME RANGÉE pour les deux codes (consigne pilote) : placés séparément —
    // un bloc de 2 lignes les empilerait, alors qu'aux extrémités opposées du
    // graphe ils ne peuvent jamais se chevaucher.
    const spansSol = new Map();
    for (const l of endLines) placeBlock(spansSol, [l], yB - 2);
    for (const l of endLines) {
        // Fond blanc : lisible sur le remplissage du relief et sur les
        // limites/étiquettes de zones qui passent dessous.
        doc.setFillColor(255, 255, 255);
        doc.rect(l.a - 1, l.y - 2.8, (l.b - l.a) + 2, 3.8, 'F');
        _setInk(doc, INK);
        doc.text(l.txt, l.x, l.y, l.alignRight ? { align: 'right' } : undefined);
    }

    // — Étiquettes SIV par secteur : wrap ENTRE LIMITES (découpage glouton ;
    // un mot seul trop large déborde centré, mieux vaut déborder que d'être
    // illisible), puis placement en rangées, gauche → droite.
    const sivBlocks = [];
    for (const g of zones) {
        for (const s of g.segs) {
            const zone = (s.zone && s.zone.toUpperCase() !== g.name.toUpperCase())
                ? s.zone : g.name.replace(/ INFO$/, '');
            if (!zone) continue;
            const x0 = Math.max(xL, xOf(s.fa)), x1 = Math.min(xR, xOf(s.fb));
            if (x1 - x0 < 3) continue;
            doc.setFont('helvetica', 'bold'); doc.setFontSize(6);
            // « partie A » → « A » (nom SIA compacté), fréquence en fin.
            const words = zone.replace(/\s+partie\s+/i, ' ').split(/\s+/);
            if (g.freq) words.push(String(g.freq));
            const maxW = x1 - x0 - 1.5;
            const linesTxt = [];
            let cur = '';
            for (const w of words) {
                const cand = cur ? cur + ' ' + w : w;
                if (doc.getTextWidth(cand) <= maxW || !cur) cur = cand;
                else { linesTxt.push(cur); cur = w; }
            }
            if (cur) linesTxt.push(cur);
            const lines = linesTxt.map(t => {
                const w = doc.getTextWidth(t);
                const cx = Math.max(xL + 2 + w / 2, Math.min((x0 + x1) / 2, xR - 2 - w / 2));
                return { txt: t, a: cx - w / 2, b: cx + w / 2, x: cx };
            });
            // Lecture visuelle NOM puis fréquence DE HAUT EN BAS (consigne
            // pilote) : les lignes sont posées bas → haut depuis l'ancre,
            // on inverse donc l'ordre logique (nom d'abord, fréq en fin).
            lines.reverse();
            if (lines.length) sivBlocks.push(lines);
        }
    }
    // Ancre SIV : 12 pt AU-DESSUS DU POINT LE PLUS HAUT du relief (consigne
    // pilote 10-15 px) — les étiquettes flottent au-dessus du dessin du
    // terrain, jamais sur le remplissage orange.
    const yAnchorSiv = yOf(pr.maxFt) - 12;
    const spansSiv = new Map();
    sivBlocks.sort((A, B) => A[0].a - B[0].a);
    for (const lines of sivBlocks) placeBlock(spansSiv, lines, yAnchorSiv);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6);
    _setInk(doc, SIV_TX);
    for (const lines of sivBlocks) {
        for (const l of lines) doc.text(l.txt, l.x, l.y, { align: 'center' });
    }

    return yB + 16;
}
