/**
 * Moteur du jeu : pur et deterministe.
 *
 * Aucun acces au DOM, a l'horloge ou a Math.random. L'etat n'est jamais mute :
 * chaque fonction renvoie un nouvel etat. Deux machines qui partent de la meme
 * graine et appliquent la meme suite d'actions et de ticks obtiennent des etats
 * identiques, ce qui est la condition pour le jeu en reseau.
 */

import {
  BASE_DROP_MS,
  COLS,
  DROP_MS_PER_LEVEL,
  GARBAGE_COLOR,
  HARD_DROP_POINTS_PER_ROW,
  KICK_OFFSETS,
  LINE_POINTS,
  LINES_PER_LEVEL,
  MIN_DROP_MS,
  PIECES,
  ROWS,
  SOFT_DROP_POINTS,
  STATUS,
  TYPES,
} from './constants.js';
import { createRng, shuffle } from './rng.js';

/**
 * @typedef {{ type: string, color: string, cells: number[][], x: number, y: number }} Piece
 * @typedef {{
 *   seed: number,
 *   rng: import('./rng.js').Rng,
 *   grid: (string|null)[][],
 *   bag: string[],
 *   current: Piece,
 *   next: Piece,
 *   score: number,
 *   lines: number,
 *   level: number,
 *   dropCounter: number,
 *   status: string,
 * }} GameState
 */

/** Delta maximum absorbe par un tick : evite de rattraper 10 min d'onglet en veille. */
const MAX_TICK_MS = 1000;

function emptyGrid() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(null));
}

/**
 * Tire le prochain type de piece dans le sac de 7 (chaque piece sort une fois
 * par cycle), en rechargeant le sac au besoin.
 */
function takeType(bag, rng) {
  if (bag.length === 0) {
    const refilled = shuffle(TYPES, rng);
    const nextBag = refilled.items;
    const type = nextBag.pop();
    return { type, bag: nextBag, rng: refilled.rng };
  }
  const nextBag = bag.slice();
  const type = nextBag.pop();
  return { type, bag: nextBag, rng };
}

/** @returns {Piece} */
function spawnPiece(type) {
  const piece = PIECES[type];
  return {
    type,
    color: piece.color,
    cells: piece.cells.map((row) => row.slice()),
    x: Math.floor((COLS - piece.cells.length) / 2),
    y: 0,
  };
}

function drawPiece(bag, rng) {
  const taken = takeType(bag, rng);
  return { piece: spawnPiece(taken.type), bag: taken.bag, rng: taken.rng };
}

/**
 * Teste une position de piece contre les bords et les cases figees.
 * @param {(string|null)[][]} grid
 * @param {Piece} piece
 */
