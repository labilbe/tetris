/**
 * Protocole du jeu en reseau, partage par le client et le serveur.
 *
 * La partie ne se joue qu'avec des actions et une graine : c'est le moteur
 * deterministe qui rend cela possible : a partir de la meme graine et de la
 * meme suite d'actions, deux machines obtiennent le meme plateau.
 *
 * Un second canal, BOARD, transporte des instantanes de plateau. Il ne sert
 * qu'a regarder les autres jouer, jamais a decider de quoi que ce soit : le
 * perdre ou le fausser ne change aucune partie. C'est ce qui l'autorise a
 * cotoyer le canal d'actions sans le contaminer.
 *
 * Ce fichier est la seule definition de ce vocabulaire, pour que les deux cotes
 * ne puissent pas diverger.
 */

/** Messages du client vers le serveur. */
export const CLIENT = {
  JOIN: 'join', // { type, room, name, reprise? } — reprise : on revient apres une coupure
  BEGIN: 'begin', // { type } — lancer la partie sans attendre le salon plein
  ACTION: 'action', // { type, action }
  BOARD: 'board', // { type, board } — instantane pour les spectateurs
  OVER: 'over', // { type } — j'ai perdu
};

/** Messages du serveur vers le client. */
export const SERVER = {
  WAITING: 'waiting', // { type, room, players, min, names }
  START: 'start', // { type, room, seed, playerId, players, names }
  ACTION: 'action', // { type, playerId, action }
  BOARD: 'board', // { type, playerId, board }
  ELIMINATED: 'eliminated', // { type, playerId, remaining }
  FINISHED: 'finished', // { type, winner } — le dernier en jeu l'emporte
  AWAY: 'away', // { type, playerId, secondes } — coupe, mais attendu
  BACK: 'back', // { type, playerId } — revenu
  LEFT: 'left', // { type, playerId }
  ERROR: 'error', // { type, message }
};

/** Longueur maximale d'un pseudo : de quoi se reconnaitre, pas de quoi pavoiser. */
export const NAME_MAX = 16;

/**
 * Nettoie un pseudo recu. Il vient d'un inconnu et finira affiche chez les
 * autres joueurs : on le ramene a du texte court et sans surprise, et on ne
 * laisse jamais passer une chaine vide.
 */
export function cleanName(raw, fallback = 'Joueur') {
  if (typeof raw !== 'string') return fallback;
  // Les caracteres de controle n'ont rien a faire dans un pseudo, et les
  // espaces multiples servent surtout a se fabriquer un nom invisible.
  const propre = raw.replace(/\s+/g, ' ').replace(/[\p{C}]/gu, '').trim().slice(0, NAME_MAX);
  return propre || fallback;
}

/**
 * Noms proposes a qui n'en a pas.
 *
 * Des fleuves et des villes de Russie, clin d'oeil a Moscou ou le jeu est ne.
 * Aucun n'est un prenom d'adversaire artificiel (BOT_NAMES, plus bas) : dans le
 * multiplex, on doit pouvoir distinguer d un coup d oeil un humain d une IA.
 * La disjonction des deux listes est verifiee par test/protocol.test.js.
 */
export const HUMAN_NAMES = [
  'Volga', 'Neva', 'Oural', 'Baikal', 'Angara', 'Ienissei',
  'Amour', 'Irtych', 'Kama', 'Oka', 'Don', 'Ladoga',
  'Onega', 'Taiga', 'Toundra', 'Kazan', 'Omsk', 'Tomsk',
  'Perm', 'Samara', 'Novgorod', 'Souzdal', 'Rostov', 'Vladimir',
];

/**
 * Un pseudo tire au sort, pour le joueur dont on ne peut pas connaitre la
 * machine.
 *
 * C'est le cas de tout invite du reseau local : le nom d'une machine distante
 * n'est pas resolvable depuis le serveur — ni par DNS inverse, ni par NetBIOS,
 * ni par mDNS — et deviner donnerait un faux nom, ce qui vaut moins que pas de
 * nom du tout.
 *
 * Reste qu'un champ vide ne vaut rien non plus : tout le monde s'appellerait
 * « Joueur », numerote les uns derriere les autres, et la camera annoncerait
 * « Joueur 3 » sans que personne ne se reconnaisse. Un nom quelconque mais
 * distinct rend le multiplex lisible, et le joueur le remplace s'il veut.
 *
 * @param {() => number} alea source du hasard, injectable pour les tests
 */
