/**
 * Tests de l'arbitre et de son election.
 *
 * L'arbitre renvoyant ses messages au lieu de les emettre, tout se verifie ici
 * sans reseau : c'est la couverture que l'ancien serveur n'avait pas.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TOUS, createHost, elire } from '../src/net/host.js';
import { CLIENT, SERVER } from '../src/net/protocol.js';

/** Graine fixe : les tests ne doivent dependre d'aucun hasard. */
const GRAINE = () => 4242;

/** Monte un hote et y fait entrer les joueurs nommes, dans l'ordre donne. */
function salonAvec(...entrees) {
  const host = createHost({ seed: GRAINE });
  for (const [id, name] of entrees) host.receive(id, { type: CLIENT.JOIN, name });
  return host;
}

/** Les messages d'un type donne dans une liste d'enveloppes. */
function duType(envelopes, type) {
  return envelopes.filter((e) => e.message.type === type);
}

describe('elire', () => {
  it('ne designe personne dans un salon vide', () => {
    assert.equal(elire([]), null);
  });

  it('designe le plus petit identifiant', () => {
    assert.equal(elire(['c', 'a', 'b']), 'a');
  });

  it('donne le meme hote quel que soit l ordre d arrivee', () => {
    // C'est toute la propriete qui compte : chacun calcule chez soi et tous
    // tombent d'accord, sans echanger un message.
    const ids = ['zoe', 'alf', 'mia', 'bob'];
    assert.equal(elire(ids), elire([...ids].reverse()));
    assert.equal(elire(ids), elire([...ids].sort()));
  });

  it('reste stable quand un autre que l hote part', () => {
    assert.equal(elire(['a', 'b', 'c']), 'a');
    assert.equal(elire(['a', 'c']), 'a');
  });

  it('change d hote quand un plus petit identifiant arrive', () => {
    // C'est le cas d'abdication : il ne peut survenir qu'avant le depart.
    assert.equal(elire(['b', 'c']), 'b');
    assert.equal(elire(['a', 'b', 'c']), 'a');
  });

  it('ignore ce qui n est pas un identifiant', () => {
    assert.equal(elire([null, 'b', undefined, 'a', 42]), 'a');
  });

  it('se contente d un seul pair', () => {
    assert.equal(elire(['seul']), 'seul');
  });
});

describe('entree dans le salon', () => {
  it('annonce l attente a tout le salon', () => {
    const host = createHost({ seed: GRAINE });
    const envelopes = host.receive('a', { type: CLIENT.JOIN, name: 'Ali' });

    assert.equal(envelopes.length, 1);
    assert.equal(envelopes[0].to, TOUS);
    assert.equal(envelopes[0].message.type, SERVER.WAITING);
    assert.equal(envelopes[0].message.players, 1);
    assert.deepEqual(envelopes[0].message.names, ['Ali']);
  });

  it('fait voir le compte monter a ceux qui patientent', () => {
    const host = salonAvec(['a', 'Ali']);
    const envelopes = host.receive('b', { type: CLIENT.JOIN, name: 'Bea' });

    assert.equal(envelopes[0].message.players, 2);
    assert.deepEqual(envelopes[0].message.names, ['Ali', 'Bea']);
  });

  it('nomme celui qui n a pas de pseudo plutot que de laisser un blanc', () => {
    const host = createHost({ seed: GRAINE });
    const envelopes = host.receive('a', { type: CLIENT.JOIN, name: '' });

    // Le salon applique son propre nom par defaut : un seul endroit connait
    // « Joueur ».
    assert.deepEqual(envelopes[0].message.names, ['Joueur']);
  });

  it('redit l etat du salon a qui se presente deux fois', () => {
    // Un pair se represente quand son election se corrige, et le reseau peut
    // doubler un message. Le prendre pour un refus ejecterait un joueur assis.
    const host = salonAvec(['a', 'Ali'], ['b', 'Bea']);
    const envelopes = host.receive('b', { type: CLIENT.JOIN, name: 'Bea' });

    assert.equal(envelopes.length, 1);
    assert.equal(envelopes[0].message.type, SERVER.WAITING);
    assert.equal(envelopes[0].message.players, 2);
    // Et surtout : pas de doublon dans le salon.
    assert.deepEqual(envelopes[0].message.names, ['Ali', 'Bea']);
  });

  it('annonce le salon sans attendre que l arrivant parle', () => {
    // Chacun comptait sur l'autre pour se presenter, et deux joueurs restaient
    // face a un salon vide.
    const host = salonAvec(['a', 'Ali']);
    const envelopes = host.annonce();

    assert.equal(envelopes.length, 1);
    assert.equal(envelopes[0].to, TOUS);
    assert.equal(envelopes[0].message.type, SERVER.WAITING);
  });

  it('n annonce plus rien une fois la partie lancee', () => {
    const host = salonAvec(['a', 'Ali'], ['b', 'Bea']);
    host.receive('a', { type: CLIENT.BEGIN });
    assert.deepEqual(host.annonce(), []);
  });

  it('refuse l arrivant quand la partie a commence', () => {
    const host = salonAvec(['a', 'Ali'], ['b', 'Bea']);
    host.receive('a', { type: CLIENT.BEGIN });

    const envelopes = host.receive('c', { type: CLIENT.JOIN, name: 'Cyr' });
    assert.equal(envelopes.length, 1);
    assert.equal(envelopes[0].to, 'c');
    assert.equal(envelopes[0].message.type, SERVER.ERROR);
  });

  it('ne lance jamais la partie de lui-meme', () => {
    // Sans cela, un arrivant de plus la declencherait a la place des presents.
    const host = salonAvec(['a', 'Ali'], ['b', 'Bea'], ['c', 'Cyr']);
    assert.equal(host.started(), false);
  });
});

