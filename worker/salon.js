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
 * Les coupures
 * ------------
 * Une connexion qui tombe n'est pas un abandon. La place du joueur est gardee
 * trente secondes, les autres sont prevenus, et il reprend la sienne s'il
 * revient. L'etat du salon est range dans le stockage a chaque changement : un
 * Durable Object redemarre — ce qui arrive a chaque deploiement — retrouve donc
 * la partie en cours au lieu de la perdre.
 *
 * Le journal
 * ----------
 * Tout ce qui entre et sort est consigne, horodate. C'est la lecon du chantier
 * precedent : les pannes de reseau se racontent mal apres coup, et une capture
 * d'ecran ne dit jamais quel message est parti, ni quand. Il est la par defaut,
 * sans que personne ait rien a activer au moment ou le probleme survient,
 * c'est-a-dire toujours trop tard.
 *
 * Les instantanes de plateau en sont exclus : cinq par seconde et par joueur,
 * ils noieraient tout ce qui se lit, et ils n'expliquent rien.
 */

import { DurableObject } from 'cloudflare:workers';

import { TOUS, createHost } from '../src/net/host.js';
import { CLIENT, REPRISE_MS, SERVER, decode, encode } from '../src/net/protocol.js';

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
    /** Comptes a rebours des joueurs coupes. @type {Map<string, number>} */
    this.minuteurs = new Map();
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

    this.ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS etat (cle TEXT PRIMARY KEY, valeur TEXT)',
    );
  }

  /** Une valeur rangee, ou null. */
  lire(cle) {
    const [ligne] = [...this.ctx.storage.sql.exec('SELECT valeur FROM etat WHERE cle = ?', cle)];
    return ligne ? JSON.parse(ligne.valeur) : null;
  }

  ecrire(cle, valeur) {
    this.ctx.storage.sql.exec(
      'INSERT INTO etat (cle, valeur) VALUES (?, ?) '
      + 'ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur',
      cle, JSON.stringify(valeur),
    );
  }

  /**
   * L'arbitre du salon, retrouve tel qu'il etait.
   *
   * C'est ce qui fait qu'une partie survit au redemarrage du relais : sans cela,
   * un deploiement effacait le salon, et les joueurs qui se reconnectaient
   * tombaient sur un salon vide ou sur un refus.
   */
  arbitre() {
    if (!this.host) {
      this.host = createHost({ code: this.code, etat: this.lire('arbitre') });
      this.pseudos = new Map(this.lire('pseudos') ?? []);
    }
    return this.host;
  }

  /** Range l'etat de l'arbitre : il doit survivre a un reveil froid. */
  sauver() {
    this.ecrire('arbitre', this.host.etat());
    this.ecrire('pseudos', [...this.pseudos]);
  }

  /** Le numero de la partie en cours dans ce salon. */
  partie() {
    if (this.partieCourante == null) this.partieCourante = this.lire('partie') ?? 1;
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
    this.ecrire('partie', this.partieCourante);
    this.ctx.storage.sql.exec(
      'DELETE FROM journal WHERE partie <= ?',
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
    this.code = decodeURIComponent(url.pathname.slice(1));

    // Lecture du journal : pas une connexion de jeu.
    if (url.searchParams.get('journal') === '1') return this.lireJournal(url);

    this.arbitre();

    const { 0: client, 1: serveur } = new WebSocketPair();
    serveur.accept();

    // L'identifiant est attribue ici, et le joueur ne le choisit pas : c'est ce
    // qui empeche de se faire passer pour un autre. Il tient dans un objet
    // mutable, car une reprise le remplace par celui du joueur qui revient.
    const moi = { id: crypto.randomUUID() };
    this.sockets.set(moi.id, serveur);
    this.noter('note', moi.id, { evenement: 'connexion', joueurs: this.sockets.size });

    serveur.addEventListener('message', (event) => this.onMessage(moi, event.data));
    const partir = () => this.onClose(moi.id);
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

  /** Distribue les enveloppes de l'arbitre, et range ce qu'elles ont change. */
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
        this.auRegistre({
          action: 'fin',
          partie: this.partie(),
          issue: `vainqueur ${court(message.winner)}`,
        });
      }
    }

    if (envelopes.length > 0) this.sauver();
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

  /**
   * Un joueur coupe se represente avant la fin du delai.
   *
   * Son identifiant lui tient lieu de laissez-passer : il est tire au sort par
   * le relais et n'a ete dit qu'a lui. Reprendre sa place revient donc a prouver
   * qu'on est bien celui qui l'occupait.
   *
   * @returns {boolean} vrai si la place a ete reprise
   */
  reprise(moi, demande) {
    const { repris, envelopes } = this.arbitre().reprendre(demande);
    if (!repris) return false;

    // La socket neuve prend l'identite de l'ancienne : pour l'arbitre comme pour
    // les autres joueurs, rien n'a change.
    const socket = this.sockets.get(moi.id);
    this.sockets.delete(moi.id);
    moi.id = demande;
    this.sockets.set(demande, socket);

    this.annulerMinuteur(demande);
    this.noter('note', demande, { evenement: 'reprise', pseudo: this.pseudos.get(demande) });
    this.router(envelopes);
    return true;
  }

  /** Arme le compte a rebours d'un joueur coupe. */
  armerMinuteur(playerId) {
    this.annulerMinuteur(playerId);
    this.minuteurs.set(playerId, setTimeout(() => {
      this.minuteurs.delete(playerId);
      this.noter('note', playerId, { evenement: 'delai de reprise ecoule' });
      this.router(this.arbitre().expirer(playerId));
      this.rangerSiVide();
    }, REPRISE_MS));
  }

  annulerMinuteur(playerId) {
    const minuteur = this.minuteurs.get(playerId);
    if (minuteur !== undefined) {
      clearTimeout(minuteur);
      this.minuteurs.delete(playerId);
    }
  }

  onMessage(moi, brut) {
    const message = decode(typeof brut === 'string' ? brut : String(brut));
    if (!message) {
      this.noter('recu', moi.id, { evenement: 'message illisible' });
      return;
    }

    // Les instantanes ne sont pas consignes : cinq par seconde et par joueur,
    // ils noieraient tout ce qui se lit.
    if (message.type !== CLIENT.BOARD) this.noter('recu', moi.id, message);

    switch (message.type) {
      case CLIENT.JOIN:
        // Un retour apres coupure reprend la place gardee, au lieu d'entrer
        // comme un nouveau venu — ce qui lui vaudrait un refus, la partie ayant
        // commence.
        if (message.reprise && this.reprise(moi, message.reprise)) return;

        this.pseudos.set(moi.id, message.name || 'Joueur');
        this.router(this.arbitre().receive(moi.id, message));
        break;

      case CLIENT.BEGIN:
      case CLIENT.OVER:
        this.router(this.arbitre().receive(moi.id, message));
        break;

      case CLIENT.ACTION:
        // Le handicap, et lui seul, traverse le reseau. Il ne revient pas a son
        // emetteur : celui qui efface les lignes ne se penalise pas, et il a
        // deja applique son action chez lui.
        if (message.action) {
          this.auxAutres(moi.id, { type: SERVER.ACTION, playerId: moi.id, action: message.action });
        }
        break;

      case CLIENT.BOARD:
        // Purement decoratif, et opaque : le relais n'y comprend rien et n'a pas
        // a y comprendre quoi que ce soit.
        if (message.board) {
          this.auxAutres(moi.id, { type: SERVER.BOARD, playerId: moi.id, board: message.board });
        }
        break;

      default:
        break;
    }
  }

  onClose(playerId) {
    if (!this.sockets.delete(playerId)) return; // deja parti

    this.noter('note', playerId, {
      evenement: 'coupure',
      pseudo: this.pseudos.get(playerId),
      restants: this.sockets.size,
    });

    const envelopes = this.arbitre().partir(playerId);
    this.router(envelopes);

    // Sa place est-elle gardee ? Alors on l'attend, et on tranchera a l'echeance.
    if (envelopes.some((e) => e.message.type === SERVER.AWAY)) {
      this.armerMinuteur(playerId);
      return;
    }

    this.pseudos.delete(playerId);
    this.rangerSiVide();
  }

  /**
   * Plus personne, et plus personne a attendre : on repart d'un salon neuf.
   *
   * Tant qu'un joueur coupe peut revenir, on ne touche a rien — c'est tout
   * l'interet du delai.
   */
  rangerSiVide() {
    if (this.sockets.size > 0 || this.arbitre().attendus().length > 0) return;

    this.host = null;
    this.departVu = null;
    this.pseudos = new Map();
    this.ecrire('arbitre', null);
    this.ecrire('pseudos', []);
    this.noter('note', null, { evenement: 'salon vide' });
    this.nouvellePartie();
  }
}
