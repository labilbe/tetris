/**
 * Tests des gestes sur le plateau.
 *
 * La machine est pure : on lui donne des points, elle rend des actions. C'est
 * ce qui permet de verifier ici ce qu'aucun essai au doigt ne verifierait deux
 * fois de suite — qu'un glissement ne compte jamais deux fois la meme case,
 * qu'une derive verticale ne fait pas descendre la piece qu'on deplace, et
 * qu'une tape repetee tourne a chaque fois.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createGestes } from '../src/input/gestures.js';

const CELLULE = 30;

function machine() {
  return createGestes({ mesurer: () => ({ celluleX: CELLULE, celluleY: CELLULE }) });
}

/** Un point au centre d'une case, a l'instant donne. */
function point(colonne, ligne, t) {
  return { x: colonne * CELLULE + CELLULE / 2, y: ligne * CELLULE + CELLULE / 2, t };
}

describe('glissement lateral', () => {
  it('deplace la piece case par case, et une seule fois chacune', () => {
    const gestes = machine();
    gestes.debut(point(4, 10, 0));

    assert.deepEqual(gestes.bouge(point(5, 10, 50)), [{ type: 'move', dx: 1 }]);
    // Meme case : le doigt a bouge, la piece non.
    assert.deepEqual(gestes.bouge({ x: point(5, 10, 60).x + 5, y: point(5, 10, 60).y, t: 60 }), []);
    assert.deepEqual(gestes.bouge(point(7, 10, 80)), [
      { type: 'move', dx: 1 },
      { type: 'move', dx: 1 },
    ]);
  });

  it('revient en arriere quand le doigt revient', () => {
    const gestes = machine();
    gestes.debut(point(4, 10, 0));
    gestes.bouge(point(7, 10, 50));

    assert.deepEqual(gestes.bouge(point(6, 10, 80)), [{ type: 'move', dx: -1 }]);
  });

  it('ignore la derive vers le bas', () => {
    // Sans le verrou d'axe, viser une colonne couterait des lignes.
    const gestes = machine();
    gestes.debut(point(4, 10, 0));
    gestes.bouge(point(7, 10, 50));

    assert.deepEqual(gestes.bouge(point(7, 12, 80)), []);
  });
});

describe('glissement vers le bas', () => {
  it('fait descendre la piece case par case', () => {
    const gestes = machine();
    gestes.debut(point(4, 2, 0));

    assert.deepEqual(gestes.bouge(point(4, 3, 50)), [{ type: 'softDrop' }]);
    assert.deepEqual(gestes.bouge(point(4, 5, 80)), [{ type: 'softDrop' }, { type: 'softDrop' }]);
  });

  it('ne remonte pas : une piece ne remonte pas non plus', () => {
    const gestes = machine();
    gestes.debut(point(4, 5, 0));
    gestes.bouge(point(4, 8, 50));

    assert.deepEqual(gestes.bouge(point(4, 6, 80)), []);
    // Et redescendre au meme endroit ne redemande rien.
    assert.deepEqual(gestes.bouge(point(4, 8, 110)), []);
  });

  it('ne dit rien avant le seuil : une tape tremble toujours un peu', () => {
    const gestes = machine();
    const depart = point(4, 0, 0);
    gestes.debut(depart);

    assert.deepEqual(gestes.bouge({ x: depart.x + 4, y: depart.y + 4, t: 20 }), []);
    // Le geste reste une tape, et la tape tourne.
    assert.deepEqual(gestes.fin({ x: depart.x + 4, y: depart.y + 4, t: 40 }), [{ type: 'rotate' }]);
  });
});

describe('tape', () => {
  it('fait tourner la piece, ou qu elle tombe sur la grille', () => {
    // Viser du pouce une piece de trente pixels qui tombe serait un geste
    // d'adresse, et rien d'autre n'attend derriere pour disputer la tape.
    const gestes = machine();

    gestes.debut(point(4, 0, 0));
    assert.deepEqual(gestes.fin(point(4, 0, 100)), [{ type: 'rotate' }]);

    gestes.debut(point(1, 15, 200));
    assert.deepEqual(gestes.fin(point(1, 15, 300)), [{ type: 'rotate' }]);
  });

  it('ne compte pas un doigt pose longtemps', () => {
    const gestes = machine();
    gestes.debut(point(4, 0, 0));

    assert.deepEqual(gestes.fin(point(4, 0, 900)), []);
  });

  it('ne compte pas la fin d un glissement', () => {
    const gestes = machine();
    gestes.debut(point(4, 0, 0));
    gestes.bouge(point(6, 0, 50));

    assert.deepEqual(gestes.fin(point(6, 0, 80)), []);
  });
});

describe('tape repetee', () => {
  it('tourne autant de fois qu on tape, sans jamais lacher la piece', () => {
    // La chute rapide a d'abord ete une double tape : tourner deux fois de
    // suite posait la piece. Elle est repartie au bouton du pave.
    const gestes = machine();

    gestes.debut(point(4, 0, 0));
    assert.deepEqual(gestes.fin(point(4, 0, 40)), [{ type: 'rotate' }]);

    gestes.debut(point(4, 0, 100));
    assert.deepEqual(gestes.fin(point(4, 0, 140)), [{ type: 'rotate' }]);

    gestes.debut(point(4, 0, 200));
    assert.deepEqual(gestes.fin(point(4, 0, 240)), [{ type: 'rotate' }]);
  });

  it('relit la taille des cases a chaque geste', () => {
    // Le plateau change de taille avec l'ecran : une geometrie figee a la
    // premiere mesure viserait la mauvaise case apres une rotation d'ecran.
    let mesures = 0;
    const gestes = createGestes({
      mesurer: () => { mesures++; return { celluleX: CELLULE, celluleY: CELLULE }; },
    });

    gestes.debut(point(1, 15, 0));
    gestes.fin(point(1, 15, 60));
    gestes.debut(point(1, 15, 150));
    gestes.fin(point(1, 15, 200));

    assert.equal(mesures, 2);
  });
});

describe('geste perdu', () => {
  it('oublie le doigt : le glissement suivant repart de son propre depart', () => {
    const gestes = machine();
    gestes.debut(point(4, 10, 0));
    gestes.bouge(point(6, 10, 50));
    gestes.annule();

    assert.deepEqual(gestes.bouge(point(9, 10, 80)), []);
  });
});
