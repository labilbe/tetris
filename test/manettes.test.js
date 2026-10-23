/**
 * Tests des manettes.
 *
 * La machine est pure : on lui donne l'etat des manettes et l'heure, elle rend
 * des actions. C'est ce qui permet de verifier ici ce qu'aucun essai au pouce
 * ne verifierait deux fois de suite — qu'un bouton tenu ne lache pas la piece
 * en boucle, qu'une direction tenue se repete a rythme regulier, et qu'une
 * manette debranchee n'emporte pas une repetition en cours.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createManettes } from '../src/input/gamepad.js';

const DELAI_MS = 170;
const REPET_MS = 60;

/** Une manette au repos, dans la disposition standard. */
function manette({ boutons = {}, axes = [0, 0] } = {}) {
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
  for (const [index, pressed] of Object.entries(boutons)) {
    buttons[index] = { pressed, value: pressed ? 1 : 0 };
  }
  return { index: 0, buttons, axes };
}

describe('les deux boutons', () => {
  it('fait tourner la piece au premier bouton, une fois par appui', () => {
    const manettes = createManettes();

    assert.deepEqual(manettes.lire([manette({ boutons: { 0: true } })], 0), [{ type: 'rotate' }]);
    // Toujours enfonce : une rotation qui se repeterait seule ferait tourner la
    // piece sur place tant qu'on garde le pouce dessus.
    assert.deepEqual(manettes.lire([manette({ boutons: { 0: true } })], 500), []);
    assert.deepEqual(manettes.lire([manette()], 520), []);
    assert.deepEqual(manettes.lire([manette({ boutons: { 0: true } })], 540), [{ type: 'rotate' }]);
  });

  it('lache la piece au deuxieme bouton, une fois par appui', () => {
    const manettes = createManettes();

    assert.deepEqual(manettes.lire([manette({ boutons: { 1: true } })], 0), [{ type: 'hardDrop' }]);
    // Le cas qui compte : un bouton tenu une seconde ne doit pas poser une
    // piece par image.
    assert.deepEqual(manettes.lire([manette({ boutons: { 1: true } })], 1000), []);
  });

  it('accepte les deux a la fois', () => {
    const manettes = createManettes();

    assert.deepEqual(manettes.lire([manette({ boutons: { 0: true, 1: true } })], 0), [
      { type: 'rotate' },
      { type: 'hardDrop' },
    ]);
  });
});

describe('directions', () => {
  it('deplace la piece a la croix, puis se repete', () => {
    const manettes = createManettes();
    const pousse = () => manette({ boutons: { 14: true } });

    assert.deepEqual(manettes.lire([pousse()], 0), [{ type: 'move', dx: -1 }]);
    // Avant l'echeance : rien, pour pouvoir n'avancer que d'une case.
    assert.deepEqual(manettes.lire([pousse()], DELAI_MS - 1), []);
    assert.deepEqual(manettes.lire([pousse()], DELAI_MS), [{ type: 'move', dx: -1 }]);
    assert.deepEqual(manettes.lire([pousse()], DELAI_MS + REPET_MS), [{ type: 'move', dx: -1 }]);
  });

  it('rattrape les images sautees sans depasser l heure', () => {
    const manettes = createManettes();
    const pousse = () => manette({ axes: [1, 0] });

    manettes.lire([pousse()], 0);
    // Un saut de deux repetitions apres le delai : deux cases, pas trois.
    assert.deepEqual(manettes.lire([pousse()], DELAI_MS + REPET_MS), [
      { type: 'move', dx: 1 },
      { type: 'move', dx: 1 },
    ]);
  });

  it('fait descendre la piece vers le bas, au stick comme a la croix', () => {
    const croix = createManettes();
    assert.deepEqual(croix.lire([manette({ boutons: { 13: true } })], 0), [{ type: 'softDrop' }]);

    const stick = createManettes();
    assert.deepEqual(stick.lire([manette({ axes: [0, 1] })], 0), [{ type: 'softDrop' }]);
  });

  it('ignore un stick a peine pousse', () => {
    const manettes = createManettes();

    assert.deepEqual(manettes.lire([manette({ axes: [.2, -.3] })], 0), []);
  });

  it('ne fait pas remonter la piece', () => {
    // Une piece ne remonte pas : le haut n'a rien a dire.
    const manettes = createManettes();

    assert.deepEqual(manettes.lire([manette({ boutons: { 12: true } })], 0), []);
    assert.deepEqual(manettes.lire([manette({ axes: [0, -1] })], 0), []);
  });
});

describe('manettes branchees et debranchees', () => {
  it('ignore les trous de la liste', () => {
    const manettes = createManettes();

    assert.deepEqual(manettes.lire([null, undefined], 0), []);
    assert.deepEqual(manettes.lire(undefined, 0), []);
  });

  it('laisse chaque manette piloter le meme plateau', () => {
    const manettes = createManettes();
    const premiere = { ...manette({ boutons: { 0: true } }), index: 0 };
    const seconde = { ...manette({ boutons: { 0: true } }), index: 1 };

    assert.deepEqual(manettes.lire([premiere, seconde], 0), [
      { type: 'rotate' },
      { type: 'rotate' },
    ]);
  });

  it('oublie une manette debranchee, repetition comprise', () => {
    const manettes = createManettes();
    const pousse = () => manette({ boutons: { 15: true } });

    manettes.lire([pousse()], 0);
    manettes.lire([], 1000);

    // Rebranchee bouton tenu : c'est un nouvel appui, pas la suite de l'ancien
    // — sinon le rattrapage lacherait une seconde entiere de deplacements.
    assert.deepEqual(manettes.lire([pousse()], 1020), [{ type: 'move', dx: 1 }]);
  });
});
