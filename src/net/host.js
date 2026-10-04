/**
 * L'arbitre de la partie, sans reseau.
 *
 * En pair-a-pair il n'y a plus de serveur, mais il reste quatre decisions qui
 * demandent qu'une seule machine tranche : qui est dans le salon, avec quelle
 * graine, quand on part, et qui l'emporte. C'est l'hote qui s'en charge — un
 * navigateur comme les autres, elu parmi les pairs (voir elire).
 *
 * Ce fichier est le portage de l'ancien serveur, moins le reseau : les
 * gestionnaires ne poussent plus rien dans des sockets, ils renvoient les
 * messages a emettre. C'est ce qui le rend entierement testable sous
 * `node --test`, ce que l'ancien serveur n'etait qu'a moitie, et ce qui permet a
 * net/peer.js de router de la meme facon un message venu d'un pair, de l'hote
 * lui-meme ou d'un adversaire artificiel : un seul chemin, aucune duplication.
 *
 * Ce qui a disparu au passage : le relais des actions et des instantanes. Le
 * handicap et les plateaux vont desormais d'un pair a l'autre en direct, sans
 * detour par l'hote, parce qu'aucun ordre n'a besoin d'etre impose — voir
 * net/transport.js pour la raison.
 */

import { randomSeed } from '../engine/rng.js';
import { CLIENT, DEFAULT_ROOM, MIN_PLAYERS, SERVER } from './protocol.js';
import { alive, begin, closeRoom, createLobby, eliminate, join, leave, roomOf, waitingStatus } from './rooms.js';

/**
 * Un message et son destinataire.
 *
 * `to` vaut '*' pour tout le salon, emetteur compris, ou l'identifiant d'un
 * joueur. C'est a l'appelant de savoir si cet identifiant designe un pair du
 * reseau, lui-meme, ou un adversaire artificiel : l'arbitre l'ignore, et c'est
 * precisement ce qui lui permet de les traiter tous pareil.
 *
 * @typedef {{ to: string, message: object }} Envelope
 */

/** Destinataire valant « tout le salon, emetteur compris ». */
export const TOUS = '*';

/**
 * Designe l'arbitre parmi les pairs presents.
 *
 * Le plus petit identifiant, au sens alphabetique. La regle n'a l'air de rien,
 * mais elle a la seule propriete qui compte : chacun la calcule chez soi, sans
 * echanger un message, et tous tombent d'accord. Le maillage etant complet,
 * tout le monde voit le meme ensemble de pairs.
 *
 * @param {string[]} ids identifiants presents, le sien compris
 * @returns {string | null} l'hote, ou null si personne n'est la
 */
export function elire(ids) {
  let hote = null;
  for (const id of ids) {
    if (typeof id !== 'string') continue;
    if (hote === null || id < hote) hote = id;
  }
  return hote;
}

/**
 * @param {{ seed?: () => number, min?: number, code?: string }} options
 *   `seed` est injectable pour que les tests soient reproductibles.
 */
