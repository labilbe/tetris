/**
 * Musique de fond.
 *
 * Couche locale au meme titre que le rendu : elle observe l'etat du jeu mais ne
 * le modifie jamais, et rien de ce qu'elle fait ne transite par le reseau.
 *
 * Contrainte navigateur : le son ne peut pas demarrer tant que le joueur n'a pas
 * interagi avec la page (politique d'autoplay). On ne peut donc pas se contenter
 * d'appeler play() au chargement ; si l'appel est refuse, on arme un demarrage
 * differe au premier clic ou a la premiere touche.
 */

import { STATUS } from '../engine/constants.js';

/**
 * @param {object} options
 * @param {string} options.src
 * @param {number} [options.volume] entre 0 et 1
 */
export function createMusic({ src, volume = 0.35 }) {
  const audio = new Audio(src);
  audio.loop = true;
  audio.volume = volume;
  audio.preload = 'auto';
  // Attache a la page : l'element participe alors aux controles media du
  // navigateur, et son etat reel reste inspectable.
  audio.hidden = true;
  document.body.append(audio);

  let enabled = false;
  let wanted = false; // la musique devrait-elle jouer, au vu de l'etat du jeu
  let waitingForGesture = false;

  function startOnFirstGesture() {
    if (waitingForGesture) return;
    waitingForGesture = true;
    const resume = () => {
      waitingForGesture = false;
      document.removeEventListener('pointerdown', resume);
      document.removeEventListener('keydown', resume);
      if (enabled && wanted) play();
    };
    document.addEventListener('pointerdown', resume, { once: true });
    document.addEventListener('keydown', resume, { once: true });
  }

  function play() {
    // play() renvoie une promesse rejetee si l'autoplay est bloque.
    audio.play().catch(startOnFirstGesture);
  }

  function apply() {
    if (enabled && wanted) play();
    else audio.pause();
  }

  return {
    setEnabled(value) {
      enabled = value;
      apply();
    },

    isEnabled() {
      return enabled;
    },

    /**
     * Cale la musique sur l'etat du jeu : elle s'arrete en pause et en fin de
     * partie, et reprend la ou elle en etait.
     * @param {import('../engine/state.js').GameState} state
     */
    sync(state) {
      const next = state.status === STATUS.PLAYING;
      if (next === wanted) return;
      wanted = next;
      apply();
    },
  };
}
