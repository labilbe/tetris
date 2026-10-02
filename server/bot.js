/**
 * Adversaires artificiels, pour essayer le multijoueur tout seul.
 *
 * Ce sont de vrais clients : ils ouvrent une connexion au serveur de jeu,
 * entrent dans un salon, derivent leur plateau de la graine commune et n'agissent
 * que par les actions d'un joueur au clavier. Le serveur ne les distingue pas
 * d'un navigateur, et c'est le but — ce qu'on essaie ainsi, c'est la vraie chaine
 * (salon, ordre des actions, handicap, instantanes, eliminations), et pas une
 * maquette a cote du jeu.
 *
 * Le partage du travail suit celui du navigateur : la decision est pure et vit
 * dans src/ai/player.js, le temps et le reseau sont ici.
 *
 *   npm run bots                    trois adversaires, qui attendent votre depart
 *   npm run bots -- 5               cinq
 *   npm run bots -- 2 --lancer      deux, qui lancent la partie sans vous attendre
 *   npm run bots -- 3 --adresse 0.75 --delai 60
 */

import { WebSocket } from 'ws';

import { STATUS } from '../src/engine/constants.js';
import { createState, reduce, tick } from '../src/engine/state.js';
import { choisir, prochaineAction } from '../src/ai/player.js';
import { drawGarbageColumns } from '../src/net/garbage.js';
import { CLIENT, DEFAULT_ROOM, SERVER, decode, encode } from '../src/net/protocol.js';
import { encodeBoard } from '../src/net/snapshot.js';

/** Pas d'horloge du pilote. Le moteur, lui, ne lit jamais l'heure : on la lui donne. */
const TICK_MS = 16;

/** Le meme rythme d'instantanes que le navigateur : cinq images par seconde. */
const BOARD_MS = 200;

/**
 * Delai avant de revenir apres une partie.
 *
 * Les bots repartent d'eux-memes a chaque fin de partie : sans cela le salon
 * resterait marque « commence » et il faudrait les relancer a la main entre deux
 * essais. Le delai laisse au serveur le temps de defaire le salon.
 */
const RETOUR_MS = 2000;

/** Intervalle entre deux actions, par defaut : de quoi voir jouer. */
const DELAI_ACTION_MS = 80;

/**
 * Des prenoms plutot que « Bot 1 » : le multiplex nomme celui qu'on regarde, et
 * un nom se reconnait d'un coup d'oeil la ou un numero se dechiffre. Clin d'oeil
 * a Moscou, ou le jeu est ne.
 */
const PRENOMS = ['Nina', 'Sacha', 'Vadim', 'Lena', 'Iouri', 'Sveta', 'Boris', 'Katia'];

/**
 * Un adversaire artificiel. Se reconnecte tout seul, indefiniment : on le lance
 * une fois et on joue autant de parties qu'on veut.
 *
 * @param {{ url: string, salon: string, nom: string, adresse: number, delai: number, lancer: boolean }} options
 */
