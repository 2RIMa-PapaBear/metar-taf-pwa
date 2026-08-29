# Visualiseur METAR/TAF

**Météo aéronautique en temps réel pour pilotes VFR** — décodage et visualisation
graphique des METAR/TAF, planification de vol, performances décollage et log de nav,
dans une PWA installable qui fonctionne aussi hors ligne.

🌐 **Application en ligne :** <http://papabear56.free.fr/>

## Captures d'écran

| Météo & rose des vents | Performance décollage |
|:---:|:---:|
| ![METAR décodé, rose des vents et widgets météo](docs/capture-meteo.png) | ![Panneau performance décollage avec schéma en coupe](docs/capture-perfs-decollage.png) |

| Calcul de navigation | Carte régionale & profil d'élévation |
|:---:|:---:|
| ![Calcul de navigation LFPB → LFRM](docs/capture-navigation.png) | ![Carte régionale avec route et profil d'élévation](docs/capture-carte-regionale.png) |

---

## Fonctionnalités

### Météo & briefing
- **METAR / TAF** décodés en clair et visualisés graphiquement (rose des vents
  animée, sélecteur de piste en service, tendances sur 24 h).
- **Widgets météo** : température / point de rosée, tendance de pression,
  **givrage carburateur** (zones à risque), niveau de congélation, vents en
  altitude, plafond & visibilité.
- **SIGMET / AIRMET** et **PIREP** (rapports de pilotes) autour du terrain.
- **Radar de précipitations** (RainViewer) en superposition carte.
- **Fenêtre de vol jour VFR** avec alerte de nuit (crépuscules calculés).
- **Mode cockpit** (briefing express ultra-lisible) et **mode nuit** (vision
  scotopique préservée).
- **Watchdog** : surveillance active des terrains favoris.

### Navigation
- **Planificateur de vol** : recherche de terrain par code OACI (validation
  alphanumérique, ex. CNU8 ou K6RE), waypoints intelligents ou libres,
  alternates, compagnie du trajet, autocomplétion. Le champ « Waypoints »
  affiche les **vrais noms** des repères (VOR, NDB, points de repère VFR).
- **Carte régionale** (Leaflet) : route, étiquettes de tronçons
  (cap / distance / temps), espaces aériens — **base officielle SIA (XML
  AIRAC) en priorité**, complétée par openAIP (ATZ, reste du monde), radar.
- **Radiophares et points VFR mondiaux** (openAIP, actualisés chaque
  semaine par un cron GitHub) : couches VOR / NDB / points de repère
  VFR activables case par case dans le menu du bouton « Espaces », avec
  allègement selon le zoom — chaque point est utilisable comme waypoint
  du plan de vol.
- **Obstacles** (base officielle **SIA**, export AIXM « Obstacles Model ») :
  ~13 800 obstacles en France et outre-mer — éoliennes, pylônes, mâts,
  châteaux d'eau, cheminées, bâtiments… — avec icône par type, hauteur,
  altitude du sommet et **balisage lumineux** au clic ; visible à partir
  d'un zoom régional, mise à jour à chaque cycle AIRAC (28 j).
- **Profil d'élévation** du trajet (Open-Meteo) en NM par tronçon, avec les
  **espaces traversés** : limites tracées en traits verticaux (bleu carte)
  et, sur le PDF, nom du secteur + fréquence en vertical entre les limites.
- **Météo de route** sur chaque waypoint, créneaux de vol par étape.
- **Permalien complet** du plan de vol (départ / destination / waypoints),
  partageable par QR code.
- **Sauvegarde / import** du plan de vol : JSON natif, **GPX** et **KML**.

### Performances & masse
- **Performance décollage** : flotte d'avions personnalisable (Cessna, Piper,
  Robin, DR400…), correction densité-altitude, revêtement de piste (herbe,
  dur sec/humide/contaminé), piste en service pilotée par la rose des vents,
  schéma en coupe (roulement → rotation → franchissement 50 ft) avec marge
  restante ou manque.
- **Masse & centrage** : centrogramme par avion (enveloppe, postes, carburant),
  points Décollage / Arrivée / ZFW, page dédiée du PDF, pré-remplissage depuis
  le plan de nav en mode navigation.
- **Log de nav PDF** (3–4 pages) : waypoints, alternates, météo, terrain,
  performances et centrage — généré dans le navigateur, sans serveur.

