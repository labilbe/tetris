/**
 * Commandes tactiles.
 *
 * Meme role que le clavier : traduire des gestes en actions du moteur. Le jeu
 * ne sait toujours pas d'ou viennent ses actions, et c'est ce qui permet
 * d'ajouter cette couche sans toucher au reste.
 *
 * Les boutons portent leur action en attribut data-action : l'ecoute se fait
 * une seule fois, sur le conteneur.
 */

/** Deplacer et descendre se repetent tant que le doigt reste pose. */
const REPEAT_DELAY_MS = 220; // avant la premiere repetition
const REPEAT_RATE_MS = 60;

const ACTIONS = {
  left: { type: 'move', dx: -1 },
  right: { type: 'move', dx: 1 },
  rotate: { type: 'rotate' },
  soft: { type: 'softDrop' },
  hard: { type: 'hardDrop' },
};

const REPEATABLE = new Set(['left', 'right', 'soft']);

/**
 * @param {object} options
 * @param {HTMLElement} options.pad conteneur des boutons
 * @param {(action: object) => void} options.onGameAction
 * @returns {() => void} fonction de detachement
 */
export function createTouchInput({ pad, onGameAction }) {
  let delay = null;
  let repeat = null;

  function stopRepeat() {
    clearTimeout(delay);
    clearInterval(repeat);
    delay = null;
    repeat = null;
  }

  function onPointerDown(event) {
    const button = event.target.closest('[data-action]');
    if (!button || !pad.contains(button)) return;

    const name = button.dataset.action;
    const action = ACTIONS[name];
    if (!action) return;

    // Sans cela, le navigateur interprete l'appui comme un defilement ou un
    // zoom, et la partie devient injouable.
    event.preventDefault();

    // L'action part avant tout le reste : rien d'accessoire ne doit pouvoir
    // l'empecher.
    onGameAction({ ...action });
    stopRepeat();

    // Capturer le pointeur evite qu'un glissement hors du bouton n'interrompe
    // le geste, mais l'appel echoue sur un pointeur deja relache : le confort
    // ne doit pas faire tomber la commande.
    try {
      button.setPointerCapture?.(event.pointerId);
    } catch {
      // Sans capture, on garde le comportement par defaut du navigateur.
    }

    if (!REPEATABLE.has(name)) return;
    delay = setTimeout(() => {
      repeat = setInterval(() => onGameAction({ ...action }), REPEAT_RATE_MS);
    }, REPEAT_DELAY_MS);
  }

  pad.addEventListener('pointerdown', onPointerDown);
  pad.addEventListener('pointerup', stopRepeat);
  pad.addEventListener('pointercancel', stopRepeat);
  // Un doigt releve hors de l'ecran ne produit pas toujours pointerup.
  window.addEventListener('blur', stopRepeat);

  return () => {
    stopRepeat();
    pad.removeEventListener('pointerdown', onPointerDown);
    pad.removeEventListener('pointerup', stopRepeat);
    pad.removeEventListener('pointercancel', stopRepeat);
    window.removeEventListener('blur', stopRepeat);
  };
}
