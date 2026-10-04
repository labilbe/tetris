/**
 * Un salon, et le reseau qui va avec.
 *
 * Tout l'arbitrage — qui attend qui, avec quelle graine, qui l'emporte — vit
 * dans src/net/host.js, pur et teste sous `node --test`. Ce fichier ne fait que
 * le brancher sur des WebSockets : il recoit, il transmet, il n'interprete rien.
 * Il ne connait aucune regle de Tetris et ne calcule aucun plateau.
 *
 * Deux messages ne passent pas par l'arbitre : le handicap et les instantanes de
 * plateau. Ils n'ont aucune decision a demander, et sont simplement relayes aux
 * autres joueurs — jamais a leur emetteur, qui a deja applique son action
 * chez lui sans attendre personne.
 */

import { DurableObject } from 'cloudflare:workers';

import { TOUS, createHost } from '../src/net/host.js';
import { CLIENT, SERVER, decode, encode } from '../src/net/protocol.js';

export class Salon extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);

    /** @type {Map<string, WebSocket>} */
    this.sockets = new Map();
    /** @type {ReturnType<typeof createHost> | null} */
    this.host = null;
  }

  async fetch(request) {
    // Le code vient du chemin, pose par le point d'entree. L'arbitre n'est cree
    // qu'ici : un Durable Object peut etre reveille pour autre chose, et un
    // salon sans joueur n'a pas lieu d'exister.
    const code = decodeURIComponent(new URL(request.url).pathname.slice(1));
    if (!this.host) this.host = createHost({ code });

    const { 0: client, 1: serveur } = new WebSocketPair();
    serveur.accept();

    // L'identifiant est attribue ici, et le joueur ne le choisit pas : c'est ce
    // qui empeche de se faire passer pour un autre.
    const playerId = crypto.randomUUID();
    this.sockets.set(playerId, serveur);

    serveur.addEventListener('message', (event) => {
      this.onMessage(playerId, event.data);
    });

    const partir = () => this.onClose(playerId);
    serveur.addEventListener('close', partir);
    serveur.addEventListener('error', partir);

    return new Response(null, { status: 101, webSocket: client });
  }

  /** Emet un message vers un joueur, s'il est encore la. */
  envoyer(playerId, message) {
    const socket = this.sockets.get(playerId);
    if (!socket) return;

    try {
      socket.send(encode(message));
    } catch {
      // Socket deja fermee : le depart sera traite par son evenement.
    }
  }

  /** Distribue les enveloppes de l'arbitre. */
  router(envelopes) {
    for (const { to, message } of envelopes) {
      if (to === TOUS) {
        for (const playerId of this.sockets.keys()) this.envoyer(playerId, message);
      } else {
        this.envoyer(to, message);
      }
    }
  }

  /** Relaie un message a tout le salon sauf son emetteur. */
  auxAutres(emetteur, message) {
    for (const playerId of this.sockets.keys()) {
      if (playerId !== emetteur) this.envoyer(playerId, message);
    }
  }

  onMessage(playerId, brut) {
    const message = decode(typeof brut === 'string' ? brut : String(brut));
    if (!message) return; // un client peut toujours envoyer n'importe quoi

    switch (message.type) {
      case CLIENT.JOIN:
      case CLIENT.BEGIN:
      case CLIENT.OVER:
        this.router(this.host.receive(playerId, message));
        break;

      case CLIENT.ACTION:
        // Le handicap, et lui seul, traverse le reseau. Il ne revient pas a son
        // emetteur : celui qui efface les lignes ne se penalise pas, et il a
        // deja applique son action chez lui.
        if (message.action) {
          this.auxAutres(playerId, { type: SERVER.ACTION, playerId, action: message.action });
        }
        break;

      case CLIENT.BOARD:
        // Purement decoratif, et opaque : le relais n'y comprend rien et n'a pas
        // a y comprendre quoi que ce soit.
        if (message.board) {
          this.auxAutres(playerId, { type: SERVER.BOARD, playerId, board: message.board });
        }
        break;

      default:
        break;
    }
  }

  onClose(playerId) {
    if (!this.sockets.delete(playerId)) return; // deja parti

    // Un depart en pleine partie vaut elimination, et peut donc designer un
    // vainqueur : c'est l'arbitre qui en decide.
    this.router(this.host.disconnect(playerId));

    // Salon vide : on repart d'un arbitre neuf, graine comprise. Le Durable
    // Object, lui, peut etre garde en vie par la plateforme ; sans cela, un
    // salon acheve interdirait la partie suivante sous le meme code.
    if (this.sockets.size === 0) this.host = null;
  }
}
