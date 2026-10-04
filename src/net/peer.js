/**
 * Transport pair-a-pair : le reseau sans serveur.
 *
 * Les navigateurs se parlent en direct par WebRTC. Il n'y a plus de machine a
 * heberger : seul le rendez-vous initial passe par un reseau public, et c'est le
 * fichier vendor/trystero-nostr.js qui s'en charge.
 *
 * Ce module n'importe rien de WebRTC : `joinRoom` et `selfId` lui sont
 * **injectes**. Il reste donc du JavaScript ordinaire, sans DOM ni navigateur,
 * et c'est ce qui permet de monter trois transports dans un seul process pour
 * les eprouver sous `node --test` (voir test/peer.test.js). Seul main.js connait
 * vendor/.
 *
 * Ce qui circule, et ce qui ne circule pas
 * ----------------------------------------
 * Chaque joueur ne reduit que ses propres actions : les plateaux adverses ne
 * sont jamais simules, ils arrivent par le canal decoratif des instantanes. Rien
 * n'a donc besoin d'etre synchronise, et aucun ordre n'a besoin d'etre impose.
 *
 * Les actions locales sont appliquees **immediatement**, en echo local, comme en
 * solo. Seul le handicap part sur le reseau, parce que c'est la seule action qui
 * s'applique aux autres. L'aller-retour que coutait l'ancien serveur disparait :
 * le pair-a-pair n'est pas un pis-aller, il est plus rapide.
 *
 * Les adversaires artificiels
 * ---------------------------
 * Ils vivent chez l'hote et ne sont jamais vus comme des pairs par le reseau :
 * ce sont des identifiants locaux. Ils emettent les memes messages qu'un vrai
 * client, et l'hote les relaie — c'est le seul endroit ou il relaie quelque
 * chose, et il le doit, puisqu'un bot n'a pas de connexion a lui.
 */

import { randomSeed } from '../engine/rng.js';
import { TOUS, createHost, elire } from './host.js';
import { CLIENT, DEFAULT_ROOM, SERVER, decode, encode } from './protocol.js';

/**
 * Delai d'observation avant d'arbitrer quoi que ce soit.
 *
 * Le temps que les pairs deja presents se signalent. Sans lui, un arrivant seul
 * se proclamerait hote et emettrait une attente qu'il devrait defaire a la
 * seconde suivante.
 */
const SETTLE_MS = 1200;

/**
 * Delai au-dela duquel rester seul merite une explication.
 *
 * Trystero ne signale un pair qu'une fois la connexion **etablie** : un reseau
 * qui refuse la connexion directe est donc indistinguable d'un salon vide. On ne
 * peut pas trancher, alors on dit les deux — c'est plus honnete qu'un « en
 * attente » muet, qui laisse conclure que le jeu est casse.
 */
const SEUL_MS = 20000;

/** Identifiant d'application : il isole nos salons de ceux des autres jeux. */
const APP_ID = 'tetris-labilbe';

/**
 * Demandes adressees a l'arbitre.
 *
 * Attention : CLIENT et SERVER partagent deux noms, 'action' et 'board'. Sur un
 * socket la direction allait de soi — ce qui montait venait d'un client, ce qui
 * descendait venait du serveur. Dans un maillage il n'y a plus de haut ni de
 * bas, et classer un SERVER.ACTION recu comme une demande le ferait rediffuser
 * sans fin. On ne reconnait donc comme demande que les trois types sans
 * homonyme ; tout le reste est un message d'arbitre.
 */
const TYPES_DEMANDE = new Set([CLIENT.JOIN, CLIENT.BEGIN, CLIENT.OVER]);

/**
 * Messages qu'un pair quelconque a le droit d'emettre.
 *
 * Le handicap et les instantanes vont d'un pair a l'autre en direct : ils
 * viennent donc de n'importe qui. Tout le reste est un verdict, et n'est accepte
 * que de l'arbitre — sans quoi un pair pourrait s'inventer vainqueur.
 */
const TYPES_DIRECTS = new Set([SERVER.ACTION, SERVER.BOARD]);

/**
 * Pose un gestionnaire d'evenement sur un objet de la bibliotheque.
 *
 * `onMessage`, `onPeerJoin` et `onPeerLeave` ne sont pas des enregistreurs mais
 * des proprietes a **assigner** : elles valent `null` tant qu'on ne leur a rien
 * mis. Les versions anterieures — et le README d'amont — en faisaient des
 * fonctions. On accepte les deux, pour qu'un rafraichissement du fichier vendu
 * ne casse rien.
 */
function brancher(cible, nom, handler) {
  if (typeof cible[nom] === 'function') cible[nom](handler);
  else cible[nom] = handler;
}

