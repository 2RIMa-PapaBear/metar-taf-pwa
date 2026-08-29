import { fetchAvecRelais } from './core.js';

const _cache = new Map();
const TTL_MS = 30 * 60 * 1000;

export async function fetchAtis(icao) {
    if (!icao) return null;
    const key = icao.toUpperCase();

    const cached = _cache.get(key);
    if (cached && Date.now() - cached.ts < TTL_MS) return cached.data;

    // NOTE : l'endpoint /api/data/atis d'AviationWeather.gov a été supprimé lors de la
    // refonte de l'API (septembre 2025). Il retourne désormais 404 "Not found".
    // On tente quand même (au cas où il réapparaisse), mais tout échec est silencieux :
    // le widget fréquences fonctionne sans ATIS (fréquences OpenAIP).
    try {
        const url = `https://aviationweather.gov/api/data/atis?station=${encodeURIComponent(key)}&format=json`;
        const data = await fetchAvecRelais(url, 'json');

        const item = Array.isArray(data) ? data[0] : data;
        if (!item) return null;

        const raw = item.rawOb || item.rawText || item.datis || '';
        if (!raw) return null;

        const result = { raw, icao: key };
        _cache.set(key, { data: result, ts: Date.now() });
        return result;
    } catch {
        // Silencieux : endpoint déprécié côté AviationWeather. Pas de warn bruyant.
        return null;
    }
}

const VAC_PROVIDERS = [
    {

        match: /^LF[A-Z]{2}$/,
        country: 'France',
        url: () => 'https://www.sia.aviation-civile.gouv.fr/vaip',
        label: { fr: 'eAIP officiel (SIA)', en: 'Official eAIP (SIA)' },
    },
    {

        match: /^EG[A-Z]{2}$/,
        country: 'United Kingdom',
        url: () => 'https://nats-uk.ead-it.com/cms-nats/opencms/en/Publications/AIP/',
        label: { fr: 'eAIP (NATS)', en: 'eAIP (NATS)' },
    },
    {

        match: /^K?[A-Z]{3,4}$/,
        country: 'USA',
        url: () => 'https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/vfr/',
        label: { fr: 'VFR Charts (FAA)', en: 'VFR Charts (FAA)' },
    },
    {

        match: /^ED[A-Z]{2}$/,
        country: 'Germany',
        url: () => 'https://www.dfs.de/homepage/de/flugsicherung/aeronautical-information-service/aip-vfr/',
        label: { fr: 'AIP VFR (DFS)', en: 'AIP VFR (DFS)' },
    },
    {

        match: /^LE[A-Z]{2}$/,
        country: 'Spain',
        url: () => 'https://www.enaire.es/servicios-a-la-navegacion-aerea/servicios-informacion-aeronautica',
        label: { fr: 'eAIP (ENAIRE)', en: 'eAIP (ENAIRE)' },
    },
    {

        match: /^LI[A-Z]{2}$/,
        country: 'Italy',
        url: () => 'https://www.enav.it/',
        label: { fr: 'eAIP (ENAV)', en: 'eAIP (ENAV)' },
    },
    {

        match: /^LS[A-Z]{2}$/,
        country: 'Switzerland',
        url: () => 'https://www.skyguide.ch/',
        label: { fr: 'eAIP (Skyguide)', en: 'eAIP (Skyguide)' },
    },
    {

        match: /^EB[A-Z]{2}$/,
        country: 'Belgium',
        url: () => 'https://ops.skeyes.be/',
        label: { fr: 'eAIP (skeyes)', en: 'eAIP (skeyes)' },
    },
];

export function getVacLink(icao) {
    const code = (icao || '').toUpperCase();
    for (const p of VAC_PROVIDERS) {
        if (p.match.test(code)) {
            return {
                url: p.url(code),
                labelFr: p.label.fr,
                labelEn: p.label.en,
                country: p.country,
            };
        }
    }
    return null;
}

export function _clearCache() { _cache.clear(); }
