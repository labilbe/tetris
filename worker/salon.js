/**
 * Un salon, le reseau qui va avec, et son journal.
 *
 * Tout l'arbitrage — qui attend qui, avec quelle graine, qui l'emporte — vit
 * dans src/net/host.js, pur et teste sous `node --test`. Ce fichier ne fait que
 * le brancher sur des WebSockets : il recoit, il transmet, il n'interprete rien.
 * Il ne connait aucune regle de Tetris et ne calcule aucun plateau.
 *
 * Deux messages ne passent pas par l'arbitre : le handicap et les instantanes de
 * plateau. Ils n'ont aucune decision a demander, et sont simplement relayes aux
 * autres joueurs — jamais a leur emetteur, qui a deja applique son action chez
 * lui sans attendre personne.
 *
 * Le journal
 * ----------
 * Tout ce qui entre et sort est consigne, horodate. C'est la lecon du chantier
 * precedent : les pannes de reseau se racontent mal apres coup, et une capture
 * d'ecran ne dit jamais quel message est parti, ni quand. Le journal, lui, le
 * dit — et il est la par defaut, sans que personne ait rien a activer au moment
 * ou le probleme survient, c'est-a-dire toujours trop tard.
 *
 * Les instantanes de plateau en sont exclus : cinq par seconde et par joueur,
 * ils noieraient tout ce qui se lit, et ils n'expliquent rien.
 */

import { DurableObject } from 'cloudflare:workers';

import { TOUS, createHost } from '../src/net/host.js';
import { CLIENT, SERVER, decode, encode } from '../src/net/protocol.js';

/** Au-dela, les parties les plus anciennes s'effacent de ce salon. */
const PARTIES_GARDEES = 20;

/** Un identifiant lisible dans un journal : les premiers caracteres suffisent. */
const court = (id) => (id ? String(id).slice(0, 8) : null);

