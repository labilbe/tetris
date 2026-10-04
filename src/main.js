/**
 * Cablage : c'est le seul module qui connait a la fois le DOM, l'horloge et le
 * moteur. Il tient la boucle de temps et fait circuler les actions.
 */

import { createMusic } from './audio/music.js';
import { STATUS } from './engine/constants.js';
import { createState, reduce, tick } from './engine/state.js';
import { createKeyboardInput } from './input/keyboard.js';
import { createTouchInput } from './input/touch.js';
import { createBotClients } from './net/bot-client.js';
import { drawGarbageColumns } from './net/garbage.js';
import { relaisUrl } from './net/relais.js';
import { createSocketTransport } from './net/socket.js';
import { cleanRoom, randomName, randomRoom } from './net/protocol.js';
import { decodeBoard, encodeBoard } from './net/snapshot.js';
import { createLocalTransport } from './net/transport.js';
import { createRenderer, createRivalRenderer } from './render/canvas.js';
import { createHud } from './render/hud.js';
import { DANGER, automatique, cadrer, createCamera, viser } from './view/camera.js';
import { readPreference, readTextPreference, writePreference } from './view/preferences.js';

const renderer = createRenderer({
  board: document.getElementById('board'),
  next: document.getElementById('next'),
});

const rivalCanvas = document.getElementById('rival');
const rivalRenderer = createRivalRenderer(rivalCanvas);

const hud = createHud({
  score: document.getElementById('score'),
  lines: document.getElementById('lines'),
  level: document.getElementById('level'),
  toggle: document.getElementById('toggle'),
  overlay: document.getElementById('overlay'),
  overlayText: document.getElementById('overlay-text'),
  resume: document.getElementById('resume'),
  toMenu: document.getElementById('to-menu'),
});

const music = createMusic();

const ghostCheckbox = document.getElementById('ghost');
const musicCheckbox = document.getElementById('music');
const menu = document.getElementById('menu');
const menuError = document.getElementById('menu-error');
const waiting = document.getElementById('waiting');
const waitingText = document.getElementById('waiting-text');
const waitingBegin = document.getElementById('waiting-begin');
const waitingBot = document.getElementById('waiting-bot');
const waitingCopier = document.getElementById('waiting-copier');
const salonInput = document.getElementById('salon');
const remaining = document.getElementById('remaining');
const pad = document.getElementById('pad');
const game = document.querySelector('.game');
const pseudo = document.getElementById('pseudo');
const rivalName = document.getElementById('rival-name');
const rivalAuto = document.getElementById('rival-auto');

// Pavé tactile : sur un écran tactile, et sur un écran étroit où la mise en
// page s'empile de toute façon.
const COARSE = matchMedia('(pointer: coarse)');
const NARROW = matchMedia('(max-width: 700px)');

/** Le pave tactile occupe le bas de la colonne : le plateau lui laisse la place. */
function updatePad() {
  const visible = COARSE.matches || NARROW.matches;
  pad.hidden = !visible;
  game.classList.toggle('with-pad', visible);
}

const GHOST_PREFERENCE = 'tetris.ghost';
const MUSIC_PREFERENCE = 'tetris.music';
const PSEUDO_PREFERENCE = 'tetris.pseudo';
const SALON_PREFERENCE = 'tetris.salon';

/**
 * Rythme d'emission de son propre plateau vers les spectateurs.
 *
 * Cinq images par seconde : assez pour voir jouer quelqu'un, assez peu pour que
 * le canal d'affichage ne pese rien a cote des actions. Une image perdue ne se
 * rattrape pas — la suivante arrive.
 */
const BOARD_MS = 200;

function setGhostVisible(visible) {
  renderer.setGhostVisible(visible);
  ghostCheckbox.checked = visible;
  writePreference(GHOST_PREFERENCE, visible);
  render();
}

function setMusicEnabled(enabled) {
  music.setEnabled(enabled);
  musicCheckbox.checked = enabled;
  writePreference(MUSIC_PREFERENCE, enabled);
}

