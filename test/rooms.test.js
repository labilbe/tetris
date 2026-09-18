/**
 * Tests des salons. Comme le moteur, cette logique est pure : elle se teste
 * sans serveur ni socket, ce qui laisse a server/index.js le seul reseau.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createLobby, finish, join, leave, roomOf, waitingStatus } from '../server/rooms.js';

const SEED = 4242;

describe('arrivee dans un salon', () => {
  it('cree le salon au premier joueur et le fait patienter', () => {
    const { lobby, room, joined, starts } = join(createLobby(), 'test', 'a', SEED);

    assert.equal(joined, true);
    assert.equal(starts, false);
    assert.deepEqual(room.players, ['a']);
    assert.equal(room.seed, SEED);
    assert.deepEqual(waitingStatus(lobby, room), { room: 'test', players: 1, capacity: 2 });
  });

  it('lance la partie quand le salon est complet', () => {
    const premier = join(createLobby(), 'test', 'a', SEED);
    const second = join(premier.lobby, 'test', 'b', 999);

    assert.equal(second.starts, true);
    assert.equal(second.room.started, true);
    assert.deepEqual(second.room.players, ['a', 'b']);
  });

  it('garde la graine du salon, pas celle de l arrivant', () => {
    // Sinon les deux joueurs ne verraient pas la meme suite de pieces.
    const premier = join(createLobby(), 'test', 'a', SEED);
    const second = join(premier.lobby, 'test', 'b', 999);

    assert.equal(second.room.seed, SEED);
  });

  it('refuse un troisieme joueur', () => {
    let lobby = createLobby();
    lobby = join(lobby, 'test', 'a', SEED).lobby;
    lobby = join(lobby, 'test', 'b', SEED).lobby;

    const troisieme = join(lobby, 'test', 'c', SEED);
    assert.equal(troisieme.joined, false);
    assert.deepEqual(troisieme.room.players, ['a', 'b']);
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

    assert.equal(bleu.starts, false, 'deux salons distincts ne se completent pas');
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

describe('fin de partie', () => {
  function salonLance() {
    let lobby = createLobby();
    lobby = join(lobby, 'test', 'a', SEED).lobby;
    return join(lobby, 'test', 'b', SEED).lobby;
  }

  it('marque la partie terminee au premier perdant', () => {
    const fin = finish(salonLance(), 'a');

    assert.equal(fin.already, false);
    assert.equal(fin.room.finished, true);
  });

  it('ignore le second signalement', () => {
    // Les deux joueurs peuvent perdre a quelques millisecondes d'intervalle :
    // seul le premier doit designer le perdant.
    const premier = finish(salonLance(), 'a');
    const second = finish(premier.lobby, 'b');

    assert.equal(second.already, true);
  });

  it('accepte le signalement d un joueur sans salon', () => {
    const fin = finish(createLobby(), 'fantome');

    assert.equal(fin.room, null);
    assert.equal(fin.already, false);
  });

  it('ne mute pas le lobby recu', () => {
    const lobby = salonLance();
    const avant = JSON.stringify(lobby);
    finish(lobby, 'a');

    assert.equal(JSON.stringify(lobby), avant);
  });
});

describe('depart', () => {
  it('retire le joueur et signale ceux qui restent', () => {
    let lobby = createLobby();
    lobby = join(lobby, 'test', 'a', SEED).lobby;
    lobby = join(lobby, 'test', 'b', SEED).lobby;

    const sortie = leave(lobby, 'a');
    assert.deepEqual(sortie.remaining, ['b']);
    assert.equal(roomOf(sortie.lobby, 'a'), null);
    assert.deepEqual(roomOf(sortie.lobby, 'b').players, ['b']);
  });

  it('supprime un salon devenu vide', () => {
    const premier = join(createLobby(), 'test', 'a', SEED);
    const sortie = leave(premier.lobby, 'a');

    assert.deepEqual(sortie.lobby.rooms, {});
    assert.deepEqual(sortie.remaining, []);
  });

  it('accepte le depart d un inconnu', () => {
    const lobby = createLobby();
    const sortie = leave(lobby, 'fantome');

    assert.equal(sortie.room, null);
    assert.deepEqual(sortie.lobby.rooms, {});
  });

  it('n accepte pas un remplacant dans une partie lancee', () => {
    // La partie a commence sans lui : il jouerait une autre partie.
    let lobby = createLobby();
    lobby = join(lobby, 'test', 'a', SEED).lobby;
    lobby = join(lobby, 'test', 'b', SEED).lobby;
    lobby = leave(lobby, 'b').lobby;

    const tardif = join(lobby, 'test', 'c', SEED);
    assert.equal(tardif.joined, false);
  });
});
