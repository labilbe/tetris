/**
 * Tirage des colonnes de handicap, cote emetteur.
 *
 * Le tirage vit ici et non dans le moteur, qui ne touche jamais Math.random :
 * c'est justement le seul hasard du jeu qui echappe a la graine commune. Il n'a
 * pas a etre reproductible, il a a etre *unique* — les colonnes sont tirees une
 * fois par celui qui efface les lignes, puis voyagent dans l'action, si bien que
 * tous les receveurs subissent exactement les memes blocs.
 *
 * D'ou sa place dans net/ plutot que dans engine/ : ce qui se decide ici ne se
 * recalcule pas chez le receveur, cela se transmet.
 *
 * Deux raisons d'en envoyer, et un seul tirage pour les deux : le coup d'eclat
 * (plusieurs lignes d'un coup) et la duree (un niveau franchi). Ils comptent
 * leurs blocs autrement, mais un bloc est un bloc, et le receveur ne fait
 * aucune difference entre eux.
 */

import { COLS, GARBAGE_PER_LEVEL, GARBAGE_SENT } from '../engine/constants.js';

/**
 * Repartit un nombre de blocs sur les colonnes du plateau.
 *
 * Une passe = chaque colonne au plus une fois. En enchainant des passes
 * melangees, les blocs se repartissent au lieu de s'empiler au meme endroit,
 * tout en restant imprevisibles.
 *
 * @param {number} count nombre de blocs
 * @param {() => number} alea
 * @returns {number[]} une colonne par bloc
 */
function repartir(count, alea) {
  const columns = [];
  while (columns.length < count) {
    const passe = [...Array(COLS).keys()];
    for (let i = passe.length - 1; i > 0; i--) {
      const j = Math.floor(alea() * (i + 1));
      [passe[i], passe[j]] = [passe[j], passe[i]];
    }
    columns.push(...passe.slice(0, count - columns.length));
  }

  return columns;
}

/**
 * Colonnes des blocs a envoyer apres un effacement de plusieurs lignes.
 *
 * @param {number} cleared lignes effacees d'un coup
 * @param {() => number} alea source du hasard, injectable pour les tests
 * @returns {number[]} une colonne par bloc ; vide quand l'effacement n'envoie rien
 */
export function drawGarbageColumns(cleared, alea = Math.random) {
  return repartir(GARBAGE_SENT[cleared] ?? 0, alea);
}

/**
 * Colonnes des blocs a envoyer apres un ou plusieurs niveaux franchis.
 *
 * Un verrouillage efface au plus quatre lignes, et un niveau en demande dix :
 * on n'en franchit donc jamais deux a la fois. Le parametre les compte quand
 * meme, pour que ce tirage n'ait pas d'avis sur le bareme du moteur — si les
 * niveaux se rapprochaient un jour, il suivrait sans qu'on y revienne.
 *
 * @param {number} levels niveaux franchis d'un coup
 * @param {() => number} alea source du hasard, injectable pour les tests
 * @returns {number[]} une colonne par bloc ; vide si aucun niveau n'a ete franchi
 */
export function drawLevelColumns(levels, alea = Math.random) {
  if (!Number.isInteger(levels) || levels <= 0) return [];
  return repartir(levels * GARBAGE_PER_LEVEL, alea);
}
