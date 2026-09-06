/* NOTE 04/09/2026 : fetchAtis SUPPRIMÉ sur demande pilote — l'endpoint
 * /api/data/atis d'AviationWeather.gov a été retiré lors de leur refonte
 * API (septembre 2025, 404 permanent) : chaque chargement de terrain
 * partait une requête vouée à l'échec. Le widget fréquences fonctionne
 * sans (fréquences SIA/OpenAIP). Ne pas ré-introduire sans vérifier que
 * l'endpoint est réapparu. */

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
