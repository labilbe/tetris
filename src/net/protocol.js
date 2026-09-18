/**
 * Protocole du jeu en reseau, partage par le client et le serveur.
 *
 * Il ne transporte jamais l'etat de la partie, seulement des actions et une
 * graine. C'est le moteur deterministe qui rend cela possible : a partir de la
 * meme graine et de la meme suite d'actions, deux machines obtiennent le meme
 * plateau. Ce fichier est la seule definition de ce vocabulaire, pour que les
 * deux cotes ne puissent pas diverger.
 */

/** Messages du client vers le serveur. */
export const CLIENT = {
  JOIN: 'join', // { type, room }
  BEGIN: 'begin', // { type } — lancer la partie sans attendre le salon plein
  ACTION: 'action', // { type, action }
  OVER: 'over', // { type } — j'ai perdu
};

/** Messages du serveur vers le client. */
export const SERVER = {
  WAITING: 'waiting', // { type, room, players, min }
  START: 'start', // { type, room, seed, playerId, players }
  ACTION: 'action', // { type, playerId, action }
  ELIMINATED: 'eliminated', // { type, playerId, remaining }
  FINISHED: 'finished', // { type, winner } — le dernier en jeu l'emporte
  LEFT: 'left', // { type, playerId }
  ERROR: 'error', // { type, message }
};

/**
 * Il faut au moins deux joueurs pour une partie. Il n'y a pas de maximum : le
 * salon accueille qui veut, et ce sont les presents qui decident du depart.
 */
export const MIN_PLAYERS = 2;

export const DEFAULT_ROOM = 'partie';

export function encode(message) {
  return JSON.stringify(message);
}

/**
 * Analyse un message recu. Renvoie null plutot que de lever : un pair peut
 * toujours envoyer n'importe quoi, et cela ne doit pas tuer la partie.
 */
export function decode(raw) {
  try {
    const message = JSON.parse(raw);
    return message && typeof message.type === 'string' ? message : null;
  } catch {
    return null;
  }
}