/**
 * Ouvre un canal de messages et ramene l'API de la bibliotheque a deux
 * fonctions : `envoyer(message, destinataire)` et `recevoir(handler)`.
 *
 * Deux pieges, aucun devinable :
 *
 * - `makeAction` renvoyait un couple `[envoyer, recevoir]` ; depuis la 0.25 il
 *   renvoie un objet.
 * - `send` ne prend plus l'identifiant du pair en second argument, mais un objet
 *   d'options `{ target }`. Passer l'identifiant tout nu ne leve rien : le
 *   message part simplement a tout le monde, ce qui ne se voit pas tout de
 *   suite.
 *
 * Tout cela se joue ici, et nulle part ailleurs : le reste du fichier ne connait
 * que `envoyer` et `recevoir`.
 */
function canal(room, nom) {
  const action = room.makeAction(nom);

  if (Array.isArray(action)) {
    const [envoyer, recevoir] = action;
    return { envoyer, recevoir };
  }

  return {
    envoyer(message, destinataire) {
      // L'envoi est asynchrone et peut echouer si un pair vient de partir :
      // cela ne doit pas interrompre la partie de celui qui reste.
      const envoi = destinataire
        ? action.send(message, { target: destinataire })
        : action.send(message);
      Promise.resolve(envoi).catch(() => {});
    },
    recevoir(handler) {
      brancher(action, 'onMessage', handler);
    },
  };
}

/**
 * Serveurs STUN publics.
 *
 * Ils ne relaient rien : ils disent seulement a un navigateur sous quelle
 * adresse le reste du monde le voit. C'est ce qui permet la connexion directe
 * dans la grande majorite des cas. Les pairs derriere un NAT symetrique
 * resteront injoignables : il faudrait un relais TURN, que ce jeu n'heberge pas.
 */
const STUN = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

/**
 * @param {{
 *   code?: string,
 *   name?: string,
 *   joinRoom: Function,
 *   selfId: string,
 *   seed?: () => number,
 *   settleMs?: number,
 *   seulMs?: number,
 *   appId?: string,
 *   iceServers?: object[],
 *   bots?: object | null,
 *   now?: () => number,
 * }} options
 */