/** @type {import('./engine/state.js').GameState} */
let state;
/** @type {ReturnType<typeof createLocalTransport> | null} */
let transport = null;
let lastTime = null;
let looping = false;
/** Resultat d'une partie en reseau : 'won', 'lost', ou null tant qu'elle dure. */
let outcome = null;
let overReported = false;

/**
 * Les adversaires, tels qu'on les voit.
 *
 * Rien ici n'appartient au jeu : des images recues, des pseudos, et le choix de
 * celui qu'on regarde. Une vignette en retard ou manquante ne change la partie
 * de personne — c'est ce qui autorise a la traiter aussi legerement.
 *
 * @type {Map<string, { id: string, name: string, grid: (string|null)[][] | null, hauteur: number, vivant: boolean }>}
 */
const rivaux = new Map();
let camera = createCamera();
let moiId = null;
let estMulti = false;
let dernierInstantane = 0;
/** Composition du salon, recue au depart de la partie. */
let salon = { players: [], names: {} };

/** L'ordre d'arrivee fait l'ordre des plans : la rotation reste previsible. */
function listeRivaux() {
  return [...rivaux.values()];
}

/** Prepare une vignette par adversaire, vide jusqu'au premier instantane. */
function construireRivaux() {
  rivaux.clear();
  camera = createCamera();

  for (const id of salon.players) {
    if (id === moiId) continue; // on se voit deja en grand
    rivaux.set(id, { id, name: salon.names[id] ?? 'Joueur', grid: null, hauteur: 0, vivant: true });
  }
}

/** Choisit le plan et le dessine. Purement decoratif : jamais dans render(). */
function dessineMultiplex(maintenant) {
  camera = cadrer(camera, listeRivaux(), maintenant);
  const vu = camera.focus ? rivaux.get(camera.focus) : null;

  rivalName.textContent = vu ? vu.name : '—';
  rivalRenderer.draw(vu?.grid ?? null);
  rivalCanvas.classList.toggle('danger', Boolean(vu && vu.hauteur >= DANGER));
  rivalAuto.setAttribute('aria-pressed', String(camera.mode === 'auto'));
}

/** Commandes de la camera, qu'elles viennent du clavier ou des boutons. */
function commandeCamera(type) {
  if (!estMulti) return;
  const maintenant = performance.now();

  if (type === 'watchAuto') camera = automatique(camera, maintenant);
  else camera = viser(camera, listeRivaux(), type === 'watchPrev' ? -1 : 1, maintenant);

  dessineMultiplex(maintenant);
}

/**
 * Envoie une action.
 *
 * Elle s'applique immediatement, en reseau comme en solo : personne d'autre ne
 * simule notre plateau, donc il n'y a aucun arbitre a attendre. Seul le handicap
 * part vers les autres, et c'est le transport qui s'en charge.
 */
function dispatch(action) {
  if (!transport) return; // encore au menu : il n'y a pas de partie a piloter
  if (outcome) return; // la partie en reseau est jouee, le verdict est tombe
  transport.send(action);
}

function render() {
  if (!state) return; // avant le demarrage du transport, il n'y a rien a dessiner
  renderer.draw(state);
  hud.update(state, outcome);
  // Le verdict arrete la musique comme le ferait une fin de partie.
  music.sync(outcome ? { ...state, status: STATUS.OVER } : state);

  // Sa propre defaite vaut elimination : on la signale une seule fois, et c'est
  // l'arbitre qui en tire le verdict.
  if (state.status === STATUS.OVER && !overReported && transport) {
    overReported = true;
    transport.reportGameOver();
  }
}

