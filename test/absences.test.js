/**
 * Tests du gel de la partie quand un joueur est coupe.
 *
 * Le temps est un parametre : aucune de ces fonctions ne lit l'horloge, et les
 * trente secondes d'attente s'eprouvent donc sans en passer une seule.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MARGE_MS, attendus, messageAttente, noter, oublier } from '../src/net/absences.js';

describe('joueurs attendus', () => {
  it('ne gele rien quand personne n\'est coupe', () => {
    assert.deepEqual(attendus(new Map(), 0), []);
  });

  it('attend celui qui vient d\'etre coupe, et dit combien de temps', () => {
    const absences = noter(new Map(), 'a', 30, 1000);
    assert.deepEqual(attendus(absences, 1000), [{ playerId: 'a', reste: 30 }]);
    assert.deepEqual(attendus(absences, 11000), [{ playerId: 'a', reste: 20 }]);
  });

  it('n\'annonce jamais un decompte negatif', () => {
    const absences = noter(new Map(), 'a', 30, 0);
    assert.deepEqual(attendus(absences, 31000), [{ playerId: 'a', reste: 0 }]);
  });

  it('cesse d\'attendre passe l\'echeance et sa marge', () => {
    const absences = noter(new Map(), 'a', 30, 0);

    // La marge laisse au relais le temps de prononcer son elimination : tant
    // qu'elle court, la partie reste gelee.
    assert.equal(attendus(absences, 30000 + MARGE_MS - 1).length, 1);
    // Passe ce point, la partie repart meme si le verdict s'est perdu : une
    // partie gelee pour toujours serait pire que tout.
    assert.deepEqual(attendus(absences, 30000 + MARGE_MS), []);
  });

  it('attend plusieurs joueurs a la fois', () => {
    let absences = noter(new Map(), 'a', 30, 0);
    absences = noter(absences, 'b', 30, 5000);

    assert.deepEqual(attendus(absences, 5000).map((a) => a.playerId), ['a', 'b']);
    // Le premier expire sans emporter le second.
    assert.deepEqual(attendus(absences, 31000 + MARGE_MS).map((a) => a.playerId), ['b']);
  });

  it('oublie celui qui revient', () => {
    const absences = oublier(noter(new Map(), 'a', 30, 0), 'a');
    assert.deepEqual(attendus(absences, 0), []);
  });

  it('ne bronche pas sur un retour qu\'on n\'attendait pas', () => {
    const absences = noter(new Map(), 'a', 30, 0);
    assert.equal(oublier(absences, 'inconnu'), absences);
  });

  it('ne modifie jamais l\'etat recu', () => {
    const depart = noter(new Map(), 'a', 30, 0);
    noter(depart, 'b', 30, 0);
    oublier(depart, 'a');
    assert.deepEqual([...depart.keys()], ['a']);
  });

  it('repart a zero quand le meme joueur se coupe une seconde fois', () => {
    let absences = noter(new Map(), 'a', 30, 0);
    absences = noter(absences, 'a', 30, 20000);
    assert.deepEqual(attendus(absences, 20000), [{ playerId: 'a', reste: 30 }]);
  });
});

describe('ce qu\'on affiche pendant l\'attente', () => {
  const noms = { a: 'Volga', b: 'Neva' };

  it('ne dit rien quand il n\'y a personne a attendre', () => {
    assert.equal(messageAttente([], noms), '');
  });

  it('nomme celui qu\'on attend, et le decompte', () => {
    const texte = messageAttente(attendus(noter(new Map(), 'a', 30, 0), 10000), noms);
    assert.match(texte, /Volga/);
    assert.match(texte, /20 s/);
  });

  it('les nomme tous, et retient le decompte le plus long', () => {
    let absences = noter(new Map(), 'a', 30, 0);
    absences = noter(absences, 'b', 30, 5000);

    const texte = messageAttente(attendus(absences, 5000), noms);
    assert.match(texte, /Volga et Neva/);
    // Neva vient d'etre coupee : c'est elle qui fait attendre le plus longtemps.
    assert.match(texte, /30 s/);
  });

  it('se contente d\'un mot quand le pseudo est inconnu', () => {
    const texte = messageAttente([{ playerId: 'z', reste: 12 }], noms);
    assert.match(texte, /un joueur/);
    assert.doesNotMatch(texte, /\bz\b/);
  });
});
