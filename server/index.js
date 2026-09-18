/**
 * Serveur de jeu en reseau.
 *
 * Son role est volontairement etroit : reunir les joueurs, imposer la graine,
 * et relayer les actions dans un ordre unique. Il ne connait pas les regles du
 * Tetris et ne calcule aucun plateau — c'est le moteur, identique chez tous les
 * joueurs, qui derive l'etat des actions recues.
 *
 *   npm run server
 */

import { randomUUID } from 'node:crypto';

import { WebSocketServer } from 'ws';

import { randomSeed } from '../src/engine/rng.js';
import { CLIENT, DEFAULT_ROOM, SERVER, encode, decode } from '../src/net/protocol.js';
import { createLobby, join, leave, roomOf, waitingStatus } from './rooms.js';

const PORT = Number(process.env.PORT ?? 1985);

let lobby = createLobby();

/** @type {Map<string, import('ws').WebSocket>} playerId -> socket */
const sockets = new Map();

function send(playerId, message) {
  const socket = sockets.get(playerId);
  if (socket && socket.readyState === socket.OPEN) socket.send(encode(message));
}

function sendToRoom(room, message, { except } = {}) {
  for (const playerId of room.players) {
    if (playerId !== except) send(playerId, message);
  }
}

function handleJoin(playerId, message) {
  const code = typeof message.room === 'string' && message.room.trim()
    ? message.room.trim().slice(0, 40)
    : DEFAULT_ROOM;

  const result = join(lobby, code, playerId, randomSeed());
  lobby = result.lobby;

  if (!result.joined) {
    send(playerId, { type: SERVER.ERROR, message: 'Ce salon est complet ou la partie a deja commence.' });
    return;
  }

  if (result.starts) {
    // Tous recoivent la meme graine — c'est elle qui rend les parties
    // identiques — mais chacun recoit aussi son propre identifiant, pour
    // distinguer ensuite ses actions de celles de l'adversaire.
    for (const id of result.room.players) {
      send(id, {
        type: SERVER.START,
        room: result.room.code,
        seed: result.room.seed,
        playerId: id,
        players: result.room.players,
      });
    }
    console.log(`[salon ${result.room.code}] partie lancee (graine ${result.room.seed})`);
    return;
  }

  sendToRoom(result.room, { type: SERVER.WAITING, ...waitingStatus(lobby, result.room) });
  console.log(`[salon ${code}] ${result.room.players.length}/${lobby.capacity} joueur(s)`);
}

function handleAction(playerId, message) {
  const room = roomOf(lobby, playerId);
  if (!room || !room.started || !message.action) return;

  // Relais a tout le monde, emetteur compris : l'ordre du serveur fait foi, et
  // chacun applique la meme suite d'actions.
  sendToRoom(room, { type: SERVER.ACTION, playerId, action: message.action });
}

function handleDisconnect(playerId) {
  const result = leave(lobby, playerId);
  lobby = result.lobby;
  sockets.delete(playerId);

  if (!result.room) return;

  for (const id of result.remaining) {
    send(id, { type: SERVER.LEFT, playerId });
  }
  console.log(`[salon ${result.room.code}] depart d'un joueur (${result.remaining.length} restant(s))`);
}

const server = new WebSocketServer({ port: PORT });

server.on('connection', (socket) => {
  const playerId = randomUUID();
  sockets.set(playerId, socket);

  socket.on('message', (raw) => {
    const message = decode(raw.toString());
    if (!message) return; // message illisible : on l'ignore plutot que de rompre

    if (message.type === CLIENT.JOIN) handleJoin(playerId, message);
    else if (message.type === CLIENT.ACTION) handleAction(playerId, message);
  });

  socket.on('close', () => handleDisconnect(playerId));
  socket.on('error', () => handleDisconnect(playerId));
});

console.log(`Serveur de jeu en ecoute sur le port ${PORT}`);
