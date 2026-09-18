/** Panneau lateral et overlay : score, niveau, pause, fin de partie. */

import { STATUS } from '../engine/constants.js';

const OVERLAY_TEXT = {
  [STATUS.PAUSED]: 'Pause',
  [STATUS.OVER]: 'Game over',
};

/** En reseau, le resultat prime sur l'etat du plateau. */
const OUTCOME_TEXT = {
  won: 'Gagné !',
  lost: 'Perdu',
  // A plus de deux, on sort de la partie sans qu'elle soit finie pour autant.
  eliminated: 'Éliminé — la partie continue',
};

/**
 * @param {Record<string, HTMLElement>} elements
 */
export function createHud({ score, lines, level, toggle, overlay, overlayText, resume, toMenu }) {
  let shown = null; // evite de reecrire le DOM a chaque frame

  return {
    /**
     * @param {import('../engine/state.js').GameState} state
     * @param {'won' | 'lost' | 'eliminated' | null} [outcome] issue d'une partie en reseau
     */
    update(state, outcome = null) {
      score.textContent = state.score;
      lines.textContent = state.lines;
      level.textContent = state.level;

      const key = outcome ?? state.status;
      if (key === shown) return;
      shown = key;

      toggle.textContent = state.status === STATUS.PAUSED ? 'Reprendre' : 'Pause';
      toggle.disabled = state.status === STATUS.OVER || outcome !== null;

      const text = OUTCOME_TEXT[outcome] ?? OVERLAY_TEXT[state.status];

      // L'overlay recouvre le panneau : sans ce bouton, une partie en pause
      // n'offrirait plus aucun moyen de reprendre a la souris.
      resume.hidden = outcome !== null || state.status !== STATUS.PAUSED;
      // Le retour au menu est le seul autre choix : c'est la qu'on rechoisit le
      // mode, et relancer seul une partie en reseau n'aurait pas de sens.
      toMenu.hidden = !text;

      overlayText.textContent = text ?? '';
      overlay.hidden = !text;
    },
  };
}
