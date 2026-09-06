# Visualiseur METAR/TAF

**Météo aéronautique en temps réel pour pilotes VFR** — décodage et visualisation
graphique des METAR/TAF, planification de vol, performances décollage et log de nav,
dans une PWA installable qui fonctionne aussi hors ligne.

🌐 **Application en ligne :** <https://2rima-papabear.github.io/metar-taf-pwa/>

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
- **SIGMET / AIRMET** actifs autour du terrain : évalués pour le GO/NO-GO
  (plus tracés sur la carte — retour pilote). Les PIREP ont été retirés.
- **Radar de précipitations** (RainViewer) en superposition carte.
- **Fenêtre de vol jour VFR** avec alerte de nuit (crépuscules calculés).
- **Mode cockpit** (briefing express ultra-lisible) et **mode nuit** (vision
  scotopique préservée).
- **Watchdog** : surveillance active des terrains favoris.

### Navigation
- **Planificateur de vol** : recherche de terrain par code OACI (validation
  alphanumérique, ex. CNU8 ou K6RE), waypoints intelligents ou libres,
  alternates, compagnie du trajet, autocomplétion. - **Log de nav PDF multi-pages** : au-delà de 9 tronçons, une page « VFR Flight Log
  (suite) » prolonge le log dans la même trame (lignes vierges + checks en bas de page) ;
  le tableau des calculs remplit la page avant d'appeler « Détail des waypoints (suite) ».
Le champ « Waypoints »
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
- **Fiche terrain en deux onglets** : « Fréquences » (fréquences
  officielles SIA avec observations — secteurs d'approche, fréquences
  suppléantes — et codes d'horaires H24/HO…) et « Info terrain »
  (altitude, déclinaison, ouverture VFR/IFR, statut, pistes en clair,
  horaires du service et avitaillement en sous-sections repliables).
- **Pastilles de la carte régionale** : clic = METAR + bouton
  « Carte VAC » du terrain ; **clic droit = ajout au plan de vol** comme
  waypoint.
- **Carte VAC « Atterrissage à vue »** intégrée : Atlas-VAC officiel du
  SIA (421 terrains de France, AIRAC), visionneuse pdfjs avec zoom et
  pages, **consultable hors ligne** après première ouverture (cache
  IndexedDB).

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
- **PWA installable** sur le **miroir GitHub Pages** :
  <https://2rima-papabear.github.io/metar-taf-pwa/> (HTTPS — service worker
  actif, installation mobile / bureau, shell hors ligne). Ce miroir public
  reçoit automatiquement les mêmes fichiers prod que Free.fr à chaque
  publication, **cellules openAIP incluses** (servies en HTTPS, sans dépôt
  FTP manuel).
- L'hébergement Free.fr (<http://papabear56.free.fr/>) est en HTTP seul —
  les navigateurs n'y exécutent pas les service workers : l'application y
  fonctionne comme un site classique, données consultées mises en cache
  navigateur (IndexedDB), versions rafraîchies au rechargement (numérotation
  automatique à chaque déploiement).
- **Interface française / anglaise**, thème sombre / clair.
- **Notice utilisateur bilingue** (FR/EN) : icônes et contrôles reproduits
  à l'identique de l'application (Lucide, pastilles, segments), contenu
  100 % utilisateur — le journal des versions et les procédures de
  maintenance vivent dans ce README (mis à jour automatiquement à chaque
  publication).
- **Mention de paternité SIA** conforme à la licence de réutilisation,
  en pied de page de l'application (date du cycle AIRAC en vigueur,
  calculée automatiquement).

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
                                    # + miroir GitHub Pages (metar-taf-pwa)
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
- **Base SIA (XML bd SIA)** — terrains (identité, horaires ATS,
  avitaillement, téléphone), pistes, espaces France, fréquences
  services/A-A : export `XML_SIA_<date>.xml` téléchargé à chaque cycle →
  `node scripts/fetch-sia-airac.mjs --xml="…"`.
- **Cartes VAC « Atterrissage à vue »** : extraites de l'**Atlas-VAC** du
  ZIP « eAIP complet » du portail SIA (≈1 Go) → `node
  scripts/fetch-vac-atlas.mjs` (421 terrains vers `data/vac-sia/`).
- **Garde-fou AIRAC global** (`airac-sia-xml` + `airac-obstacles`) :
  échec/notification dès qu'une base (terrains, pistes, espaces,
  fréquences, obstacles, cartes VAC) est en retard sur le cycle vigueur.


