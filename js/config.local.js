/* ================================================================
 * CONFIG LOCALE — À NE PAS COMMITTER (déjà dans .gitignore)
 * ================================================================
 * Ce fichier centralise les URLs/secrets qui ne doivent pas être
 * mélangés avec le code applicatif.
 *
 * En production : uploadez ce fichier sur le FTP Free.fr à côté des
 * autres fichiers JS. S'il est absent, l'app affichera une erreur
 * claire au lieu de planter silencieusement.
 * ================================================================ */

// URL du proxy Google Apps Script (relai CORS pour aviationweather.gov).
export const PROXY_URL = 'https://script.google.com/macros/s/AKfycby7fXRbE2jE0-X6UCruvck-Q899PJ2X_USuGuno7I82AtM3icPivRbphzakNolu19SNrw/exec';

// Clé API OpenAIP (https://account.openaip.net/).
// Saisissez votre clé ci-dessous. Elle est visible côté navigateur (inévitable
// pour du 100% statique) mais isolée du code applicatif.
export const OPENAIP_API_KEY = 'c1493c21e8b05551258b0cb21b36e9fd';

// Clé corsproxy.io (miroir public GitHub Pages) : la météo du miroir passe
// par ce proxy quand aviationweather.gov bloque CORS. Embarquée côté
// navigateur, donc publique dans le miroir — plafond gratuit 10k req/mois.
export const CORS_PROXY_KEY = 'fc84d9df';
