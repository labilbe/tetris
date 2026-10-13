/**
 * Le bouton de chute rapide.
 *
 * Meme role que le clavier et que les gestes : traduire un appui en action du
 * moteur, qui ne sait toujours pas d'ou elles viennent.
 *
 * Le pave en a longtemps porte cinq — deplacer, tourner, descendre, lacher. Les
 * quatre premiers ne faisaient plus que doubler les gestes du plateau
 * (src/input/gestures.js) en lui prenant sa hauteur. Il n'en reste que celui-ci,
 * et c'est voulu : la chute pose la piece pour de bon, et un geste qui ne se
 * reprend pas vaut mieux sous un bouton qu'au doigt sur la grille, ou on le
 * declencherait par erreur.
 *
 * D'ou ce qui a disparu avec les autres boutons : la repetition tant que le
 * doigt reste pose, qui n'avait de sens que pour un deplacement, et la capture
 * du pointeur, qui ne servait qu'a la poursuivre hors du bouton.
 *
 * Le bouton porte son action en attribut data-action, comme avant : l'ecoute se
 * fait sur le conteneur, et le jour ou il s'en ajoute un, elle les verra.
 */

/**
 * @param {object} options
 * @param {HTMLElement} options.pad conteneur du bouton
 * @param {(action: object) => void} options.onGameAction
 * @returns {() => void} fonction de detachement
 */
export function createTouchInput({ pad, onGameAction }) {
  function onPointerDown(event) {
    const button = event.target.closest('[data-action="hard"]');
    if (!button || !pad.contains(button)) return;

    // Sans cela, le navigateur interprete l'appui comme un defilement ou un
    // zoom, et la partie devient injouable.
    event.preventDefault();

    onGameAction({ type: 'hardDrop' });
  }

  pad.addEventListener('pointerdown', onPointerDown);

  return () => pad.removeEventListener('pointerdown', onPointerDown);
}
