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
  ACTION: 'action', // { type, action }
};

/** Messages du serveur vers le client. */
export const SERVER = {
  WAITING: 'waiting', // { type, room, players, capacity }
  START: 'start', // { type, room, seed, playerId, players }
  ACTION: 'action', // { type, playerId, action }
  LEFT: 'left', // { type, playerId }
  ERROR: 'error', // { type, message }
};

/** Nombre de joueurs par partie. */
export const CAPACITY = 2;

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
