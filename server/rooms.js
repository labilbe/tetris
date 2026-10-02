/**
 * Salons du jeu en reseau : qui attend qui, avec quelle graine, et qui reste
 * en jeu.
 *
 * Volontairement sans socket ni horloge : ce sont des fonctions pures sur un
 * etat simple, donc testables directement, comme le moteur du jeu. Le fichier
 * server/index.js se charge du reseau et n'a plus de logique a lui.
 */

import { MIN_PLAYERS, cleanName } from '../src/net/protocol.js';

/**
 * @typedef {{
 *   code: string,
 *   seed: number,
 *   players: string[],
 *   names: Record<string, string>,
 *   eliminated: string[],
 *   started: boolean,
 *   finished: boolean,
 *   winner: string | null,
 * }} Room
 * @typedef {{ min: number, rooms: Record<string, Room> }} Lobby
 */

/** @returns {Lobby} */
export function createLobby({ min = MIN_PLAYERS } = {}) {
  return { min, rooms: {} };
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
 * Rend un pseudo unique dans le salon.
 *
 * Deux « Franck » a l'ecran ne designeraient plus personne : la camera dirait
 * qu'elle regarde Franck sans qu'on sache lequel. Le second prend donc un
 * numero, et c'est le tardif qui le porte.
 */
function nomLibre(room, souhaite) {
  const pris = new Set(Object.values(room.names ?? {}));
  if (!pris.has(souhaite)) return souhaite;

  for (let suffixe = 2; ; suffixe++) {
    const candidat = `${souhaite} ${suffixe}`;
    if (!pris.has(candidat)) return candidat;
  }
}

/**
 * Fait entrer un joueur dans un salon, cree au besoin.
 *
 * La graine est fixee a la creation du salon et ne change plus : c'est elle qui
 * garantit que tous les joueurs verront la meme suite de pieces.
 *
 * @returns {{ lobby: Lobby, room: Room, joined: boolean }}
 */
export function join(lobby, code, playerId, seed, name) {
  const existing = lobby.rooms[code];

  if (existing && existing.players.includes(playerId)) {
    return { lobby, room: existing, joined: false };
  }

  // Un salon deja lance n'accepte personne : l'arrivant manquerait le debut et
  // jouerait une autre partie que les autres. Il n'y a pas d'autre limite.
  if (existing && existing.started) {
    return { lobby, room: existing, joined: false };
  }

  const base = existing ?? {
    code,
    seed,
    players: [],
    names: {},
    eliminated: [],
    started: false,
    finished: false,
    winner: null,
  };

  const room = {
    ...base,
    players: [...base.players, playerId],
    names: { ...base.names, [playerId]: nomLibre(base, cleanName(name)) },
  };
  return { lobby: put(lobby, room), room, joined: true };
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
 * Ferme le salon d'une partie terminee.
 *
 * Un salon lance refuse les arrivants, et c'est voulu : un retardataire
 * manquerait le debut et jouerait une autre partie que les autres. Mais ce refus
 * survivait a la partie. Le salon restait marque « lance » une fois finie, et
 * comme il ne disparaissait qu'une fois vide, un seul ecran de verdict encore
 * ouvert suffisait a interdire la partie suivante a tout le monde : « La partie
 * a deja commence dans ce salon », sans qu'aucune partie ne soit en cours.
 *
 * Une partie terminee n'a plus de salon a tenir. Personne n'y joue, et ceux qui
 * y restent connectes n'ont plus qu'un bouton, « Retour au menu ». On le
 * supprime donc, et la partie suivante repart d'un salon neuf — graine comprise,
 * ce qu'une simple reouverture aurait oublie.
 *
 * Supprimer plutot que rouvrir evite au passage un piege : un joueur encore
 * devant son verdict compterait comme present dans le salon rouvert, un autre
 * pourrait lancer la partie avec ce fantome, et l'attendrait indefiniment.
 */
export function closeRoom(lobby, code) {
  if (!lobby.rooms[code]) return lobby;

  const rooms = { ...lobby.rooms };
  delete rooms[code];
  return { ...lobby, rooms };
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

  // Le pseudo part avec son joueur : sans cela il resterait pris, et celui qui
  // revient apres une coupure se verrait numeroter derriere lui-meme.
  const names = { ...room.names };
  delete names[playerId];

  const updated = {
    ...room,
    players,
    names,
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
    // Les pseudos des presents : on sait qui on attend, et qui est deja la.
    names: room.players.map((id) => room.names[id]),
  };
}
