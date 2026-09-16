/**
 * Transport des actions.
 *
 * Le jeu ne dispatche jamais une action directement dans le moteur : il la
 * passe au transport, qui la restitue via onAction. En solo l'aller-retour est
 * immediat ; en reseau il passera par le serveur, qui devient l'arbitre de
 * l'ordre des actions et de la graine.
 *
 * Contrat commun :
 *   start()            -> Promise<{ seed: number }>  graine de la partie
 *   send(action)       -> void                        emet une action locale
 *   onAction(listener) -> () => void                  recoit les actions a appliquer
 *   close()            -> void
 */

import { randomSeed } from '../engine/rng.js';

/** Solo : les actions reviennent telles quelles, sans latence. */
export function createLocalTransport(seed = randomSeed()) {
  const listeners = new Set();

  return {
    async start() {
      return { seed };
    },
    send(action) {
      listeners.forEach((listener) => listener(action));
    },
    onAction(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      listeners.clear();
    },
  };
}

/**
 * Multijoueur, a brancher sur un serveur WebSocket qui diffuse les actions et
 * impose la graine. Non teste : le serveur reste a ecrire. Le protocole attendu
 * est volontairement minimal :
 *   serveur -> client : { type: 'start', seed }
 *   serveur -> client : { type: 'action', playerId, action }
 *   client  -> serveur : { type: 'action', action }
 *
 * L'action locale n'est PAS appliquee immediatement : elle attend l'echo du
 * serveur, ce qui garantit le meme ordre pour tout le monde au prix d'un aller-
 * retour. La prediction locale (appliquer tout de suite puis reconcilier en
 * rejouant depuis le dernier etat confirme) se greffe ici, et nulle part
 * ailleurs, parce que le moteur est deterministe.
 */
export function createWebSocketTransport(url) {
  const listeners = new Set();
  const socket = new WebSocket(url);

  return {
    start() {
      return new Promise((resolve, reject) => {
        socket.addEventListener('message', (event) => {
          const message = JSON.parse(event.data);
          if (message.type === 'start') resolve({ seed: message.seed });
          else if (message.type === 'action') listeners.forEach((l) => l(message.action));
        });
        socket.addEventListener('error', reject);
      });
    },
    send(action) {
      socket.send(JSON.stringify({ type: 'action', action }));
    },
    onAction(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      listeners.clear();
      socket.close();
    },
  };
}
