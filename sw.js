/* ================================================================
 * SERVICE WORKER — PWA shell hors-ligne (mt-shell-v1)
 * ================================================================
 *
 * PHILOSOPHIE / SÉCURITÉ PILOTE
 * ------------------------------
 * Ce Service Worker met en cache le SHELL applicatif (HTML, CSS, JS,
 * icônes, polices, airports.json) afin que le site démarre vite et
 * fonctionne hors-ligne. Il NE MET JAMAIS EN CACHE les données météo
 * (METAR/TAF, stationinfo, géocodage, météo temps réel) : un pilote
 * ne doit jamais voir s'afficher une prévision périmée. Les hôtes de
 * données sont explicitement court-circuités (network-only).
 *
 * BUMP DE VERSION
 * ---------------
 * Quand le shell change (CSS/JS modifiés), bump mt-shell-v1 → v2 :
 * l'activation supprimera l'ancien cache. Les navigations repassent
 * en network-first pour récupérer le nouveau index.html.
 * ================================================================ */

const CACHE = 'mt-shell-v226';

// Hôtes de DONNÉES : jamais mis en cache (sécurité pilote).
const NO_CACHE_HOSTS = [
    'aviationweather.gov',
    'api.open-meteo.com',
    'nominatim.openstreetmap.org',
    'script.google.com',          // proxy Apps Script (relai CORS météo)
];

// Ressources stables préchargées à l'installation. On se limite aux
// fichiers à URL fixe (les CSS/JS versionnés ?v= sont mis en cache à
// la volée par SWR lors de la première visite en ligne, ce qui évite
// de devoir mettre à jour cette liste à chaque release).
const PRECACHE = [
    './',
    'index.html',
    'notice-fr.html',
    'notice-en.html',
    'favicon.ico',
    'icon.svg',
    'manifest.webmanifest',
    // Modules JS critiques (sans ?v= — le PRECACHE est invalidé à chaque CACHE bump).
    'js/app.js',
    'js/core.js',
    'js/regional-map.js',
    'js/ui-module.js',
    'css/style.css',
];

// ----------------------------------------------------------------
// Installation : précache du shell minimal.
// ----------------------------------------------------------------
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE)
            .then((cache) => cache.addAll(PRECACHE).catch(() => {}))
            // skipWaiting : le nouveau SW prend le relais sans attendre
            // la fermeture des onglets existants (adéquat pour un shell).
            .then(() => self.skipWaiting()),
    );
});

// ----------------------------------------------------------------
// Activation : nettoyage des anciens caches + prise de contrôle.
// ----------------------------------------------------------------
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
            ))
            .then(() => self.clients.claim()),
    );
});

// ----------------------------------------------------------------
// Aide : une URL est-elle une donnée météo (à ne jamais cacher) ?
// ----------------------------------------------------------------
function isWeatherData(url) {
    const host = url.hostname;
    return NO_CACHE_HOSTS.some((h) => host === h || host.endsWith('.' + h));
}

// ----------------------------------------------------------------
// Stratégie : Stale-While-Revalidate.
// Sert le cache immédiatement s'il existe, puis rafraîchit en arrière.
// ----------------------------------------------------------------
async function staleWhileRevalidate(request) {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    const network = fetch(request).then((response) => {
        // On ne met en cache que les réponses valides. Les réponses
        // opaques (cross-origin no-cors) ont status 0 : on les accepte.
        if (response && (response.ok || response.status === 0 || response.type === 'opaque')) {
            cache.put(request, response.clone()).catch(() => {});
        }
        return response;
    }).catch(() => cached); // réseau mort → on retombe sur le cache.
    return cached || network;
}

// ----------------------------------------------------------------
// Stratégie : Network-first (navigations HTML).
// Sert le réseau quand disponible (toujours le HTML à jour), sinon
// le cache (mode hors-ligne).
// ----------------------------------------------------------------
async function networkFirst(request) {
    const cache = await caches.open(CACHE);
    try {
        const response = await fetch(request);
        if (response && response.ok) {
            cache.put(request, response.clone()).catch(() => {});
        }
        return response;
    } catch {
        // Hors-ligne : on retombe sur le cache de la navigation demandée,
        // puis sur la racine en dernier recours.
        return (await cache.match(request)) || (await cache.match('./')) || Response.error();
    }
}

// ----------------------------------------------------------------
// Routage des requêtes.
// ----------------------------------------------------------------
self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);

    // 1) Données météo / géocodage : network-only, JAMAIS de cache.
    //    (Sécurité pilote — une donnée périmée serait dangereuse.)
    if (isWeatherData(url)) return;

    // 2) Navigations (pages HTML) : network-first.
    if (req.mode === 'navigate') {
        event.respondWith(networkFirst(req));
        return;
    }

    // 3) Tout le reste du shell (CSS, JS, vendor, airports.json,
    //    icônes, polices Google, suncalc CDN) : network-first pour garantir
    //    la fraîcheur du code (les modules ES n'ont pas de ?v= dans les imports).
    //    On n'intercepte que GET (les POST/PUT ne se cachent pas).
    if (req.method === 'GET') {
        event.respondWith(networkFirst(req));
    }
});
