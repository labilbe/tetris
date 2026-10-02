/**
 * Instantane de plateau : ce que les autres voient de notre partie.
 *
 * C'est le seul etat qui transite sur le reseau, et il ne sert qu'a afficher.
 * Le jeu, lui, continue de ne deriver que des actions : un instantane perdu,
 * tardif ou incoherent ne change la partie de personne, il fait au pire sauter
 * une vignette. C'est ce qui permet de l'envoyer sans ceremonie, et de le lire
 * sans confiance.
 *
 * Le format est du texte : une lettre par case, une chaine par rangee. Lisible
 * dans un journal reseau, et assez compact pour etre emis plusieurs fois par
 * seconde (une vingtaine de chaines de dix caracteres).
 */

import { GARBAGE_COLOR, PIECES, ROWS, COLS, STATUS, TYPES } from '../engine/constants.js';

const VIDE = '.';
const GARBAGE = '#';

/** Couleur -> lettre. Les lettres sont les types de pieces, plus le handicap. */
const LETTRE = new Map(TYPES.map((type) => [PIECES[type].color, type]));
LETTRE.set(GARBAGE_COLOR, GARBAGE);

/** Lettre -> couleur, pour le rendu chez celui qui regarde. */
const COULEUR = new Map([...LETTRE].map(([couleur, lettre]) => [lettre, couleur]));

/** Hauteur de la pile, en rangees. C'est la mesure de la difficulte du joueur. */
function hauteurPile(grid) {
  const premiere = grid.findIndex((row) => row.some((cell) => cell !== null));
  return premiere === -1 ? 0 : ROWS - premiere;
}

/**
 * Photographie l'etat pour les spectateurs.
 *
 * La piece en cours est incrustee dans les rangees : sans elle la vignette
 * serait figee entre deux verrouillages, et on ne verrait pas jouer l'autre.
 * La hauteur, elle, est mesuree sans la piece — sinon une piece qui vient
 * d'apparaitre ferait croire a une pile au plafond.
 *
 * @param {import('../engine/state.js').GameState} state
 */
export function encodeBoard(state) {
  const rows = state.grid.map((row) => row.map((cell) => LETTRE.get(cell) ?? (cell ? GARBAGE : VIDE)));

  if (state.status !== STATUS.OVER) {
    const piece = state.current;
    const lettre = LETTRE.get(piece.color) ?? GARBAGE;
    piece.cells.forEach((ligne, y) => ligne.forEach((value, x) => {
      const ny = piece.y + y;
      const nx = piece.x + x;
      if (value && rows[ny] && rows[ny][nx] !== undefined) rows[ny][nx] = lettre;
    }));
  }

  return {
    rows: rows.map((row) => row.join('')),
    hauteur: hauteurPile(state.grid),
    score: state.score,
    lines: state.lines,
  };
}

/**
 * Relit un instantane recu. Renvoie null sur tout ce qui n'a pas la bonne
 * forme : cela vient du reseau, donc de n'importe qui.
 *
 * @returns {{ grid: (string|null)[][], hauteur: number, score: number, lines: number } | null}
 */
export function decodeBoard(payload) {
  if (!payload || !Array.isArray(payload.rows) || payload.rows.length !== ROWS) return null;

  const grid = [];
  for (const row of payload.rows) {
    if (typeof row !== 'string' || row.length !== COLS) return null;
    grid.push([...row].map((lettre) => COULEUR.get(lettre) ?? null));
  }

  const entier = (valeur) => (Number.isFinite(valeur) ? Math.max(0, Math.trunc(valeur)) : 0);

  return {
    grid,
    hauteur: Math.min(ROWS, entier(payload.hauteur)),
    score: entier(payload.score),
    lines: entier(payload.lines),
  };
}
