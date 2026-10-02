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
import { createServer } from 'node:http';
import { hostname } from 'node:os';

import { WebSocketServer } from 'ws';

import { randomSeed } from '../src/engine/rng.js';
import { CLIENT, DEFAULT_ROOM, SERVER, cleanName, encode, decode } from '../src/net/protocol.js';
import { alive, begin, closeRoom, createLobby, eliminate, join, leave, roomOf, waitingStatus } from './rooms.js';

const PORT = Number(process.env.PORT ?? 1985);

let lobby = createLobby();

/** @type {Map<string, import('ws').WebSocket>} playerId -> socket */
const sockets = new Map();

/**
 * Nom de la machine qui fait tourner le serveur, pour servir de pseudo par
 * defaut.
 *
 * Un navigateur ne peut pas lire le nom de sa machine : aucune API ne l'expose,
 * et c'est voulu — ce serait un identifiant stable de plus a offrir au premier
 * site visite. Le serveur, lui, connait le nom de la machine ou il tourne. C'est
 * donc le bon nom pour un joueur qui joue SUR cette machine, et pour lui seul :
 * l'attribuer aussi aux invites du reseau local les ferait tous apparaitre sous
 * le nom de la machine qui heberge, numerotes derriere elle.
 *
 * Le suffixe de domaine est retire : « poste-12.bureau.lan » se reconnait a
 * « poste-12 », et le reste ne tiendrait pas dans un pseudo.
 */
const MACHINE = cleanName(hostname().split('.')[0], 'Joueur');

/** Adresses de la machine elle-meme, telles qu'une connexion les presente. */
const BOUCLE = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Les joueurs connectes depuis la machine du serveur : eux seuls heritent de son
 * nom quand ils laissent le pseudo vide.
 *
 * @type {Set<string>}
 */
const locaux = new Set();

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
      // Les pseudos accompagnent les identifiants : c'est ce qui permet de
      // nommer celui qu'on regarde jouer.
      names: room.names,
    });
  }
  console.log(`[salon ${room.code}] partie lancee a ${room.players.length} (graine ${room.seed})`);
}

