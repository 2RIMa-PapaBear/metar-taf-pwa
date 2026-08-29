/* ================================================================
 * FREQUENCIES UI — Affichage des fréquences radio du terrain
 * ================================================================
 *
 * Affiche les fréquences radio (Tour, Sol, ATIS, Approche...) du
 * terrain courant, issues d'OpenAIP. Le widget s'affiche sous le
 * widget performance décollage.
 *
 * Les fréquences sont disponibles après enrichissement OpenAIP. Si
 * l'enrichissement n'a pas eu lieu (offline, API HS), le widget reste
 * masqué.
 * ================================================================ */

import { state, escapeHtml } from './core.js';
import { getAirportByICAO } from './ui-module.js';
import { fetchAtis, getVacLink } from './atc-info.js';
import { makeCollapsible } from './collapsible.js';
import { loadFreqSources, getAirportFreqs, getSiaAirac } from './freq-sia.js';

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
    await loadFreqSources();
    const { source, freqs } = getAirportFreqs(icao, apt?.frequencies);
    const hasFreqs = freqs.length > 0;

    // Lien VAC officiel (peut être null si le pays n'est pas reconnu).
    const vac = getVacLink(icao);

    if (!hasFreqs && !vac) {
        // Ni fréquences, ni VAC → on masque.
        container.style.display = 'none';
        return;
    }

    const isFr = state.lang === 'fr';
    // Prépare le panel repliable et rend dans le body.
    const body = makeCollapsible(container, isFr ? 'Fréquences & info terrain' : 'Frequencies & airfield info', 'radio-tower');

    // Affiche immédiatement les fréquences + VAC, puis complète l'ATIS
    // en arrière-plan (non bloquant).
    render(body, freqs, source, vac, null, isFr);
    container.style.display = 'block';

    // Récupère l'ATIS en arrière-plan.
    const atis = await fetchAtis(icao);
    if (atis) {
        render(body, freqs, source, vac, atis, isFr);
    }
}

/**
 * Génère le HTML du widget (fréquences + ATIS + lien VAC).
 */
function render(container, freqs, source, vac, atis, isFr) {
    // Sépare les fréquences principales des secondaires.
    const primary = freqs.filter(f => f.primary);
    const others = freqs.filter(f => !f.primary);

    // Construit les lignes de fréquences.
    const freqRow = (f) => {
        const isPrimary = f.primary;
        const freqStr = f.freq.toFixed(3);
        return `<div style="display:flex; align-items:center; gap:10px; padding:6px 12px; background:${isPrimary ? 'rgba(56,189,248,0.08)' : 'rgba(255,255,255,0.03)'}; border-radius:6px; border-left:3px solid ${isPrimary ? '#38BDF8' : 'rgba(148,163,184,0.3)'};">
            <span style="font-family:'DM Mono',monospace; font-size:16px; font-weight:500; color:${isPrimary ? '#38BDF8' : 'var(--text-color)'}; min-width:78px;">${freqStr}</span>
            <span style="font-size:9px; background:rgba(255,255,255,0.08); color:var(--text-muted); padding:2px 6px; border-radius:3px; font-weight:700; letter-spacing:0.5px; min-width:38px; text-align:center;">${escapeHtml(f.type)}</span>
            <span style="font-size:11px; color:var(--text-muted); flex:1;">${escapeHtml(f.name || '')}</span>
        </div>`;
    };

    let html = `<div class="dash-title" style="margin-bottom:10px;">
        <i data-lucide="radio-tower" class="icon-sm"></i>
        <span>${isFr ? 'Fréquences & info terrain' : 'Frequencies & airfield info'}</span>
    </div>`;

    // ATIS (si disponible).
    if (atis?.raw) {
        html += `<div style="margin-bottom:8px; padding:8px 10px; background:rgba(45,212,191,0.08); border:1px solid rgba(45,212,191,0.25); border-radius:6px;">
            <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
                <i data-lucide="radio" style="width:13px;height:13px;color:#2DD4BF;"></i>
                <span style="font-size:10px; text-transform:uppercase; letter-spacing:1px; font-weight:700; color:#2DD4BF;">ATIS</span>
            </div>
            <div style="font-family:'DM Mono',monospace; font-size:11px; color:var(--text-color); line-height:1.5; max-height:120px; overflow-y:auto; white-space:pre-wrap;">${escapeHtml(atis.raw)}</div>
        </div>`;
    }

    // Fréquences principales (Tour) en premier si elles existent.
    if (primary.length > 0) {
        html += `<div style="display:flex; flex-direction:column; gap:5px; margin-bottom:${others.length > 0 ? '8px' : '0'};">`;
        primary.forEach(f => { html += freqRow(f); });
        html += `</div>`;
    }

    // Autres fréquences.
    if (others.length > 0) {
        html += `<div style="display:flex; flex-direction:column; gap:5px;">`;
        others.forEach(f => { html += freqRow(f); });
        html += `</div>`;
    }

    // Lien vers le portail AIP officiel du pays (eAIP).
    if (vac) {
        html += `<a href="${escapeHtml(vac.url)}" target="_blank" rel="noopener noreferrer"
            style="display:flex; align-items:center; gap:8px; margin-top:8px; padding:8px 12px; background:rgba(56,189,248,0.08); border:1px solid rgba(56,189,248,0.25); border-radius:6px; text-decoration:none; color:var(--primary); font-size:12px; font-weight:600; transition:background 0.15s;"
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
        ${sourceNote(source, isFr)}
    </div>`;

    container.innerHTML = html;
    if (window.lucide) window.lucide.createIcons({ root: container });
}

/** Mention de source du pied de page (SIA officiel / corrections / openAIP). */
function sourceNote(source, isFr) {
    if (source === 'sia') {
        const airac = getSiaAirac();
        return isFr
            ? `Fréquences : SIA · eAIP France${airac ? ' (AIRAC ' + airac + ')' : ''} · ATIS : AviationWeather`
            : `Frequencies: SIA French AIP${airac ? ' (AIRAC ' + airac + ')' : ''} · ATIS: AviationWeather`;
    }
    if (source === 'overrides') {
        return isFr ? 'Fréquences : corrections manuelles' : 'Frequencies: manual corrections';
    }
    return isFr ? 'Fréquences : OpenAIP · ATIS : AviationWeather' : 'Frequencies: OpenAIP · ATIS: AviationWeather';
}
