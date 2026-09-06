/* ================================================================
 * FRÉQUENCES + INFO TERRAIN — deux onglets séparés (demande pilote
 * 06/09) :
 *   #frequencies-widget « Fréquences » : fréquences radio (avec
 *     observations officielles eAIP et codes d'horaires) ;
 *   #airfield-widget « Info terrain » : identité, pistes, HORAIRES DU
 *     SERVICE et AVITAILLEMENT en sous-sections REPLIABLES, carte VAC
 *     « Atterrissage à vue » en dernière ligne.
 *
 * Sources : corrections manuelles > eAIP/XML SIA > openAIP (fréquences),
 * base SIA (identité/pistes/horaires/avitaillement), base embarquée
 * 17 000 terrains (monde), Atlas-VAC (cartes). Chaque section est omise
 * silencieusement quand la donnée n'existe pas.
 * ================================================================ */

import { state, escapeHtml } from './core.js';
import { getAirportByICAO, initAirportsDB } from './ui-module.js';
import { getVacLink } from './atc-info.js';
import { makeCollapsible } from './collapsible.js';
import { loadFreqSources, getAirportFreqs, getSiaAirac } from './freq-sia.js';
import { loadSiaAux, getSiaAirfield, getSiaRunways, getSiaAuxAirac } from './sia-data.js';
import { hasVac, openVac } from './vac-viewer.js';
import { getDeclinationForIcao } from './magvar.js';

/**
 * Affiche/masque les onglets du terrain courant.
 * @param {string|null} icao Code OACI (null = tout masquer).
 */
