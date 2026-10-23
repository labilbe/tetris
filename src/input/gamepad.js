/**
 * Les manettes.
 *
 * Meme role que le clavier, le pave et les gestes : traduire des appuis en
 * actions du moteur, qui ne sait toujours pas d'ou elles viennent.
 *
 * Une difference, et elle commande tout le module : une manette ne previent
 * pas. Le navigateur n'envoie aucun evenement quand un bouton s'enfonce, il
 * donne seulement l'etat courant quand on le demande (navigator.getGamepads).
 * Il faut donc regarder a chaque image, et c'est a nous de retrouver les
 * instants : un bouton deja enfonce a l'image precedente n'est pas un nouvel
 * appui.
 *
 * Le vocabulaire :
 *
 *   - premier bouton (celui du bas, A ou croix) : la piece tourne ;
 *   - deuxieme bouton (a droite, B ou rond) : la piece tombe d'un coup ;
 *   - croix directionnelle ou stick gauche : la piece se deplace, et descend.
 *
 * Les directions sont la parce que sans elles la manette ne joue pas : deux
 * boutons ne suffisent pas a viser une colonne. Elles se repetent tant qu'on
 * reste pousse, comme le fait le clavier de lui-meme ; les deux boutons, non —
 * une rotation et surtout une chute qui se repeteraient seules lacheraient la
 * piece avant qu'on ait relache.
 *
 * Deux parties ici : une machine pure, qui ne connait que des etats de manettes
 * et rend des actions, et le cablage a l'horloge. La premiere se teste sans
 * navigateur ni manette (test/manettes.test.js), et c'est elle qui porte les
 * regles.
 */

/** Attente avant que la direction maintenue commence a se repeter. */
const DELAI_MS = 170;

/** Puis une case tous les tant : assez vif pour traverser, assez lent pour viser. */
const REPET_MS = 60;

/** Au-dela, le stick est pousse ; en-dessous, c'est du jeu ou un pouce qui traine. */
const SEUIL_AXE = .5;

/**
 * Ce que chaque commande declenche, et si elle se repete.
 *
 * L'ordre compte : c'est celui dans lequel les actions partent quand plusieurs
 * commandes tombent sur la meme image.
 */
const COMMANDES = [
  { nom: 'gauche', action: { type: 'move', dx: -1 }, repete: true },
  { nom: 'droite', action: { type: 'move', dx: 1 }, repete: true },
  { nom: 'bas', action: { type: 'softDrop' }, repete: true },
  { nom: 'tourner', action: { type: 'rotate' }, repete: false },
  { nom: 'lacher', action: { type: 'hardDrop' }, repete: false },
];

/** Un bouton, qu'il arrive en objet (GamepadButton) ou en simple nombre. */
function enfonce(bouton) {
  if (bouton === undefined || bouton === null) return false;
  if (typeof bouton === 'object') return Boolean(bouton.pressed) || bouton.value > SEUIL_AXE;
  return bouton > SEUIL_AXE;
}

function axe(manette, index) {
  const valeur = manette.axes?.[index];
  return typeof valeur === 'number' ? valeur : 0;
}

/**
 * L'etat d'une manette, traduit en commandes du jeu.
 *
 * Les numeros sont ceux de la disposition standard, la seule que le navigateur
 * promette : 0 et 1 les deux premiers boutons, 12 a 15 la croix, axes 0 et 1 le
 * stick gauche. Une manette exotique peut s'annoncer autrement ; elle gardera
 * au moins ses deux premiers boutons, qui sont l'essentiel de ce qu'on lui
 * demande.
 *
 * @param {{ buttons?: Array, axes?: number[] }} manette
 * @returns {Record<string, boolean>}
 */
function lireCommandes(manette) {
  const boutons = manette.buttons ?? [];
  return {
    gauche: enfonce(boutons[14]) || axe(manette, 0) <= -SEUIL_AXE,
    droite: enfonce(boutons[15]) || axe(manette, 0) >= SEUIL_AXE,
    bas: enfonce(boutons[13]) || axe(manette, 1) >= SEUIL_AXE,
    tourner: enfonce(boutons[0]),
    lacher: enfonce(boutons[1]),
  };
}

/**
 * La machine des manettes.
 *
 * Elle ne touche a rien : on lui donne l'etat des manettes et l'heure, elle
 * rend les actions a envoyer. Les manettes absentes (trous dans la liste rendue
 * par le navigateur, manette debranchee) sont ignorees sans ceremonie.
 *
 * Plusieurs manettes pilotent le meme plateau : c'est ce qui permet de passer
 * la manette a quelqu'un sans rien reconfigurer, et on ne saurait pas quel
 * plateau donner a la seconde — en ligne, chacun joue sur le sien.
 *
 * @returns {{ lire: (manettes: Array, t: number) => object[] }}
 */