function loop(time) {
  // Premiere frame : pas de delta de reference, on se contente d'amorcer.
  const delta = lastTime === null ? 0 : time - lastTime;
  lastTime = time;

  // Pas de partie en cours (menu, attente, verdict tombe) : le temps ne doit
  // pas avancer, sinon les pieces tomberaient derriere l'ecran affiche.
  if (state && transport && !outcome) {
    state = tick(state, delta);
    render();

    // Son plateau part vers ceux qui le regardent, a rythme fixe et sans
    // attendre : en solo, le transport n'en fait rien.
    if (estMulti && time - dernierInstantane >= BOARD_MS) {
      dernierInstantane = time;
      transport.sendBoard(encodeBoard(state));
    }
  }

  // Le multiplex continue de tourner apres sa propre defaite : eliminé, on
  // regarde la fin de la partie plutot que de fixer un plateau mort.
  if (estMulti && transport) dessineMultiplex(time);

  // Les adversaires artificiels avancent sur la meme image que le jeu : pas de
  // seconde horloge, et ils gelent avec la partie quand l onglet passe en
  // arriere-plan.
  botClients?.tick(time);

  requestAnimationFrame(loop);
}

/** Les adversaires artificiels de cette partie, chacun avec sa connexion. */
let botClients = null;

/**
 * Le code du salon : le point de rendez-vous des joueurs.
 *
 * Il vient du lien partage, sinon du dernier salon joue, sinon d'un tirage au
 * sort. L'ordre compte : un joueur qui ouvre le lien d'un ami doit atterrir chez
 * lui, pas dans son propre salon de la veille.
 */
function salonChoisi() {
  const saisi = cleanRoom(salonInput.value);
  return saisi || randomRoom();
}

/**
 * Inscrit le salon dans la barre d'adresse.
 *
 * La page devient alors son propre lien d'invitation : il n'y a rien a composer,
 * il suffit de copier ce qu'on a sous les yeux.
 */
function afficherSalon(code) {
  salonInput.value = code;
  writePreference(SALON_PREFERENCE, code);
  const url = new URL(location.href);
  url.searchParams.set('salon', code);
  history.replaceState(null, '', url);
}

/** Messages du serveur qui concernent l'attente et la connexion, pas le jeu. */
function onNetworkStatus(status) {
  switch (status.kind) {
    // Le rendez-vous n'a pas encore abouti : on dit ou l'on en est plutot que
    // de laisser un ecran muet, dont on conclurait que le jeu est casse.
    case 'seeking':
      waitingText.textContent = status.message;
      break;

    case 'waiting': {
      // Les pseudos plutot que le seul compte : on voit qui est deja la.
      const presents = status.names?.length ? status.names.join(', ') : '';
      const joueurs = presents || `${status.players} joueur${status.players > 1 ? 's' : ''}`;
      const manque = status.min - status.players;

      if (status.players <= 1) {
        // Seul dans le salon : dire quoi faire, et non seulement ce qui manque.
        waitingText.textContent = `Salon ${status.room} : vous êtes seul. Partagez le lien, `
          + 'ou ajoutez un adversaire artificiel.';
      } else {
        waitingText.textContent = manque > 0
          ? `Salon ${status.room} : ${joueurs}. Il en faut ${status.min} pour commencer.`
          : `Salon ${status.room} : ${joueurs}. À vous de lancer quand vous voulez.`;
      }

      // Le salon n'a pas de maximum : ce sont les presents qui decident du
      // depart, des qu'ils sont assez nombreux.
      waitingBegin.hidden = manque > 0;
      // Seul l'hote peut peupler le salon : un adversaire artificiel tourne dans
      // son onglet, il n'a pas de connexion a lui.
      break;
    }
    case 'start':
      remaining.textContent = status.players.length;
      // Les vignettes attendent l'identifiant local, connu une fois start()
      // resolu : on retient la composition en attendant.
      salon = { players: status.players, names: status.names ?? {} };
      break;
    case 'eliminated':
      if (status.self) outcome = 'eliminated';
      // Un joueur sorti n'a plus de plateau a montrer : la camera l'ignore.
      if (rivaux.has(status.playerId)) rivaux.get(status.playerId).vivant = false;
      remaining.textContent = status.remaining;
      render();
      break;
    case 'finished':
      // Il ne reste qu'un joueur en jeu : c'est lui qui l'emporte.
      outcome = status.self ? 'won' : 'lost';
      remaining.textContent = status.winner ? '1' : '0';
      render();
      break;
    case 'left':
      // Rien a faire : un depart en cours de partie vaut elimination, et c'est
      // l'arbitre qui en tire les consequences. Renvoyer les autres au menu
      // arreterait une partie a plusieurs qui doit continuer.
      break;
    case 'closed':
      // Le depart de l'arbitre dit pourquoi : sans lui, plus de verdict
      // possible, et il vaut mieux l'annoncer que laisser la partie sans fin.
      if (state) showMenu(status.message ?? 'La connexion a été perdue.');
      break;
    default:
      break;
  }
}