export function createHost({ seed = randomSeed, min = MIN_PLAYERS, code = DEFAULT_ROOM } = {}) {
  let lobby = createLobby({ min });

  /** @returns {Envelope[]} */
  function annonceAttente(room) {
    return [{ to: TOUS, message: { type: SERVER.WAITING, ...waitingStatus(lobby, room) } }];
  }

  /**
   * Lance la partie et distribue la graine commune.
   *
   * Tous recoivent la meme graine — c'est elle qui donne a chacun la meme suite
   * de pieces — mais chacun recoit aussi son identifiant, pour distinguer
   * ensuite ses actions de celles des autres.
   *
   * @returns {Envelope[]}
   */
  function demarrer(roomCode) {
    const result = begin(lobby, roomCode);
    lobby = result.lobby;
    if (!result.started) return [];

    const room = result.room;
    return room.players.map((id) => ({
      to: id,
      message: {
        type: SERVER.START,
        room: room.code,
        seed: room.seed,
        playerId: id,
        players: room.players,
        // Les pseudos accompagnent les identifiants : c'est ce qui permet de
        // nommer celui qu'on regarde jouer.
        names: room.names,
      },
    }));
  }

  /**
   * Sortie de jeu d'un joueur : defaite ou depart en pleine partie.
   *
   * @returns {Envelope[]}
   */
  function sortie(playerId) {
    const result = eliminate(lobby, playerId);
    lobby = result.lobby;
    if (!result.eliminated) return [];

    const room = result.room;

    if (result.finished) {
      // Le verdict parti, le salon n'a plus lieu d'etre : il se ferme, et la
      // partie suivante repart d'un salon neuf. Le garder interdisait la partie
      // suivante a tout le monde des qu'un seul joueur restait devant son
      // ecran de fin.
      lobby = closeRoom(lobby, room.code);
      return [{ to: TOUS, message: { type: SERVER.FINISHED, winner: room.winner } }];
    }

    // La partie continue entre les survivants.
    return [{
      to: TOUS,
      message: { type: SERVER.ELIMINATED, playerId, remaining: alive(room).length },
    }];
  }

  return {
    /**
     * Traite un message de joueur et renvoie ce qu'il faut emettre.
     *
     * @param {string} fromId emetteur : un pair, l'hote lui-meme, ou un bot
     * @param {object} message un CLIENT.* (join, begin, over)
     * @returns {Envelope[]}
     */
    receive(fromId, message) {
      if (!message || typeof message.type !== 'string') return [];

      switch (message.type) {
        case CLIENT.JOIN: {
          // Le code du salon est celui de l'hote : en pair-a-pair, le salon
          // *est* le point de rendez-vous, et nul ne peut en demander un autre
          // sans aller ailleurs. Le champ du message ne sert donc a rien ici.
          //
          // Le pseudo passe tel quel : c'est le salon qui applique son propre
          // nom par defaut, pour qu'un seul endroit connaisse « Joueur ».
          const result = join(lobby, code, fromId, seed(), message.name);
          lobby = result.lobby;

          if (!result.joined) {
            return [{
              to: fromId,
              message: { type: SERVER.ERROR, message: 'La partie a deja commence dans ce salon.' },
            }];
          }

          // Aucun depart automatique : la partie ne se lance que sur demande
          // d'un joueur, sans quoi un arrivant de plus la declencherait a leur
          // place.
          return annonceAttente(result.room);
        }

        case CLIENT.BEGIN: {
          const room = roomOf(lobby, fromId);
          if (!room || room.started) return [];

          if (room.players.length < lobby.min) {
            return [{
              to: fromId,
              message: {
                type: SERVER.ERROR,
                message: `Il faut au moins ${lobby.min} joueurs pour commencer.`,
              },
            }];
          }

          return demarrer(room.code);
        }

        case CLIENT.OVER:
          return sortie(fromId);

        default:
          // Un pair peut toujours envoyer n'importe quoi : on l'ignore plutot
          // que de lever, comme le fait deja decode().
          return [];
      }
    },

    /**
     * Depart d'un joueur : onglet ferme, ou reseau qui l'a lache.
     *
     * @returns {Envelope[]}
     */
    disconnect(playerId) {
      // L'etat du salon est lu avant le retrait : apres, le joueur n'y est plus.
      const started = roomOf(lobby, playerId)?.started ?? false;

      // Un depart en pleine partie vaut elimination, arbitree tant que le
      // joueur fait encore partie du salon.
      const messages = started ? sortie(playerId) : [];

      const result = leave(lobby, playerId);
      lobby = result.lobby;

      if (!result.room || result.remaining.length === 0) return messages;

      if (started) {
        // Evenement de partie : les survivants continuent, c'est l'elimination
        // qui decide de la suite, pas ce message.
        return [...messages, { to: TOUS, message: { type: SERVER.LEFT, playerId } }];
      }

      // Simple passage dans le salon : ceux qui patientent voient le compte
      // baisser, et rien de plus. Leur attente n'est pas annulee.
      return [...messages, ...annonceAttente(result.room)];
    },

    /** Le salon arbitre, ou null s'il s'est ferme. */
    room() {
      return lobby.rooms[code] ?? null;
    },

    /** La partie a-t-elle commence ? Un arrivant tardif se verra refuse. */
    started() {
      return lobby.rooms[code]?.started ?? false;
    },
  };
}
