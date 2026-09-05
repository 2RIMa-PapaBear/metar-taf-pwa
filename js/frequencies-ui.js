/* ================================================================
 * FREQUENCIES UI — Fréquences radio + fiche du terrain
 * ================================================================
 *
 * Onglet « Fréquences & info terrain » du terrain courant :
 *   - identité : élévation, déclinaison (officielle SIA en France,
 *     modèle WMM ailleurs), usage VFR/IFR, statut, public/privé, pays ;
 *   - fréquences (corrections manuelles > eAIP/XML SIA > openAIP) ;
 *   - pistes en clair (officielles SIA en France, base embarquée
 *     17 000 terrains pour le reste du monde) ;
 *   - horaires du service ATS/AFIS + téléphone exploitant et
 *     avitaillement carburant (rubriques AD du XML SIA — France).
 *
 * Chaque section est omise silencieusement quand la donnée n'existe
 * pas (terrain sans fiche, hors France…).
 * ================================================================ */

import { state, escapeHtml } from './core.js';
import { getAirportByICAO, initAirportsDB } from './ui-module.js';
import { getVacLink } from './atc-info.js';
import { makeCollapsible } from './collapsible.js';
import { loadFreqSources, getAirportFreqs, getSiaAirac } from './freq-sia.js';
import { loadSiaAux, getSiaAirfield, getSiaRunways, getSiaAuxAirac } from './sia-data.js';
import { getDeclinationForIcao } from './magvar.js';

/**
 * Affiche/masque le widget fréquences pour le terrain courant.
 * @param {string|null} icao Code OACI (null = masquer).
 */
export async function showFrequenciesWidget(icao) {
    const container = document.getElementById('frequencies-widget');
    if (!container) return;

    if (!icao) {
        container.style.display = 'none';
        return;
    }

    // Source des fréquences : corrections manuelles > eAIP officiel SIA
    // (France métropole) > openAIP. Le premier affichage attend le chargement
    // (120 Ko, puis cache IndexedDB) pour ne jamais montrer openAIP par erreur.
    // Les pistes/terrains officiels France chargent en parallèle (cache IDB).
    // La base embarquée (17 000 terrains) participe au rendu (pays/élévation/
    // pistes hors France) : on l'attend, sinon le widget s'affiche complet
    // pour la France mais AMPUTÉ hors France (base encore en cours de
    // chargement, jamais re-rendue ensuite) — et apt n'est capturé QU'APRÈS
    // cette attente (sinon null ou partiel au 1er rendu : course vue en QA).
    const [, aux] = await Promise.all([
        loadFreqSources(),
        loadSiaAux().catch(() => null),
        initAirportsDB().catch(() => {}),
    ]);
    const apt = getAirportByICAO(icao);
    const { source, freqs } = getAirportFreqs(icao, apt?.frequencies);
    const sia = aux ? getSiaAirfield(icao) : null;

    // Lien VAC officiel (peut être null si le pays n'est pas reconnu).
    const vac = getVacLink(icao);

    const ident = identityRows(icao, apt, sia, state.lang === 'fr');
    const runways = runwayRows(icao, apt, sia);

    if (!freqs.length && !vac && !ident.length && !runways.length && !sia?.horAts && !sia?.horAvt) {
        // Rien à raconter sur ce terrain → on masque.
        container.style.display = 'none';
        return;
    }

    const isFr = state.lang === 'fr';
    // Prépare le panel repliable et rend dans le body.
    const body = makeCollapsible(container, isFr ? 'Fréquences & info terrain' : 'Frequencies & airfield info', 'radio-tower');

    render(body, { icao, freqs, source, vac, ident, runways, sia, isFr });
    container.style.display = 'block';
}

/** Lignes d'identité « Libellé : valeur » (retour pilote 05/09 : chaque
 * donnée dit ce qu'elle est). NB : TfcPrive = « vols privés AUTORISÉS »
 * (314 terrains CAP sur 316 l'ont) — ce n'est PAS « terrain privé », on ne
 * l'affiche pas ; l'ouverture est portée par la ligne « Ouvert aux vols ». */