export function createManettes() {
  /** Par manette, par commande : l'etat precedent et l'echeance de repetition. */
  const etats = new Map();

  function etat(cle) {
    let trouve = etats.get(cle);
    if (!trouve) {
      trouve = {};
      for (const { nom } of COMMANDES) trouve[nom] = { enfonce: false, echeance: 0 };
      etats.set(cle, trouve);
    }
    return trouve;
  }

  function lire(manettes, t) {
    const actions = [];
    const vues = new Set();

    for (let index = 0; index < (manettes?.length ?? 0); index++) {
      const manette = manettes[index];
      if (!manette) continue;

      // L'index suffit a distinguer les manettes, et il reste stable tant
      // qu'elles restent branchees. L'identifiant du materiel ne ferait pas
      // mieux : deux manettes identiques le partagent.
      const cle = manette.index ?? index;
      vues.add(cle);

      const precedent = etat(cle);
      const courant = lireCommandes(manette);

      for (const { nom, action, repete } of COMMANDES) {
        const memoire = precedent[nom];

        if (!courant[nom]) {
          memoire.enfonce = false;
          continue;
        }

        // Nouvel appui : il part tout de suite. Une direction attend ensuite
        // DELAI_MS avant de se repeter, le temps de pouvoir n'avancer que d'une
        // case en tapotant.
        if (!memoire.enfonce) {
          memoire.enfonce = true;
          memoire.echeance = t + DELAI_MS;
          actions.push({ ...action });
          continue;
        }

        if (!repete) continue;

        /*
         * Les images peuvent avoir saute (onglet en arriere-plan, machine
         * chargee) : on rattrape case par case plutot que d'en perdre, mais
         * sans jamais depasser l'heure courante, sinon la piece continuerait
         * d'avancer apres le pouce leve.
         */
        while (t >= memoire.echeance) {
          actions.push({ ...action });
          memoire.echeance += REPET_MS;
        }
      }
    }

    // Manette debranchee : sa memoire n'a plus d'objet, et la garder ferait
    // repartir une repetition en cours au rebranchement.
    for (const cle of [...etats.keys()]) if (!vues.has(cle)) etats.delete(cle);

    return actions;
  }

  return { lire };
}

/**
 * Branche les manettes sur l'horloge.
 *
 * Rien ne tourne tant qu'aucune manette n'est branchee : une page jouee au
 * clavier n'a aucune raison d'interroger getGamepads a chaque image. Les
 * evenements de connexion servent a cela, et a cela seulement — ils ne disent
 * rien des boutons.
 *
 * @param {object} options
 * @param {(action: object) => void} options.onGameAction
 * @param {Window} [options.cible]
 * @returns {() => void} fonction de detachement
 */
export function createGamepadInput({ onGameAction, cible = window }) {
  // Pas de manette dans ce navigateur (ou page non securisee) : il n'y a rien
  // a brancher, et le reste du jeu n'en sait rien.
  if (typeof cible.navigator?.getGamepads !== 'function') return () => {};

  const manettes = createManettes();
  let image = null;

  const branchees = () => Array.from(cible.navigator.getGamepads());

  function tour() {
    image = cible.requestAnimationFrame(tour);
    for (const action of manettes.lire(branchees(), cible.performance.now())) onGameAction(action);
  }

  function demarrer() {
    if (image === null) tour();
  }

  function arreter() {
    if (image !== null) cible.cancelAnimationFrame(image);
    image = null;
  }

  function onDisconnect() {
    // La derniere partie : on rend l'image au reste de la page. Tant qu'il en
    // reste une, la boucle continue et oubliera celle qui vient de partir au
    // tour suivant.
    if (!branchees().some(Boolean)) arreter();
  }

  cible.addEventListener('gamepadconnected', demarrer);
  cible.addEventListener('gamepaddisconnected', onDisconnect);

  // Une manette branchee avant le chargement de la page n'annonce rien : elle
  // n'apparait qu'au premier appui. Le navigateur la montre parfois deja, et
  // dans ce cas la boucle part tout de suite.
  if (branchees().some(Boolean)) demarrer();

  return () => {
    arreter();
    cible.removeEventListener('gamepadconnected', demarrer);
    cible.removeEventListener('gamepaddisconnected', onDisconnect);
  };
}
