/**
 * Gestes sur le plateau.
 *
 * Meme role que le clavier et que le pave : traduire des gestes en actions du
 * moteur, qui ne sait toujours pas d'ou elles viennent. Le pave reste — on joue
 * parfois mieux avec des boutons —, ceci s'y ajoute pour ceux qui preferent
 * poser le doigt sur la grille.
 *
 * Le vocabulaire :
 *
 *   - un doigt glisse lateralement : la piece suit, case par case ;
 *   - un doigt glisse vers le bas : la piece descend, case par case ;
 *   - une tape sur la piece : elle tourne.
 *
 * La chute rapide n'est pas ici : elle reste au bouton du pave, en bas. Elle y
 * a d'abord ete une double tape, et c'etait une erreur — tourner deux fois de
 * suite lachait la piece. Un geste qui pose la piece pour de bon ne peut pas
 * partager son vocabulaire avec celui qu'on repete le plus.
 *
 * Deux parties ici : une machine pure, qui ne connait que des points et rend
 * des actions, et le cablage aux evenements du pointeur. La premiere se teste
 * sans navigateur (test/gestes.test.js), et c'est elle qui porte les regles.
 */

import { COLS, ROWS } from '../engine/constants.js';

/** Au-dela, l'appui n'est plus une tape mais un doigt pose. */
const TAP_MS = 250;

/**
 * Fraction de case a parcourir avant qu'un appui devienne un glissement.
 *
 * Trop petite, la moindre tremblote du doigt deplacerait la piece au lieu de la
 * faire tourner ; trop grande, le glissement partirait en retard.
 */
const SEUIL = .4;

/**
 * La machine des gestes.
 *
 * Elle ne touche a rien : on lui donne des points, elle rend les actions a
 * envoyer. Les coordonnees sont en pixels depuis le coin haut gauche du
 * plateau, et `t` en millisecondes.
 *
 * La taille des cases est relue a chaque debut plutot que fixee une fois : le
 * plateau change de taille avec l'ecran.
 *
 * @param {object} options
 * @param {() => { celluleX: number, celluleY: number }} options.mesurer taille
 *   d'une case a l'ecran ; la hauteur differe de la largeur, le plateau n'etant
 *   pas toujours affiche dans ses proportions exactes
 * @param {(colonne: number, ligne: number) => boolean} options.surLaPiece
 * @returns {{ debut: Function, bouge: Function, fin: Function, annule: Function }}
 */
export function createGestes({ mesurer, surLaPiece }) {
  let depart = null;
  /** Axe retenu pour ce glissement : 'x', 'y', ou null tant qu'on hesite. */
  let axe = null;
  /** Nombre de cases deja envoyees sur cet axe, pour n'en envoyer aucune deux fois. */
  let envoyees = 0;

  let celluleX = 0;
  let celluleY = 0;
  let seuil = 0;

  function debut(point) {
    ({ celluleX, celluleY } = mesurer());
    seuil = Math.min(celluleX, celluleY) * SEUIL;
    depart = point;
    axe = null;
    envoyees = 0;
    return [];
  }

  function bouge(point) {
    if (!depart) return [];

    const dx = point.x - depart.x;
    const dy = point.y - depart.y;

    /*
     * L'axe se fixe au premier franchissement et ne change plus jusqu'au doigt
     * leve. Un glissement lateral derive toujours un peu vers le bas : sans ce
     * verrou, deplacer la piece la ferait aussi descendre, et on ne pourrait
     * plus viser une colonne sans perdre des lignes.
     */
    if (!axe) {
      if (Math.abs(dx) < seuil && Math.abs(dy) < seuil) return [];
      axe = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
    }

    if (axe === 'x') {
      const cible = Math.trunc(dx / celluleX);
      const actions = [];
      while (envoyees < cible) { actions.push({ type: 'move', dx: 1 }); envoyees++; }
      while (envoyees > cible) { actions.push({ type: 'move', dx: -1 }); envoyees--; }
      return actions;
    }

    // Vers le bas seulement : une piece ne remonte pas, un glissement vers le
    // haut n'a donc rien a dire.
    const cible = Math.trunc(dy / celluleY);
    const actions = [];
    while (envoyees < cible) { actions.push({ type: 'softDrop' }); envoyees++; }
    return actions;
  }

  function fin(point) {
    const commence = depart;
    depart = null;
    const glisse = axe !== null;
    axe = null;
    envoyees = 0;

    // Un glissement s'est deja exprime en chemin, et un doigt pose longtemps
    // sans bouger ne demande rien.
    if (!commence || glisse || point.t - commence.t > TAP_MS) return [];

    /*
     * La tape ne fait tourner que sur la piece elle-meme : c'est ce qu'on vise
     * quand on veut la tourner, et ailleurs sur la grille une tape ne veut rien
     * dire. Elle tourne tout de suite et autant de fois qu'on la repete : rien
     * d'autre n'attend derriere pour lui disputer le geste.
     */
    const colonne = Math.floor(commence.x / celluleX);
    const ligne = Math.floor(commence.y / celluleY);
    return surLaPiece(colonne, ligne) ? [{ type: 'rotate' }] : [];
  }

  /** Doigt perdu (appel systeme, fenetre quittee) : le geste n'a pas eu lieu. */
  function annule() {
    depart = null;
    axe = null;
    envoyees = 0;
    return [];
  }

  return { debut, bouge, fin, annule };
}

