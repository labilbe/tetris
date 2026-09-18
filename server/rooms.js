/**
 * Salons du jeu en reseau : qui attend qui, et avec quelle graine.
 *
 * Volontairement sans socket ni horloge : ce sont des fonctions pures sur un
 * etat simple, donc testables directement, comme le moteur du jeu. Le fichier
 * server/index.js se charge du reseau et n'a plus de logique a lui.
 */

import { CAPACITY } from '../src/net/protocol.js';

/**
 * @typedef {{ code: string, seed: number, players: string[], started: boolean }} Room
 * @typedef {{ capacity: number, rooms: Record<string, Room> }} Lobby
 */

/** @returns {Lobby} */
export function createLobby(capacity = CAPACITY) {
  return { capacity, rooms: {} };
}

/** Salon d'un joueur, ou null s'il n'en a pas. */
export function roomOf(lobby, playerId) {
  return Object.values(lobby.rooms).find((room) => room.players.includes(playerId)) ?? null;
}

/**
 * Fait entrer un joueur dans un salon, cree au besoin.
 *
 * La graine est fixee a la creation du salon et ne change plus : c'est elle qui
 * garantit que tous les joueurs verront la meme suite de pieces.
 *
 * @param {Lobby} lobby
 * @param {string} code
 * @param {string} playerId
 * @param {number} seed graine a utiliser si le salon est cree
 * @returns {{ lobby: Lobby, room: Room, joined: boolean, starts: boolean }}
 */
export function join(lobby, code, playerId, seed) {
  const existing = lobby.rooms[code];

  if (existing && existing.players.includes(playerId)) {
    return { lobby, room: existing, joined: false, starts: false };
  }

  // Un salon plein ou deja lance n'accepte personne : sinon l'arrivant
  // manquerait le debut et jouerait une autre partie que les autres.
  if (existing && (existing.started || existing.players.length >= lobby.capacity)) {
    return { lobby, room: existing, joined: false, starts: false };
  }

  const base = existing ?? { code, seed, players: [], started: false };
  const players = [...base.players, playerId];
  const starts = players.length >= lobby.capacity;
  const room = { ...base, players, started: base.started || starts };

  return {
    lobby: { ...lobby, rooms: { ...lobby.rooms, [code]: room } },
    room,
    joined: true,
    starts,
  };
}

/**
 * Retire un joueur. Un salon vide disparait ; un salon entame reste marque
 * comme lance, car la partie de ceux qui restent, elle, a bien commence.
 *
 * @returns {{ lobby: Lobby, room: Room | null, remaining: string[] }}
 */
export function leave(lobby, playerId) {
  const room = roomOf(lobby, playerId);
  if (!room) return { lobby, room: null, remaining: [] };

  const players = room.players.filter((id) => id !== playerId);
  const rooms = { ...lobby.rooms };

  if (players.length === 0) delete rooms[room.code];
  else rooms[room.code] = { ...room, players };

  return { lobby: { ...lobby, rooms }, room, remaining: players };
}

/** Etat a envoyer a ceux qui patientent. */
export function waitingStatus(lobby, room) {
  return { room: room.code, players: room.players.length, capacity: lobby.capacity };
}
