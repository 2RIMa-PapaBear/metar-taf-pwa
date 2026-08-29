/* ================================================================
 * AIRCRAFT DATABASE — Base des avions VFR courants
 * ================================================================
 *
 * OBJECTIF
 * --------
 * Faciliter la saisie des paramètres de performance (roulement,
 * franchissement 50ft) en proposant une base pré-remplie des avions
 * les plus volés en aéroclub / instruction / navigation VFR.
 *
 * Les distances sont des valeurs REPRESENTATIVES au niveau de la mer en
 * atmosphère standard (ISA), compilées depuis les manuels de vol publics
 * et fiches techniques constructeurs. Elles varient selon la version,
 * la masse, l'équipement. L'utilisateur DOIT vérifier avec le POH de
 * SON avion.
 *
 * ⚠️ Ces valeurs sont des points de départ indicatifs. Elles ne
 * remplacent JAMAIS le manuel de vol (POH/AFM) de l'avion concerné.
 * ================================================================ */

// Base des avions courants. groundRoll/fiftyFt en pieds, au niveau mer / ISA.
// Sources : POH publics, fiches constructeurs, données EASA/FAA type certificate.
export const AIRCRAFT_DB = [
    // --- Cessna ---
    { name: 'Cessna 152', type: 'C152', groundRoll: 735, fiftyFt: 1340 },
    { name: 'Cessna 172 Skyhawk', type: 'C172', groundRoll: 830, fiftyFt: 1400 },
    { name: 'Cessna 172 SP', type: 'C172S', groundRoll: 930, fiftyFt: 1630 },
    { name: 'Cessna 172 RG', type: 'C172RG', groundRoll: 1025, fiftyFt: 1820 },
    { name: 'Cessna 182 Skylane', type: 'C182', groundRoll: 795, fiftyFt: 1535 },
    { name: 'Cessna 177 Cardinal', type: 'C177', groundRoll: 815, fiftyFt: 1540 },
    { name: 'Cessna 206 Stationair', type: 'C206', groundRoll: 1055, fiftyFt: 1890 },
    { name: 'Cessna 210 Centurion', type: 'C210', groundRoll: 900, fiftyFt: 1750 },
    { name: 'Cessna 150', type: 'C150', groundRoll: 715, fiftyFt: 1310 },
    { name: 'Cessna 310', type: 'C310', groundRoll: 1200, fiftyFt: 2200 },

    // --- Piper ---
    { name: 'Piper PA-28 Cherokee 140', type: 'PA28-140', groundRoll: 770, fiftyFt: 1500 },
    { name: 'Piper PA-28 Cherokee 150', type: 'PA28-150', groundRoll: 770, fiftyFt: 1500 },
    { name: 'Piper PA-28 Cherokee 160', type: 'PA28-160', groundRoll: 810, fiftyFt: 1530 },
    { name: 'Piper PA-28 Cherokee 180', type: 'PA28-180', groundRoll: 770, fiftyFt: 1525 },
    { name: 'Piper PA-28 Archer', type: 'PA28-181', groundRoll: 870, fiftyFt: 1585 },
    { name: 'Piper PA-28 Arrow', type: 'PA28R', groundRoll: 950, fiftyFt: 1800 },
    { name: 'Piper PA-28 Warrior', type: 'PA28-161', groundRoll: 845, fiftyFt: 1560 },
    { name: 'Piper PA-32 Cherokee Six', type: 'PA32', groundRoll: 1015, fiftyFt: 1895 },
    { name: 'Piper PA-34 Seneca', type: 'PA34', groundRoll: 1180, fiftyFt: 2200 },
    { name: 'Piper PA-38 Tomahawk', type: 'PA38', groundRoll: 850, fiftyFt: 1665 },
    { name: 'Piper PA-44 Seminole', type: 'PA44', groundRoll: 1150, fiftyFt: 2200 },
    { name: 'Piper Super Cub', type: 'PA18', groundRoll: 300, fiftyFt: 700 },

    // --- Robin / CAP ---
    { name: 'Robin DR400-120', type: 'DR400-120', groundRoll: 400, fiftyFt: 760 },
    { name: 'Robin DR400-140', type: 'DR400-140', groundRoll: 400, fiftyFt: 770 },
    { name: 'Robin DR400-160', type: 'DR400-160', groundRoll: 420, fiftyFt: 800 },
    { name: 'Robin DR400-180', type: 'DR400-180', groundRoll: 430, fiftyFt: 850 },
    { name: 'Robin DR400-200', type: 'DR400-200', groundRoll: 460, fiftyFt: 880 },
    { name: 'Robin DR400-220', type: 'DR400-220', groundRoll: 480, fiftyFt: 900 },
    { name: 'Robin DR401', type: 'DR401', groundRoll: 440, fiftyFt: 840 },
    { name: 'Robin DR500', type: 'DR500', groundRoll: 480, fiftyFt: 920 },
    { name: 'Robin ATR.72', type: 'R2120', groundRoll: 520, fiftyFt: 1000 },
    { name: 'Robin Cap 10', type: 'CAP10', groundRoll: 380, fiftyFt: 700 },

    // --- Diamond ---
    { name: 'Diamond DA20 Katana', type: 'DA20', groundRoll: 560, fiftyFt: 1080 },
    { name: 'Diamond DA20 C1 Eclipse', type: 'DA20-C1', groundRoll: 640, fiftyFt: 1200 },
    { name: 'Diamond DA40 Star', type: 'DA40', groundRoll: 840, fiftyFt: 1550 },
    { name: 'Diamond DA40 NG', type: 'DA40NG', groundRoll: 950, fiftyFt: 1700 },
    { name: 'Diamond DA42 Twin Star', type: 'DA42', groundRoll: 950, fiftyFt: 1850 },

    // --- Cirrus ---
    { name: 'Cirrus SR20', type: 'SR20', groundRoll: 1115, fiftyFt: 1985 },
    { name: 'Cirrus SR22', type: 'SR22', groundRoll: 1050, fiftyFt: 1920 },
    { name: 'Cirrus SR22T', type: 'SR22T', groundRoll: 1150, fiftyFt: 2080 },

    // --- Socata / TBM ---
    { name: 'Socata TB-9 Tampico', type: 'TB9', groundRoll: 920, fiftyFt: 1700 },
    { name: 'Socata TB-10 Tobago', type: 'TB10', groundRoll: 920, fiftyFt: 1700 },
    { name: 'Socata TB-20 Trinidad', type: 'TB20', groundRoll: 1050, fiftyFt: 1980 },
    { name: 'Socata TB-21 Trinidad TC', type: 'TB21', groundRoll: 1100, fiftyFt: 2050 },
    { name: 'Socata Rallye', type: 'MS880', groundRoll: 420, fiftyFt: 800 },
    { name: 'Socata Rallye 100', type: 'MS883', groundRoll: 450, fiftyFt: 850 },
    { name: 'Socata Rallye 150', type: 'MS893', groundRoll: 480, fiftyFt: 900 },
    { name: 'TBM 700', type: 'TBM700', groundRoll: 1620, fiftyFt: 2540 },
    { name: 'TBM 850', type: 'TBM850', groundRoll: 1700, fiftyFt: 2680 },
    { name: 'TBM 900', type: 'TBM900', groundRoll: 1750, fiftyFt: 2760 },

    // --- Beechcraft ---
    { name: 'Beechcraft Bonanza F33', type: 'F33A', groundRoll: 1000, fiftyFt: 1850 },
    { name: 'Beechcraft Bonanza A36', type: 'A36', groundRoll: 1060, fiftyFt: 1980 },
    { name: 'Beechcraft Baron 58', type: 'BE58', groundRoll: 1400, fiftyFt: 2600 },
    { name: 'Beechcraft Duchess 76', type: 'BE76', groundRoll: 900, fiftyFt: 1900 },
    { name: 'Beechcraft Musketeer', type: 'BE23', groundRoll: 870, fiftyFt: 1640 },
    { name: 'Beechcraft Skipper', type: 'BE77', groundRoll: 810, fiftyFt: 1500 },
    { name: 'Beechcraft Sundowner', type: 'BE24', groundRoll: 950, fiftyFt: 1750 },

    // --- Mooney ---
    { name: 'Mooney M20J', type: 'M20J', groundRoll: 850, fiftyFt: 1680 },
    { name: 'Mooney M20K 231', type: 'M20K', groundRoll: 900, fiftyFt: 1800 },
    { name: 'Mooney M20R Ovation', type: 'M20R', groundRoll: 950, fiftyFt: 1850 },
    { name: 'Mooney M20TN Acclaim', type: 'M20TN', groundRoll: 1000, fiftyFt: 1950 },

    // --- Grumman / Gulfstream ---
    { name: 'Grumman AA-5 Traveler', type: 'AA5', groundRoll: 890, fiftyFt: 1650 },
    { name: 'Grumman AA-5A Cheetah', type: 'AA5A', groundRoll: 880, fiftyFt: 1700 },
    { name: 'Grumman AA-5B Tiger', type: 'AA5B', groundRoll: 950, fiftyFt: 1800 },
    { name: 'Grumman AA-1 Yankee', type: 'AA1', groundRoll: 790, fiftyFt: 1450 },

    // --- Aeronca / Luscombe / Taylorcraft (classiques) ---
    { name: 'Aeronca 7AC Champion', type: '7AC', groundRoll: 250, fiftyFt: 600 },
    { name: 'Aeronca 11AC Chief', type: '11AC', groundRoll: 280, fiftyFt: 700 },
    { name: 'Luscombe 8A Silvaire', type: 'L8A', groundRoll: 400, fiftyFt: 850 },
    { name: 'Taylorcraft BC12-D', type: 'BC12D', groundRoll: 300, fiftyFt: 700 },

    // --- Citabria / Decathlon ---
    { name: 'American Champion 7GCBC Citabria', type: '7GCBC', groundRoll: 340, fiftyFt: 780 },
    { name: 'American Champion 8KCAB Decathlon', type: '8KCAB', groundRoll: 360, fiftyFt: 800 },
    { name: 'American Champion 8GCBC Scout', type: '8GCBC', groundRoll: 400, fiftyFt: 900 },

    // --- Maule ---
    { name: 'Maule M-7', type: 'M7', groundRoll: 500, fiftyFt: 1000 },
    { name: 'Maule M-9', type: 'M9', groundRoll: 550, fiftyFt: 1100 },

    // --- Tecnam ---
    { name: 'Tecnam P92 Echo', type: 'P92', groundRoll: 360, fiftyFt: 680 },
    { name: 'Tecnam P2002 Sierra', type: 'P2002', groundRoll: 450, fiftyFt: 850 },
    { name: 'Tecnam P2010', type: 'P2010', groundRoll: 750, fiftyFt: 1400 },
    { name: 'Tecnam P2006T', type: 'P2006T', groundRoll: 850, fiftyFt: 1650 },

    // --- Aeroprakt / ULM 3 axes ---
    { name: 'Aeroprakt A-22 Foxbat', type: 'A22', groundRoll: 250, fiftyFt: 520 },
    { name: 'Aeroprakt A-32 Vixxen', type: 'A32', groundRoll: 280, fiftyFt: 560 },
    { name: "Dyn'Aéro MCR01 ULM", type: 'MCR01', groundRoll: 200, fiftyFt: 450 },
    { name: "Dyn'Aéro MCR-4S", type: 'MCR4S', groundRoll: 380, fiftyFt: 750 },
    { name: 'TL-Ultralight TL-3000 Sirius', type: 'TL3000', groundRoll: 300, fiftyFt: 600 },
    { name: 'Evektor EuroStar SLW', type: 'EV97', groundRoll: 250, fiftyFt: 520 },
    { name: 'Pipistrel Virus SW', type: 'VirusSW', groundRoll: 300, fiftyFt: 620 },
    { name: 'Pipistrel Sinus', type: 'Sinus', groundRoll: 320, fiftyFt: 650 },

    // --- Multi-axes /_biplaces école ---
    { name: 'Mudry CAP 20', type: 'CAP20', groundRoll: 450, fiftyFt: 900 },
    { name: 'Extra EA-200', type: 'EA200', groundRoll: 400, fiftyFt: 800 },
    { name: 'Stemme S-10 VT', type: 'S10VT', groundRoll: 500, fiftyFt: 1000 },
    { name: 'Yakovlev Yak-18T', type: 'Yak18T', groundRoll: 750, fiftyFt: 1450 },

    // --- Autres constructeurs ---
    { name: 'Aeronca Champion', type: 'AERC', groundRoll: 250, fiftyFt: 600 },
    { name: 'Auster J/1 Autocrat', type: 'AUSTER', groundRoll: 350, fiftyFt: 750 },
    { name: 'Jodel D112', type: 'D112', groundRoll: 350, fiftyFt: 700 },
    { name: 'Jodel DR1050 Sicile', type: 'DR1050', groundRoll: 380, fiftyFt: 750 },
    { name: 'Jodel DR1051 Ambassadeur', type: 'DR1051', groundRoll: 380, fiftyFt: 760 },
    { name: 'Siai Marchetti SF260', type: 'SF260', groundRoll: 750, fiftyFt: 1450 },
    { name: 'Valmet L-90 RediGO', type: 'L90', groundRoll: 700, fiftyFt: 1350 },
    { name: 'PZL Koliber 160', type: 'KOLIBER', groundRoll: 850, fiftyFt: 1600 },
    { name: 'Yakovlev Yak-52', type: 'Yak52', groundRoll: 600, fiftyFt: 1150 },
    { name: 'Zlin Z-42', type: 'Z42', groundRoll: 600, fiftyFt: 1150 },
    { name: 'Zlin Z-43', type: 'Z43', groundRoll: 650, fiftyFt: 1250 },
    { name: 'Zlin Z-142', type: 'Z142', groundRoll: 650, fiftyFt: 1250 },
    { name: 'Zlin Z-242L', type: 'Z242L', groundRoll: 650, fiftyFt: 1250 },
    { name: 'Grob G-115', type: 'G115', groundRoll: 600, fiftyFt: 1150 },
    { name: 'Grob G-120A', type: 'G120A', groundRoll: 700, fiftyFt: 1350 },
    { name: 'Slingsby T-67 Firefly', type: 'T67', groundRoll: 700, fiftyFt: 1350 },
    { name: 'Scottish Aviation Bulldog', type: 'BULLDOG', groundRoll: 650, fiftyFt: 1250 },
    { name: 'Beagle Pup', type: 'B-121', groundRoll: 700, fiftyFt: 1350 },
    { name: 'AISA HEMA-352', type: 'HEMA352', groundRoll: 400, fiftyFt: 800 },
];

