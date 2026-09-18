/**
 * Salons du jeu en reseau : qui attend qui, avec quelle graine, et qui reste
 * en jeu.
 *
 * Volontairement sans socket ni horloge : ce sont des fonctions pures sur un
 * etat simple, donc testables directement, comme le moteur du jeu. Le fichier
 * server/index.js se charge du reseau et n'a plus de logique a lui.
 */

import { MAX_PLAYERS, MIN_PLAYERS } from '../src/net/protocol.js';

/**
 * @typedef {{
 *   code: string,
 *   seed: number,
 *   players: string[],
 *   eliminated: string[],
 *   started: boolean,
 *   finished: boolean,
 *   winner: string | null,
 * }} Room
 * @typedef {{ min: number, max: number, rooms: Record<string, Room> }} Lobby
 */

/** @returns {Lobby} */
export function createLobby({ min = MIN_PLAYERS, max = MAX_PLAYERS } = {}) {
  return { min, max, rooms: {} };
}

/** Salon d'un joueur, ou null s'il n'en a pas. */
export function roomOf(lobby, playerId) {
  return Object.values(lobby.rooms).find((room) => room.players.includes(playerId)) ?? null;
}

/** Joueurs encore en jeu. */
export function alive(room) {
  return room.players.filter((id) => !room.eliminated.includes(id));
}

function put(lobby, room) {
  return { ...lobby, rooms: { ...lobby.rooms, [room.code]: room } };
}

/**
 * Fait entrer un joueur dans un salon, cree au besoin.
 *
 * La graine est fixee a la creation du salon et ne change plus : c'est elle qui
 * garantit que tous les joueurs verront la meme suite de pieces.
 *
 * @returns {{ lobby: Lobby, room: Room, joined: boolean, full: boolean }}
 */
export function join(lobby, code, playerId, seed) {
  const existing = lobby.rooms[code];

  if (existing && existing.players.includes(playerId)) {
    return { lobby, room: existing, joined: false, full: false };
  }

  // Un salon plein ou deja lance n'accepte personne : sinon l'arrivant
  // manquerait le debut et jouerait une autre partie que les autres.
  if (existing && (existing.started || existing.players.length >= lobby.max)) {
    return { lobby, room: existing, joined: false, full: true };
  }

  const base = existing ?? {
    code,
    seed,
    players: [],
    eliminated: [],
    started: false,
    finished: false,
    winner: null,
  };

  const room = { ...base, players: [...base.players, playerId] };
  return {
    lobby: put(lobby, room),
    room,
    joined: true,
    full: room.players.length >= lobby.max,
  };
}

/**
 * Lance la partie d'un salon.
 *
 * Attendre que le salon soit plein rendrait toute partie a trois impossible
 * quand le maximum est six : les joueurs presents decident eux-memes du depart,
 * des lors qu'ils sont assez nombreux.
 *
 * @returns {{ lobby: Lobby, room: Room | null, started: boolean }}
 */
export function begin(lobby, code) {
  const room = lobby.rooms[code];
  if (!room || room.started) return { lobby, room: room ?? null, started: false };
  if (room.players.length < lobby.min) return { lobby, room, started: false };

  const started = { ...room, started: true };
  return { lobby: put(lobby, started), room: started, started: true };
}

/**
 * Elimine un joueur : il a perdu, ou il est parti.
 *
 * La partie s'arrete quand il ne reste qu'un joueur — ou aucun. A deux, cela
 * revient bien a « le premier qui perd a perdu ».
 *
 * @returns {{ lobby: Lobby, room: Room | null, eliminated: boolean, finished: boolean, remaining: string[] }}
 */
export function eliminate(lobby, playerId) {
  const room = roomOf(lobby, playerId);
  const none = { lobby, room: null, eliminated: false, finished: false, remaining: [] };
  if (!room) return none;

  if (!room.started || room.finished || room.eliminated.includes(playerId)) {
    return { lobby, room, eliminated: false, finished: false, remaining: alive(room) };
  }

  const updated = { ...room, eliminated: [...room.eliminated, playerId] };
  const remaining = alive(updated);
  const finished = remaining.length <= 1;

  const room2 = finished
    ? { ...updated, finished: true, winner: remaining[0] ?? null }
    : updated;

  return { lobby: put(lobby, room2), room: room2, eliminated: true, finished, remaining };
}

/**
 * Retire un joueur du salon. Un salon vide disparait.
 *
 * @returns {{ lobby: Lobby, room: Room | null, remaining: string[] }}
 */
export function leave(lobby, playerId) {
  const room = roomOf(lobby, playerId);
  if (!room) return { lobby, room: null, remaining: [] };

  const players = room.players.filter((id) => id !== playerId);
  const rooms = { ...lobby.rooms };

  if (players.length === 0) {
    delete rooms[room.code];
    return { lobby: { ...lobby, rooms }, room, remaining: [] };
  }

  const updated = {
    ...room,
    players,
    eliminated: room.eliminated.filter((id) => id !== playerId),
  };
  rooms[room.code] = updated;

  return { lobby: { ...lobby, rooms }, room: updated, remaining: players };
}

/** Etat a envoyer a ceux qui patientent. */
export function waitingStatus(lobby, room) {
  return {
    room: room.code,
    players: room.players.length,
    min: lobby.min,
    max: lobby.max,
  };
}