describe('depart de la partie', () => {
  it('refuse de lancer a moins de deux joueurs', () => {
    const host = salonAvec(['a', 'Ali']);
    const envelopes = host.receive('a', { type: CLIENT.BEGIN });

    assert.equal(envelopes.length, 1);
    // L'erreur ne va qu'au demandeur : les autres n'ont rien demande.
    assert.equal(envelopes[0].to, 'a');
    assert.equal(envelopes[0].message.type, SERVER.ERROR);
    assert.equal(host.started(), false);
  });

  it('envoie un START a chacun, avec la meme graine', () => {
    const host = salonAvec(['a', 'Ali'], ['b', 'Bea']);
    const envelopes = host.receive('a', { type: CLIENT.BEGIN });

    const starts = duType(envelopes, SERVER.START);
    assert.equal(starts.length, 2);
    assert.equal(new Set(starts.map((e) => e.message.seed)).size, 1);
    assert.equal(starts[0].message.seed, 4242);
  });

  it('donne a chacun son propre identifiant', () => {
    const host = salonAvec(['a', 'Ali'], ['b', 'Bea']);
    const starts = duType(host.receive('a', { type: CLIENT.BEGIN }), SERVER.START);

    // Chacun doit pouvoir distinguer ses actions de celles des autres.
    for (const start of starts) assert.equal(start.to, start.message.playerId);
    assert.equal(new Set(starts.map((e) => e.message.playerId)).size, 2);
  });

  it('joint les pseudos aux identifiants', () => {
    const host = salonAvec(['a', 'Ali'], ['b', 'Bea']);
    const starts = duType(host.receive('a', { type: CLIENT.BEGIN }), SERVER.START);

    // C'est ce qui permet de nommer celui qu'on regarde jouer.
    assert.deepEqual(starts[0].message.names, { a: 'Ali', b: 'Bea' });
  });

  it('laisse n importe quel present lancer la partie', () => {
    const host = salonAvec(['a', 'Ali'], ['b', 'Bea']);
    assert.equal(duType(host.receive('b', { type: CLIENT.BEGIN }), SERVER.START).length, 2);
  });

  it('ne lance pas deux fois', () => {
    const host = salonAvec(['a', 'Ali'], ['b', 'Bea']);
    host.receive('a', { type: CLIENT.BEGIN });
    assert.deepEqual(host.receive('b', { type: CLIENT.BEGIN }), []);
  });
});

