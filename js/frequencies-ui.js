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
import { getAirportByICAO } from './ui-module.js';
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

    const apt = getAirportByICAO(icao);

    // Source des fréquences : corrections manuelles > eAIP officiel SIA
    // (France métropole) > openAIP. Le premier affichage attend le chargement
    // (120 Ko, puis cache IndexedDB) pour ne jamais montrer openAIP par erreur.
    // Les pistes/terrains officiels France chargent en parallèle (cache IDB).
    const [, aux] = await Promise.all([
        loadFreqSources(),
        loadSiaAux().catch(() => null),
    ]);
    const { source, freqs } = getAirportFreqs(icao, apt?.frequencies);
    const sia = aux ? getSiaAirfield(icao) : null;

    // Lien VAC officiel (peut être null si le pays n'est pas reconnu).
    const vac = getVacLink(icao);

    const ident = identityChips(icao, apt, sia);
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

/** Chips d'identité du terrain : élévation, déclinaison, usage, statut… */
function identityChips(icao, apt, sia) {
    const chips = [];
    const elevFt = Number.isFinite(sia?.elevFt) ? sia.elevFt : apt?.elevation;
    if (Number.isFinite(elevFt)) chips.push({ v: `${elevFt} ft`, l: 'élévation / elevation' });

    // Déclinaison : officielle SIA (millésimée) en France, sinon modèle.
    let dec = Number.isFinite(sia?.magVar) ? sia.magVar : getDeclinationForIcao(icao);
    if (Number.isFinite(dec)) {
        const deg = Math.abs(dec) >= 10 ? Math.abs(dec).toFixed(0) : Math.abs(dec).toFixed(1);
        chips.push({
            v: `${deg}° ${dec >= 0 ? 'E' : 'W'}${sia?.magVarYear ? ` (${sia.magVarYear})` : ''}`,
            l: 'déclinaison magnétique / magnetic variation',
        });
    }

    const usage = [sia?.vfr === true && 'VFR', sia?.ifr === true && 'IFR'].filter(Boolean).join(' · ');
    if (usage) chips.push({ v: usage, l: 'usage autorisé / traffic' });
    if (sia?.statut) chips.push({ v: sia.statut, l: 'statut de la carte SIA / SIA map status' });
    if (sia?.prive) chips.push({ v: 'privé / private', l: 'usage privé / private' });
    if (!sia && apt?.country) chips.push({ v: apt.country, l: 'pays / country' });
    return chips;
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

    // Construit les lignes de fréquences.
    const freqRow = (f) => {
        const isPrimary = f.primary;
        const freqStr = f.freq.toFixed(3);
        return `<div style="display:flex; align-items:center; gap:10px; padding:6px 12px; background:${isPrimary ? 'rgba(56,189,248,0.08)' : 'rgba(255,255,255,0.03)'}; border-radius:6px; border-left:3px solid ${isPrimary ? '#38BDF8' : 'rgba(148,163,184,0.3)'};">
            <span style="font-family:'DM Mono',monospace; font-size:16px; font-weight:500; color:${isPrimary ? '#38BDF8' : 'var(--text-color)'}; min-width:78px;">${freqStr}</span>
            ${f.type ? `<span style="font-size:9px; background:rgba(255,255,255,0.08); color:var(--text-muted); padding:2px 6px; border-radius:3px; font-weight:700; letter-spacing:0.5px; min-width:38px; text-align:center;">${escapeHtml(f.type)}</span>` : ''}
            <span style="font-size:11px; color:var(--text-muted); flex:1;">${escapeHtml(f.name || '')}</span>
        </div>`;
    };

    // Titre de sous-section (identité / pistes / horaires / avitaillement).
    const sectionTitle = (icon, label) => `<div style="display:flex; align-items:center; gap:6px; margin:12px 0 6px; color:var(--text-muted); font-size:10px; font-weight:700; letter-spacing:0.6px; text-transform:uppercase;">
        <i data-lucide="${icon}" style="width:11px;height:11px;"></i><span>${label}</span></div>`;

    let html = `<div class="dash-title" style="margin-bottom:10px;">
        <i data-lucide="radio-tower" class="icon-sm"></i>
        <span>${isFr ? 'Fréquences & info terrain' : 'Frequencies & airfield info'}</span>
    </div>`;

    // ---- Identité du terrain (chips discrètes, 1-2 lignes) ----
    if (ident.length) {
        html += `<div style="display:flex; flex-wrap:wrap; gap:4px; margin-bottom:2px;">` + ident.map(c =>
            `<span title="${escapeHtml(c.l)}" style="font-size:10px; background:rgba(255,255,255,0.06); color:var(--text-color); padding:3px 8px; border-radius:4px; font-weight:600; font-family:'DM Mono',monospace;">${escapeHtml(c.v)}</span>`
        ).join('') + `</div>`;
    }

    // ---- Fréquences (réponse rapide en prévol : juste sous l'identité) ----
    if (primary.length > 0 || others.length > 0) {
        if (ident.length) html += sectionTitle('radio', isFr ? 'Fréquences' : 'Frequencies');
        html += `<div style="display:flex; flex-direction:column; gap:5px;">`;
        primary.forEach(f => { html += freqRow(f); });
        others.forEach(f => { html += freqRow(f); });
        html += `</div>`;
    }

    // ---- Pistes en clair ----
    if (runways.length) {
        html += sectionTitle('move-horizontal', isFr ? 'Pistes' : 'Runways');
        html += `<div style="display:flex; flex-direction:column; gap:4px;">`;
        for (const r of runways) {
            const dims = [r.lenM != null ? `${r.lenM}` : null, r.widM != null ? `${r.widM}` : null].filter(Boolean).join(' × ');
            html += `<div title="${escapeHtml(r.thr ? (isFr ? `altitude des seuils ${r.thr}` : `threshold elevations ${r.thr}`) : '')}" style="display:flex; align-items:baseline; flex-wrap:wrap; gap:4px 10px; padding:4px 8px; background:rgba(255,255,255,0.03); border-radius:6px; font-size:11px;">
                <span style="font-family:'DM Mono',monospace; font-weight:700; color:var(--text-color); min-width:52px;">${escapeHtml(r.d)}${r.main ? ' ★' : ''}</span>
                ${r.cap != null ? `<span style="color:var(--text-muted); font-family:'DM Mono',monospace; min-width:64px;">${String(r.cap).padStart(3, '0')}°${sia ? ' vrai' : ''}</span>` : ''}
                ${dims ? `<span style="font-family:'DM Mono',monospace; color:var(--text-color);">${dims} m</span>` : ''}
                ${r.surf ? `<span style="color:var(--text-muted); margin-left:auto;">${escapeHtml(r.surf)}</span>` : ''}
            </div>`;
        }
        html += `</div>`;
        html += `<div style="font-size:9px; color:var(--text-muted); margin-top:3px;">${isFr ? '★ piste principale · caps et dimensions officiels SIA' : '★ main runway · official SIA data'}</div>`;
    }

    // ---- Horaires du service ATS/AFIS + exploitant (France) ----
    if (sia?.horAts || sia?.tel) {
        html += sectionTitle('clock', isFr ? 'Horaires du service' : 'Service hours');
        if (sia?.horAtsCode) html += `<span style="display:inline-block; font-size:9px; background:rgba(56,189,248,0.15); color:#38BDF8; padding:2px 6px; border-radius:3px; font-weight:700; font-family:'DM Mono',monospace;">${escapeHtml(sia.horAtsCode)}</span>`;
        if (sia?.horAts) html += `<div style="margin-top:5px; padding:6px 10px; border-left:3px solid rgba(148,163,184,0.3); border-radius:6px; font-size:11px; color:var(--text-muted); line-height:1.5;">${sia.horAts.map(l => escapeHtml(l)).join('<br>')}</div>`;
        if (sia?.tel) html += `<a href="tel:${escapeHtml(sia.tel.replace(/\s/g, ''))}" style="display:flex; align-items:center; gap:6px; margin-top:5px; color:var(--primary); font-size:11px; font-weight:600; text-decoration:none;">
            <i data-lucide="phone" style="width:12px;height:12px;"></i>
            <span style="font-family:'DM Mono',monospace;">${escapeHtml(sia.tel)}</span>
            <span style="color:var(--text-muted); font-weight:400; font-size:10px;">${isFr ? '· exploitant' : '· operator'}</span></a>`;
    }

    // ---- Avitaillement carburant (France) ----
    if (sia?.horAvt) {
        html += sectionTitle('fuel', isFr ? 'Avitaillement' : 'Fuel');
        html += `<div style="padding:6px 10px; border-left:3px solid rgba(148,163,184,0.3); border-radius:6px; font-size:11px; color:var(--text-muted); line-height:1.5;">${sia.horAvt.map(l => escapeHtml(l)).join('<br>')}</div>`;
    }

    // Lien vers le portail AIP officiel du pays (eAIP).
    if (vac) {
        html += `<a href="${escapeHtml(vac.url)}" target="_blank" rel="noopener noreferrer"
            style="display:flex; align-items:center; gap:8px; margin-top:10px; padding:8px 12px; background:rgba(56,189,248,0.08); border:1px solid rgba(56,189,248,0.25); border-radius:6px; text-decoration:none; color:var(--primary); font-size:12px; font-weight:600; transition:background 0.15s;"
            onmouseover="this.style.background='rgba(56,189,248,0.15)'"
            onmouseout="this.style.background='rgba(56,189,248,0.08)'">
            <i data-lucide="map" style="width:14px;height:14px;"></i>
            <span>${escapeHtml(isFr ? vac.labelFr : vac.labelEn)}</span>
            ${vac.country ? `<span style="margin-left:auto; font-size:9px; color:var(--text-muted); font-weight:500;">${escapeHtml(vac.country)}</span>` : ''}
            <i data-lucide="external-link" style="width:11px;height:11px;color:var(--text-muted);"></i>
        </a>`;
    }

    html += `<div style="font-size:10px; color:var(--text-muted); margin-top:8px;">
        <i data-lucide="info" style="width:11px;height:11px;vertical-align:middle;"></i>
        ${sourceNote(source, !!sia, isFr)}
    </div>`;

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
