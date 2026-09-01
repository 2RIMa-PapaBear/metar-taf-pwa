/* ================================================================
 * FLIGHT PLAN IO — Sauvegarde / import du plan de vol
 * ================================================================
 * Bouton « dossier » de la barre Départ → Destination :
 *   💾 Sauvegarder (JSON natif, 100 % fidèle : repères nommés,
 *      altitude, TAS, conso, vol de nuit)
 *   ⤓ Exporter GPX (standard GPS universel)
 *   ⤓ Exporter KML (Google Earth)
 *   📂 Importer un plan (.json / .gpx / .kml)
 *
 * Dossier de sauvegarde : choisi à la PREMIÈRE sauvegarde
 * (showDirectoryPicker, Chromium/Edge) puis mémorisé en IndexedDB —
 * les handles FileSystem y survivent (structured clone). Repli :
 * téléchargement classique si l'API est absente ou le dossier perdu.
 *
 * L'import restitue le plan par ÉVÉNEMENTS (aucun import cyclique) :
 * chargement du départ (recherche principale), destination (champ),
 * repères libres ('restore-free-waypoint' → regional-map), puis la
 * liste des étapes posée EN BLOC dans le champ Waypoints (l'ordre du
 * fichier prime sur l'insertion intelligente).
 * ================================================================ */

import { state, memoGet } from './core.js';
import { getAirportByICAO } from './ui-module.js';
import { parseWaypointsField, formatWaypointsField } from './flight-planner-ui.js';

const DB_NAME = 'mt-plan-io';
const DIR_STORE = 'handles';

// ---------- Lecture du plan courant ----------

// Instantané du plan affiché : départ, destination, étapes (codes OACI ou
// repères libres avec nom + coordonnées) et réglages de calcul.
export function readCurrentPlan() {
    const toInput = document.getElementById('route-to-input');
    const dest = (toInput?.value || '').trim().toUpperCase();
    const dep = (state.requestedIcao || '').toUpperCase();
    const wps = [];
    const wpInput = document.getElementById('fp-waypoints');
    // Le champ affiche les VRAIS noms des repères libres : le parse partagé
    // restitue les codes (OACI ou ZZxx) du plan.
    const codes = wpInput ? parseWaypointsField(wpInput.value) : [];
    for (const code of codes) {
        const apt = getAirportByICAO(code);
        if (/^ZZ[A-Z]{2}$/.test(code) && apt?.lat != null) {
            // Repère libre : conserve nom + position pour une restitution fidèle.
            wps.push({ name: apt.name || code, lat: apt.lat, lon: apt.lon });
        } else {
            wps.push(code);
        }
    }
    const alt = document.getElementById('fp-cruise-alt')?.value;
    const tas = document.getElementById('fp-tas')?.value;
    const burn = document.getElementById('fp-burn')?.value;
    const night = document.getElementById('fp-night')?.checked;
    return {
        app: 'metar-taf-visualiseur', version: 1,
        dep, dest, wps,
        cruiseAltFt: alt ? parseInt(alt, 10) : null,
        tasKt: tas ? parseInt(tas, 10) : null,
        burnLph: burn ? parseInt(burn, 10) : null,
        night: night === true,
    };
}

// ---------- JSON natif ----------

export function buildPlanJson(plan) {
    return JSON.stringify(plan, null, 2);
}

export function parsePlanJson(text) {
    const p = JSON.parse(text);
    if (p.app !== 'metar-taf-visualiseur' || !p.dep || !p.dest) return null;
    return p;
}