// Index pour la recherche rapide (insensible à la casse, sur nom + type).
let _searchIndex = null;
function _ensureIndex() {
    if (_searchIndex) return _searchIndex;
    _searchIndex = AIRCRAFT_DB.map(ac => {
        // Tokens de recherche : mots du nom + type.
        const hay = (ac.name + ' ' + ac.type).toLowerCase();
        return { ac, hay };
    });
    return _searchIndex;
}

/**
 * Recherche des avions correspondant à une requête.
 * @param {string} query Texte de recherche (ex: "cessna", "dr400", "172").
 * @param {number} [limit=8] Nombre max de résultats.
 * @returns {Array<Object>} Avions correspondants.
 */
export function searchAircraft(query, limit = 8) {
    const q = (query || '').trim().toLowerCase();
    if (q.length < 1) return [];

    const index = _ensureIndex();
    const results = [];

    // 1. Correspondances où TOUS les mots de la requête apparaissent.
    const tokens = q.split(/\s+/).filter(Boolean);
    for (const { ac, hay } of index) {
        if (tokens.every(t => hay.includes(t))) {
            results.push(ac);
            if (results.length >= limit) return results;
        }
    }

    // 2. Si peu de résultats, on tolère une correspondance partielle (au moins un mot).
    if (results.length < limit) {
        for (const { ac, hay } of index) {
            if (results.includes(ac)) continue;
            if (tokens.some(t => hay.includes(t))) {
                results.push(ac);
                if (results.length >= limit) return results;
            }
        }
    }

    return results;
}
