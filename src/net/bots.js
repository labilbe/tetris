/**
 * Adversaires artificiels, dans la page.
 *
 * Ils remplacent les anciens bots du serveur, qui etaient de vrais clients
 * WebSocket lances a cote du jeu. Ici ils vivent chez l'hote, dans son onglet :
 * en ligne on arrive souvent seul, et un salon qu'on ne peut pas lancer ne sert
 * a rien.
 *
 * Deux choses seulement changent par rapport a l'ancien pilote :
 *
 * 1. Plus d'echo a attendre. Un bot reduit ses actions directement, comme le
 *    fait maintenant le joueur humain : personne ne simule son plateau.
 * 2. Plus d'horloge a lui. `step(nowMs)` recoit le temps, et il est appele
 *    depuis la boucle de rendu. Les bots vivent donc sur la meme image que le
 *    jeu : pas de `setInterval`, pas de second rythme, et si l'onglet passe en
 *    arriere-plan ils gelent avec la partie — ce qui est souhaitable.
 *
 * La decision, elle, ne change pas d'un iota : c'est `ai/player.js`, pur et
 * deja teste, qui dit ou poser la piece.
 */

import { choisir, prochaineAction } from '../ai/player.js';
import { STATUS } from '../engine/constants.js';
import { createState, reduce, tick } from '../engine/state.js';
import { drawGarbageColumns } from './garbage.js';
import { BOT_NAMES, CLIENT, SERVER } from './protocol.js';
import { encodeBoard } from './snapshot.js';

/** Intervalle entre deux actions : de quoi voir jouer. */
const DELAI_ACTION_MS = 80;

/** Intervalle entre deux instantanes, comme pour un joueur humain. */
const BOARD_MS = 200;

/**
 * Nombre maximal d'adversaires artificiels.
 *
 * Ils tournent dans l'onglet de l'hote, sur la meme image que son jeu : au-dela
 * c'est sa propre partie qui saccade.
 */
export const PLAFOND_BOTS = 5;

/**
 * Un adversaire artificiel : un moteur, une decision, et du temps recu.
 *
 * @param {{ id: string, name: string, adresse?: number, delai?: number,
 *           boardMs?: number, alea?: () => number }} options
 */
export function createBotPilot({
  id,
  name,
  adresse = 0.9,
  delai = DELAI_ACTION_MS,
  boardMs = BOARD_MS,
  alea = Math.random,
}) {
  /** @type {import('../engine/state.js').GameState | undefined} */
  let state;

  let horloge = 0;
  let dernierInstantane = 0;
  let derniereAction = 0;
  let defaiteSignalee = false;

  /**
   * Le placement vise, garde tant que la piece est la meme.
   *
   * Il ne peut pas etre rejuge a chaque action : quand l'adresse fait rater un
   * coup, c'est un tirage au sort, et le retirer dix fois de suite ferait
   * hesiter la piece au lieu de la faire mal poser. On ne rejuge donc qu'a
   * l'arrivee d'une nouvelle piece — ou quand un handicap a change le plateau
   * sous elle.
   *
   * `state.next` ne change que lors d'un verrouillage : c'est le signal le plus
   * sur qu'une piece a laisse la place a la suivante.
   */
  let plan = null;

  /** Actions refusees d'affilee : la piece bute contre quelque chose. */
  let bloque = 0;

  function replanifier() {
    plan = null;
    bloque = 0;
  }

  /** Le placement vise, recalcule seulement s'il n'est plus d'actualite. */
  function cible() {
    if (plan && plan.piece === state.next) return plan.place;
    plan = { piece: state.next, place: choisir(state, { adresse, alea }) };
    bloque = 0;
    return plan.place;
  }

  return {
    id,
    name,

    /** La partie commence : meme graine que tout le monde. */
    demarrer(seed) {
      state = createState(seed);
      horloge = 0;
      dernierInstantane = 0;
      derniereAction = 0;
      defaiteSignalee = false;
      replanifier();
    },

    /** A-t-il deja annonce sa defaite ? */
    fini() {
      return defaiteSignalee;
    },

    /** Son plateau, pour les tests. */
    state() {
      return state;
    },

    /**
     * Un message d'arbitre, ou le handicap d'un autre joueur.
     *
     * Tout le reste — l'attente, les eliminations, le verdict — ne le concerne
     * pas : il joue jusqu'a perdre, et c'est l'hote qui tient les comptes.
     */
    receive(message) {
      if (!message) return;

      if (message.type === SERVER.START) {
        this.demarrer(message.seed);
        return;
      }

      if (message.type !== SERVER.ACTION || !state) return;
      if (message.playerId === id) return;

      // Le handicap est la seule action qui s'applique aux AUTRES.
      if (message.action?.type !== 'garbage') return;

      state = reduce(state, message.action);
      // Les blocs ont change le plateau : le placement vise ne vaut plus rien.
      replanifier();
    },

    /**
     * Un pas du pilote : le temps avance, puis on agit s'il est l'heure.
     *
     * @param {number} nowMs horloge de la boucle de rendu
     * @param {boolean} [gele] la partie attend un joueur : il patiente avec elle
     * @returns {{ from: string, message: object }[]} ce qu'il emet
     */
    step(nowMs, gele = false) {
      if (!state || defaiteSignalee) return [];

      const delta = horloge === 0 ? 0 : nowMs - horloge;
      horloge = nowMs;

      // Gele, il ne joue pas — mais son horloge suit quand meme, sans quoi il
      // rattraperait d'un coup, au degel, toutes les secondes d'attente.
      //
      // Et il continue d'emettre son plateau : un instantane est la preuve
      // qu'un joueur est toujours la. Un adversaire artificiel muet serait
      // tenu pour absent par les autres, qui l'attendraient a leur tour — et
      // comme c'est le gel qui l'a fait taire, la partie s'attendrait
      // elle-meme jusqu'a l'echeance.
      if (gele) {
        if (nowMs - dernierInstantane < boardMs) return [];
        dernierInstantane = nowMs;
        return [{ from: id, message: { type: CLIENT.BOARD, board: encodeBoard(state) } }];
      }

      state = tick(state, delta);

      if (state.status === STATUS.OVER) {
        defaiteSignalee = true;
        return [{ from: id, message: { type: CLIENT.OVER } }];
      }

      const messages = [];

      if (nowMs - dernierInstantane >= boardMs) {
        dernierInstantane = nowMs;
        messages.push({ from: id, message: { type: CLIENT.BOARD, board: encodeBoard(state) } });
      }

      if (nowMs - derniereAction >= delai) {
        derniereAction = nowMs;

        // Une action refusee laisse l'etat inchange — le moteur renvoie le meme
        // objet. Deux refus de suite et la piece bute contre un surplomb : on la
        // lache la ou elle est plutot que de pousser un mur jusqu'au
        // verrouillage.
        const action = bloque >= 2 ? { type: 'hardDrop' } : prochaineAction(state, cible());

        const avant = state;
        state = reduce(state, action);
        if (state === avant) bloque += 1;
        else bloque = 0;

        const gagnees = state.lines - avant.lines;
        if (gagnees > 0) {
          const columns = drawGarbageColumns(gagnees, alea);
          if (columns.length > 0) {
            messages.push({
              from: id,
              message: { type: CLIENT.ACTION, action: { type: 'garbage', columns } },
            });
          }
        }
      }

      return messages;
    },
  };
}

