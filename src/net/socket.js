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
 * meme qu'un serveur est de retour dans l'histoire.
 *
 * Les coupures
 * ------------
 * En pleine partie, une connexion perdue n'est pas une fin. Le relais garde la
 * place du joueur trente secondes ; pendant ce temps on se rebranche, et sa
 * partie reprend ou elle en etait. Son identifiant, tire au sort par le relais
 * et dit a lui seul, lui tient lieu de laissez-passer.
 */

import { CLIENT, REPRISE_MS, SERVER, decode, encode } from './protocol.js';

/**
 * Delai au-dela duquel on renonce a joindre le relais.
 *
 * Il ne couvre que l'ouverture de la connexion, jamais l'attente des autres
 * joueurs, qui est legitime et peut durer.
 */
const CONNECT_TIMEOUT_MS = 10000;

/** Temps entre deux tentatives de reconnexion. */
const RETENTE_MS = 1000;

/**
 * @param {{ url: string, code: string, name?: string, repriseMs?: number }} options
 */
export function createSocketTransport({ url, code, name = '', repriseMs = REPRISE_MS }) {
  const actionListeners = new Set();
  const statusListeners = new Set();
  const boardListeners = new Set();

  /** @type {WebSocket | null} */
  let socket = null;
  let moiId = null;
  let ouverte = false;
  let demarree = false;
  let ferme = false;

  /** Coupure en cours : jusqu'a quand on a le droit d'esperer. */
  let echeance = 0;
  let coupe = false;

  /** Resolution de start(), tenue jusqu'au START. */
  let resoudre = null;
  let rejeter = null;

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

  function traiter(message) {
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
        if (resoudre) {
          resoudre({ seed: message.seed, playerId: moiId });
          resoudre = null;
          rejeter = null;
        }
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
        // Le handicap d'un autre joueur : le relais ne nous renvoie jamais le
        // notre.
        remettreAction(message.playerId, message.action);
        break;

      case SERVER.BOARD:
        for (const listener of boardListeners) listener(message.playerId, message.board);
        break;

      case SERVER.AWAY:
        // Un autre joueur est coupe : sa place est gardee, la partie continue.
        notifyStatus({ kind: 'away', playerId: message.playerId, secondes: message.secondes });
        break;

      case SERVER.BACK:
        if (message.playerId === moiId) {
          coupe = false;
          notifyStatus({ kind: 'reprise' });
        } else {
          notifyStatus({ kind: 'back', playerId: message.playerId });
        }
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
        // En pleine partie, un refus signifie que notre place n'existe plus :
        // insister ne ferait qu'entrer dans un salon ou l'on n'a pas sa partie.
        if (demarree) {
          ferme = true;
          notifyStatus({ kind: 'closed', message: message.message });
          break;
        }
        notifyStatus({ kind: 'error', message: message.message });
        if (rejeter) rejeter(new Error(message.message));
        break;

      default:
        break;
    }
  }

  /**
   * Branche une socket : ce qu'elle dit, et sa disparition.
   *
   * Toutes y passent, la premiere comme celles des reprises. Ne l'avoir fait que
   * pour la premiere laissait une seconde coupure sans aucun traitement : le
   * plateau restait fige sous un compte a rebours arrete, et rien n'arrivait
   * jamais.
   */
  function brancher(ws) {
    ws.addEventListener('message', (event) => {
      const message = decode(event.data);
      if (message) traiter(message);
    });
    ws.addEventListener('close', () => perdue());
  }

  /**
   * Se rebrancher apres une coupure, tant qu'il reste du temps.
   *
   * Passe le delai, le relais a elimine le joueur : on renonce et on le dit,
   * plutot que de le laisser esperer devant un ecran fige.
   */
  function reconnecter() {
    if (ferme || !coupe) return;

    const reste = Math.max(0, echeance - Date.now());
    if (reste === 0) {
      notifyStatus({
        kind: 'closed',
        message: 'La connexion n’est pas revenue à temps : la partie s’arrête.',
      });
      return;
    }

    notifyStatus({ kind: 'coupure', secondes: Math.ceil(reste / 1000) });

    socket = new WebSocket(`${url}?salon=${encodeURIComponent(code)}`);
    brancher(socket);

    socket.addEventListener('open', () => {
      // Notre identifiant tient lieu de laissez-passer : le relais l'a tire au
      // sort et ne l'a dit qu'a nous.
      emettre({ type: CLIENT.JOIN, room: code, name, reprise: moiId });
    });
  }

  /** La connexion est tombee : on attend, ou on renonce. */
  function perdue() {
    if (ferme) return;

    // En pleine partie seulement : avant le depart, il n'y a pas de place a
    // garder, et le joueur peut simplement relancer.
    if (!demarree) {
      notifyStatus({ kind: 'closed', message: 'La connexion au relais a été perdue.' });
      if (rejeter) rejeter(new Error('Connexion fermee avant le debut de la partie'));
      return;
    }

    // Premiere chute : on ouvre le delai et on essaie sur-le-champ. Les
    // suivantes sont des tentatives qui echouent, et on espace.
    if (!coupe) {
      coupe = true;
      echeance = Date.now() + repriseMs;
      reconnecter();
      return;
    }

    setTimeout(reconnecter, RETENTE_MS);
  }

  return {
    start() {
      return new Promise((resolve, reject) => {
        resoudre = resolve;
        rejeter = reject;

        notifyStatus({ kind: 'seeking', message: `Connexion au salon ${code}…` });
        socket = new WebSocket(`${url}?salon=${encodeURIComponent(code)}`);
        brancher(socket);

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

        socket.addEventListener('error', () => {
          clearTimeout(minuteur);
          if (ferme || demarree) return; // la perte est traitee par `close`
          const erreur = new Error(`Le relais de jeu est injoignable (${url}).`);
          notifyStatus({ kind: 'error', message: erreur.message });
          reject(erreur);
        });

        // La perte de connexion passe par brancher() : une seule porte.
        socket.addEventListener('close', () => clearTimeout(minuteur));
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
      coupe = false;
      actionListeners.clear();
      statusListeners.clear();
      boardListeners.clear();
      if (socket) socket.close();
      socket = null;
    },
  };
}