export async function showFrequenciesWidget(icao) {
    const freqContainer = document.getElementById('frequencies-widget');
    const terrainContainer = document.getElementById('airfield-widget');
    if (!freqContainer || !terrainContainer) return;

    if (!icao) {
        freqContainer.style.display = 'none';
        terrainContainer.style.display = 'none';
        return;
    }

    // Les pistes/terrains officiels France et la base embarquée (17 000
    // terrains, pays/élévation/pistes hors France) participent au rendu :
    // on les attend, sinon l'onglet terrain s'afficherait amputé — et apt
    // n'est capturé qu'APRÈS cette attente (course vue en QA EGHH).
    const [, aux] = await Promise.all([
        loadFreqSources(),
        loadSiaAux().catch(() => null),
        initAirportsDB().catch(() => {}),
    ]);
    const apt = getAirportByICAO(icao);
    const { source, freqs } = getAirportFreqs(icao, apt?.frequencies);
    const sia = aux ? getSiaAirfield(icao) : null;
    const vac = getVacLink(icao);

    const ident = identityRows(icao, apt, sia, state.lang === 'fr');
    const runways = runwayRows(icao, apt, sia);
    const avecCarte = await hasVac(icao).catch(() => false);

    // ---- Onglet 1 : FRÉQUENCES ----
    if (freqs.length) {
        const isFr = state.lang === 'fr';
        const body = makeCollapsible(freqContainer, isFr ? 'Fréquences' : 'Frequencies', 'radio-tower');
        renderFrequencies(body, freqs, source, isFr);
        freqContainer.style.display = 'block';
    } else {
        freqContainer.style.display = 'none';
    }

    // ---- Onglet 2 : INFO TERRAIN ----
    const hasTerrain = ident.length || runways.length || sia?.horAts || sia?.tel || sia?.horAvt || avecCarte || !!vac;
    if (hasTerrain) {
        const isFr = state.lang === 'fr';
        const body = makeCollapsible(terrainContainer, isFr ? 'Info terrain' : 'Airfield info', 'id-card');
        renderTerrain(body, { icao, ident, runways, sia, vac, isFr, avecCarte });
        terrainContainer.style.display = 'block';
    } else {
        terrainContainer.style.display = 'none';
    }
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

// ---- Onglet 1 : FRÉQUENCES ---------------------------------------------------

function renderFrequencies(container, freqs, source, isFr) {
    // Codes d'horaires des organismes (eAIP AD 2.18) — info-bulle du badge.
    const HOR_CODES = {
        H24: isFr ? 'Service permanent 24 h/24' : 'Continuous service',
        HO: isFr ? 'Service sur demande (hors horaires publiés)' : 'Service on request',
        HX: isFr ? 'Horaires variables (consulter le complément AIP)' : 'Variable hours',
        HJ: isFr ? 'Du lever au coucher du soleil' : 'Sunrise to sunset',
        HN: isFr ? 'Du coucher au lever du soleil' : 'Sunset to sunrise',
    };

    // Ligne de fréquence : observation officielle eAIP (secteurs,
    // fréquence supplétive…) en 2ᵉ ligne, texte complet au survol.
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

    const primary = freqs.filter(f => f.primary);
    const others = freqs.filter(f => !f.primary);

    let html = `<div class="dash-title" style="margin-bottom:10px;">
        <i data-lucide="radio-tower" class="icon-sm"></i>
        <span>${isFr ? 'Fréquences' : 'Frequencies'}</span>
    </div>
    <div style="display:flex; flex-direction:column; gap:5px;">`;
    primary.forEach(f => { html += freqRow(f); });
    others.forEach(f => { html += freqRow(f); });
    html += `</div>`;

    html += `<div style="font-size:10.5px; color:var(--text-muted); margin-top:8px;">
        <i data-lucide="info" style="width:11px;height:11px;vertical-align:middle;"></i>
        ${freqSourceNote(source, isFr)}
    </div>`;

    container.innerHTML = html;
    if (window.lucide) window.lucide.createIcons({ root: container });
}

/** Mention de source des fréquences (pied de l'onglet). */
function freqSourceNote(source, isFr) {
    const airac = getSiaAirac();
    if (source === 'overrides') return isFr ? 'Fréquences : corrections manuelles' : 'Frequencies: manual corrections';
    if (source === 'sia') {
        return isFr
            ? `Fréquences : SIA · eAIP France${airac ? ' (AIRAC ' + airac + ')' : ''}`
            : `Frequencies: SIA French AIP${airac ? ' (AIRAC ' + airac + ')' : ''}`;
    }
    return isFr ? 'Fréquences : OpenAIP' : 'Frequencies: OpenAIP';
}

// ---- Onglet 2 : INFO TERRAIN ---------------------------------------------------

/** Sous-section repliable (horaires, avitaillement) — repliée par défaut. */
function subsection(icon, label, innerHtml, isFr) {
    return `<div class="card-ss">
        <button type="button" class="ss-head" title="${isFr ? 'Afficher/masquer' : 'Toggle'}">
            <i data-lucide="${icon}" style="width:12px;height:12px;"></i>
            <span style="flex:1;text-align:left;">${escapeHtml(label)}</span>
            <i data-lucide="chevron-down" class="ss-chev" style="width:13px;height:13px;transition:transform .15s;"></i>
        </button>
        <div class="ss-body">${innerHtml}</div>
    </div>`;
}

function renderTerrain(container, { icao, ident, runways, sia, vac, isFr, avecCarte }) {
    let html = `<div class="dash-title" style="margin-bottom:10px;">
        <i data-lucide="id-card" class="icon-sm"></i>
        <span>${isFr ? 'Info terrain' : 'Airfield info'}</span>
    </div>`;

    // Identité « Libellé : valeur », à la suite des deux-points (retour pilote).
    if (ident.length) {
        html += `<div style="display:flex; flex-direction:column; gap:2px;">` + ident.map(r =>
            `<div style="display:flex; align-items:baseline; flex-wrap:wrap; gap:4px 7px; padding:3px 0; font-size:12px;">
                <span style="color:var(--text-muted); white-space:nowrap;">${escapeHtml(r.l)} :</span>
                <span style="color:var(--text-color); font-weight:500;${r.mono ? " font-family:'DM Mono',monospace; font-size:13px;" : ''}">${escapeHtml(r.v)}</span>
            </div>`
        ).join('') + `</div>`;
    }

    // Pistes en clair (seuils officiels affichés).
    if (runways.length) {
        html += `<div style="display:flex; flex-direction:column; gap:4px; margin-top:6px;">`;
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

    // HORAIRES DU SERVICE + exploitant : sous-section REPLIABLE.
    if (sia?.horAts || sia?.tel) {
        let inner = '';
        if (sia?.horAtsCode) inner += `<span style="display:inline-block; font-size:10px; background:rgba(56,189,248,0.15); color:#38BDF8; padding:2px 7px; border-radius:3px; font-weight:700; font-family:'DM Mono',monospace;">${escapeHtml(sia.horAtsCode)}</span>`;
        if (sia?.horAts) inner += `<div style="${sia.horAtsCode ? 'margin-top:5px;' : ''}padding:7px 11px; border-left:3px solid rgba(148,163,184,0.3); border-radius:6px; font-size:12px; color:var(--text-muted); line-height:1.55;">${sia.horAts.map(l => escapeHtml(l)).join('<br>')}</div>`;
        if (sia?.tel) inner += `<a href="tel:${escapeHtml(sia.tel.replace(/\s/g, ''))}" style="display:flex; align-items:center; gap:7px; margin-top:6px; color:var(--primary); font-size:12.5px; font-weight:600; text-decoration:none;">
            <i data-lucide="phone" style="width:13px;height:13px;"></i>
            <span style="font-family:'DM Mono',monospace; font-size:13.5px;">${escapeHtml(sia.tel)}</span>
            <span style="color:var(--text-muted); font-weight:400; font-size:11px;">${isFr ? '· exploitant' : '· operator'}</span></a>`;
        html += subsection('clock', isFr ? 'Horaires du service' : 'Service hours', inner, isFr);
    }

    // AVITAILLEMENT : sous-section REPLIABLE.
    if (sia?.horAvt) {
        const inner = `<div style="padding:7px 11px; border-left:3px solid rgba(148,163,184,0.3); border-radius:6px; font-size:12px; color:var(--text-muted); line-height:1.55;">${sia.horAvt.map(l => escapeHtml(l)).join('<br>')}</div>`;
        html += subsection('fuel', isFr ? 'Avitaillement' : 'Fuel', inner, isFr);
    }

    // DERNIÈRE LIGNE : carte VAC « Atterrissage à vue » (Atlas-VAC) ou portail.
    if (avecCarte) {
        html += `<button data-vac-open="${escapeHtml(icao)}"
            style="display:flex; align-items:center; gap:8px; margin-top:10px; width:100%; padding:9px 12px; background:rgba(56,189,248,0.08); border:1px solid rgba(56,189,248,0.25); border-radius:6px; color:var(--primary); font-size:12.5px; font-weight:600; cursor:pointer; transition:background 0.15s;"
            onmouseover="this.style.background='rgba(56,189,248,0.15)'"
            onmouseout="this.style.background='rgba(56,189,248,0.08)'">
            <i data-lucide="map" style="width:14px;height:14px;"></i>
            <span>${isFr ? 'Carte VAC · Atterrissage à vue' : 'VAC · Visual approach'}</span>
            <span style="margin-left:auto; font-size:10px; color:var(--text-muted); font-weight:500;">${isFr ? 'lisible hors ligne' : 'works offline'}</span>
        </button>`;
    } else if (vac) {
        html += `<a href="${escapeHtml(vac.url)}" target="_blank" rel="noopener noreferrer"
            style="display:flex; align-items:center; gap:8px; margin-top:10px; padding:9px 12px; background:rgba(56,189,248,0.08); border:1px solid rgba(56,189,248,0.25); border-radius:6px; text-decoration:none; color:var(--primary); font-size:12.5px; font-weight:600; transition:background 0.15s;"
            onmouseover="this.style.background='rgba(56,189,248,0.15)'"
            onmouseout="this.style.background='rgba(56,189,248,0.08)'">
            <i data-lucide="map" style="width:14px;height:14px;"></i>
            <span>${escapeHtml(isFr ? vac.labelFr : vac.labelEn)}</span>
            ${vac.country ? `<span style="margin-left:auto; font-size:10px; color:var(--text-muted); font-weight:500;">${escapeHtml(vac.country)}</span>` : ''}
            <i data-lucide="external-link" style="width:11px;height:11px;color:var(--text-muted);"></i>
        </a>`;
    }

    // Note de source des infos terrain.
    html += `<div style="font-size:10.5px; color:var(--text-muted); margin-top:8px;">
        <i data-lucide="info" style="width:11px;height:11px;vertical-align:middle;"></i>
        ${terrainSourceNote(!!sia, isFr)}
    </div>`;

    container.innerHTML = html;
    if (window.lucide) window.lucide.createIcons({ root: container });

    // Sous-sections repliables (horaires, avitaillement).
    container.querySelectorAll('.ss-head').forEach(h => {
        h.addEventListener('click', () => h.parentElement.classList.toggle('open'));
    });

    container.querySelector('[data-vac-open]')?.addEventListener('click', function () {
        this.disabled = true;
        openVac(this.dataset.vacOpen).finally(() => { this.disabled = false; });
    });
}

/** Mention de source des infos terrain. Les cycles peuvent différer :
 * XML (rubriques AD) et eAIP — chacun cite SON AIRAC. */
function terrainSourceNote(hasSia, isFr) {
    const auxAirac = getSiaAuxAirac();
    return hasSia
        ? (isFr ? `infos terrain : SIA${auxAirac ? ' (AIRAC ' + auxAirac + ')' : ''}` : `field info: SIA${auxAirac ? ' (AIRAC ' + auxAirac + ')' : ''}`)
        : (isFr ? 'infos terrain : base embarquée' : 'field info: embedded database');
}
