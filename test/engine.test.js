/**
 * Tests du moteur. Ils tournent sous Node sans navigateur : c'est exactement ce
 * que le decoupage rend possible, et c'est aussi ce qui garantit la propriete
 * dont depend le jeu en reseau (meme graine + memes actions => meme etat).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { COLS, ROWS, STATUS } from '../src/engine/constants.js';
import { createState, reduce, tick } from '../src/engine/state.js';

const SEED = 12345;

/** Suite d'actions variee, rejouable a l'identique. */
const SCRIPT = [
  { type: 'move', dx: -1 },
  { type: 'rotate' },
  { type: 'move', dx: 1 },
  { type: 'softDrop' },
  { type: 'hardDrop' },
  { type: 'rotate' },
  { type: 'hardDrop' },
];

function play(seed, actions) {
  let state = createState(seed);
  for (const action of actions) {
    state = reduce(state, action);
    state = tick(state, 120);
  }
  return state;
}

describe('determinisme', () => {
  it('rejoue la meme partie a partir de la meme graine', () => {
    assert.deepEqual(play(SEED, SCRIPT), play(SEED, SCRIPT));
  });

  it('produit une partie differente avec une autre graine', () => {
    // Sur une seule piece la coincidence est banale : on compare un sac entier.
    const sequence = (seed) => {
      let state = createState(seed);
      const types = [state.current.type];
      for (let i = 0; i < 7; i++) {
        state = reduce(state, { type: 'hardDrop' });
        types.push(state.current.type);
      }
      return types.join('');
    };
    assert.notEqual(sequence(SEED), sequence(SEED + 1));
  });

  it('ne mute jamais l etat recu', () => {
    const state = createState(SEED);
    const snapshot = JSON.stringify(state);
    reduce(state, { type: 'hardDrop' });
    tick(state, 5000);
    assert.equal(JSON.stringify(state), snapshot);
  });
});

describe('sac de 7', () => {
  it('sort les 7 pieces avant d en repeter une', () => {
    let state = createState(SEED);
    const seen = [state.current.type, state.next.type];
    while (seen.length < 7) {
      state = reduce(state, { type: 'hardDrop' });
      seen.push(state.next.type);
    }
    assert.equal(new Set(seen).size, 7);
  });
});

describe('gravite', () => {
  it('fait descendre la piece quand l intervalle est ecoule', () => {
    const state = createState(SEED);
    const after = tick(state, 1000);
    assert.equal(after.current.y, state.current.y + 1);
  });

  it('ne bouge pas avant l intervalle', () => {
    const state = createState(SEED);
    assert.equal(tick(state, 100).current.y, state.current.y);
  });

  it('ignore le temps en pause', () => {
    const paused = reduce(createState(SEED), { type: 'pause' });
    assert.deepEqual(tick(paused, 5000), paused);
  });
});

describe('lignes', () => {
  it('efface une ligne pleine et compte les points', () => {
    const state = createState(SEED);
    // Grille dont la derniere ligne est pleine sauf une case, comblee ensuite
    // par une chute rapide dans cette colonne.
    const grid = state.grid.map((row) => row.slice());
    const hole = state.current.x;
    for (let x = 0; x < COLS; x++) {
      if (x !== hole) grid[ROWS - 1][x] = '#ffffff';
    }

    const single = { ...state.current, cells: [[1]], x: hole, y: 0 };
    const prepared = { ...state, grid, current: single };
    const after = reduce(prepared, { type: 'hardDrop' });

    assert.equal(after.lines, 1);
    assert.ok(after.grid[ROWS - 1].every((cell) => cell === null));
    // 100 points pour la ligne (niveau 1) + 2 par ligne parcourue en chute rapide.
    assert.equal(after.score, 100 + (ROWS - 1) * 2);
  });

  it('monte de niveau toutes les 10 lignes', () => {
    const state = { ...createState(SEED), lines: 9 };
    const grid = state.grid.map((row) => row.slice());
    const hole = state.current.x;
    for (let x = 0; x < COLS; x++) {
      if (x !== hole) grid[ROWS - 1][x] = '#ffffff';
    }
    const prepared = { ...state, grid, current: { ...state.current, cells: [[1]], x: hole, y: 0 } };
    const after = reduce(prepared, { type: 'hardDrop' });

    assert.equal(after.lines, 10);
    assert.equal(after.level, 2);
  });
});

describe('fin de partie', () => {
  it('passe en game over quand la pile atteint le haut', () => {
    const state = createState(SEED);
    // Toutes les colonnes pleines sauf la premiere : aucune ligne n est complete,
    // donc rien ne s efface, et la piece suivante n a plus de place pour entrer.
    const grid = state.grid.map((row) => row.map((_, x) => (x === 0 ? null : '#ffffff')));
    const after = reduce({ ...state, grid }, { type: 'hardDrop' });

    assert.equal(after.status, STATUS.OVER);
    assert.deepEqual(tick(after, 5000), after);
  });
});

describe('deplacements', () => {
  it('bloque la piece contre le bord gauche', () => {
    let state = createState(SEED);
    for (let i = 0; i < COLS; i++) state = reduce(state, { type: 'move', dx: -1 });
    const blocked = reduce(state, { type: 'move', dx: -1 });
    assert.equal(blocked.current.x, state.current.x);
  });

  it('ignore les actions de jeu en pause', () => {
    const paused = reduce(createState(SEED), { type: 'pause' });
    assert.deepEqual(reduce(paused, { type: 'move', dx: -1 }), paused);
  });

  it('reprend apres une pause', () => {
    const state = reduce(reduce(createState(SEED), { type: 'pause' }), { type: 'resume' });
    assert.equal(state.status, STATUS.PLAYING);
  });
});