function identityRows(icao, apt, sia, isFr) {
    const rows = [];
    const elevFt = Number.isFinite(sia?.elevFt) ? sia.elevFt : apt?.elevation;
    if (Number.isFinite(elevFt)) rows.push({ l: isFr ? 'Alt. terrain' : 'Field elevation', v: `${elevFt} ft`, mono: true });

    // Déclinaison : officielle SIA (millésimée) en France, sinon modèle.
    let dec = Number.isFinite(sia?.magVar) ? sia.magVar : getDeclinationForIcao(icao);
    if (Number.isFinite(dec)) {
        const deg = Math.abs(dec) >= 10 ? Math.abs(dec).toFixed(0) : Math.abs(dec).toFixed(1);
        rows.push({ l: isFr ? 'Déclinaison' : 'Variation', v: `${deg}° ${dec >= 0 ? 'E' : 'W'}${sia?.magVarYear ? ` (${sia.magVarYear})` : ''}`, mono: true });
    }

    if (sia) {
        const t = [sia.vfr === true && 'VFR', sia.ifr === true && 'IFR'].filter(Boolean);
        if (t.length === 2) rows.push({ l: isFr ? 'Ouvert aux vols' : 'Open to traffic', v: t.join(' · ') });
        else if (t.length === 1 && t[0] === 'VFR') rows.push({ l: isFr ? 'Ouvert aux vols' : 'Open to traffic', v: isFr ? 'VFR uniquement' : 'VFR only' });
        else if (t.length === 1) rows.push({ l: isFr ? 'Ouvert aux vols' : 'Open to traffic', v: t[0] });

        const STATUTS = {
            CAP: isFr ? 'Ouvert à la circulation aérienne publique' : 'Open to public air traffic',
            RST: isFr ? 'Usage restreint' : 'Restricted use',
            PRV: isFr ? 'Usage privé' : 'Private use',
            MIL: isFr ? 'Militaire' : 'Military',
            OFF: isFr ? 'Fermé (OFF)' : 'Closed (OFF)',
        };
        if (STATUTS[sia.statut]) rows.push({ l: isFr ? 'Statut' : 'Status', v: STATUTS[sia.statut] });
    } else if (apt?.country) {
        rows.push({ l: isFr ? 'Pays' : 'Country', v: apt.country });
    }
    return rows;
}

/** Lignes de pistes : officielles SIA (France) ou base embarquée (monde). */
function runwayRows(icao, apt, sia) {
    const rows = [];
    const surfWorld = (code) => {
        const s = String(code || '').toUpperCase();
        if (/ASP|CONC|BITU|PEM/.test(s)) return 'revêtue';
        if (/GRS|GRASS/.test(s)) return 'herbe';
        if (/GRV|DIRT|EARTH/.test(s)) return 'non revêtue';
        return s || '';
    };

    const siaRw = getSiaRunways(icao);
    if (siaRw?.length) {
        for (const r of siaRw) {
            rows.push({
                d: r.d,
                cap: Number.isFinite(r.brg) ? Math.round(r.brg) : null,
                lenM: r.len, widM: r.wid || null,
                surf: r.surf || '',
                main: !!r.main,
                thr: (r.t1 && r.t2 && Number.isFinite(r.t1.altFt) && Number.isFinite(r.t2.altFt))
                    ? `${r.t1.altFt}/${r.t2.altFt} ft` : null,
            });
        }
        return rows;
    }

    for (const str of (apt?.runways || [])) {
        // Format embarqué : « 04 (039°)/22 (219°) ».
        const m = String(str).match(/^(\w+)\s*\((\d+)°\)\s*\/\s*(\w+)\s*\((\d+)°\)$/);
        const qfu1 = m?.[1], qfu2 = m?.[3];
        const lenFt = qfu1 && apt?.runwayLengths?.[qfu1] != null ? apt.runwayLengths[qfu1] : apt?.longestRunway;
        const surf = qfu1 && apt?.runwaySurfaces ? surfWorld(apt.runwaySurfaces[qfu1]) : '';
        rows.push({
            d: qfu1 && qfu2 ? `${qfu1}/${qfu2}` : String(str),
            cap: m ? +m[2] : null,
            lenM: Number.isFinite(lenFt) ? Math.round(lenFt * 0.3048) : null,
            widM: null, surf, main: false, thr: null,
        });
    }
    return rows;
}