// Décode les entités XML des noms relus (&amp; &lt; &gt; &quot; &apos;).
function _xmlDecode(s) {
    return String(s)
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

// ---------- GPX ----------

export function buildGpx(plan) {
    const pts = planPoints(plan);
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const rtepts = pts.map(p => `    <rtept lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><name>${esc(p.name)}</name></rtept>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="metar-taf-visualiseur" xmlns="http://www.topografix.com/GPX/1/1">
  <rte>
    <name>${esc(plan.dep)}-${esc(plan.dest)}</name>
${rtepts}
  </rte>
</gpx>`;
}

// Parse un GPX : rte>rtept prioritaire, sinon liste de wpt.
export function parseGpx(text) {
    const pts = [];
    const rte = /<rtept[^>]*lat="([-\d.]+)"[^>]*lon="([-\d.]+)"[^>]*>(?:[\s\S]*?<name>([^<]*)<\/name>)?[\s\S]*?<\/rtept>/g;
    let m;
    while ((m = rte.exec(text)) !== null) {
        pts.push({ lat: parseFloat(m[1]), lon: parseFloat(m[2]), name: _xmlDecode((m[3] || '')).trim() });
    }
    if (pts.length) return pts;
    const wpt = /<wpt[^>]*lat="([-\d.]+)"[^>]*lon="([-\d.]+)"[^>]*>(?:[\s\S]*?<name>([^<]*)<\/name>)?[\s\S]*?<\/wpt>/g;
    while ((m = wpt.exec(text)) !== null) {
        pts.push({ lat: parseFloat(m[1]), lon: parseFloat(m[2]), name: _xmlDecode((m[3] || '')).trim() });
    }
    return pts;
}

// ---------- KML ----------

export function buildKml(plan) {
    const pts = planPoints(plan);
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const marks = pts.map(p =>
        `    <Placemark><name>${esc(p.name)}</name><Point><coordinates>${p.lon.toFixed(6)},${p.lat.toFixed(6)},0</coordinates></Point></Placemark>`
    ).join('\n');
    const line = pts.map(p => `${p.lon.toFixed(6)},${p.lat.toFixed(6)},0`).join(' ');
    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${esc(plan.dep)}-${esc(plan.dest)}</name>
${marks}
    <Placemark><name>Route</name><LineString><coordinates>${line}</coordinates></LineString></Placemark>
  </Document>
</kml>`;
}

// Parse un KML : Placemark>Point>coordinates (« lon,lat[,alt] »).
export function parseKml(text) {
    const pts = [];
    const pm = /<Placemark>([\s\S]*?)<\/Placemark>/g;
    let m;
    while ((m = pm.exec(text)) !== null) {
        const block = m[1];
        const nm = block.match(/<name>([^<]*)<\/name>/);
        const co = block.match(/<coordinates>([^<]*)<\/coordinates>/);
        if (!co) continue;
        const xyz = co[1].trim().split(/[\s,]+/).map(Number);
        if (!isFinite(xyz[0]) || !isFinite(xyz[1])) continue;
        // Une LineString (route) a plusieurs points : on ne garde que les
        // Placemark à Point unique (une paire de coordonnées).
        if (co[1].trim().split(/\s+/).length > 1) continue;
        pts.push({ lat: xyz[1], lon: xyz[0], name: _xmlDecode(nm ? nm[1] : '').trim() });
    }
    return pts;
}

// ---------- Points physiques du plan (pour GPX/KML) ----------

function coordsOf(code) {
    const apt = getAirportByICAO(code);
    const memo = memoGet(code);
    const lat = memo?.lat ?? apt?.lat ?? null;
    const lon = memo?.lon ?? apt?.lon ?? null;
    return (lat != null && lon != null) ? { lat, lon } : null;
}

function planPoints(plan) {
    const seq = [plan.dep, ...(Array.isArray(plan.wps) ? plan.wps : []), plan.dest];
    const pts = [];
    for (const w of seq) {
        if (typeof w === 'string') {
            const c = coordsOf(w);
            if (c) pts.push({ ...c, name: w });
        } else if (w && typeof w.lat === 'number' && typeof w.lon === 'number') {
            pts.push({ lat: w.lat, lon: w.lon, name: w.name || 'WPT' });
        }
    }
    return pts;
}

// ---------- Dossier mémorisé (IndexedDB) ----------

function _idb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(DIR_STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function _rememberDir(handle) {
    try {
        const db = await _idb();
        await new Promise((res, rej) => {
            const tx = db.transaction(DIR_STORE, 'readwrite');
            tx.objectStore(DIR_STORE).put(handle, 'plan-dir');
            tx.oncomplete = res; tx.onerror = () => rej(tx.error);
        });
    } catch { /* quota / privé */ }
}

async function _recallDir() {
    try {
        const db = await _idb();
        return await new Promise((res, rej) => {
            const tx = db.transaction(DIR_STORE, 'readonly');
            const r = tx.objectStore(DIR_STORE).get('plan-dir');
            r.onsuccess = () => res(r.result || null);
            r.onerror = () => rej(r.error);
        });
    } catch { return null; }
}

// Écrit le fichier dans le dossier mémorisé (le choisit sinon), avec repli
// téléchargement si l'API est absente ou l'accès refusé.
export async function savePlanFile(filename, content, mime) {
    let dir = await _recallDir();
    if (dir) {
        // Réactive la permission si elle a expiré (nécessite un geste utilisateur).
        try {
            if ((await dir.queryPermission?.({ mode: 'readwrite' })) !== 'granted') {
                dir = (await dir.requestPermission?.({ mode: 'readwrite' })) === 'granted' ? dir : null;
            }
        } catch { dir = null; }
    }
    if (!dir && window.showDirectoryPicker) {
        // Race 90 s : dans un visualiseur intégré sans UI de picker, la
        // promesse reste suspendue pour toujours — on retombe alors sur le
        // téléchargement classique au lieu de rester bloqué.
        try {
            dir = await Promise.race([
                window.showDirectoryPicker({ mode: 'readwrite' }),
                new Promise((_, rej) => setTimeout(() => rej(new Error('picker-timeout')), 90000)),
            ]);
        } catch { dir = null; }
        if (dir) await _rememberDir(dir);
    }
    if (dir) {
        try {
            const fh = await dir.getFileHandle(filename, { create: true });
            const w = await fh.createWritable();
            await w.write(new Blob([content], { type: mime }));
            await w.close();
            return { ok: true, where: 'dossier' };
        } catch { /* écriture refusée → repli */ }
    }
    // Repli : téléchargement classique (dossier Téléchargements du navigateur).
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: mime }));
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return { ok: true, where: 'telechargement' };
}

// ---------- Restauration dans l'app ----------

function _setDeparture(icao) {
    const input = document.getElementById('icaoInput');
    if (input) {
        input.value = icao;
        document.getElementById('btn-fetch-metar')?.click();
    }
}

function _setDestination(icao) {
    const toInput = document.getElementById('route-to-input');
    if (!toInput) return;
    toInput.value = icao;
    const apt = getAirportByICAO(icao);
    const toNameEl = document.getElementById('route-to-name');
    if (toNameEl) toNameEl.textContent = apt?.name || '';
    // Passe par le chemin OFFICIEL d'une saisie clavier : l'écouteur 'input'
    // (app.js) appelle handleDestinationChange — nom du terrain, route sur la
    // carte, planificateur et profil suivent. Sans lui, le champ était rempli
    // mais le tracé n'était jamais redessiné (bug « import sans tracé »).
    toInput.dispatchEvent(new Event('input'));
}

// Point importé : code OACI connu → terrain, sinon repère libre nommé
// (position aux coordonnées du fichier).
function _resolvePoint(p) {
    const name = (p.name || '').trim().toUpperCase();
    if (/^[A-Z][A-Z0-9]{3}$/.test(name) && getAirportByICAO(name)) return name;
    // Repère libre : signalé à regional-map, qui crée le marqueur + registre.
    document.dispatchEvent(new CustomEvent('restore-free-waypoint', {
        detail: { lat: p.lat, lon: p.lon, name: (p.name || '').trim().slice(0, 24) || 'WPT' },
    }));
    return null;   // le code ZZxx sera lu depuis le registre au moment de poser la liste
}

// Extrémité GPX/KML : code OACI connu, sinon le repère libre VENANT d'être
// créé (son code ZZxx est annoncé de façon synchrone par l'événement).
function _resolveEndpoint(p) {
    return _resolvePoint(p) || _createdCodes[_createdCodes.length - 1] || null;
}

// Restore un plan (points + réglages). La séquence d'étapes est posée EN BLOC
// dans state.route (LA source du tracé carte et du plan multi-étapes) puis
// synchronisée dans le champ Waypoints dès que le planner est rendu —
// l'ordre du fichier prime sur l'insertion intelligente.
let _createdCodes = [];
if (typeof document !== 'undefined') {
    document.addEventListener('free-waypoint-created', (e) => {
        if (e.detail?.icao) _createdCodes.push(e.detail.icao);
    });
}

export function restorePlan(planOrPoints, settings = null) {
    const points = Array.isArray(planOrPoints) ? planOrPoints : null;
    let plan = planOrPoints;
    if (points) {
        // GPX/KML : conversion points → plan (1er = départ, dernier = dest).
        if (points.length < 2) return false;
        _createdCodes = [];
        const dep = _resolveEndpoint(points[0]);
        const dest = _resolveEndpoint(points[points.length - 1]);
        if (!dep || !dest) return false;
        plan = { dep, dest, wps: points.slice(1, -1) };
    }
    if (!plan?.dep || !plan?.dest) return false;
    _createdCodes = [];

    // Repères libres d'abord : chaque dispatch crée le marqueur et annonce
    // son code ZZxx dans l'ordre (événement synchrone 'free-waypoint-created'
    // — ou file d'attente de la carte si elle n'est pas encore initialisée).
    for (const w of (plan.wps || [])) {
        if (w && typeof w.lat === 'number' && typeof w.lon === 'number') {
            document.dispatchEvent(new CustomEvent('restore-free-waypoint', {
                detail: { lat: w.lat, lon: w.lon, name: String(w.name || 'WPT').slice(0, 24) },
            }));
        }
    }

    _setDeparture(plan.dep);

    // Séquence complète DANS L'ORDRE DU FICHIER — posée AVANT _setDestination :
    // le 'input' qu'il émet rend immédiatement le planificateur (qui lit
    // state.route pour la séquence multi-étapes), puis RÉIMPOSÉE après car
    // handleDestinationChange la vide sur un changement de destination.
    const buildSeq = () => {
        let ci = 0;
        const codes = (plan.wps || [])
            .map(w => typeof w === 'string' ? w : (_createdCodes[ci++] ?? null))
            .filter(Boolean);
        return [plan.dep, ...codes, plan.dest];
    };
    state.route = buildSeq();
    _setDestination(plan.dest);
    state.route = buildSeq();

    // Trace la route immédiatement si la carte est affichée (sinon elle sera
    // tracée à l'ouverture du panneau, qui lit state.route).
    window.dispatchEvent(new CustomEvent('route-changed'));

    // Réglages de calcul (JSON natif) + synchronisation du champ Waypoints :
    // appliqués dès que le planificateur rendu correspond à CE plan (il est
    // recréé quand la météo du départ arrive, horloge réseau incontrôlable —
    // d'où le poll), puis 'change' déclenche le recalcul officiel (recalc
    // relit le champ, re-rend le plan et notifie la carte).
    const applySettings = (tries) => {
        const fp = document.getElementById('flight-planner-panel');
        const wpInput = document.getElementById('fp-waypoints');
        const retry = () => { if (tries > 0) setTimeout(() => applySettings(tries - 1), 800); };
        if (!fp || !wpInput) { retry(); return; }
        const head = fp.querySelector('.fp-route')?.textContent || '';
        if (!head.includes(plan.dep) || !head.includes(plan.dest)) { retry(); return; }

        const ordered = buildSeq().slice(1, -1);
        state.route = buildSeq();
        wpInput.value = formatWaypointsField([...new Set(ordered)]);
        if (settings?.cruiseAltFt != null) { const el = document.getElementById('fp-cruise-alt'); if (el) el.value = settings.cruiseAltFt; }
        if (settings?.tasKt != null) { const el = document.getElementById('fp-tas'); if (el) el.value = settings.tasKt; }
        if (settings?.burnLph != null) { const el = document.getElementById('fp-burn'); if (el) el.value = settings.burnLph; }
        if (settings?.night === true) { const el = document.getElementById('fp-night'); if (el) el.checked = true; }
        wpInput.dispatchEvent(new Event('change'));
    };
    setTimeout(() => applySettings(20), 1500);
    return true;
}

// ---------- Import d'un fichier ----------

export async function importPlanFile(file) {
    const text = await file.text();
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'json') {
        const p = parsePlanJson(text);
        if (!p) throw new Error('JSON non reconnu (pas un plan de cette app)');
        return restorePlan(p, p);
    }
    if (ext === 'gpx') {
        const pts = parseGpx(text);
        if (pts.length < 2) throw new Error('GPX sans rtept/wpt exploitable');
        return restorePlan(pts);
    }
    if (ext === 'kml' || ext === 'xml') {
        const pts = parseKml(text);
        if (pts.length < 2) throw new Error('KML sans Placemark Point exploitable');
        return restorePlan(pts);
    }
    throw new Error('Format non supporté : ' + ext);
}

// ---------- UI : bouton + menu ----------

export function initPlanIo() {
    const btn = document.getElementById('plan-io-btn');
    const menu = document.getElementById('plan-io-menu');
    if (!btn || !menu) return;
    const isFr = state.lang === 'fr';

    const close = () => menu.classList.remove('visible');
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.toggle('visible');
    });
    document.addEventListener('click', (e) => {
        if (!menu.contains(e.target) && e.target !== btn) close();
    });

    menu.querySelector('[data-act="save-json"]')?.addEventListener('click', async () => {
        close();
        const plan = readCurrentPlan();
        const d = new Date().toISOString().slice(0, 10);
        await savePlanFile(`Plan_${plan.dep}-${plan.dest}_${d}.json`, buildPlanJson(plan), 'application/json');
    });
    menu.querySelector('[data-act="save-gpx"]')?.addEventListener('click', async () => {
        close();
        const plan = readCurrentPlan();
        const d = new Date().toISOString().slice(0, 10);
        await savePlanFile(`Plan_${plan.dep}-${plan.dest}_${d}.gpx`, buildGpx(plan), 'application/gpx+xml');
    });
    menu.querySelector('[data-act="save-kml"]')?.addEventListener('click', async () => {
        close();
        const plan = readCurrentPlan();
        const d = new Date().toISOString().slice(0, 10);
        await savePlanFile(`Plan_${plan.dep}-${plan.dest}_${d}.kml`, buildKml(plan), 'application/vnd.google-earth.kml+xml');
    });
    menu.querySelector('[data-act="import"]')?.addEventListener('click', () => {
        close();
        let input = document.getElementById('plan-io-file');
        if (!input) {
            input = document.createElement('input');
            input.type = 'file';
            input.id = 'plan-io-file';
            input.accept = '.json,.gpx,.kml,.xml';
            input.style.display = 'none';
            document.body.appendChild(input);
            input.addEventListener('change', async () => {
                const f = input.files?.[0];
                input.value = '';
                if (!f) return;
                try {
                    await importPlanFile(f);
                } catch (err) {
                    alert((state.lang === 'fr' ? 'Import impossible : ' : 'Import failed: ') + err.message);
                }
            });
        }
        input.click();
    });
}