/**
 * Envoie un handicap aux autres joueurs apres un effacement de plusieurs
 * lignes : des blocs qui leur tomberont du haut.
 *
 * Le tirage des colonnes vit dans net/garbage.js, partage avec les adversaires
 * artificiels : ils penalisent leurs voisins par le meme canal, et il ne doit y
 * avoir qu'une seule facon de tirer un handicap dans le jeu.
 *
 * @param {number} cleared lignes effacees d'un coup
 */
function sendGarbage(cleared) {
  const columns = drawGarbageColumns(cleared);
  if (columns.length === 0) return;

  dispatch({ type: 'garbage', columns });
}

/**
 * Le pseudo saisi, retenu d'une partie a l'autre.
 *
 * Il n'est pas impose : le serveur remplace un pseudo vide par un nom par
 * defaut. Refuser de lancer la partie pour un champ vide couterait plus au
 * joueur que cela ne rapporte a l'affichage.
 */
function pseudoChoisi() {
  // L'enregistrement se fait a la saisie, pas ici : il n'y a plus qu'a lire.
  return pseudo.value.trim();
}

function showMenu(message = '') {
  if (botClients) { botClients.close(); botClients = null; }
  if (transport) {
    transport.close();
    transport = null;
  }
  // Le menu n'est pas une partie en cours : la musique s'arrete avec elle.
  // render() ne le fera pas, faute d'etat a dessiner une fois celui-ci efface.
  music.sync({ status: STATUS.OVER });

  state = undefined;
  outcome = null;
  overReported = false;

  // Le multiplex appartient a la partie qui s'acheve : rien n'en survit.
  estMulti = false;
  moiId = null;
  salon = { players: [], names: {} };
  rivaux.clear();
  camera = createCamera();
  rivalRenderer.draw(null);
  rivalName.textContent = '—';
  rivalCanvas.classList.remove('danger');
  // Sans cela, « Perdu » resterait affiche sous le menu.
  document.getElementById('overlay').hidden = true;
  waiting.hidden = true;
  waitingBegin.hidden = true;
  game.classList.remove('multi');
  menu.hidden = false;
  menuError.textContent = message;
  menuError.hidden = message === '';
}

/**
 * Demarre une partie depuis le menu.
 *
 * Le clic qui declenche cette fonction est aussi le geste que le navigateur
 * exige pour autoriser le son : c'est pour cela que la musique part en meme
 * temps que la partie, sans rien demander de plus au joueur.
 *
 * @param {'solo' | 'multi'} mode
 */
