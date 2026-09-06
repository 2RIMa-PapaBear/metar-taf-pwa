// Givrage carburateur — digitisation de l'abaque classique T° extérieure / point de rosée.
//
// PHYSIQUE (cf. notice « Givrage du carburateur », manuel du pilote) :
//   La vaporisation de l'essence dans l'étranglement du venturi et la détente
//   du mélange refroidissent l'air de 20 à 35 °C sous la température extérieure.
//   Le givrage se forme lorsque la température carburateur tombe entre −15 et 0 °C
//   (maximum de risque vers −5 °C) dans un air humide ; le risque est plus élevé
//   en basses couches et à puissance réduite (descente). Sur avion à calage fixe,
//   il se détecte par une chute du régime moteur (pression d'admission à calage
//   variable). Anticiper : réchauffe carburateur avant la mise en descente.
//
// ABAQUE (zones T / Td, écart S = T − Td) — style « Carburettor icing chart » :
//   - SÉVÈRE À TOUTES PUISSANCES : air froid et humide (T ∈ [−15 ; 0], S ≤ 8)
//                                  ou air très humide (T ≤ +5, S ≤ 5 ; T ≤ +12, S ≤ 3)
//   - SÉVÈRE EN DESCENTE         : air doux et humide (0 < T ≤ +20, S ≤ 12)
//                                  ou quasi saturé chaud (T ≤ +25, S ≤ 4)
//   - LÉGER / À SURVEILLER       : marge autour des zones sévères (T ∈ [−15 ; +30], S ≤ 15)
//   - FAIBLE OU NUL              : air sec (S > 15), très chaud (T > +30)
//                                  ou très froid (T < −15 : air trop sec, givrage carbu improbable)
//
// Ce module est volontairement SANS import (calcul pur, testable isolément).

export const CARB_DROP_MIN_C = 20; // chute de T° minimale (vaporisation)
export const CARB_DROP_MAX_C = 35; // chute de T° maximale (vaporisation + détente)

// T° carburateur estimée : OAT − [20 ; 35] °C.
export function estimateCarbTempC(oatC) {
    if (typeof oatC !== 'number' || isNaN(oatC)) return null;
    return { min: oatC - CARB_DROP_MAX_C, max: oatC - CARB_DROP_MIN_C };
}

// Niveau de risque : 'serious' | 'descent' | 'light' | 'none' (ou null si données absentes).
export function evaluateCarbIcing(oatC, tdC) {
    if (typeof oatC !== 'number' || isNaN(oatC) ||
        typeof tdC !== 'number' || isNaN(tdC)) return null;

    const t = oatC;
    const s = oatC - tdC; // écart T − Td : proxy d'humidité (plus il est faible, plus l'air est humide)
    const carb = estimateCarbTempC(oatC);

    let level;
    if ((t >= -15 && t <= 0 && s <= 8) || (t > 0 && t <= 5 && s <= 5) || (t > 0 && t <= 12 && s <= 3)) {
        level = 'serious';   // sévère à toutes puissances
    } else if ((t >= 0 && t <= 20 && s <= 12) || (t > 0 && t <= 25 && s <= 4)) {
        level = 'descent';   // sévère en descente (puissance réduite)
    } else if (t >= -15 && t <= 30 && ((t <= 15 && s <= 15) || (s <= 10))) {
        level = 'light';     // léger, à surveiller
    } else {
        level = 'none';      // faible ou nul
    }

    return {
        level,
        spread: Math.round(s * 10) / 10,
        carbMin: carb.min,
        carbMax: carb.max,
    };
}