/**
 * L'equipe d'adversaires artificiels de l'hote.
 *
 * Elle parle le langage d'un client : des `join`, des `action`, des `board`, un
 * `over`. L'hote ne fait aucune difference entre eux et un vrai joueur, ce qui
 * lui evite un second chemin a tenir — c'etait deja la vertu des anciens bots,
 * qui etaient de vrais clients du reseau.
 *
 * @param {{ count?: number, adresse?: number, delai?: number,
 *           alea?: () => number }} options
 */
export function createBotTeam({ count = 0, adresse, delai, alea = Math.random } = {}) {
  /** @type {ReturnType<typeof createBotPilot>[]} */
  const pilotes = [];

  // Les prenoms sont pris a la suite depuis un rang tire au sort : distincts a
  // coup sur, pour qu'on les distingue dans le multiplex, et pas toujours les
  // memes d'une partie a l'autre.
  const depart = Math.floor(alea() * BOT_NAMES.length);
  let rang = 0;

  function creer() {
    if (pilotes.length >= PLAFOND_BOTS) return null;

    const index = rang;
    rang += 1;
    const pilote = createBotPilot({
      id: `bot-${index + 1}`,
      name: BOT_NAMES[(depart + index) % BOT_NAMES.length],
      adresse,
      delai,
      alea,
    });
    pilotes.push(pilote);
    return pilote;
  }

  function demande(pilote) {
    return { from: pilote.id, message: { type: CLIENT.JOIN, name: pilote.name } };
  }

  for (let i = 0; i < Math.min(count, PLAFOND_BOTS); i += 1) creer();

  return {
    ids() {
      return pilotes.map((p) => p.id);
    },

    /** Combien sont deja la, et combien on peut encore en ajouter. */
    count() {
      return pilotes.length;
    },

    complet() {
      return pilotes.length >= PLAFOND_BOTS;
    },

    /** Les entrees dans le salon, une par adversaire. */
    joins() {
      return pilotes.map(demande);
    },

    /**
     * Ajoute un adversaire et renvoie son entree dans le salon.
     *
     * @returns {{ from: string, message: object } | null} null si c'est complet
     */
    ajouter() {
      const pilote = creer();
      return pilote ? demande(pilote) : null;
    },

    receive(botId, message) {
      pilotes.find((p) => p.id === botId)?.receive(message);
    },

    /** Fait avancer tous les adversaires et rassemble ce qu'ils emettent. */
    step(nowMs) {
      const messages = [];
      for (const pilote of pilotes) messages.push(...pilote.step(nowMs));
      return messages;
    },

    /** Un adversaire donne, pour les tests. */
    pilote(botId) {
      return pilotes.find((p) => p.id === botId);
    },
  };
}