function createBot({ url, salon, nom, adresse, delai, lancer }) {
  /** @type {WebSocket | null} */
  let socket = null;
  /** @type {import('../src/engine/state.js').GameState | undefined} */
  let state;
  let moi = null;
  let timer = null;

  let horloge = 0;
  let dernierInstantane = 0;
  let derniereAction = 0;
  let defaiteSignalee = false;

  /**
   * Le placement vise, garde tant que la piece est la meme.
   *
   * Il ne peut pas etre rejuge a chaque action : quand l'adresse fait rater un
   * coup, c'est un tirage au sort, et le retirer dix fois de suite ferait hesiter
   * la piece au lieu de la faire mal poser. On ne rejuge donc qu'a l'arrivee
   * d'une nouvelle piece — ou quand un handicap a change le plateau sous elle.
   *
   * `state.next` ne change que lors d'un verrouillage : c'est le signal le plus
   * sur qu'une piece a laisse la place a la suivante.
   */
  let plan = null;

  /** Actions refusees d'affilee : la piece bute contre quelque chose. */
  let bloque = 0;

  const dire = (texte) => console.log(`[${nom}] ${texte}`);

  const envoyer = (message) => {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(encode(message));
  };

  function replanifier() {
    plan = null;
    bloque = 0;
  }

  /** Le placement vise, recalcule seulement s'il n'est plus d'actualite. */
  function cible() {
    if (plan && plan.piece === state.next) return plan.place;
    plan = { piece: state.next, place: choisir(state, { adresse }) };
    bloque = 0;
    return plan.place;
  }

  /**
   * Applique une action qui revient du serveur. Comme dans le navigateur : c'est
   * l'ordre du serveur qui fait foi, y compris pour ses propres actions.
   */
  function appliquer(action, self) {
    if (!state) return;

    // Le handicap est la seule action qui s'applique aux AUTRES.
    if (action.type === 'garbage') {
      if (self) return;
      state = reduce(state, action);
      // Les blocs ont change le plateau : le placement vise ne vaut plus rien.
      replanifier();
      return;
    }

    if (!self) return;

    const avant = state;
    state = reduce(state, action);

    // Une action refusee laisse l'etat inchange — le moteur renvoie le meme
    // objet. Deux refus de suite et la piece bute contre un surplomb : on la
    // lache la ou elle est plutot que de pousser un mur jusqu'au verrouillage.
    if (state === avant) bloque++;
    else bloque = 0;

    const gagnees = state.lines - avant.lines;
    if (gagnees > 0) {
      const columns = drawGarbageColumns(gagnees);
      if (columns.length > 0) envoyer({ type: CLIENT.ACTION, action: { type: 'garbage', columns } });
    }
  }

  /** Un pas du pilote : le temps avance, puis on agit s'il est l'heure. */
  function pas() {
    if (!state || defaiteSignalee) return;

    const maintenant = performance.now();
    const delta = horloge === 0 ? 0 : maintenant - horloge;
    horloge = maintenant;

    state = tick(state, delta);

    if (state.status === STATUS.OVER) {
      defaiteSignalee = true;
      envoyer({ type: CLIENT.OVER });
      dire(`perdu (${state.lines} lignes, ${state.score} points)`);
      return;
    }

    if (maintenant - dernierInstantane >= BOARD_MS) {
      dernierInstantane = maintenant;
      envoyer({ type: CLIENT.BOARD, board: encodeBoard(state) });
    }

    if (maintenant - derniereAction >= delai) {
      derniereAction = maintenant;
      const action = bloque >= 2 ? { type: 'hardDrop' } : prochaineAction(state, cible());
      envoyer({ type: CLIENT.ACTION, action });
    }
  }

  function onMessage(brut) {
    const message = decode(brut.toString());
    if (!message) return;

    switch (message.type) {
      case SERVER.WAITING:
        dire(`salon « ${message.room} » : ${message.names?.join(', ') ?? message.players}`);
        // Personne ne lance a la place du joueur humain, sauf demande expresse.
        if (lancer && message.players >= message.min) envoyer({ type: CLIENT.BEGIN });
        break;

      case SERVER.START:
        moi = message.playerId;
        state = createState(message.seed);
        horloge = 0;
        dernierInstantane = 0;
        derniereAction = 0;
        defaiteSignalee = false;
        replanifier();
        dire(`partie lancee a ${message.players.length}`);
        break;

      case SERVER.ACTION:
        appliquer(message.action, message.playerId === moi);
        break;

      case SERVER.BOARD:
        // Un bot ne regarde personne : le multiplex est pour les yeux humains.
        break;

      case SERVER.ELIMINATED:
        if (message.playerId !== moi) dire(`un joueur est sorti (${message.remaining} en jeu)`);
        break;

      case SERVER.FINISHED:
        dire(message.winner === moi ? 'gagne' : 'partie terminee');
        revenir();
        break;

      case SERVER.ERROR:
        // « La partie a deja commence » : on repasse plus tard, sans insister.
        dire(message.message);
        revenir();
        break;

      default:
        break;
    }
  }

  /** Coupe tout et revient dans le salon un peu plus tard. */
  function revenir() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    state = undefined;
    moi = null;

    // Le socket est oublie avant d'etre ferme : sa fermeture rappellerait cette
    // meme fonction, et on reviendrait deux fois.
    const ancien = socket;
    socket = null;
    if (ancien) ancien.close();

    setTimeout(connecter, RETOUR_MS);
  }

  function connecter() {
    const pending = new WebSocket(url);
    socket = pending;

    pending.on('open', () => {
      envoyer({ type: CLIENT.JOIN, room: salon, name: nom });
      timer = setInterval(pas, TICK_MS);
    });

    pending.on('message', onMessage);

    pending.on('close', () => {
      if (socket === pending) revenir();
    });

    pending.on('error', (error) => {
      // Le serveur n'est peut-etre pas encore la : on le dit et on reessaie,
      // plutot que de mourir et de laisser le joueur relancer la commande.
      if (socket === pending) {
        dire(`connexion impossible (${error.message})`);
        revenir();
      }
    });
  }

  connecter();
}

