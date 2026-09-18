/**
 * Tests des salons. Comme le moteur, cette logique est pure : elle se teste
 * sans serveur ni socket, ce qui laisse a server/index.js le seul reseau.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { alive, begin, createLobby, eliminate, join, leave, roomOf, waitingStatus } from '../server/rooms.js';

const SEED = 4242;

/** Salon peuple puis lance, pour les tests de partie en cours. */
function partie(joueurs, options) {
  let lobby = createLobby(options);
  for (const id of joueurs) lobby = join(lobby, 'test', id, SEED).lobby;
  return begin(lobby, 'test').lobby;
}

describe('arrivee dans un salon', () => {
  it('cree le salon au premier joueur', () => {
    const { lobby, room, joined } = join(createLobby(), 'test', 'a', SEED);

    assert.equal(joined, true);
    assert.equal(room.started, false);
    assert.deepEqual(room.players, ['a']);
    assert.equal(room.seed, SEED);
    assert.deepEqual(waitingStatus(lobby, room), { room: 'test', players: 1, min: 2, max: 6 });
  });

  it('accueille plus de deux joueurs', () => {
    let lobby = createLobby();
    for (const id of ['a', 'b', 'c', 'd']) lobby = join(lobby, 'test', id, SEED).lobby;

    assert.deepEqual(lobby.rooms.test.players, ['a', 'b', 'c', 'd']);
  });

  it('garde la graine du salon, pas celle de l arrivant', () => {
    // Sinon les joueurs ne verraient pas la meme suite de pieces.
    const premier = join(createLobby(), 'test', 'a', SEED);
    const second = join(premier.lobby, 'test', 'b', 999);

    assert.equal(second.room.seed, SEED);
  });

  it('signale le salon plein au dernier arrivant', () => {
    let lobby = createLobby({ max: 3 });
    lobby = join(lobby, 'test', 'a', SEED).lobby;
    lobby = join(lobby, 'test', 'b', SEED).lobby;
    const dernier = join(lobby, 'test', 'c', SEED);

    assert.equal(dernier.joined, true);
    assert.equal(dernier.full, true);
  });

  it('refuse un joueur de trop', () => {
    let lobby = createLobby({ max: 2 });
    lobby = join(lobby, 'test', 'a', SEED).lobby;
    lobby = join(lobby, 'test', 'b', SEED).lobby;

    const refuse = join(lobby, 'test', 'c', SEED);
    assert.equal(refuse.joined, false);
    assert.equal(refuse.full, true);
  });

  it('refuse un arrivant apres le debut', () => {
    const lobby = partie(['a', 'b']);
    assert.equal(join(lobby, 'test', 'c', SEED).joined, false);
  });

  it('ignore une arrivee en double', () => {
    const premier = join(createLobby(), 'test', 'a', SEED);
    const doublon = join(premier.lobby, 'test', 'a', SEED);

    assert.equal(doublon.joined, false);
    assert.deepEqual(doublon.room.players, ['a']);
  });

  it('separe les salons', () => {
    let lobby = createLobby();
    lobby = join(lobby, 'rouge', 'a', 1).lobby;
    const bleu = join(lobby, 'bleu', 'b', 2);

    assert.equal(roomOf(bleu.lobby, 'a').code, 'rouge');
    assert.equal(roomOf(bleu.lobby, 'b').code, 'bleu');
  });

  it('ne mute pas le lobby recu', () => {
    const lobby = createLobby();
    const avant = JSON.stringify(lobby);
    join(lobby, 'test', 'a', SEED);

    assert.equal(JSON.stringify(lobby), avant);
  });
});

describe('lancement', () => {
  it('refuse de lancer a un seul joueur', () => {
    const lobby = join(createLobby(), 'test', 'a', SEED).lobby;
    const lance = begin(lobby, 'test');

    assert.equal(lance.started, false);
    assert.equal(lance.room.started, false);
  });

  it('lance des le minimum atteint, sans attendre le salon plein', () => {
    // C'est ce qui rend possible une partie a trois quand le maximum est six.
    let lobby = createLobby({ max: 6 });
    lobby = join(lobby, 'test', 'a', SEED).lobby;
    lobby = join(lobby, 'test', 'b', SEED).lobby;
    lobby = join(lobby, 'test', 'c', SEED).lobby;

    const lance = begin(lobby, 'test');
    assert.equal(lance.started, true);
    assert.deepEqual(lance.room.players, ['a', 'b', 'c']);
  });

  it('ne relance pas une partie en cours', () => {
    assert.equal(begin(partie(['a', 'b']), 'test').started, false);
  });

  it('ignore un salon inconnu', () => {
    assert.equal(begin(createLobby(), 'absent').started, false);
  });
});

