/** Panneau lateral et overlay : score, niveau, pause, game over. */

import { STATUS } from '../engine/constants.js';

const OVERLAY_TEXT = {
  [STATUS.PAUSED]: 'Pause',
  [STATUS.OVER]: 'Game over',
};

/**
 * @param {Record<string, HTMLElement>} elements
 */
export function createHud({ score, lines, level, toggle, overlay, overlayText, resume, restart }) {
  let shown = null; // evite de reecrire le DOM a chaque frame

  return {
    /** @param {import('../engine/state.js').GameState} state */
    update(state) {
      score.textContent = state.score;
      lines.textContent = state.lines;
      level.textContent = state.level;

      if (state.status === shown) return;
      shown = state.status;

      toggle.textContent = state.status === STATUS.PAUSED ? 'Reprendre' : 'Pause';
      toggle.disabled = state.status === STATUS.OVER;

      // L'overlay recouvre le panneau : sans ces boutons, une partie en pause
      // n'offrirait plus aucun moyen de reprendre a la souris.
      resume.hidden = state.status !== STATUS.PAUSED;
      restart.textContent = state.status === STATUS.OVER ? 'Rejouer' : 'Recommencer';

      const text = OVERLAY_TEXT[state.status];
      overlayText.textContent = text ?? '';
      overlay.hidden = !text;
    },
  };
}