### Général
- **PWA prête** (manifest + service worker) : installation et démarrage
  hors ligne complets **sur un hébergement HTTPS** ou en local (localhost).
  L'hébergement Free.fr actuel est en HTTP seul — les navigateurs n'y
  exécutent pas les service workers, l'application y fonctionne comme un
  site classique : données consultées mises en cache navigateur (IndexedDB)
  pour la réactivité, versions rafraîchies au rechargement (numérotation
  automatique à chaque déploiement).
- **Interface française / anglaise**, thème sombre.

## Sources de données

| Source | Usage |
|---|---|
| [aviationweather.gov](https://aviationweather.gov/) | METAR, TAF, PIREP, SIGMET, ATIS, infos stations |
| [SIA](https://www.sia.aviation-civile.gouv.fr/) (eAIP + XML AIRAC) | Fréquences officielles des terrains, espaces aériens France, radiophares, obstacles — cycle AIRAC 28 j (paternité mentionnée dans l'application) |
| [Open-Meteo](https://open-meteo.com/) | Prévisions, élévation, vents en altitude |
| [openAIP](https://www.openaip.net/) | Terrains, espaces aériens mondiaux, radiophares et points VFR |
| [RainViewer](https://rainviewer.com/) | Radar de précipitations |
| Relais CORS (Google Apps Script) | Proxy met en cache les requêtes météo |

## Développement

Prérequis : **Node.js ≥ 18** (tests `node --test`).

```bash
npm install     # devDependencies (basic-ftp pour le déploiement)
npm test        # suite complète (~185 tests : cœur, plan de vol, perfs, centrage…)
```

- `index.html` — application (vanilla JS, modules ES, aucun framework).
- `js/` — modules applicatifs (`engine`, `weather`, `flight-planner`,
  `takeoff-performance`, `wb-core`, `navlog-pdf`…), volontairement découplés
  et testables sous Node.
- `test/` — tests unitaires + **pages d'aperçu** autonomes (QA visuelle des
  schémas, génération d'aperçus PDF) — non exécutées par `npm test`.
- `vendor/` — dépendances bundlées (Leaflet, jsPDF, pdf.js, Lucide) pour un
  fonctionnement 100 % hors ligne.
- `apps-script/` — code du relais CORS (proxy météo avec cache).

## Déploiement

À chaque push sur `Version-2.0`, **GitHub Actions** déploie automatiquement par
FTP sur Free.fr, bump les versions PWA et committe le marqueur `[deploy]`
(workflow `.github/workflows/deploy-ftp.yml`, secrets `FTP_SERVER`,
`FTP_USER`, `FTP_PASSWORD`). Les ~27 000 cellules openAIP
(`data/airspaces/cells/`) sont exclues de cet upload (débit Free.fr
insuffisant) et posées directement sur le FTP.

En local, la routine complète tient en une commande :

```bash
npm run pub -- "message du commit"   # commit + push + attente du déploiement
```

### Données aéronautiques — mises à jour automatiques

- **Cron quotidien** (`update-radio-points.yml`) : crawl incrémental des
  espaces aériens openAIP (cellule 1°), fréquences SIA (à chaque nouvel
  AIRAC), radiophares + points VFR (lundi).
- **Obstacles SIA** : extraits de l'export AIXM « Obstacles Model »
  téléchargé manuellement à chaque cycle AIRAC → `node scripts/fetch-obstacles.mjs`.
  Un **garde-fou** (job `airac-obstacles`) fait échouer le workflow quotidien
  — notification GitHub — tant que la base est en retard sur le cycle en
  vigueur.

## Crédits & licences

- [Leaflet](https://leafletjs.com/) (BSD-2) — cartographie.
- [jsPDF](https://github.com/parallax/jsPDF) (MIT) — log de nav PDF.
- [Mozilla pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0) — aperçus PDF.
- [Lucide](https://lucide.dev/) (Apache-2.0) — icônes (dont l'avion du schéma
  de décollage, tracé `plane-takeoff`).
- Données aéronautiques : aviationweather.gov (NOAA), **SIA / DGAC**
  (eAIP France et export XML AIRAC — fréquences, espaces, obstacles),
  openAIP et contributeurs.

## ⚠️ Avertissement

Cet outil est une **aide au briefing** : il agrège et met en forme des
informations publiques. Il ne remplace ni les sources officielles (SIA,
NOTAM, aviationweather.gov), ni le jugement du pilote, ni les performances
du manuel de vol de l'aéronef. **Responsabilité du commandant de bord.**