export function randomName(alea = Math.random) {
  const rang = Math.min(HUMAN_NAMES.length - 1, Math.max(0, Math.floor(alea() * HUMAN_NAMES.length)));
  return HUMAN_NAMES[rang];
}

/**
 * Il faut au moins deux joueurs pour une partie. Il n'y a pas de maximum : le
 * salon accueille qui veut, et ce sont les presents qui decident du depart.
 */
export const MIN_PLAYERS = 2;

export const DEFAULT_ROOM = 'partie';

export function encode(message) {
  return JSON.stringify(message);
}

/**
 * Analyse un message recu. Renvoie null plutot que de lever : un pair peut
 * toujours envoyer n'importe quoi, et cela ne doit pas tuer la partie.
 */
export function decode(raw) {
  try {
    const message = JSON.parse(raw);
    return message && typeof message.type === 'string' ? message : null;
  } catch {
    return null;
  }
}

/**
 * Prenoms des adversaires artificiels.
 *
 * Des prenoms plutot que « Bot 1 » : le multiplex nomme celui qu'on regarde, et
 * un nom se reconnait d'un coup d'oeil la ou un numero se dechiffre.
 *
 * Ils sont volontairement disjoints de HUMAN_NAMES, fleuves et villes de Russie :
 * dans le multiplex, on doit pouvoir distinguer d'un coup d'oeil un humain d'une
 * IA. Les deux listes vivant desormais dans le meme fichier, un test peut enfin
 * verifier cette disjonction au lieu de la confier a deux fichiers qui ne se
 * connaissent pas.
 */
export const BOT_NAMES = ['Nina', 'Sacha', 'Vadim', 'Lena', 'Iouri', 'Sveta', 'Boris', 'Katia'];

/**
 * Un prenom d'adversaire artificiel, tire au sort.
 *
 * @param {() => number} alea source du hasard, injectable pour les tests
 */
export function randomBotName(alea = Math.random) {
  const rang = Math.min(BOT_NAMES.length - 1, Math.max(0, Math.floor(alea() * BOT_NAMES.length)));
  return BOT_NAMES[rang];
}

/**
 * Alphabet des codes de salon.
 *
 * Ni O ni 0, ni I ni 1 : un code se lit a voix haute et se recopie a la main
 * depuis l'ecran d'un ami. Les paires ambigues coutent plus cher en salons
 * manques qu'elles ne rapportent en combinaisons.
 */
const ALPHABET_SALON = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Longueurs acceptees pour un code de salon. */
export const ROOM_MIN = 4;
export const ROOM_MAX = 8;

/**
 * Nettoie un code de salon.
 *
 * Le code voyage dans une URL et se tape a la main : on ignore la casse, on
 * jette tout ce qui n'est pas une lettre ou un chiffre — espaces et tirets que
 * l'on ajoute en recopiant — et on tronque. Renvoie '' si rien d'utilisable ne
 * reste : c'est a l'appelant de decider d'en tirer un au sort.
 */
export function cleanRoom(raw) {
  if (typeof raw !== 'string') return '';
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_MAX);
}

/**
 * Un code de salon tire au sort, pour qui arrive sans lien.
 *
 * @param {() => number} alea source du hasard, injectable pour les tests
 */
export function randomRoom(alea = Math.random) {
  let code = '';
  for (let i = 0; i < 5; i += 1) {
    const rang = Math.min(ALPHABET_SALON.length - 1, Math.max(0, Math.floor(alea() * ALPHABET_SALON.length)));
    code += ALPHABET_SALON[rang];
  }
  return code;
}

/**
 * Delai laisse a un joueur coupe pour revenir.
 *
 * Une connexion qui tombe n'est pas un abandon : un Wi-Fi hoquette, un relais
 * redemarre, un telephone change d'antenne. Eliminer sur-le-champ punissait un
 * accident ; attendre indefiniment bloquerait les autres. Trente secondes
 * laissent le temps de revenir sans faire languir le salon.
 */
export const REPRISE_MS = 30000;