/**
 * Branche les gestes sur le plateau.
 *
 * @param {object} options
 * @param {HTMLCanvasElement} options.board
 * @param {() => object | undefined} options.getState pour savoir ou est la piece
 * @param {(action: object) => void} options.onGameAction
 * @returns {() => void} fonction de detachement
 */
export function createBoardGestures({ board, getState, onGameAction }) {
  let doigt = null;
  let cadre = null;

  /** La piece couvre-t-elle cette case ? */
  function surLaPiece(colonne, ligne) {
    const piece = getState()?.current;
    if (!piece) return false;
    return Boolean(piece.cells[ligne - piece.y]?.[colonne - piece.x]);
  }

  /*
   * Une seule machine pour toute la partie, et non une par geste : c'est elle
   * qui se souvient de la tape precedente, et une machine neuve a chaque doigt
   * pose ne verrait jamais que des premieres tapes.
   *
   * Le cadre est relu a chaque doigt pose : le canvas garde ses 300x600
   * internes mais s'affiche a la taille que lui laisse l'ecran, et c'est la
   * taille affichee que le doigt parcourt.
   */
  const gestes = createGestes({
    mesurer: () => ({ celluleX: cadre.width / COLS, celluleY: cadre.height / ROWS }),
    surLaPiece,
  });

  function point(event) {
    return { x: event.clientX - cadre.left, y: event.clientY - cadre.top, t: event.timeStamp };
  }

  function envoyer(actions) {
    for (const action of actions) onGameAction(action);
  }

  function onPointerDown(event) {
    if (doigt !== null) return; // un seul doigt pilote : le second ne doit rien brouiller

    // Sans cela, le navigateur prend le geste pour un defilement ou un zoom.
    event.preventDefault();

    doigt = event.pointerId;
    cadre = board.getBoundingClientRect();

    try {
      board.setPointerCapture?.(event.pointerId);
    } catch {
      // Sans capture, un doigt sorti du plateau finira par etre perdu : le
      // geste s'arretera, rien de plus.
    }

    envoyer(gestes.debut(point(event)));
  }

  function onPointerMove(event) {
    if (event.pointerId !== doigt) return;
    envoyer(gestes.bouge(point(event)));
  }

  function onPointerUp(event) {
    if (event.pointerId !== doigt) return;
    envoyer(gestes.fin(point(event)));
    doigt = null;
  }

  function onPointerCancel(event) {
    if (event.pointerId !== doigt) return;
    gestes.annule();
    doigt = null;
  }

  function onBlur() {
    gestes.annule();
    doigt = null;
  }

  board.addEventListener('pointerdown', onPointerDown);
  board.addEventListener('pointermove', onPointerMove);
  board.addEventListener('pointerup', onPointerUp);
  board.addEventListener('pointercancel', onPointerCancel);
  window.addEventListener('blur', onBlur);

  return () => {
    onBlur();
    board.removeEventListener('pointerdown', onPointerDown);
    board.removeEventListener('pointermove', onPointerMove);
    board.removeEventListener('pointerup', onPointerUp);
    board.removeEventListener('pointercancel', onPointerCancel);
    window.removeEventListener('blur', onBlur);
  };
}
