/**
 * Les joueurs qui manquent a la partie, vus de chez les autres.
 *
 * On manque de deux facons, et la seconde est la plus frequente :
 *
 * 1. **La connexion tombe.** Le relais garde la place du joueur (AWAY) et la
 *    lui rend s'il revient a temps (BACK). Son onglet a disparu, et tout le
 *    monde le sait.
 * 2. **Le joueur se tait.** Sa socket tient, le relais ne voit donc rien, mais
 *    son onglet ne tourne plus : passe en arriere-plan, telephone verrouille,
 *    page gelee par le systeme. Son plateau s'arrete sur place pendant que les
 *    autres continuent. Le relais n'en saura jamais rien ; d'ici, cela se voit
 *    tres bien — ses instantanes de plateau, cinq par seconde, cessent
 *    d'arriver, et sa vignette se fige dans le multiplex.
 *
 * Ce module tient la liste de ceux qu'on attend, dans les deux cas, et c'est
 * elle qui gele la partie.
 *
 * Pourquoi geler plutot que continuer : le jeu se joue au handicap. Celui qui
 * ne joue plus ne peut ni en envoyer ni en recevoir, et pendant ce temps les
 * autres continuent d'empiler des lignes. Trente secondes de ce regime
 * decident la partie a sa place, et son retour n'y change plus rien. Une
 * partie mise en pause pour tout le monde est la seule qui reste la meme pour
 * tout le monde.
 *
 * Aucune horloge ici, aucun DOM : le temps est un parametre, comme dans le
 * moteur. C'est ce qui rend tout ceci verifiable sous `node --test`.
 */

/**
 * Marge accordee au relais, par-dessus le delai de reprise.
 *
 * L'echeance est calculee ici alors que c'est le relais qui tranche : son
 * elimination (ELIMINATED) peut arriver une poignee de secondes apres nos
 * trente. Sans marge, on repartirait juste avant son verdict ; sans echeance
 * du tout, un message perdu gelerait la partie pour toujours. La marge est le
 * filet, le message reste la regle.
 */
export const MARGE_MS = 3000;

/**
 * Silence au-dela duquel on tient un joueur pour absent.
 *
 * Les instantanes partent cinq fois par seconde : trois secondes de silence,
 * ce sont quinze messages manques d'affilee. Ce n'est plus un reseau qui
 * hoquette, c'est un onglet qui ne tourne plus.
 */
export const SILENCE_MS = 3000;

/**
 * Patience accordee a un joueur qui se tait.
 *
 * Le meme delai qu'une coupure, et pour la meme raison : c'est le temps qu'on
 * accepte de perdre a attendre quelqu'un. Passe ce delai, la partie repart
 * sans lui — et contrairement a une coupure, personne ne l'eliminera, sa
 * socket tenant toujours. Entre une partie qui ne repart jamais et un joueur
 * enterre pour avoir verrouille son telephone, c'est le second qui coute le
 * moins cher.
 */
export const PATIENCE_MS = 30000;

/**
 * Note un joueur coupe.
 *
 * @param {Map<string, number>} absences etat courant, jamais modifie
 * @param {string} playerId
 * @param {number} secondes delai annonce par le relais
 * @param {number} maintenant horloge, en millisecondes
 * @returns {Map<string, number>} un nouvel etat
 */
export function noter(absences, playerId, secondes, maintenant) {
  const suite = new Map(absences);
  suite.set(playerId, maintenant + secondes * 1000);
  return suite;
}

/**
 * Oublie un joueur : il est revenu, elimine, ou parti pour de bon.
 *
 * @returns {Map<string, number>} un nouvel etat
 */
export function oublier(absences, playerId) {
  if (!absences.has(playerId)) return absences;
  const suite = new Map(absences);
  suite.delete(playerId);
  return suite;
}

/**
 * Ceux que le relais a declares coupes, et pour combien de temps.
 *
 * Les echeances depassees sont ignorees : c'est le filet decrit plus haut.
 *
 * @returns {{ playerId: string, reste: number, raison: 'coupure' }[]} `reste` en secondes, jamais negatif
 */
export function attendus(absences, maintenant) {
  const liste = [];

  for (const [playerId, echeance] of absences) {
    if (maintenant >= echeance + MARGE_MS) continue;
    liste.push({
      playerId,
      reste: Math.max(0, Math.ceil((echeance - maintenant) / 1000)),
      raison: 'coupure',
    });
  }

  return liste;
}

/**
 * Ceux dont les instantanes ne viennent plus.
 *
 * Seuls les joueurs encore en jeu comptent : un elimine cesse d'emettre, et
 * c'est normal — l'attendre gelerait la partie jusqu'a la fin des temps.
 *
 * La fenetre est bornee des deux cotes : avant SILENCE_MS c'est du reseau qui
 * hoquette, apres PATIENCE_MS on a assez attendu.
 *
 * @param {{ id: string, vivant: boolean, vuA?: number }[]} rivaux `vuA` : date du dernier instantane
 * @param {number} maintenant
 * @returns {{ playerId: string, reste: number, raison: 'silence' }[]}
 */
export function silencieux(rivaux, maintenant) {
  const liste = [];

  for (const { id, vivant, vuA } of rivaux) {
    if (!vivant || typeof vuA !== 'number') continue;

    const silence = maintenant - vuA;
    if (silence < SILENCE_MS || silence >= PATIENCE_MS) continue;

    liste.push({
      playerId: id,
      reste: Math.max(0, Math.ceil((PATIENCE_MS - silence) / 1000)),
      raison: 'silence',
    });
  }

  return liste;
}

/**
 * Reunit les deux listes.
 *
 * Un joueur peut etre dans les deux a la fois — sa socket tombe, et ses
 * instantanes cessent du meme coup. La coupure l'emporte : c'est la plus sure
 * des deux, le relais l'ayant constatee, et son echeance est celle qui compte.
 *
 * @returns {{ playerId: string, reste: number, raison: string }[]}
 */
export function fusionner(coupes, muets) {
  const connus = new Set(coupes.map(({ playerId }) => playerId));
  return [...coupes, ...muets.filter(({ playerId }) => !connus.has(playerId))];
}

/**
 * Ce qu'on affiche aux autres pendant l'attente.
 *
 * Des pseudos, pas des identifiants : on attend quelqu'un, pas une connexion.
 * Le decompte est celui du plus patient — c'est lui qui dit quand la partie
 * repartira au pire.
 *
 * L'annonce ne dit que ce qu'on sait : une coupure est constatee, un silence
 * ne l'est pas. Annoncer une connexion perdue a qui a seulement verrouille son
 * telephone serait une explication fausse, et c'est celle qu'on retiendrait.
 *
 * @param {{ playerId: string, reste: number, raison?: string }[]} liste
 * @param {Record<string, string>} noms pseudos du salon, par identifiant
 */
export function messageAttente(liste, noms = {}) {
  if (liste.length === 0) return '';

  const pseudos = liste.map(({ playerId }) => noms[playerId] ?? 'un joueur');
  const qui = pseudos.length === 1
    ? pseudos[0]
    : `${pseudos.slice(0, -1).join(', ')} et ${pseudos[pseudos.length - 1]}`;
  const reste = Math.max(...liste.map(({ reste: r }) => r));

  if (liste.every(({ raison }) => raison === 'coupure')) {
    return `Connexion perdue : la partie attend ${qui}… ${reste} s`;
  }
  if (liste.every(({ raison }) => raison === 'silence')) {
    return `Plus de nouvelles de ${qui} : la partie attend… ${reste} s`;
  }
  return `La partie attend ${qui}… ${reste} s`;
}
