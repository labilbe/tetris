/**
 * Cablage : c'est le seul module qui connait a la fois le DOM, l'horloge et le
 * moteur. Il tient la boucle de temps et fait circuler les actions.
 */

import { createMusic } from './audio/music.js';
import { COLS, GARBAGE_SENT, STATUS } from './engine/constants.js';
import { createState, reduce, tick } from './engine/state.js';
import { createKeyboardInput } from './input/keyboard.js';
import { createTouchInput } from './input/touch.js';
import { createLocalTransport, createWebSocketTransport } from './net/transport.js';
import { createRenderer } from './render/canvas.js';
import { createHud } from './render/hud.js';
import { readPreference, writePreference } from './view/preferences.js';

const renderer = createRenderer({
  board: document.getElementById('board'),
  next: document.getElementById('next'),
});

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
const remaining = document.getElementById('remaining');
const multiOnly = document.querySelectorAll('.multi-only');
const pad = document.getElementById('pad');
const game = document.querySelector('.game');

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

/** Envoie une action : en reseau elle repassera par le serveur avant d'etre appliquee. */
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

  // Sa propre defaite met fin a la partie des deux joueurs : on la signale une
  // seule fois, le serveur designant le perdant au premier signalement recu.
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
  }

  requestAnimationFrame(loop);
}

/**
 * Adresse du serveur de jeu, sur la machine qui sert la page.
 *
 * Le protocole suit celui de la page : un navigateur refuse une connexion ws://
 * depuis une page https, la tenir pour du contenu mixte. Sur un hebergement
 * statique (GitHub Pages) il n'y a de toute facon aucun serveur en face, et le
 * menu affiche alors l'echec.
 */
/**
 * Le multijoueur suppose un serveur sur la machine qui sert la page. Sur un
 * hebergement statique (GitHub Pages) il n'y en a aucun, et une page https ne
 * peut de toute facon pas ouvrir une connexion vers un port arbitraire. Autant
 * le dire tout de suite plutot que de laisser le joueur attendre une connexion
 * qui n'aboutira pas.
 */
function multiplayerUnavailable() {
  return location.protocol === 'https:'
    ? 'Le multijoueur demande un serveur : il n’est pas disponible sur la version en ligne.'
    : '';
}

function serverUrl() {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.hostname}:1985`;
}

/** Messages du serveur qui concernent l'attente et la connexion, pas le jeu. */
function onNetworkStatus(status) {
  switch (status.kind) {
    case 'waiting': {
      const joueurs = `${status.players} joueur${status.players > 1 ? 's' : ''}`;
      const manque = status.min - status.players;
      waitingText.textContent = manque > 0
        ? `Salon : ${joueurs}. Il en faut ${status.min} pour commencer.`
        : `Salon : ${joueurs}. À vous de lancer quand vous voulez.`;
      // Le salon n'a pas de maximum : ce sont les presents qui decident du
      // depart, des qu'ils sont assez nombreux.
      waitingBegin.hidden = manque > 0;
      break;
    }
    case 'start':
      remaining.textContent = status.players.length;
      break;
    case 'eliminated':
      if (status.self) outcome = 'eliminated';
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
      // le serveur qui en tire les consequences. Renvoyer les autres au menu
      // arreterait une partie a plusieurs qui doit continuer.
      break;
    case 'closed':
      if (state) showMenu('La connexion au serveur a été perdue.');
      break;
    default:
      break;
  }
}

/**
 * Envoie un handicap aux autres joueurs apres un effacement de plusieurs
 * lignes.
 *
 * Les colonnes trouees sont tirees ici, une fois, et voyagent avec l'action :
 * tous les receveurs subissent donc exactement les memes lignes. Les tirer
 * chez chacun donnerait des trous differents, et les tirer avec le generateur
 * du jeu ferait diverger la suite de pieces.
 *
 * @param {number} cleared lignes effacees d'un coup
 */
function sendGarbage(cleared) {
  const count = GARBAGE_SENT[cleared] ?? 0;
  if (count === 0) return;

  const holes = Array.from({ length: count }, () => Math.floor(Math.random() * COLS));
  dispatch({ type: 'garbage', holes });
}

function showMenu(message = '') {
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
  // Sans cela, « Perdu » resterait affiche sous le menu.
  document.getElementById('overlay').hidden = true;
  waiting.hidden = true;
  waitingBegin.hidden = true;
  for (const element of multiOnly) element.hidden = true;
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
  transport = mode === 'multi'
    ? createWebSocketTransport(serverUrl())
    : createLocalTransport();

  if (mode === 'multi') {
    waiting.hidden = false;
    waitingBegin.hidden = true;
    waitingText.textContent = 'Connexion au serveur…';
    transport.onStatus(onNetworkStatus);
  }

  // Le compte des joueurs encore en jeu n'a de sens qu'en reseau.
  for (const element of multiOnly) element.hidden = mode !== 'multi';

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
  try {
    ({ seed } = await transport.start());
  } catch (error) {
    if (transport === pending) showMenu(error.message);
    return;
  }

  waiting.hidden = true;
  state = createState(seed);
  lastTime = null;
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
  },
});

document.getElementById('play-solo').addEventListener('click', () => startGame('solo'));
const multiButton = document.getElementById('play-multi');
multiButton.addEventListener('click', () => startGame('multi'));

const indisponible = multiplayerUnavailable();
if (indisponible) {
  multiButton.disabled = true;
  multiButton.title = indisponible;
  document.querySelector('.menu-note').textContent = indisponible;
}
document.getElementById('waiting-cancel').addEventListener('click', () => showMenu());
document.getElementById('waiting-begin').addEventListener('click', () => transport?.begin());

createTouchInput({ pad, onGameAction: dispatch });

COARSE.addEventListener('change', updatePad);
NARROW.addEventListener('change', updatePad);


updatePad();

// Valeurs par defaut pour un nouveau joueur : un choix deja enregistre l'emporte.
setGhostVisible(readPreference(GHOST_PREFERENCE, true));
setMusicEnabled(readPreference(MUSIC_PREFERENCE, true));