/**
 * Génère le HTML du widget.
 */
function render(container, { icao, freqs, source, vac, ident, runways, sia, isFr }) {
    // Sépare les fréquences principales des secondaires.
    const primary = freqs.filter(f => f.primary);
    const others = freqs.filter(f => !f.primary);

    // Codes d'horaires des organismes (eAIP AD 2.18) — info-bulle du badge.
    const HOR_CODES = {
        H24: isFr ? 'Service permanent 24 h/24' : 'Continuous service',
        HO: isFr ? 'Service sur demande (hors horaires publiés)' : 'Service on request',
        HX: isFr ? 'Horaires variables (consulter le complément AIP)' : 'Variable hours',
        HJ: isFr ? 'Du lever au coucher du soleil' : 'Sunrise to sunset',
        HN: isFr ? 'Du coucher au lever du soleil' : 'Sunset to sunrise',
    };

    // Construit les lignes de fréquences. L'observation officielle eAIP
    // (secteurs, fréquence supplétive, conditions…) différencie les
    // fréquences multiples d'un même organisme — 2ᵉ ligne, texte complet
    // au survol ( publié bilingue FR/EN par le SIA, FR en tête).
    const freqRow = (f) => {
        const isPrimary = f.primary;
        const freqStr = f.freq.toFixed(3);
        const hor = f.hor && HOR_CODES[f.hor] ? f.hor : null;
        const rem = f.rem ? String(f.rem).trim() : '';
        const remShort = rem.length > 92 ? rem.slice(0, 92).replace(/\s+\S*$/, '') + '…' : rem;
        return `<div style="display:flex; flex-direction:column; gap:1px; padding:6px 12px; background:${isPrimary ? 'rgba(56,189,248,0.08)' : 'rgba(255,255,255,0.03)'}; border-radius:6px; border-left:3px solid ${isPrimary ? '#38BDF8' : 'rgba(148,163,184,0.3)'};">
            <div style="display:flex; align-items:center; gap:10px;">
                <span style="font-family:'DM Mono',monospace; font-size:13.5px; font-weight:700; color:${isPrimary ? '#38BDF8' : 'var(--text-color)'}; min-width:70px;">${freqStr}</span>
                ${f.type ? `<span style="font-size:10px; background:rgba(255,255,255,0.08); color:var(--text-muted); padding:2px 7px; border-radius:3px; font-weight:700; letter-spacing:0.5px; min-width:40px; text-align:center;">${escapeHtml(f.type)}</span>` : ''}
                <span style="font-size:12px; color:var(--text-muted); flex:1;">${escapeHtml(f.name || '')}</span>
                ${hor ? `<span title="${escapeHtml(HOR_CODES[f.hor])}" style="font-size:10px; font-weight:700; font-family:'DM Mono',monospace; color:var(--text-dim); border:1px solid var(--border-color); border-radius:4px; padding:1px 6px;">${hor}</span>` : ''}
            </div>
            ${rem ? `<div title="${escapeHtml(rem)}" style="font-size:11px; color:var(--text-muted); line-height:1.45; padding-left:80px;">${escapeHtml(remShort)}</div>` : ''}
        </div>`;
    };

    // Titre de sous-section (pistes / horaires / terrain / avitaillement).
    const sectionTitle = (icon, label) => `<div style="display:flex; align-items:center; gap:6px; margin:14px 0 6px; color:var(--text-muted); font-size:10.5px; font-weight:700; letter-spacing:0.8px; text-transform:uppercase;">
        <i data-lucide="${icon}" style="width:12px;height:12px;"></i><span>${label}</span></div>`;

    let html = `<div class="dash-title" style="margin-bottom:10px;">
        <i data-lucide="radio-tower" class="icon-sm"></i>
        <span>${isFr ? 'Fréquences & info terrain' : 'Frequencies & airfield info'}</span>
    </div>`;

    // ---- 1. FRÉQUENCES (le réflexe prévol radio, en tête) ----
    if (primary.length > 0 || others.length > 0) {
        html += `<div style="display:flex; flex-direction:column; gap:5px;">`;
        primary.forEach(f => { html += freqRow(f); });
        others.forEach(f => { html += freqRow(f); });
        html += `</div>`;
    }

    // ---- 2. PISTES en clair (seuils officiels affichés, pas cachés) ----
    if (runways.length) {
        html += sectionTitle('move-horizontal', isFr ? 'Pistes' : 'Runways');
        html += `<div style="display:flex; flex-direction:column; gap:4px;">`;
        for (const r of runways) {
            const dims = [r.lenM != null ? `${r.lenM}` : null, r.widM != null ? `${r.widM}` : null].filter(Boolean).join(' × ');
            html += `<div style="display:flex; align-items:baseline; flex-wrap:wrap; gap:2px 10px; padding:5px 10px; background:rgba(255,255,255,0.03); border-radius:6px;">
                <span style="font-family:'DM Mono',monospace; font-size:13px; font-weight:700; color:var(--text-color); min-width:58px;">${escapeHtml(r.d)}${r.main ? ' ★' : ''}</span>
                ${r.cap != null ? `<span style="font-family:'DM Mono',monospace; font-size:13px; color:var(--text-muted); min-width:74px;">${String(r.cap).padStart(3, '0')}°${sia ? (isFr ? ' vrai' : ' true') : ''}</span>` : ''}
                ${dims ? `<span style="font-family:'DM Mono',monospace; font-size:13px; color:var(--text-color); font-weight:500;">${dims} m</span>` : ''}
                <span style="font-size:12px; color:var(--text-muted); margin-left:auto; text-align:right;">
                    ${r.surf ? escapeHtml(r.surf) : ''}${r.surf && r.thr ? ' · ' : ''}${r.thr ? `${isFr ? 'seuils' : 'thr.'} <span style="font-family:'DM Mono',monospace;">${escapeHtml(r.thr)}</span>` : ''}
                </span>
            </div>`;
        }
        html += `</div>`;
        html += `<div style="font-size:10.5px; color:var(--text-muted); margin-top:3px;">${isFr ? '★ piste principale · caps et dimensions officiels SIA' : '★ main runway · official SIA data'}</div>`;
    }

    // ---- 3. HORAIRES du service ATS/AFIS + exploitant (France) ----
    if (sia?.horAts || sia?.tel) {
        html += sectionTitle('clock', isFr ? 'Horaires du service' : 'Service hours');
        if (sia?.horAtsCode) html += `<span style="display:inline-block; font-size:10px; background:rgba(56,189,248,0.15); color:#38BDF8; padding:2px 7px; border-radius:3px; font-weight:700; font-family:'DM Mono',monospace;">${escapeHtml(sia.horAtsCode)}</span>`;
        if (sia?.horAts) html += `<div style="margin-top:5px; padding:7px 11px; border-left:3px solid rgba(148,163,184,0.3); border-radius:6px; font-size:12px; color:var(--text-muted); line-height:1.55;">${sia.horAts.map(l => escapeHtml(l)).join('<br>')}</div>`;
        if (sia?.tel) html += `<a href="tel:${escapeHtml(sia.tel.replace(/\s/g, ''))}" style="display:flex; align-items:center; gap:7px; margin-top:6px; color:var(--primary); font-size:12.5px; font-weight:600; text-decoration:none;">
            <i data-lucide="phone" style="width:13px;height:13px;"></i>
            <span style="font-family:'DM Mono',monospace; font-size:13.5px;">${escapeHtml(sia.tel)}</span>
            <span style="color:var(--text-muted); font-weight:400; font-size:11px;">${isFr ? '· exploitant' : '· operator'}</span></a>`;
    }

    // ---- 4. Le reste : identité du terrain puis avitaillement ----
    if (ident.length) {
        html += sectionTitle('id-card', isFr ? 'Terrain' : 'Airfield');
        html += `<div style="display:flex; flex-direction:column; gap:2px;">` + ident.map(r =>
            `<div style="display:flex; align-items:baseline; flex-wrap:wrap; gap:4px 7px; padding:3px 0; font-size:12px;">
                <span style="color:var(--text-muted); white-space:nowrap;">${escapeHtml(r.l)} :</span>
                <span style="color:var(--text-color); font-weight:500;${r.mono ? " font-family:'DM Mono',monospace; font-size:13px;" : ''}">${escapeHtml(r.v)}</span>
            </div>`
        ).join('') + `</div>`;
    }

    if (sia?.horAvt) {
        html += sectionTitle('fuel', isFr ? 'Avitaillement' : 'Fuel');
        html += `<div style="padding:7px 11px; border-left:3px solid rgba(148,163,184,0.3); border-radius:6px; font-size:12px; color:var(--text-muted); line-height:1.55;">${sia.horAvt.map(l => escapeHtml(l)).join('<br>')}</div>`;
    }

    // Mention de source (avant le lien : celui-ci reste la DERNIÈRE ligne).
    html += `<div style="font-size:10.5px; color:var(--text-muted); margin-top:10px;">
        <i data-lucide="info" style="width:11px;height:11px;vertical-align:middle;"></i>
        ${sourceNote(source, !!sia, isFr)}
    </div>`;

    // ---- DERNIÈRE LIGNE : lien vers le portail AIP officiel du pays ----
    if (vac) {
        html += `<a href="${escapeHtml(vac.url)}" target="_blank" rel="noopener noreferrer"
            style="display:flex; align-items:center; gap:8px; margin-top:6px; padding:9px 12px; background:rgba(56,189,248,0.08); border:1px solid rgba(56,189,248,0.25); border-radius:6px; text-decoration:none; color:var(--primary); font-size:12.5px; font-weight:600; transition:background 0.15s;"
            onmouseover="this.style.background='rgba(56,189,248,0.15)'"
            onmouseout="this.style.background='rgba(56,189,248,0.08)'">
            <i data-lucide="map" style="width:14px;height:14px;"></i>
            <span>${escapeHtml(isFr ? vac.labelFr : vac.labelEn)}</span>
            ${vac.country ? `<span style="margin-left:auto; font-size:10px; color:var(--text-muted); font-weight:500;">${escapeHtml(vac.country)}</span>` : ''}
            <i data-lucide="external-link" style="width:11px;height:11px;color:var(--text-muted);"></i>
        </a>`;
    }

    container.innerHTML = html;
    if (window.lucide) window.lucide.createIcons({ root: container });
}

/** Mention de source du pied de page (fréquences + infos terrain).
 * Les deux cycles peuvent différer : fréquences = eAIP, infos terrain =
 * export XML (rubriques AD) — chacun cite SON AIRAC. */
function sourceNote(source, hasSia, isFr) {
    const airac = getSiaAirac();
    const auxAirac = getSiaAuxAirac();
    const freqTxt = source === 'sia'
        ? (isFr ? `Fréquences : SIA · eAIP France${airac ? ' (AIRAC ' + airac + ')' : ''}` : `Frequencies: SIA French AIP${airac ? ' (AIRAC ' + airac + ')' : ''}`)
        : source === 'overrides'
            ? (isFr ? 'Fréquences : corrections manuelles' : 'Frequencies: manual corrections')
            : (isFr ? 'Fréquences : OpenAIP' : 'Frequencies: OpenAIP');
    const infoTxt = hasSia
        ? (isFr ? ` · infos terrain : SIA${auxAirac ? ' (AIRAC ' + auxAirac + ')' : ''}` : ` · field info: SIA${auxAirac ? ' (AIRAC ' + auxAirac + ')' : ''}`)
        : (isFr ? ' · infos terrain : base embarquée' : ' · field info: embedded database');
    return freqTxt + infoTxt;
}