function handleJoin(playerId, message) {
  const code = typeof message.room === 'string' && message.room.trim()
    ? message.room.trim().slice(0, 40)
    : DEFAULT_ROOM;

  // Pseudo laisse vide : un joueur local prend le nom de sa machine. Pour les
  // autres, le pseudo passe tel quel et c'est le salon qui applique son propre
  // nom par defaut — il n'y a ainsi qu'un seul endroit qui connaisse « Joueur ».
  const name = locaux.has(playerId) ? cleanName(message.name, MACHINE) : message.name;

  const result = join(lobby, code, playerId, randomSeed(), name);
  lobby = result.lobby;

  if (!result.joined) {
    send(playerId, {
      type: SERVER.ERROR,
      message: 'La partie a deja commence dans ce salon.',
    });
    return;
  }

  console.log(`[salon ${code}] ${result.room.names[playerId]} entre (${result.room.players.length} joueur(s))`);

  // Aucun depart automatique : la partie ne se lance que sur demande d'un
  // joueur, sans quoi un arrivant de plus la declencherait a leur place.
  announceWaiting(result.room);
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

/**
 * Relaie l'instantane de plateau d'un joueur a ceux qui le regardent.
 *
 * Le serveur n'y comprend rien et n'a pas a y comprendre quoi que ce soit : il
 * transmet un bloc opaque. Il ne le renvoie pas a son emetteur, qui a son
 * plateau sous les yeux, et ne l'envoie pas non plus si la partie est finie.
 */
function handleBoard(playerId, message) {
  const room = roomOf(lobby, playerId);
  if (!room || !room.started || room.finished || !message.board) return;

  for (const id of room.players) {
    if (id !== playerId) send(id, { type: SERVER.BOARD, playerId, board: message.board });
  }
}

/** Sortie de jeu d'un joueur : defaite ou depart. */
function handleElimination(playerId) {
  const result = eliminate(lobby, playerId);
  lobby = result.lobby;
  if (!result.eliminated) return;

  const room = result.room;

  if (result.finished) {
    sendToRoom(room, { type: SERVER.FINISHED, winner: room.winner });

    // Le verdict parti, le salon n'a plus lieu d'etre : il se ferme, et la
    // partie suivante repart d'un salon neuf. Voir closeRoom — le garder
    // interdisait la partie suivante a tout le monde des qu'un seul joueur
    // restait devant son ecran de fin.
    lobby = closeRoom(lobby, room.code);

    console.log(`[salon ${room.code}] partie terminee (vainqueur ${room.winner ?? 'aucun'}), salon ferme`);
    return;
  }

  // La partie continue entre les survivants.
  sendToRoom(room, { type: SERVER.ELIMINATED, playerId, remaining: alive(room).length });
  console.log(`[salon ${room.code}] elimination (${alive(room).length} en jeu)`);
}

function handleDisconnect(playerId) {
  // L'etat du salon est lu avant le retrait : apres, le joueur n'y est plus.
  const started = roomOf(lobby, playerId)?.started ?? false;

  // Un depart en pleine partie vaut elimination, arbitree tant que le joueur
  // fait encore partie du salon.
  if (started) handleElimination(playerId);

  const result = leave(lobby, playerId);
  lobby = result.lobby;
  sockets.delete(playerId);
  locaux.delete(playerId);

  if (!result.room || result.remaining.length === 0) return;

  if (started) {
    // Evenement de partie : les survivants continuent, c'est l'elimination qui
    // decide de la suite, pas ce message.
    for (const id of result.remaining) send(id, { type: SERVER.LEFT, playerId });
  } else {
    // Simple passage dans le salon : ceux qui patientent voient le compte
    // baisser, et rien de plus. Leur attente n'est pas annulee.
    announceWaiting(result.room);
  }

  console.log(`[salon ${result.room.code}] depart (${result.remaining.length} restant(s))`);
}

/**
 * Est-ce une page servie par cette meme machine ?
 *
 * Sans origine, la requete ne vient pas d'un navigateur (curl, un test) et il
 * n'y a rien a proteger. Avec origine, on ne repond que si elle designe la meme
 * machine que celle interrogee — le port differe, la page etant servie a cote.
 * Autrement n'importe quel site visite pourrait demander ce nom a la machine de
 * son visiteur, et le navigateur a justement raison de ne pas le lui donner.
 */
function memeMachine(request) {
  const origine = request.headers.origin;
  if (!origine) return true;

  try {
    return new URL(origine).hostname === (request.headers.host ?? '').split(':')[0];
  } catch {
    return false;
  }
}

/**
 * Service HTTP minuscule a cote du jeu : il ne repond qu'une chose, le nom de
 * cette machine, pour que la page puisse le proposer dans le champ Pseudo avant
 * toute partie. Le navigateur, lui, ne peut pas le lire.
 *
 * Il ne le donne qu'a un joueur connecte depuis cette machine, par la meme regle
 * que le pseudo par defaut : le nom de l'hote n'est pas celui d'un invite du
 * reseau local, et le lui proposer le ferait jouer sous un nom qui n'est pas le
 * sien.
 */
const service = createServer((request, response) => {
  if (request.method !== 'GET' || !request.url.startsWith('/nom')) {
    response.writeHead(404).end();
    return;
  }

  const entetes = { 'content-type': 'application/json; charset=utf-8' };
  if (request.headers.origin && memeMachine(request)) {
    entetes['access-control-allow-origin'] = request.headers.origin;
  }

  const local = BOUCLE.has(request.socket.remoteAddress);
  response.writeHead(200, entetes).end(JSON.stringify({ name: local ? MACHINE : '' }));
});

const server = new WebSocketServer({ server: service });

server.on('connection', (socket, request) => {
  const playerId = randomUUID();
  sockets.set(playerId, socket);

  if (BOUCLE.has(request.socket.remoteAddress)) locaux.add(playerId);

  socket.on('message', (raw) => {
    const message = decode(raw.toString());
    if (!message) return; // message illisible : on l'ignore plutot que de rompre

    if (message.type === CLIENT.JOIN) handleJoin(playerId, message);
    else if (message.type === CLIENT.BEGIN) handleBegin(playerId);
    else if (message.type === CLIENT.ACTION) handleAction(playerId, message);
    else if (message.type === CLIENT.BOARD) handleBoard(playerId, message);
    else if (message.type === CLIENT.OVER) handleElimination(playerId);
  });

  socket.on('close', () => handleDisconnect(playerId));
  socket.on('error', () => handleDisconnect(playerId));
});

service.listen(PORT, () => {
  console.log(`Serveur de jeu en ecoute sur le port ${PORT} (${lobby.min} joueurs minimum, sans maximum)`);
  console.log(`Pseudo par defaut sur cette machine : ${MACHINE}`);
});
