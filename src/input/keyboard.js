/**
 * Traduit le clavier en actions. C'est la seule couche qui connait les touches :
 * le moteur, lui, ne voit que des actions serialisables, donc transportables
 * sur le reseau.
 *
 * Deux familles de touches, volontairement separees : celles qui changent la
 * partie (et transitent par le reseau) et celles qui ne changent que l'affichage
 * du joueur local (qui ne doivent surtout pas transiter).
 */

const KEY_ACTIONS = {
  ArrowLeft: { type: 'move', dx: -1 },
  ArrowRight: { type: 'move', dx: 1 },
  ArrowDown: { type: 'softDrop' },
  ArrowUp: { type: 'rotate' },
  ' ': { type: 'hardDrop' },
  p: { type: 'togglePause' },
  P: { type: 'togglePause' },
};

/** Touches purement locales : elles ne modifient pas la partie. */
const VIEW_ACTIONS = {
  g: { type: 'toggleGhost' },
  G: { type: 'toggleGhost' },
  m: { type: 'toggleMusic' },
  M: { type: 'toggleMusic' },
  a: { type: 'watchAuto' },
  A: { type: 'watchAuto' },
};

/**
 * Multiplex : changer de plan.
 *
 * Les fleches nues sont prises par le jeu, et elles doivent le rester — une
 * piece qui ne repond plus parce qu'on regardait ailleurs serait le pire des
 * echanges. Maj les detourne vers la camera, sans rien retirer au joueur.
 */
const WATCH_ACTIONS = {
  ArrowLeft: { type: 'watchPrev' },
  ArrowRight: { type: 'watchNext' },
};

/**
 * @param {object} handlers
 * @param {(action: object) => void} handlers.onGameAction action de jeu, a envoyer au transport
 * @param {(action: object) => void} handlers.onViewAction action d'affichage, a garder en local
 * @param {EventTarget} [handlers.target]
 * @returns {() => void} fonction de detachement
 */
export function createKeyboardInput({ onGameAction, onViewAction, target = document }) {
  function onKeyDown(event) {
    // Une zone de saisie garde ses touches : sans cela, l'espace deviendrait
    // une chute rapide au beau milieu d'un pseudo.
    const cible = event.target;
    if (cible && (cible.tagName === 'INPUT' || cible.tagName === 'TEXTAREA')) return;

    if (event.shiftKey) {
      const watchAction = WATCH_ACTIONS[event.key];
      if (watchAction) {
        event.preventDefault();
        onViewAction({ ...watchAction });
        return;
      }
    }

    const viewAction = VIEW_ACTIONS[event.key];
    if (viewAction) {
      event.preventDefault();
      onViewAction({ ...viewAction });
      return;
    }

    const action = KEY_ACTIONS[event.key];
    if (!action) return;
    event.preventDefault();
    onGameAction({ ...action });
  }

  target.addEventListener('keydown', onKeyDown);
  return () => target.removeEventListener('keydown', onKeyDown);
}