async function startGame(mode) {
  music.unlock();

  menu.hidden = true;
  menuError.hidden = true;
  outcome = null;
  overReported = false;

  // Le mode choisit le transport, et rien d'autre : le reste du jeu ignore
  // s'il joue en solo ou en reseau.
  estMulti = mode === 'multi';

  if (estMulti) {
    const code = salonChoisi();
    afficherSalon(code);
    const url = relaisUrl(location.search, location.protocol === 'https:');
    transport = createSocketTransport({ url, code, name: pseudoChoisi() });

    // Chaque adversaire artificiel ouvre sa propre connexion : le relais ne le
    // distingue pas d'un navigateur de plus, et c'est ce qui fait qu'on eprouve
    // la vraie chaine plutot qu'une maquette.
    botClients = createBotClients({ url, code });

    waiting.hidden = false;
    waitingBegin.hidden = true;
    // Avec un relais il n'y a plus d'hote : n'importe qui peut peupler le salon.
    waitingBot.hidden = false;
    waitingBot.disabled = false;
    waitingText.textContent = `Connexion au salon ${code}…`;
    transport.onStatus(onNetworkStatus);
  } else {
    transport = createLocalTransport();
  }

  // Le compte des joueurs encore en jeu n'a de sens qu'en reseau. Sa place
  // reste reservee en solo : la CSS le masque sans le retirer de la mise en page.
  game.classList.toggle('multi', mode === 'multi');

  // Canal d'affichage : il n'entre jamais dans le moteur. Un instantane
  // illisible est jete sans consequence, la vignette garde le precedent.
  transport.onBoard((playerId, board) => {
    const rival = rivaux.get(playerId);
    const lu = decodeBoard(board);
    if (!rival || !lu) return;

    rival.grid = lu.grid;
    rival.hauteur = lu.hauteur;
  });

  transport.onAction((action, meta) => {
    // Le handicap est la seule action qui s'applique aux AUTRES : celui qui
    // efface les lignes ne se penalise pas lui-meme.
    if (action.type === 'garbage') {
      if (meta.self) return;
      state = reduce(state, action);
      render();
      return;
    }

    // Les actions des autres joueurs arrivent par le meme canal : elles ne
    // doivent pas piloter notre plateau.
    if (!meta.self) return;

    const avant = state.lines;
    state = reduce(state, action);
    sendGarbage(state.lines - avant);
    render();
  });

  const pending = transport;
  let seed;
  let playerId;
  try {
    ({ seed, playerId } = await transport.start());
  } catch (error) {
    if (transport === pending) showMenu(error.message);
    return;
  }

  moiId = playerId;
  construireRivaux();

  waiting.hidden = true;
  state = createState(seed);
  lastTime = null;
  dernierInstantane = 0;
  render();

  if (!looping) {
    looping = true;
    requestAnimationFrame(loop);
  }
}

// L'onglet en arriere-plan gele requestAnimationFrame : on repart d'une base
// propre au retour plutot que de rattraper le temps perdu d'un coup.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) lastTime = null;
});

document.getElementById('toggle').addEventListener('click', () => dispatch({ type: 'togglePause' }));
document.getElementById('to-menu').addEventListener('click', () => showMenu());
document.getElementById('resume').addEventListener('click', () => dispatch({ type: 'resume' }));

ghostCheckbox.addEventListener('change', () => setGhostVisible(ghostCheckbox.checked));
musicCheckbox.addEventListener('change', () => setMusicEnabled(musicCheckbox.checked));

createKeyboardInput({
  onGameAction: dispatch,
  // Les actions locales restent ici : les envoyer au transport les diffuserait
  // aux autres joueurs, ce qui n'aurait aucun sens pour un reglage personnel.
  onViewAction: (action) => {
    if (action.type === 'toggleGhost') setGhostVisible(!renderer.isGhostVisible());
    if (action.type === 'toggleMusic') setMusicEnabled(!music.isEnabled());
    // Changer de plan ne touche a rien d'autre que ce qu'on regarde.
    if (action.type.startsWith('watch')) commandeCamera(action.type);
  },
});

document.getElementById('play-solo').addEventListener('click', () => startGame('solo'));
document.getElementById('play-multi').addEventListener('click', () => startGame('multi'));

document.getElementById('waiting-cancel').addEventListener('click', () => showMenu());
document.getElementById('waiting-begin').addEventListener('click', () => transport?.begin());

