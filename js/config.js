/* ================================================================
 * CONFIG — configuration publique de l'application (aucun secret).
 * ================================================================
 *
 * Valeurs PAR DÉFAUT vides : sans surcharge, la météo est servie en
 * DIRECT depuis aviationweather.gov (API ouverte CORS) et openAIP
 * n'est interrogé qu'avec les fichiers statiques locaux en repli.
 *
 * La surcharge locale — js/config.local.js, GITIGNORÉE car elle porte
 * l'URL du relais Apps Script privé (quota) et la clé openAIP — est
 * appliquée au démarrage par applyLocalOverride() (app.js). Présente
 * en développement et sur le FTP Free.fr, elle est absente du miroir
 * public GitHub Pages : l'application y fonctionne sur les défauts.
 * ================================================================ */

export const config = {
    PROXY_URL: '',
    OPENAIP_API_KEY: '',
    // Clé corsproxy.io — repli météo du miroir public quand aviationweather.gov
    // bloque CORS (fréquent : leurs backends n'envoient pas toujours ACAO).
    CORS_PROXY_KEY: '',
};

/** Applique js/config.local.js si présent (silencieux sinon). */
export async function applyLocalOverride() {
    try {
        const m = await import('./config.local.js');
        if (m.PROXY_URL) config.PROXY_URL = m.PROXY_URL;
        if (m.OPENAIP_API_KEY) config.OPENAIP_API_KEY = m.OPENAIP_API_KEY;
        if (m.CORS_PROXY_KEY) config.CORS_PROXY_KEY = m.CORS_PROXY_KEY;
    } catch { /* absent (miroir public) : on garde les défauts */ }
}
