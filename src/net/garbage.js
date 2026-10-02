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
 */

import { COLS, GARBAGE_SENT } from '../engine/constants.js';

/**
 * Colonnes des blocs a envoyer apres un effacement de plusieurs lignes.
 *
 * Une passe = chaque colonne au plus une fois. En enchainant des passes
 * melangees, les blocs se repartissent au lieu de s'empiler au meme endroit,
 * tout en restant imprevisibles.
 *
 * @param {number} cleared lignes effacees d'un coup
 * @param {() => number} alea source du hasard, injectable pour les tests
 * @returns {number[]} une colonne par bloc ; vide quand l'effacement n'envoie rien
 */
export function drawGarbageColumns(cleared, alea = Math.random) {
  const count = GARBAGE_SENT[cleared] ?? 0;

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
