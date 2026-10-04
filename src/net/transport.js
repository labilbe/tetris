/**
 * Transport des actions.
 *
 * Le jeu ne dispatche jamais une action directement dans le moteur : il la passe
 * au transport, qui la restitue via onAction. Le mode de jeu choisit
 * l'implementation, et rien d'autre dans le jeu ne sait comment les messages
 * voyagent — c'est ce qui a permis de remplacer un serveur WebSocket par du
 * pair-a-pair sans toucher au reste.
 *
 * Contrat commun :
 *   start()            -> Promise<{ seed, playerId }>
 *   send(action)       -> void                 emet une action locale
 *   sendBoard(board)   -> void                 emet un instantane de plateau
 *   begin()            -> void                 lancer sans attendre le salon plein
 *   reportGameOver()   -> void                 signaler sa propre defaite
 *   onAction(listener) -> () => void           listener(action, { playerId, self })
 *   onStatus(listener) -> () => void           attente, depart, erreur
 *   onBoard(listener)  -> () => void           listener(playerId, board)
 *   close()            -> void
 *
 * Extension facultative :
 *   tick(nowMs)        -> void                 appelee depuis la boucle de rendu
 *
 * Elle n'existe que pour les adversaires artificiels, qui vivent dans la page de
 * l'hote et ont besoin d'une horloge. Un transport qui n'en a pas l'omet, et
 * l'appelant l'invoque avec `transport.tick?.(time)`.
 *
 * Le meta `self` est essentiel en reseau : les actions des autres arrivent par le
 * meme canal que les siennes, et ne doivent pas piloter son propre plateau.
 *
 * Il n'y a rien a reconcilier
 * ---------------------------
 * Chaque joueur ne reduit que ses propres actions ; les plateaux adverses ne sont
 * jamais simules, ils arrivent par le canal decoratif des instantanes. Aucune
 * divergence n'est donc possible, et aucun arbitre n'a besoin d'ordonner quoi que
 * ce soit. Les actions s'appliquent sur-le-champ, en reseau comme en solo : la
 * prediction locale que ce fichier annonçait, du temps ou tout passait par un
 * serveur, n'a plus d'objet.
 */

import { randomSeed } from '../engine/rng.js';

const LOCAL_PLAYER = 'local';

/** Solo : les actions reviennent telles quelles, sans latence ni reseau. */
export function createLocalTransport(seed = randomSeed()) {
  const listeners = new Set();

  return {
    async start() {
      return { seed, playerId: LOCAL_PLAYER };
    },
    send(action) {
      for (const listener of listeners) listener(action, { playerId: LOCAL_PLAYER, self: true });
    },
    sendBoard() {
      // En solo, personne ne regarde : l'instantane n'a pas de destinataire.
    },
    onBoard() {
      return () => {};
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