## Journal des versions
- **2026-09-06** — CARTES VAC « ATERRISSAGE À VUE » — LA SEULE RETENUE (choix pilote 06/09 : « ce sont ces cartes là qu il faut, les autres ne sont pas nécessa…
- **2026-09-06** — FIX DÉPLOIEMENT visionneuse VAC (diagnostic pilote : GET vendor/pdfjs-3.11.174.min.js → 404 sur le MIROIR) : pdfjs était exclu des DEUX dépl…
- **2026-09-06** — FIX SW « vieille app malgré la bonne version » (2ᵉ retour pilote « toujours 1 seule carte en v1.244 » alors que les 2 canaux servent bien ch…
- **2026-09-05** — FIX RADICAL « toujours 1 seule carte en v1.243 » : le bump de clé IDB ne suffisait pas — l URL HTTP restait freq-sia.json?t=0, identique pou…
- **2026-09-05** — FIX « je n ai qu une carte » : les visiteurs ayant déjà chargé la fiche terrain hier/ce matin gardaient freq-sia.json SANS le champ charts e…
- **2026-09-05** — CARTES VAC MULTI-CARTES (retour pilote « il n y a pas toutes les cartes du terrain ») : chaque terrain publie en réalité des DOSSIERS de car…
- **2026-09-05** — CARTES VAC OFFICIELLES dans l app (choix pilote ③ visionneuse + hors ligne) : les cartes d aérodrome du SIA (AD_2_XXXX_ADC_01.pdf, ~143 terr…
- **2026-09-05** — GARDE-FOU AIRAC de la base XML SIA (question pilote « les infos seront-elles mises à jour à chaque AIRAC ? ») : nouveau job airac-sia-xml da…
- **2026-09-05** — FRÉQUENCES v5 : OBSERVATIONS OFFICIELLES eAIP par fréquence (réponse à « différencier les 6 approches de Nantes ») : la colonne Observations…
- **2026-09-05** — FRÉQUENCES : GONIO supprimées + badges horaires (retour pilote 05/09) : ① les fréquences VDF « Gonio » dupliquent les organes existants (ex.…
- **2026-09-05** — FICHE TERRAIN v3c — valeurs à la suite des deux-points confirmées + BUG RACE hors France : le widget pouvait s afficher AMPUTÉ (pays/altitud…
- **2026-09-05** — FICHE TERRAIN v3b (ajustement pilote) : les valeurs de la section Terrain suivent DIRECTEMENT les deux-points (« Alt. terrain : 124 ft », « …
- **2026-09-05** — FICHE TERRAIN v3 — feu vert pilote après aperçu PDF (Apercu_fiche_terrain.pdf, 3 terrains LFRN/LFRV/LFPF) : section Terrain en LIGNES LIBELL…
- **2026-09-05** — FICHE TERRAIN v2 (retours pilote : ordre + lisibilité) : ① FRÉQUENCES en tête (sans sous-titre redondant) ② PISTES (seuils officiels affiché…
- **2026-09-05** — FICHE TERRAIN COMPLÈTE dans l onglet « Fréquences & info terrain » (demande pilote, 4 arbitrages validés) : ① IDENTITÉ en chips — élévation,…
<!-- docs:lastSha=a7544acf2a9afe209caf4d5c3b399f4b502910a4 -->



## Crédits & licences

- [Leaflet](https://leafletjs.com/) (BSD-2) — cartographie.
- [jsPDF](https://github.com/parallax/jsPDF) (MIT) — log de nav PDF.
- [Mozilla pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0) — aperçus PDF.
- [Lucide](https://lucide.dev/) (Apache-2.0) — icônes (dont l'avion du schéma
  de décollage, tracé `plane-takeoff`).
- Données aéronautiques : aviationweather.gov (NOAA), **SIA / DGAC**
  (eAIP France, export XML AIRAC, Atlas-VAC — fréquences, terrains,
  espaces, obstacles, cartes VAC), openAIP et contributeurs.
- **Licence de réutilisation SIA** : les données réutilisées le sont sous
  la licence gratuite du Service de l'Information Aéronautique — la mention
  de paternité complète (source, URL, date de mise à jour = cycle en
  vigueur) est affichée dans le pied de page de l'application.

## ⚠️ Avertissement

Cet outil est une **aide au briefing** : il agrège et met en forme des
informations publiques. Il ne remplace ni les sources officielles (SIA,
NOTAM, aviationweather.gov), ni le jugement du pilote, ni les performances
du manuel de vol de l'aéronef. **Responsabilité du commandant de bord.**
