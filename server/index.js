/**
 * Serveur de jeu en reseau.
 *
 * Son role est volontairement etroit : reunir les joueurs, imposer la graine,
 * relayer les actions dans un ordre unique et arbitrer les eliminations. Il ne
 * connait pas les regles du Tetris et ne calcule aucun plateau — c'est le
 * moteur, identique chez tous les joueurs, qui derive l'etat des actions.
 *
 *   npm run server
 */

import { randomUUID } from 'node:crypto';

import { WebSocketServer } from 'ws';

import { randomSeed } from '../src/engine/rng.js';
import { CLIENT, DEFAULT_ROOM, SERVER, encode, decode } from '../src/net/protocol.js';
import { alive, begin, createLobby, eliminate, join, leave, roomOf, waitingStatus } from './rooms.js';

const PORT = Number(process.env.PORT ?? 1985);

let lobby = createLobby();

/** @type {Map<string, import('ws').WebSocket>} playerId -> socket */
const sockets = new Map();

function send(playerId, message) {
  const socket = sockets.get(playerId);
  if (socket && socket.readyState === socket.OPEN) socket.send(encode(message));
}

function sendToRoom(room, message) {
  for (const playerId of room.players) send(playerId, message);
}

function announceWaiting(room) {
  sendToRoom(room, { type: SERVER.WAITING, ...waitingStatus(lobby, room) });
}

/** Lance la partie et distribue la graine commune. */
function startRoom(code) {
  const result = begin(lobby, code);
  lobby = result.lobby;
  if (!result.started) return;

  const room = result.room;
  // Tous recoivent la meme graine — c'est elle qui rend les parties identiques
  // — mais chacun recoit aussi son identifiant, pour distinguer ensuite ses
  // actions de celles des autres.
  for (const id of room.players) {
    send(id, {
      type: SERVER.START,
      room: room.code,
      seed: room.seed,
      playerId: id,
      players: room.players,
    });
  }
  console.log(`[salon ${room.code}] partie lancee a ${room.players.length} (graine ${room.seed})`);
}

function handleJoin(playerId, message) {
  const code = typeof message.room === 'string' && message.room.trim()
    ? message.room.trim().slice(0, 40)
    : DEFAULT_ROOM;

  const result = join(lobby, code, playerId, randomSeed());
  lobby = result.lobby;

  if (!result.joined) {
    send(playerId, {
      type: SERVER.ERROR,
      message: 'Ce salon est complet ou la partie a deja commence.',
    });
    return;
  }

  console.log(`[salon ${code}] ${result.room.players.length}/${lobby.max} joueur(s)`);

  // Salon plein : inutile de faire attendre davantage.
  if (result.full) startRoom(code);
  else announceWaiting(result.room);
}

function handleBegin(playerId) {
  const room = roomOf(lobby, playerId);
  if (!room || room.started) return;

  if (room.players.length < lobby.min) {
    send(playerId, {
      type: SERVER.ERROR,
      message: `Il faut au moins ${lobby.min} joueurs pour commencer.`,
    });
    return;
  }

  startRoom(room.code);
}

function handleAction(playerId, message) {
  const room = roomOf(lobby, playerId);
  if (!room || !room.started || room.finished || !message.action) return;

  // Relais a tout le monde, emetteur compris : l'ordre du serveur fait foi, et
  // chacun applique la meme suite d'actions.
  sendToRoom(room, { type: SERVER.ACTION, playerId, action: message.action });
}

/** Sortie de jeu d'un joueur : defaite ou depart. */
function handleElimination(playerId) {
  const result = eliminate(lobby, playerId);
  lobby = result.lobby;
  if (!result.eliminated) return;

  const room = result.room;

  if (result.finished) {
    sendToRoom(room, { type: SERVER.FINISHED, winner: room.winner });
    console.log(`[salon ${room.code}] partie terminee (vainqueur ${room.winner ?? 'aucun'})`);
    return;
  }

  // La partie continue entre les survivants.
  sendToRoom(room, { type: SERVER.ELIMINATED, playerId, remaining: alive(room).length });
  console.log(`[salon ${room.code}] elimination (${alive(room).length} en jeu)`);
}

function handleDisconnect(playerId) {
  // Un depart en pleine partie vaut elimination : on l'arbitre avant de retirer
  // le joueur du salon, sinon il n'y serait plus pour etre elimine.
  handleElimination(playerId);

  const result = leave(lobby, playerId);
  lobby = result.lobby;
  sockets.delete(playerId);

  if (!result.room) return;

  for (const id of result.remaining) send(id, { type: SERVER.LEFT, playerId });

  // Depart avant le debut : ceux qui patientent doivent voir le compte baisser.
  if (!result.room.started && result.remaining.length > 0) announceWaiting(result.room);

  console.log(`[salon ${result.room.code}] depart (${result.remaining.length} restant(s))`);
}

const server = new WebSocketServer({ port: PORT });

server.on('connection', (socket) => {
  const playerId = randomUUID();
  sockets.set(playerId, socket);

  socket.on('message', (raw) => {
    const message = decode(raw.toString());
    if (!message) return; // message illisible : on l'ignore plutot que de rompre

    if (message.type === CLIENT.JOIN) handleJoin(playerId, message);
    else if (message.type === CLIENT.BEGIN) handleBegin(playerId);
    else if (message.type === CLIENT.ACTION) handleAction(playerId, message);
    else if (message.type === CLIENT.OVER) handleElimination(playerId);
  });

  socket.on('close', () => handleDisconnect(playerId));
  socket.on('error', () => handleDisconnect(playerId));
});

console.log(`Serveur de jeu en ecoute sur le port ${PORT} (${lobby.min} a ${lobby.max} joueurs)`);