export class Salon extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);

    /** @type {Map<string, WebSocket>} */
    this.sockets = new Map();
    /** @type {Map<string, string>} */
    this.pseudos = new Map();
    /** @type {ReturnType<typeof createHost> | null} */
    this.host = null;
    this.code = null;

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS journal (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        partie INTEGER NOT NULL,
        t INTEGER NOT NULL,
        sens TEXT NOT NULL,
        joueur TEXT,
        contenu TEXT NOT NULL
      )
    `);
  }

  /**
   * Le numero de la partie en cours dans ce salon.
   *
   * Retrouve depuis le journal au premier appel : un Durable Object peut etre
   * reveille froid, et la numerotation ne doit pas recommencer a 1 par-dessus
   * des parties deja ecrites.
   */
  partie() {
    if (this.partieCourante == null) {
      const [ligne] = [...this.ctx.storage.sql.exec(
        'SELECT COALESCE(MAX(partie), 1) AS n FROM journal',
      )];
      this.partieCourante = ligne?.n ?? 1;
    }
    return this.partieCourante;
  }

  /**
   * Consigne un evenement.
   *
   * @param {'recu'|'emis'|'note'} sens d'ou vient l'evenement
   */
  noter(sens, joueur, contenu) {
    this.ctx.storage.sql.exec(
      'INSERT INTO journal (partie, t, sens, joueur, contenu) VALUES (?, ?, ?, ?, ?)',
      this.partie(), Date.now(), sens, court(joueur), JSON.stringify(contenu),
    );
  }

  /** Ouvre une nouvelle page de journal, et elague les plus anciennes. */
  nouvellePartie() {
    this.partieCourante = this.partie() + 1;
    this.ctx.storage.sql.exec(
      "DELETE FROM journal WHERE partie <= ?",
      this.partieCourante - PARTIES_GARDEES,
    );
  }

  /** Previent le registre, pour qu'on retrouve cette partie sans son code. */
  auRegistre(corps) {
    const id = this.env.REGISTRE.idFromName('global');
    this.ctx.waitUntil(this.env.REGISTRE.get(id).fetch('https://registre/', {
      method: 'POST',
      body: JSON.stringify({ salon: this.code, ...corps }),
    }));
  }

  async fetch(request) {
    const url = new URL(request.url);

    // Le code vient du chemin, pose par le point d'entree.
    this.code = decodeURIComponent(url.pathname.slice(1));

    // Lecture du journal : pas une connexion de jeu.
    if (url.searchParams.get('journal') === '1') return this.lireJournal(url);

    if (!this.host) this.host = createHost({ code: this.code });

    const { 0: client, 1: serveur } = new WebSocketPair();
    serveur.accept();

    // L'identifiant est attribue ici, et le joueur ne le choisit pas : c'est ce
    // qui empeche de se faire passer pour un autre.
    const playerId = crypto.randomUUID();
    this.sockets.set(playerId, serveur);
    this.noter('note', playerId, { evenement: 'connexion', joueurs: this.sockets.size });

    serveur.addEventListener('message', (event) => {
      this.onMessage(playerId, event.data);
    });

    const partir = () => this.onClose(playerId);
    serveur.addEventListener('close', partir);
    serveur.addEventListener('error', partir);

    return new Response(null, { status: 101, webSocket: client });
  }

  /** Rend le journal d'une partie, ou de la plus recente. */
  lireJournal(url) {
    // Par defaut, la derniere partie qui a quelque chose a raconter — et non la
    // page courante, qui est vide juste apres qu'un salon s'est vide, c'est-a-dire
    // precisement au moment ou l'on vient lire.
    const demandee = url.searchParams.get('partie');
    const [derniere] = [...this.ctx.storage.sql.exec('SELECT MAX(partie) AS n FROM journal')];
    const partie = demandee ? Number(demandee) : (derniere?.n ?? this.partie());

    const lignes = [...this.ctx.storage.sql.exec(
      'SELECT t, sens, joueur, contenu FROM journal WHERE partie = ? ORDER BY id',
      partie,
    )];

    return Response.json({
      salon: this.code,
      partie,
      parties: [...this.ctx.storage.sql.exec(
        'SELECT DISTINCT partie FROM journal ORDER BY partie DESC',
      )].map((l) => l.partie),
      entrees: lignes.map((l) => ({
        t: new Date(l.t).toISOString(),
        sens: l.sens,
        joueur: l.joueur,
        ...JSON.parse(l.contenu),
      })),
    });
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
      this.noter('emis', to === TOUS ? null : to, {
        pour: to === TOUS ? 'tous' : court(to),
        ...message,
      });

      if (to === TOUS) {
        for (const playerId of this.sockets.keys()) this.envoyer(playerId, message);
      } else {
        this.envoyer(to, message);
      }

      if (message.type === SERVER.START) this.departConsigne(message);
      if (message.type === SERVER.FINISHED) {
        this.auRegistre({ action: 'fin', partie: this.partie(), issue: `vainqueur ${court(message.winner)}` });
      }
    }
  }

  /** Le depart d'une partie n'est consigne qu'une fois, pas une par joueur. */
  departConsigne(message) {
    if (this.departVu === message.seed) return;
    this.departVu = message.seed;
    this.auRegistre({
      action: 'debut',
      partie: this.partie(),
      joueurs: message.players.map((id) => this.pseudos.get(id) ?? court(id)),
    });
  }

  /** Relaie un message a tout le salon sauf son emetteur. */
  auxAutres(emetteur, message) {
    for (const playerId of this.sockets.keys()) {
      if (playerId !== emetteur) this.envoyer(playerId, message);
    }
  }

  onMessage(playerId, brut) {
    const message = decode(typeof brut === 'string' ? brut : String(brut));
    if (!message) {
      this.noter('recu', playerId, { evenement: 'message illisible' });
      return;
    }

    // Les instantanes ne sont pas consignes : cinq par seconde et par joueur,
    // ils noieraient tout ce qui se lit.
    if (message.type !== CLIENT.BOARD) this.noter('recu', playerId, message);

    switch (message.type) {
      case CLIENT.JOIN:
        this.pseudos.set(playerId, message.name || 'Joueur');
        this.router(this.host.receive(playerId, message));
        break;

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

    this.noter('note', playerId, {
      evenement: 'deconnexion',
      pseudo: this.pseudos.get(playerId),
      restants: this.sockets.size,
    });

    // Un depart en pleine partie vaut elimination, et peut donc designer un
    // vainqueur : c'est l'arbitre qui en decide.
    this.router(this.host.disconnect(playerId));
    this.pseudos.delete(playerId);

    // Salon vide : on repart d'un arbitre neuf, graine comprise, et d'une
    // nouvelle page de journal. Le Durable Object, lui, peut etre garde en vie
    // par la plateforme ; sans cela, un salon acheve interdirait la partie
    // suivante sous le meme code.
    if (this.sockets.size === 0) {
      this.host = null;
      this.departVu = null;
      this.noter("note", null, { evenement: "salon vide" });
      this.nouvellePartie();
    }
  }
}