/**
 * Lecture des options. Un nombre nu donne le nombre d'adversaires ; tout le
 * reste est nomme, pour qu'une ligne de commande se relise.
 */
function lireOptions(args) {
  const options = {
    nombre: 3,
    salon: DEFAULT_ROOM,
    hote: 'localhost',
    port: Number(process.env.PORT ?? 1985),
    adresse: 0.9,
    delai: DELAI_ACTION_MS,
    lancer: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const valeur = args[i + 1];

    if (/^\d+$/.test(arg)) options.nombre = Number(arg);
    else if (arg === '--salon') { options.salon = valeur; i++; }
    else if (arg === '--hote') { options.hote = valeur; i++; }
    else if (arg === '--port') { options.port = Number(valeur); i++; }
    else if (arg === '--adresse') { options.adresse = Number(valeur); i++; }
    else if (arg === '--delai') { options.delai = Number(valeur); i++; }
    else if (arg === '--lancer') options.lancer = true;
    else if (arg === '--aide' || arg === '-h') return null;
    else throw new Error(`option inconnue : ${arg}`);
  }

  return options;
}

const AIDE = `Adversaires artificiels pour le multijoueur.

  npm run bots -- [nombre] [options]

  nombre            adversaires a lancer (defaut 3)
  --salon <code>    salon a rejoindre (defaut « ${DEFAULT_ROOM} »)
  --hote <nom>      machine du serveur de jeu (defaut localhost)
  --port <n>        port du serveur de jeu (defaut 1985)
  --adresse <0..1>  probabilite de bien jouer (defaut 0.9 ; 1 = ne perd jamais)
  --delai <ms>      millisecondes entre deux actions (defaut ${DELAI_ACTION_MS})
  --lancer          lancer la partie sans attendre un joueur humain
  --aide            ce message

Les adversaires attendent que vous lanciez la partie depuis le navigateur, et
reviennent d'eux-memes apres chaque partie : on les lance une fois pour la
soiree.`;

const options = lireOptions(process.argv.slice(2));

if (!options) {
  console.log(AIDE);
} else {
  const url = `ws://${options.hote}:${options.port}`;

  for (let i = 0; i < options.nombre; i++) {
    createBot({
      url,
      salon: options.salon,
      // Au-dela de la liste de prenoms on numerote : le serveur saurait de toute
      // facon departager deux homonymes, mais autant ne pas l'y obliger.
      nom: PRENOMS[i] ?? `IA ${i + 1}`,
      adresse: options.adresse,
      delai: options.delai,
      // Un seul suffit a donner le depart : a plusieurs, ils le donneraient tous.
      lancer: options.lancer && i === 0,
    });
  }

  console.log(
    `${options.nombre} adversaire(s) vers ${url}, salon « ${options.salon} », `
    + `adresse ${options.adresse}${options.lancer ? ', ils lancent la partie' : ''}`,
  );
}
