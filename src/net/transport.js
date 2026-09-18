/**
 * Transport des actions.
 *
 * Le jeu ne dispatche jamais une action directement dans le moteur : il la
 * passe au transport, qui la restitue via onAction. En solo l'aller-retour est
 * immediat ; en reseau il passe par le serveur, qui devient l'arbitre de
 * l'ordre des actions et de la graine.
 *
 * Contrat commun :
 *   start()            -> Promise<{ seed, playerId }>
 *   send(action)       -> void                 emet une action locale
 *   onAction(listener) -> () => void           listener(action, { playerId, self })
 *   onStatus(listener) -> () => void           attente, depart, erreur
 *   close()            -> void
 *
 * Le meta `self` est essentiel en reseau : les actions de l'adversaire arrivent
 * par le meme canal que les siennes, et ne doivent pas piloter son propre
 * plateau.
 */

import { randomSeed } from '../engine/rng.js';
import { CLIENT, DEFAULT_ROOM, SERVER, decode, encode } from './protocol.js';

const LOCAL_PLAYER = 'local';

/** Solo : les actions reviennent telles quelles, sans latence ni serveur. */
export function createLocalTransport(seed = randomSeed()) {
  const listeners = new Set();

  return {
    async start() {
      return { seed, playerId: LOCAL_PLAYER };
    },
    send(action) {
      for (const listener of listeners) listener(action, { playerId: LOCAL_PLAYER, self: true });
    },
    reportGameOver() {
      // En solo, personne d'autre n'a besoin de le savoir.
    },
    begin() {
      // En solo, la partie commence sans attendre personne.
    },
    onAction(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onStatus() {
      return () => {};
    },
    close() {
      listeners.clear();
    },
  };
}

/**
 * Multijoueur : le serveur impose la graine et l'ordre des actions.
 *
 * Aucune action n'est appliquee localement avant son echo par le serveur. C'est
 * le choix le plus simple, au prix d'un aller-retour ; la prediction locale
 * (appliquer tout de suite, puis rejouer depuis le dernier etat confirme en cas
 * de divergence) se greffera ici, et nulle part ailleurs, parce que le moteur
 * est deterministe.
 */
export function createWebSocketTransport(url, { room = DEFAULT_ROOM } = {}) {
  const actionListeners = new Set();
  const statusListeners = new Set();

  /** @type {WebSocket | null} */
  let socket = null;
  let playerId = null;

  function notifyStatus(status) {
    for (const listener of statusListeners) listener(status);
  }

  return {
    start() {
      return new Promise((resolve, reject) => {
        socket = new WebSocket(url);

        socket.addEventListener('open', () => {
          socket.send(encode({ type: CLIENT.JOIN, room }));
        });

        socket.addEventListener('message', (event) => {
          const message = decode(event.data);
          if (!message) return;

          switch (message.type) {
            case SERVER.START:
              playerId = message.playerId;
              notifyStatus({ kind: 'start', room: message.room, players: message.players });
              resolve({ seed: message.seed, playerId });
              break;
            case SERVER.WAITING:
              notifyStatus({
                kind: 'waiting',
                room: message.room,
                players: message.players,
                min: message.min,
                max: message.max,
              });
              break;
            case SERVER.ACTION:
              for (const listener of actionListeners) {
                listener(message.action, { playerId: message.playerId, self: message.playerId === playerId });
              }
              break;
            case SERVER.ELIMINATED:
              notifyStatus({
                kind: 'eliminated',
                playerId: message.playerId,
                self: message.playerId === playerId,
                remaining: message.remaining,
              });
              break;
            case SERVER.FINISHED:
              notifyStatus({ kind: 'finished', winner: message.winner, self: message.winner === playerId });
              break;
            case SERVER.LEFT:
              notifyStatus({ kind: 'left', playerId: message.playerId });
              break;
            case SERVER.ERROR:
              notifyStatus({ kind: 'error', message: message.message });
              reject(new Error(message.message));
              break;
            default:
              break;
          }
        });

        socket.addEventListener('error', () => {
          const error = new Error(
            `Aucun serveur de jeu joignable sur ${url}. Le multijoueur demande `
            + 'un serveur lancé avec « npm run server », sur la machine qui sert la page.',
          );
          notifyStatus({ kind: 'error', message: error.message });
          reject(error);
        });

        socket.addEventListener('close', () => {
          notifyStatus({ kind: 'closed' });
          // Si la partie n'avait pas commence, personne n'attend plus rien.
          reject(new Error('Connexion fermee avant le debut de la partie'));
        });
      });
    },

    send(action) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(encode({ type: CLIENT.ACTION, action }));
      }
    },

    /** Signale sa propre defaite : elle vaut elimination. */
    reportGameOver() {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(encode({ type: CLIENT.OVER }));
      }
    },

    /** Demande a lancer la partie sans attendre que le salon soit plein. */
    begin() {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(encode({ type: CLIENT.BEGIN }));
      }
    },

    onAction(listener) {
      actionListeners.add(listener);
      return () => actionListeners.delete(listener);
    },

    onStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },

    close() {
      actionListeners.clear();
      statusListeners.clear();
      if (socket) socket.close();
    },
  };
}
