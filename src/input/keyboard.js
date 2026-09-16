/**
 * Traduit le clavier en actions du moteur. C'est la seule couche qui connait
 * les touches : le moteur, lui, ne voit que des actions serialisables, donc
 * transportables sur le reseau.
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

/**
 * @param {(action: object) => void} dispatch
 * @param {EventTarget} target
 * @returns {() => void} fonction de detachement
 */
export function createKeyboardInput(dispatch, target = document) {
  function onKeyDown(event) {
    const action = KEY_ACTIONS[event.key];
    if (!action) return;
    event.preventDefault();
    dispatch({ ...action });
  }

  target.addEventListener('keydown', onKeyDown);
  return () => target.removeEventListener('keydown', onKeyDown);
}