export function createPeerTransport({
  code = DEFAULT_ROOM,
  name = '',
  joinRoom,
  selfId,
  seed = randomSeed,
  settleMs = SETTLE_MS,
  seulMs = SEUL_MS,
  appId = APP_ID,
  iceServers = STUN,
  bots = null,
} = {}) {
  const actionListeners = new Set();
  const statusListeners = new Set();
  const boardListeners = new Set();

  /** Pairs connectes, hors soi. */
  const pairs = new Set();

  /** @type {ReturnType<typeof createHost> | null} */
  let host = null;
  /** @type {string | null} */
  let hoteId = null;
  /** @type {Function | null} */
  let room = null;
  /** @type {Function | null} */
  let envoyer = null;
  /** @type {Function | null} */
  let envoyerEcran = null;

  let moiId = selfId;
  let demarree = false;
  let ferme = false;
  let minuteurSeul = null;

  /** Resolution de start(), tenue jusqu'au START. */
  let resoudre = null;
  let rejeter = null;

  function notifyStatus(status) {
    for (const listener of statusListeners) listener(status);
  }

  /** Remet une action aux ecouteurs locaux, avec son auteur. */
  function remettreAction(playerId, action) {
    for (const listener of actionListeners) {
      listener(action, { playerId, self: playerId === moiId });
    }
  }

  /** Emet un message vers un pair, ou vers tous si `to` vaut TOUS. */
  function versPairs(message, to = TOUS) {
    if (!envoyer) return;
    const brut = encode(message);
    if (to === TOUS) {
      if (pairs.size > 0) envoyer(brut);
      return;
    }
    if (pairs.has(to)) envoyer(brut, to);
  }

  /** Les identifiants des adversaires artificiels, s'il y en a. */
  function idsBots() {
    return bots ? bots.ids() : [];
  }

  /**
   * Applique un message d'arbitre : celui de l'hote distant, ou le sien.
   *
   * C'est le meme traitement dans les deux cas, et c'est voulu : l'hote n'a
   * aucun chemin a lui, donc aucun comportement qui ne serait pas eprouve chez
   * les invites.
   */
  function appliquerArbitre(message) {
    switch (message.type) {
      case SERVER.START:
        moiId = message.playerId;
        demarree = true;
        arreterMinuteurSeul();
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

      case SERVER.ACTION:
        // Le handicap d'un autre joueur. Le filtre `self` de main.js en tire les
        // consequences : on ne se penalise pas soi-meme.
        remettreAction(message.playerId, message.action);
        break;

      case SERVER.BOARD:
        for (const listener of boardListeners) listener(message.playerId, message.board);
        break;

      case SERVER.ERROR:
        notifyStatus({ kind: 'error', message: message.message });
        if (rejeter) {
          rejeter(new Error(message.message));
          resoudre = null;
          rejeter = null;
        }
        break;

      default:
        break;
    }
  }

  /**
   * Distribue les enveloppes de l'arbitre.
   *
   * Un seul routeur pour tout le monde — pairs du reseau, soi-meme, adversaires
   * artificiels — et c'est ce qui evite de dupliquer la logique du salon.
   */
  function router(envelopes) {
    for (const { to, message } of envelopes) {
      if (to === TOUS) {
        versPairs(message);
        for (const id of idsBots()) bots.receive(id, message);
        appliquerArbitre(message);
        continue;
      }
      if (to === moiId) {
        appliquerArbitre(message);
        continue;
      }
      if (bots && idsBots().includes(to)) {
        bots.receive(to, message);
        continue;
      }
      versPairs(message, to);
    }
  }

  /**
   * Demande remise a l'arbitre : entrer, lancer, ou declarer sa defaite.
   *
   * Un invite n'arbitre rien : chez lui, la demande part vers l'hote.
   */
  function traiterDemande(fromId, message) {
    if (host) router(host.receive(fromId, message));
  }

  /**
   * Message d'un adversaire artificiel.
   *
   * Il emet ce qu'emettrait un vrai client ; c'est l'hote qui le relaie, puisque
   * le bot n'a pas de connexion a lui. Ce chemin est separe de celui du reseau
   * parce qu'ici la direction est connue d'avance : un bot ne peut etre que
   * client, donc 'action' et 'board' ne sont pas ambigus.
   */
  function traiterBot(botId, message) {
    switch (message.type) {
      case CLIENT.ACTION:
        diffuserAction(botId, message.action);
        break;

      case CLIENT.BOARD:
        diffuserEcran(botId, message.board);
        break;

      default:
        traiterDemande(botId, message);
        break;
    }
  }

  /** Diffuse une action de jeu a tout le monde sauf son auteur. */
  function diffuserAction(playerId, action) {
    versPairs({ type: SERVER.ACTION, playerId, action });
    for (const id of idsBots()) {
      if (id !== playerId) bots.receive(id, { type: SERVER.ACTION, playerId, action });
    }
    if (playerId !== moiId) remettreAction(playerId, action);
  }

  /** Diffuse un instantane de plateau a ceux qui regardent. */
  function diffuserEcran(playerId, board) {
    if (envoyerEcran && pairs.size > 0) {
      envoyerEcran(encode({ type: SERVER.BOARD, playerId, board }));
    }
    if (playerId !== moiId) {
      for (const listener of boardListeners) listener(playerId, board);
    }
  }

  function arreterMinuteurSeul() {
    if (minuteurSeul !== null) {
      clearTimeout(minuteurSeul);
      minuteurSeul = null;
    }
  }

  /**
   * Explique, au bout d'un moment, pourquoi personne n'arrive.
   *
   * On ne peut pas savoir si le salon est vide ou si un reseau bloque la
   * connexion directe : on dit les deux, avec le contournement.
   */
  function armerMinuteurSeul() {
    arreterMinuteurSeul();
    minuteurSeul = setTimeout(() => {
      if (ferme || demarree || pairs.size > 0) return;
      notifyStatus({
        kind: 'seeking',
        message: `Salon ${code} : toujours personne. Soit votre adversaire n’a pas `
          + 'encore ouvert le lien, soit l’un de vos deux réseaux refuse la connexion '
          + 'directe — cela touche environ un joueur sur dix, et il faudrait un relais '
          + 'que ce jeu n’héberge pas. Essayez depuis un autre réseau, ou le même '
          + 'Wi-Fi que lui. Vous pouvez aussi ajouter un adversaire artificiel.',
      });
    }, seulMs);
    if (typeof minuteurSeul?.unref === 'function') minuteurSeul.unref();
  }

  /**
   * Prend ou cede l'arbitrage selon les pairs presents.
   *
   * Une abdication ne peut survenir qu'avant le depart : le salon n'a alors rien
   * a perdre, sauf la graine, qui est de toute facon arbitraire.
   */
  function arbitrer() {
    if (ferme || demarree) return;

    const elu = elire([moiId, ...pairs]);
    if (elu === hoteId) return;

    hoteId = elu;

    if (hoteId === moiId) {
      host = createHost({ seed, code });
      // Son propre JOIN passe par le meme chemin que celui des autres.
      traiterDemande(moiId, { type: CLIENT.JOIN, name });
      if (bots) {
        for (const { from, message } of bots.joins()) traiterBot(from, message);
      }
      return;
    }

    // Un plus petit identifiant est apparu : on cesse d'arbitrer et on se
    // presente au nouvel hote.
    host = null;
    versPairs({ type: CLIENT.JOIN, name }, hoteId);
  }

  return {
    start() {
      return new Promise((resolve, reject) => {
        resoudre = resolve;
        rejeter = reject;

        notifyStatus({ kind: 'seeking', message: `Recherche du salon ${code}…` });

        room = joinRoom({ appId, rtcConfig: { iceServers } }, code);

        const jeu = canal(room, 'jeu');
        const ecran = canal(room, 'ecran');
        const { recevoir } = jeu;
        const { recevoir: recevoirEcran } = ecran;
        envoyer = jeu.envoyer;
        envoyerEcran = ecran.envoyer;

        recevoir((brut, fromId) => {
          const message = decode(brut);
          if (!message) return;

          // Une demande adressee a l'arbitre : elle n'a de sens que chez lui.
          if (TYPES_DEMANDE.has(message.type)) {
            traiterDemande(fromId, message);
            return;
          }

          // Un verdict ne vaut que s'il vient de l'arbitre. Le handicap et les
          // instantanes, eux, viennent de n'importe quel pair : c'est leur
          // chemin normal.
          if (TYPES_DIRECTS.has(message.type) || fromId === hoteId) appliquerArbitre(message);
        });

        recevoirEcran((brut) => {
          const message = decode(brut);
          if (message) appliquerArbitre(message);
        });

        brancher(room, 'onPeerJoin', (peerId) => {
          pairs.add(peerId);
          arreterMinuteurSeul();
          // L'arrivant se presentera de lui-meme a l'hote ; ici on ne verifie
          // que l'election, au cas ou il soit plus petit que nous.
          arbitrer();
        });

        brancher(room, 'onPeerLeave', (peerId) => {
          pairs.delete(peerId);

          if (host) {
            router(host.disconnect(peerId));
            return;
          }

          if (peerId === hoteId && demarree) {
            // Sans arbitre, plus de verdict possible : mieux vaut le dire que
            // laisser la partie continuer sans fin.
            notifyStatus({
              kind: 'closed',
              message: 'L’hôte de la partie a quitté : la partie s’arrête.',
            });
            return;
          }

          if (!demarree) arbitrer();
        });

        // Rien n'est arbitre avant d'avoir laisse aux presents le temps de se
        // signaler.
        const attente = setTimeout(() => {
          if (ferme) return;
          arbitrer();
          armerMinuteurSeul();
        }, settleMs);
        if (typeof attente?.unref === 'function') attente.unref();
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
      if (action?.type === 'garbage') diffuserAction(moiId, action);
    },

    sendBoard(board) {
      diffuserEcran(moiId, board);
    },

    onBoard(listener) {
      boardListeners.add(listener);
      return () => boardListeners.delete(listener);
    },

    /** Signale sa propre defaite : elle vaut elimination. */
    reportGameOver() {
      if (host) traiterDemande(moiId, { type: CLIENT.OVER });
      else versPairs({ type: CLIENT.OVER }, hoteId);
    },

    /** Demande a lancer la partie sans attendre que le salon soit plein. */
    begin() {
      if (host) traiterDemande(moiId, { type: CLIENT.BEGIN });
      else versPairs({ type: CLIENT.BEGIN }, hoteId);
    },

    /**
     * Fait avancer les adversaires artificiels.
     *
     * Appele depuis la boucle de rendu : les bots vivent sur la meme image que
     * le jeu, sans seconde horloge, et gelent avec elle si l'onglet passe en
     * arriere-plan — ce qui est le comportement souhaitable.
     */
    tick(nowMs) {
      if (!bots || !demarree) return;
      for (const { from, message } of bots.step(nowMs)) traiterBot(from, message);
    },

    /**
     * Ajoute un adversaire artificiel au salon. Reserve a l'hote : lui seul
     * arbitre, et un bot n'a pas de connexion a lui.
     *
     * @returns {boolean} vrai si un adversaire a ete ajoute
     */
    ajouterBot() {
      if (!host || !bots || demarree) return false;
      const ajout = bots.ajouter();
      if (!ajout) return false;
      traiterBot(ajout.from, ajout.message);
      return true;
    },

    /** Est-on l'arbitre ? L'interface n'offre les bots qu'a lui. */
    estHote() {
      return host !== null;
    },

    close() {
      ferme = true;
      arreterMinuteurSeul();
      actionListeners.clear();
      statusListeners.clear();
      boardListeners.clear();
      host = null;
      if (room) room.leave();
      room = null;
      envoyer = null;
      envoyerEcran = null;
    },

    onAction(listener) {
      actionListeners.add(listener);
      return () => actionListeners.delete(listener);
    },

    onStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
  };
}

