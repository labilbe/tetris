/** Regles et donnees du jeu. Aucune dependance : partageable client et serveur. */

export const COLS = 10;
export const ROWS = 20;

/** Chaque piece est une matrice carree : la rotation se fait par transposition. */
export const PIECES = {
  I: { color: '#4ad9e4', cells: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]] },
  J: { color: '#5a7cf5', cells: [[1, 0, 0], [1, 1, 1], [0, 0, 0]] },
  L: { color: '#f0a03c', cells: [[0, 0, 1], [1, 1, 1], [0, 0, 0]] },
  O: { color: '#f3d13e', cells: [[1, 1], [1, 1]] },
  S: { color: '#63d471', cells: [[0, 1, 1], [1, 1, 0], [0, 0, 0]] },
  T: { color: '#b46ce8', cells: [[0, 1, 0], [1, 1, 1], [0, 0, 0]] },
  Z: { color: '#ef5a6f', cells: [[1, 1, 0], [0, 1, 1], [0, 0, 0]] },
};

export const TYPES = Object.keys(PIECES);

/** Points par nombre de lignes effacees d'un coup, multiplies par le niveau. */
export const LINE_POINTS = [0, 100, 300, 500, 800];

/**
 * Lignes de handicap envoyees aux autres joueurs selon le nombre de lignes
 * effacees d'un coup. Une seule ligne n'envoie rien : il faut en reussir au
 * moins deux pour genner quelqu'un.
 */
export const GARBAGE_SENT = { 2: 1, 3: 2, 4: 4 };

/** Les lignes recues sont grises : elles ne viennent d'aucune piece. */
export const GARBAGE_COLOR = '#6b7280';

export const SOFT_DROP_POINTS = 1;
export const HARD_DROP_POINTS_PER_ROW = 2;
export const LINES_PER_LEVEL = 10;

/** Decalages tentes quand une rotation sort du plateau (wall kick simple). */
export const KICK_OFFSETS = [0, -1, 1, -2, 2];

export const BASE_DROP_MS = 1000;
export const DROP_MS_PER_LEVEL = 80;
export const MIN_DROP_MS = 80;

export const STATUS = {
  PLAYING: 'playing',
  PAUSED: 'paused',
  OVER: 'over',
};