describe('eliminations', () => {
  it('a deux, la premiere defaite designe le vainqueur', () => {
    const fin = eliminate(partie(['a', 'b']), 'a');

    assert.equal(fin.finished, true);
    assert.equal(fin.room.winner, 'b');
  });

  it('a trois, la partie continue apres la premiere defaite', () => {
    const lobby = partie(['a', 'b', 'c']);
    const premiere = eliminate(lobby, 'a');

    assert.equal(premiere.eliminated, true);
    assert.equal(premiere.finished, false);
    assert.deepEqual(premiere.remaining, ['b', 'c']);
  });

  it('a trois, la seconde defaite couronne le dernier en jeu', () => {
    let lobby = partie(['a', 'b', 'c']);
    lobby = eliminate(lobby, 'a').lobby;
    const fin = eliminate(lobby, 'b');

    assert.equal(fin.finished, true);
    assert.equal(fin.room.winner, 'c');
    assert.deepEqual(alive(fin.room), ['c']);
  });

  it('ignore une elimination en double', () => {
    // Un joueur peut signaler sa defaite puis se deconnecter.
    let lobby = partie(['a', 'b', 'c']);
    lobby = eliminate(lobby, 'a').lobby;
    const repetee = eliminate(lobby, 'a');

    assert.equal(repetee.eliminated, false);
    assert.deepEqual(repetee.remaining, ['b', 'c']);
  });

  it('n elimine personne avant le debut', () => {
    const lobby = join(createLobby(), 'test', 'a', SEED).lobby;
    assert.equal(eliminate(lobby, 'a').eliminated, false);
  });

  it('ne change plus rien une fois la partie finie', () => {
    let lobby = partie(['a', 'b']);
    lobby = eliminate(lobby, 'a').lobby;
    const apres = eliminate(lobby, 'b');

    assert.equal(apres.eliminated, false);
    assert.equal(apres.room.winner, 'b', 'le vainqueur reste celui du premier verdict');
  });

  it('accepte un joueur sans salon', () => {
    assert.equal(eliminate(createLobby(), 'fantome').room, null);
  });

  it('ne mute pas le lobby recu', () => {
    const lobby = partie(['a', 'b', 'c']);
    const avant = JSON.stringify(lobby);
    eliminate(lobby, 'a');

    assert.equal(JSON.stringify(lobby), avant);
  });
});

describe('depart', () => {
  it('retire le joueur et signale ceux qui restent', () => {
    const sortie = leave(partie(['a', 'b', 'c']), 'a');

    assert.deepEqual(sortie.remaining, ['b', 'c']);
    assert.equal(roomOf(sortie.lobby, 'a'), null);
  });

  it('supprime un salon devenu vide', () => {
    const premier = join(createLobby(), 'test', 'a', SEED);
    const sortie = leave(premier.lobby, 'a');

    assert.deepEqual(sortie.lobby.rooms, {});
  });

  it('oublie l elimination du partant', () => {
    // Sinon il compterait encore comme elimine sans etre dans la partie.
    let lobby = partie(['a', 'b', 'c']);
    lobby = eliminate(lobby, 'a').lobby;
    const sortie = leave(lobby, 'a');

    assert.deepEqual(sortie.room.eliminated, []);
    assert.deepEqual(alive(sortie.room), ['b', 'c']);
  });

  it('laisse le salon intact quand un joueur passe sans rester', () => {
    // Le salon continue d'attendre, il ne se lance ni ne se vide.
    let lobby = createLobby();
    lobby = join(lobby, 'test', 'a', SEED).lobby;
    lobby = join(lobby, 'test', 'b', SEED).lobby;

    const sortie = leave(lobby, 'b');
    assert.deepEqual(sortie.remaining, ['a']);
    assert.equal(sortie.room.started, false);
    assert.equal(sortie.room.finished, false);
    assert.deepEqual(waitingStatus(sortie.lobby, sortie.room).players, 1);
  });

  it('accepte le depart d un inconnu', () => {
    const sortie = leave(createLobby(), 'fantome');

    assert.equal(sortie.room, null);
    assert.deepEqual(sortie.lobby.rooms, {});
  });
});