export function collides(grid, piece, offsetX = 0, offsetY = 0, cells = piece.cells) {
  for (let y = 0; y < cells.length; y++) {
    for (let x = 0; x < cells[y].length; x++) {
      if (!cells[y][x]) continue;
      const nx = piece.x + x + offsetX;
      const ny = piece.y + y + offsetY;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && grid[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCells(cells) {
  const size = cells.length;
  const out = Array.from({ length: size }, () => new Array(size).fill(0));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      out[x][size - 1 - y] = cells[y][x];
    }
  }
  return out;
}

/** Fige la piece courante dans une copie de la grille. */
function merge(grid, piece) {
  const next = grid.map((row) => row.slice());
  piece.cells.forEach((row, y) => {
    row.forEach((value, x) => {
      if (!value) return;
      const ny = piece.y + y;
      if (ny >= 0) next[ny][piece.x + x] = piece.color;
    });
  });
  return next;
}

/** @returns {{ grid: (string|null)[][], cleared: number }} */
function clearLines(grid) {
  const kept = grid.filter((row) => row.some((cell) => cell === null));
  const cleared = ROWS - kept.length;
  if (cleared === 0) return { grid, cleared };
  const empty = Array.from({ length: cleared }, () => new Array(COLS).fill(null));
  return { grid: [...empty, ...kept], cleared };
}

/** Intervalle de chute automatique, en millisecondes. */
export function dropInterval(state) {
  return Math.max(MIN_DROP_MS, BASE_DROP_MS - (state.level - 1) * DROP_MS_PER_LEVEL);
}

/** Ligne d'atterrissage de la piece courante (projection affichee en transparence). */
export function ghostRow(state) {
  let offset = 0;
  while (!collides(state.grid, state.current, 0, offset + 1)) offset++;
  return state.current.y + offset;
}

/**
 * Nouvelle partie.
 * @param {number} seed graine du generateur ; en reseau elle est imposee par le serveur
 * @returns {GameState}
 */
export function createState(seed) {
  const first = drawPiece([], createRng(seed));
  const second = drawPiece(first.bag, first.rng);
  return {
    seed,
    rng: second.rng,
    grid: emptyGrid(),
    bag: second.bag,
    current: first.piece,
    next: second.piece,
    score: 0,
    lines: 0,
    level: 1,
    dropCounter: 0,
    status: STATUS.PLAYING,
  };
}

/** Fige la piece, efface les lignes pleines, fait entrer la suivante. */
function lockPiece(state) {
  const merged = merge(state.grid, state.current);
  const { grid, cleared } = clearLines(merged);

  const lines = state.lines + cleared;
  const level = Math.floor(lines / LINES_PER_LEVEL) + 1;
  const score = state.score + LINE_POINTS[cleared] * state.level;

  const drawn = drawPiece(state.bag, state.rng);
  const current = state.next;

  // Si la piece entrante ne tient pas, la pile a atteint le haut.
  const status = collides(grid, current) ? STATUS.OVER : state.status;

  return {
    ...state,
    grid,
    lines,
    level,
    score,
    current,
    next: drawn.piece,
    bag: drawn.bag,
    rng: drawn.rng,
    dropCounter: 0,
    status,
  };
}

/** Un cran de gravite : descend d'une case, ou fige la piece si elle est posee. */
function applyGravity(state) {
  if (collides(state.grid, state.current, 0, 1)) return lockPiece(state);
  return {
    ...state,
    current: { ...state.current, y: state.current.y + 1 },
    dropCounter: 0,
  };
}

/**
 * Ajoute des lignes de handicap par le bas : la pile remonte d'autant.
 *
 * Les colonnes trouees arrivent avec l'action, elles ne sont pas tirees ici.
 * C'est ce qui rend le handicap identique chez tous : le tirer localement
 * donnerait des trous differents a chacun, et le tirer avec le generateur du
 * jeu ferait diverger la suite de pieces.
 *
 * @param {GameState} state
 * @param {number[]} holes une colonne trouee par ligne ajoutee
 */
function addGarbage(state, holes) {
  if (!Array.isArray(holes) || holes.length === 0) return state;

  let grid = state.grid;
  let toppedOut = false;

  for (const hole of holes) {
    // Ce qui occupait la ligne du haut est pousse hors du plateau : la pile a
    // atteint le plafond.
    if (grid[0].some((cell) => cell !== null)) toppedOut = true;

    const row = new Array(COLS).fill(GARBAGE_COLOR);
    if (hole >= 0 && hole < COLS) row[hole] = null;
    grid = [...grid.slice(1), row];
  }

  // La piece en cours peut se retrouver dans la pile qui vient de monter : on
  // la remonte d'autant que necessaire.
  let current = state.current;
  while (collides(grid, current) && current.y > -current.cells.length) {
    current = { ...current, y: current.y - 1 };
  }

  const status = toppedOut || collides(grid, current) ? STATUS.OVER : state.status;
  return { ...state, grid, current, status };
}

function move(state, dx) {
  if (collides(state.grid, state.current, dx, 0)) return state;
  return { ...state, current: { ...state.current, x: state.current.x + dx } };
}

function rotate(state) {
  const cells = rotateCells(state.current.cells);
  for (const dx of KICK_OFFSETS) {
    if (!collides(state.grid, state.current, dx, 0, cells)) {
      return { ...state, current: { ...state.current, cells, x: state.current.x + dx } };
    }
  }
  return state;
}

function hardDrop(state) {
  let distance = 0;
  while (!collides(state.grid, state.current, 0, distance + 1)) distance++;
  const dropped = {
    ...state,
    current: { ...state.current, y: state.current.y + distance },
    score: state.score + distance * HARD_DROP_POINTS_PER_ROW,
  };
  return lockPiece(dropped);
}

function softDrop(state) {
  // La descente volontaire ne rapporte que si la piece descend vraiment d'une case.
  if (collides(state.grid, state.current, 0, 1)) return lockPiece(state);
  return { ...applyGravity(state), score: state.score + SOFT_DROP_POINTS };
}

/**
 * Applique une action de joueur. C'est le seul point d'entree des commandes :
 * en reseau, ce sont ces actions qui transitent, pas l'etat.
 *
 * @param {GameState} state
 * @param {{ type: string, dx?: number, seed?: number }} action
 * @returns {GameState}
 */
export function reduce(state, action) {
  switch (action.type) {
    case 'reset':
      return createState(action.seed ?? state.seed);
    case 'pause':
      return state.status === STATUS.PLAYING ? { ...state, status: STATUS.PAUSED } : state;
    case 'resume':
      return state.status === STATUS.PAUSED ? { ...state, status: STATUS.PLAYING } : state;
    case 'togglePause':
      if (state.status === STATUS.PLAYING) return { ...state, status: STATUS.PAUSED };
      if (state.status === STATUS.PAUSED) return { ...state, status: STATUS.PLAYING };
      return state;
    default:
      break;
  }

  if (state.status !== STATUS.PLAYING) return state;

  switch (action.type) {
    case 'move':
      return move(state, action.dx);
    case 'rotate':
      return rotate(state);
    case 'softDrop':
      return softDrop(state);
    case 'hardDrop':
      return hardDrop(state);
    case 'garbage':
      return addGarbage(state, action.holes);
    default:
      return state;
  }
}

/**
 * Avance le temps. Le moteur ne lit jamais l'horloge lui-meme : le delta est
 * fourni par l'appelant, ce qui permet de rejouer une partie a l'identique.
 *
 * @param {GameState} state
 * @param {number} deltaMs
 * @returns {GameState}
 */
export function tick(state, deltaMs) {
  if (state.status !== STATUS.PLAYING) return state;

  const delta = Math.min(Math.max(deltaMs, 0), MAX_TICK_MS);
  let next = { ...state, dropCounter: state.dropCounter + delta };

  let interval = dropInterval(next);
  while (next.dropCounter >= interval && next.status === STATUS.PLAYING) {
    const carry = next.dropCounter - interval;
    next = applyGravity(next);
    next = { ...next, dropCounter: carry };
    interval = dropInterval(next);
  }

  return next;
}
