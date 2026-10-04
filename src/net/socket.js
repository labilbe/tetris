/**
 * Transport reseau : une WebSocket vers le relais.
 *
 * Le relais reunit les joueurs, impose la graine et arbitre les eliminations. Il
 * ne connait aucune regle de Tetris : voir worker/salon.js.
 *
 * Ce qui circule, et ce qui ne circule pas
 * ----------------------------------------
 * Chaque joueur ne reduit que ses propres actions : les plateaux adverses ne
 * sont jamais simules, ils arrivent par le canal decoratif des instantanes. Il
 * n'y a donc rien a synchroniser, et aucun ordre a imposer.
 *
 * Les actions locales sont appliquees **immediatement**, en echo local, comme en
 * solo. Seul le handicap part sur le reseau, parce que c'est la seule action qui
 * s'applique aux autres. Une touche ne coute donc aucun aller-retour, alors
 * meme qu'un serveur est de retour dans l'histoire : c'est ce que le detour par
 * le serveur n'avait jamais garanti, du temps ou toutes les actions y passaient.
 */

import { CLIENT, SERVER, decode, encode } from './protocol.js';

/**
 * Delai au-dela duquel on renonce a joindre le relais.
 *
 * Il ne couvre que l'ouverture de la connexion, jamais l'attente des autres
 * joueurs, qui est legitime et peut durer. Sans lui, une adresse injoignable ne
 * produirait aucune erreur : le navigateur attendrait l'expiration TCP, et le
 * joueur resterait devant un ecran muet.
 */
const CONNECT_TIMEOUT_MS = 10000;

/**
 * @param {{ url: string, code: string, name?: string }} options
 */
export function createSocketTransport({ url, code, name = '' }) {
  const actionListeners = new Set();
  const statusListeners = new Set();
  const boardListeners = new Set();

  /** @type {WebSocket | null} */
  let socket = null;
  let moiId = null;
  let ouverte = false;
  let demarree = false;
  let ferme = false;

  function notifyStatus(status) {
    for (const listener of statusListeners) listener(status);
  }

  function emettre(message) {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(encode(message));
  }

  /** Remet une action aux ecouteurs locaux, avec son auteur. */
  function remettreAction(playerId, action) {
    for (const listener of actionListeners) {
      listener(action, { playerId, self: playerId === moiId });
    }
  }

  return {
    start() {
      return new Promise((resolve, reject) => {
        notifyStatus({ kind: 'seeking', message: `Connexion au salon ${code}…` });

        socket = new WebSocket(`${url}?salon=${encodeURIComponent(code)}`);

        // Arme seulement jusqu'a l'ouverture : une fois connecte, l'attente des
        // autres joueurs n'a pas de limite.
        const minuteur = setTimeout(() => {
          if (ouverte) return;
          const erreur = new Error(
            `Le relais de jeu ne repond pas (${url}). Verifiez votre connexion, `
            + 'ou reessayez dans un instant.',
          );
          notifyStatus({ kind: 'error', message: erreur.message });
          socket.close();
          reject(erreur);
        }, CONNECT_TIMEOUT_MS);

        socket.addEventListener('open', () => {
          ouverte = true;
          clearTimeout(minuteur);
          emettre({ type: CLIENT.JOIN, room: code, name });
        });

        socket.addEventListener('message', (event) => {
          const message = decode(event.data);
          if (!message) return;

          switch (message.type) {
            case SERVER.START:
              moiId = message.playerId;
              demarree = true;
              notifyStatus({
                kind: 'start',
                room: message.room,
                players: message.players,
                names: message.names ?? {},
              });
              resolve({ seed: message.seed, playerId: moiId });
              break;

            case SERVER.WAITING:
              notifyStatus({
                kind: 'waiting',
                room: message.room,
                players: message.players,
                min: message.min,
                names: message.names ?? [],
              });
              break;

            case SERVER.ACTION:
              // Le handicap d'un autre joueur : le relais ne nous renvoie jamais
              // le notre.
              remettreAction(message.playerId, message.action);
              break;

            case SERVER.BOARD:
              for (const listener of boardListeners) listener(message.playerId, message.board);
              break;

            case SERVER.ELIMINATED:
              notifyStatus({
                kind: 'eliminated',
                playerId: message.playerId,
                self: message.playerId === moiId,
                remaining: message.remaining,
              });
              break;

            case SERVER.FINISHED:
              notifyStatus({ kind: 'finished', winner: message.winner, self: message.winner === moiId });
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
          if (ferme) return;
          clearTimeout(minuteur);
          const erreur = new Error(`Le relais de jeu est injoignable (${url}).`);
          notifyStatus({ kind: 'error', message: erreur.message });
          reject(erreur);
        });

        socket.addEventListener('close', () => {
          clearTimeout(minuteur);
          if (ferme) return; // c'est nous qui avons raccroche
          notifyStatus({
            kind: 'closed',
            message: demarree
              ? 'La connexion au relais a été perdue : la partie s’arrête.'
              : 'La connexion au relais a été perdue.',
          });
          reject(new Error('Connexion fermee avant le debut de la partie'));
        });
      });
    },

    /**
     * Emet une action locale.
     *
     * Echo local immediat : rien n'attend un aller-retour, puisque personne
     * d'autre ne simule notre plateau. Seul le handicap part sur le reseau.
     */
    send(action) {
      remettreAction(moiId, action);
      if (action?.type === 'garbage') emettre({ type: CLIENT.ACTION, action });
    },

    /**
     * Emet un instantane de son plateau pour ceux qui regardent.
     *
     * Rien ne garantit ni ne verifie son arrivee : c'est de l'affichage, il part
     * comme il peut et le suivant corrigera.
     */
    sendBoard(board) {
      emettre({ type: CLIENT.BOARD, board });
    },

    /** Signale sa propre defaite : elle vaut elimination. */
    reportGameOver() {
      emettre({ type: CLIENT.OVER });
    },

    /** Demande a lancer la partie sans attendre que le salon soit plein. */
    begin() {
      emettre({ type: CLIENT.BEGIN });
    },

    onAction(listener) {
      actionListeners.add(listener);
      return () => actionListeners.delete(listener);
    },

    onStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },

    onBoard(listener) {
      boardListeners.add(listener);
      return () => boardListeners.delete(listener);
    },

    close() {
      ferme = true;
      actionListeners.clear();
      statusListeners.clear();
      boardListeners.clear();
      if (socket) socket.close();
      socket = null;
    },
  };
}