describe('eliminations', () => {
  it('annonce l elimination et le compte des survivants', () => {
    const host = salonAvec(['a', 'Ali'], ['b', 'Bea'], ['c', 'Cyr']);
    host.receive('a', { type: CLIENT.BEGIN });

    const envelopes = host.receive('a', { type: CLIENT.OVER });
    assert.equal(envelopes.length, 1);
    assert.equal(envelopes[0].to, TOUS);
    assert.equal(envelopes[0].message.type, SERVER.ELIMINATED);
    assert.equal(envelopes[0].message.playerId, 'a');
    assert.equal(envelopes[0].message.remaining, 2);
  });

  it('declare vainqueur le dernier en jeu', () => {
    const host = salonAvec(['a', 'Ali'], ['b', 'Bea']);
    host.receive('a', { type: CLIENT.BEGIN });

    const envelopes = host.receive('a', { type: CLIENT.OVER });
    assert.equal(envelopes[0].message.type, SERVER.FINISHED);
    assert.equal(envelopes[0].message.winner, 'b');
  });

  it('ferme le salon des le verdict', () => {
    // Le garder interdisait la partie suivante a tout le monde des qu'un seul
    // joueur restait devant son ecran de fin.
    const host = salonAvec(['a', 'Ali'], ['b', 'Bea']);
    host.receive('a', { type: CLIENT.BEGIN });
    host.receive('a', { type: CLIENT.OVER });

    assert.equal(host.room(), null);
  });

  it('ignore une defaite annoncee deux fois', () => {
    const host = salonAvec(['a', 'Ali'], ['b', 'Bea'], ['c', 'Cyr']);
    host.receive('a', { type: CLIENT.BEGIN });
    host.receive('a', { type: CLIENT.OVER });

    assert.deepEqual(host.receive('a', { type: CLIENT.OVER }), []);
  });

  it('ignore une defaite avant le depart', () => {
    const host = salonAvec(['a', 'Ali'], ['b', 'Bea']);
    assert.deepEqual(host.receive('a', { type: CLIENT.OVER }), []);
  });
});

describe('deconnexion', () => {
  it('vaut elimination en pleine partie', () => {
    const host = salonAvec(['a', 'Ali'], ['b', 'Bea'], ['c', 'Cyr']);
    host.receive('a', { type: CLIENT.BEGIN });

    const envelopes = host.disconnect('a');
    assert.equal(duType(envelopes, SERVER.ELIMINATED).length, 1);
    // Les survivants continuent : c'est l'elimination qui decide, pas LEFT.
    assert.equal(duType(envelopes, SERVER.LEFT).length, 1);
  });

  it('decide du vainqueur quand il ne reste qu un joueur', () => {
    const host = salonAvec(['a', 'Ali'], ['b', 'Bea']);
    host.receive('a', { type: CLIENT.BEGIN });

    const envelopes = host.disconnect('a');
    const finished = duType(envelopes, SERVER.FINISHED);
    assert.equal(finished.length, 1);
    assert.equal(finished[0].message.winner, 'b');
  });

  it('fait seulement baisser le compte avant le depart', () => {
    const host = salonAvec(['a', 'Ali'], ['b', 'Bea']);
    const envelopes = host.disconnect('b');

    // L'attente des presents n'est pas annulee pour autant.
    assert.equal(envelopes.length, 1);
    assert.equal(envelopes[0].message.type, SERVER.WAITING);
    assert.equal(envelopes[0].message.players, 1);
    assert.deepEqual(envelopes[0].message.names, ['Ali']);
  });

  it('n annonce rien quand le salon se vide', () => {
    const host = salonAvec(['a', 'Ali']);
    assert.deepEqual(host.disconnect('a'), []);
    assert.equal(host.room(), null);
  });

  it('accepte le depart d un inconnu', () => {
    const host = salonAvec(['a', 'Ali']);
    assert.deepEqual(host.disconnect('fantome'), []);
  });

  it('libere le pseudo au depart', () => {
    const host = salonAvec(['a', 'Ali']);
    host.disconnect('a');

    const envelopes = host.receive('b', { type: CLIENT.JOIN, name: 'Ali' });
    // Sans liberation, le second serait numerote « Ali 2 » sans raison.
    assert.deepEqual(envelopes[0].message.names, ['Ali']);
  });
});

describe('messages inattendus', () => {
  it('ignore ce qui n est pas un message', () => {
    const host = createHost({ seed: GRAINE });
    // Un pair peut toujours envoyer n'importe quoi : cela ne doit pas tuer la
    // partie, comme le fait deja decode().
    assert.deepEqual(host.receive('a', null), []);
    assert.deepEqual(host.receive('a', {}), []);
    assert.deepEqual(host.receive('a', { type: 42 }), []);
    assert.deepEqual(host.receive('a', { type: 'inconnu' }), []);
  });

  it('ignore une demande de depart d un inconnu', () => {
    const host = salonAvec(['a', 'Ali'], ['b', 'Bea']);
    assert.deepEqual(host.receive('fantome', { type: CLIENT.BEGIN }), []);
  });
});
