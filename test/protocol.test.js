/**
 * Tests du vocabulaire reseau : codes de salon et pseudos.
 *
 * Le code de salon est la seule chose qu'un joueur recopie a la main depuis
 * l'ecran d'un autre : il merite d'etre eprouve comme une entree hostile.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BOT_NAMES,
  HUMAN_NAMES,
  ROOM_MAX,
  ROOM_MIN,
  cleanRoom,
  randomBotName,
  randomRoom,
} from '../src/net/protocol.js';

describe('cleanRoom', () => {
  it('ignore la casse', () => {
    assert.equal(cleanRoom('abcd'), 'ABCD');
  });

  it('jette ce qui n est ni lettre ni chiffre', () => {
    // Espaces et tirets s'ajoutent tout seuls quand on recopie un code.
    assert.equal(cleanRoom(' ab-cd 12 '), 'ABCD12');
    assert.equal(cleanRoom('A!B@C#D'), 'ABCD');
  });

  it('tronque a la longueur maximale', () => {
    assert.equal(cleanRoom('ABCDEFGHIJKL').length, ROOM_MAX);
  });

  it('renvoie une chaine vide plutot que de deviner', () => {
    // A l'appelant d'en tirer un au sort : inventer ici masquerait la saisie vide.
    assert.equal(cleanRoom('   '), '');
    assert.equal(cleanRoom('!!!'), '');
    assert.equal(cleanRoom(''), '');
    assert.equal(cleanRoom(null), '');
    assert.equal(cleanRoom(42), '');
  });

  it('laisse passer un code deja propre', () => {
    assert.equal(cleanRoom('K7M2P'), 'K7M2P');
  });
});

describe('randomRoom', () => {
  it('tire un code de longueur acceptable', () => {
    const code = randomRoom();
    assert.ok(code.length >= ROOM_MIN && code.length <= ROOM_MAX);
  });

  it('n emploie que des caracteres sans ambiguite', () => {
    // Ni O/0 ni I/1 : un code se lit a voix haute.
    for (let i = 0; i < 200; i += 1) {
      assert.match(randomRoom(), /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/);
    }
  });

  it('survit a un hasard degenere', () => {
    assert.equal(cleanRoom(randomRoom(() => 0)), randomRoom(() => 0));
    assert.equal(randomRoom(() => 0.999999).length, 5);
  });

  it('passe son propre nettoyage', () => {
    // Un code tire au sort ne doit jamais etre altere par cleanRoom.
    for (let i = 0; i < 50; i += 1) {
      const code = randomRoom();
      assert.equal(cleanRoom(code), code);
    }
  });
});

describe('prenoms des adversaires artificiels', () => {
  it('ne croise jamais les noms des humains', () => {
    // C'est la promesse du multiplex : distinguer d'un coup d'oeil une IA d'un
    // humain. Elle ne tenait qu'a un commentaire, elle tient maintenant a ceci.
    const humains = new Set(HUMAN_NAMES);
    for (const prenom of BOT_NAMES) {
      assert.ok(!humains.has(prenom), `${prenom} sert aussi de nom humain`);
    }
  });

  it('tire un prenom de la liste', () => {
    assert.ok(BOT_NAMES.includes(randomBotName()));
  });

  it('survit a un hasard degenere', () => {
    assert.equal(randomBotName(() => 0), BOT_NAMES[0]);
    assert.equal(randomBotName(() => 0.999999), BOT_NAMES[BOT_NAMES.length - 1]);
  });
});