// Ajouter un adversaire artificiel : c'est ce qui rend un salon jouable seul,
// et en ligne on arrive souvent seul.
waitingBot.addEventListener('click', () => {
  if (!botClients?.ajouter()) waitingBot.disabled = true;
});

// Le lien partageable est la barre d'adresse elle-meme : il n'y a rien a
// composer, seulement a copier.
waitingCopier.addEventListener('click', async () => {
  const dit = (texte) => {
    waitingCopier.textContent = texte;
    setTimeout(() => { waitingCopier.textContent = 'Copier le lien'; }, 2000);
  };

  try {
    await navigator.clipboard.writeText(location.href);
    dit('Lien copié');
  } catch {
    // Presse-papiers refuse (page non securisee, permission denied) : on montre
    // le lien, a defaut de pouvoir le copier. Mieux vaut le lire que rien.
    dit(location.href);
  }
});

// Le code du salon est normalise a la saisie : on tape « ab cd », on obtient
// « ABCD », et c'est ce qu'on voit partir dans le lien.
salonInput.addEventListener('input', () => {
  salonInput.value = cleanRoom(salonInput.value);
  writePreference(SALON_PREFERENCE, salonInput.value);
});

createTouchInput({ pad, onGameAction: dispatch });

COARSE.addEventListener('change', updatePad);
NARROW.addEventListener('change', updatePad);


updatePad();

// Valeurs par defaut pour un nouveau joueur : un choix deja enregistre l'emporte.
setGhostVisible(readPreference(GHOST_PREFERENCE, true));
setMusicEnabled(readPreference(MUSIC_PREFERENCE, true));

// Les memes commandes qu'au clavier, a portee de souris : le multiplex doit
// rester pilotable sans connaitre les raccourcis.
document.getElementById('rival-prev').addEventListener('click', () => commandeCamera('watchPrev'));
document.getElementById('rival-next').addEventListener('click', () => commandeCamera('watchNext'));
rivalAuto.addEventListener('click', () => commandeCamera('watchAuto'));

/**
 * Remplit le champ Pseudo : le dernier pseudo saisi, ou un nom tire au sort.
 *
 * Le nom de la machine servait autrefois de point de depart, demande au serveur
 * de jeu — le navigateur ne pouvant pas le lire lui-meme, et c'est voulu : ce
 * serait un identifiant stable de plus offert a tout site visite. Sans serveur,
 * plus personne ne le connait, et c'est sans regret : la page etant desormais
 * servie depuis Internet, la quasi-totalite des joueurs n'y avaient de toute
 * facon pas droit.
 *
 * Un nom tire au sort est retenu aussitot : sans cela le joueur changerait
 * d'identite a chaque rechargement, et les autres ne le reconnaitraient jamais
 * d'une partie sur l'autre.
 */
function remplirPseudo() {
  const retenu = readTextPreference(PSEUDO_PREFERENCE, '');
  if (retenu) {
    pseudo.value = retenu;
    return;
  }

  pseudo.value = randomName();
  writePreference(PSEUDO_PREFERENCE, pseudo.value);
}

/**
 * Remplit le champ Salon : celui du lien recu, sinon le dernier joue, sinon un
 * tirage au sort.
 *
 * Le lien l'emporte sur la preference : qui ouvre l'invitation d'un ami doit
 * atterrir chez lui, pas dans son propre salon de la veille.
 */
function remplirSalon() {
  const invite = cleanRoom(new URLSearchParams(location.search).get('salon') ?? '');
  salonInput.value = invite || cleanRoom(readTextPreference(SALON_PREFERENCE, '')) || randomRoom();
}

// Le pseudo est retenu des qu'il change, et non au lancement d'une partie en
// reseau seulement : un joueur qui le corrige puis joue en solo, ou qui ferme
// l'onglet sans jouer, doit le retrouver tel quel a sa prochaine visite.
pseudo.addEventListener('input', () => writePreference(PSEUDO_PREFERENCE, pseudo.value.trim()));

remplirPseudo();
remplirSalon();
