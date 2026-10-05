/**
 * Installation du jeu depuis le navigateur.
 *
 * Deux choses, et elles vont ensemble : enregistrer le service worker, qui met
 * le jeu en cache et le rend installable, et brancher le bouton « Installer »
 * du menu.
 *
 * Pourquoi un bouton alors que Chrome propose deja son icone dans la barre
 * d'adresse : parce que presque personne ne la voit. Le bouton n'apparait que
 * si le navigateur dit lui-meme que l'installation est possible — ailleurs
 * (Firefox sur ordinateur, Safari, ou jeu deja installe) il reste cache plutot
 * que de promettre ce qu'il ne peut pas tenir.
 */

/**
 * Met le jeu en cache pour les visites suivantes.
 *
 * L'echec n'est pas une panne : le jeu tourne tres bien sans service worker,
 * il ne survit simplement pas a la coupure du reseau. C'est le cas en
 * navigation privee, et sur `file://` ou le navigateur refuse tout
 * enregistrement.
 *
 * @param {object} [navigateur] le `navigator` a utiliser, remplace dans les tests
 * @returns {Promise<unknown>} l'enregistrement, ou null si rien n'a pu etre fait
 */
export async function enregistrerServiceWorker(navigateur = globalThis.navigator) {
  if (!navigateur?.serviceWorker) return null;

  try {
    // updateViaCache: 'none' : sans cela le navigateur peut relire sw.js dans
    // son propre cache HTTP et ne jamais remarquer la nouvelle version.
    return await navigateur.serviceWorker.register('sw.js', { updateViaCache: 'none' });
  } catch {
    return null;
  }
}

/**
 * Branche le bouton d'installation sur l'invite du navigateur.
 *
 * `beforeinstallprompt` arrive quand le navigateur juge la page installable.
 * L'invite qu'il porte ne s'ouvre que sur un geste du joueur, et une seule
 * fois : d'ou l'evenement mis de cote jusqu'au clic, puis jete.
 *
 * @param {object} options
 * @param {HTMLElement|null} options.bouton le bouton du menu, cache au depart
 * @param {EventTarget} [options.fenetre] la `window` a ecouter, remplacee dans les tests
 */
export function brancherInstallation({ bouton, fenetre = globalThis }) {
  if (!bouton) return;

  let invite = null;

  fenetre.addEventListener('beforeinstallprompt', (evenement) => {
    // Sans preventDefault, certains navigateurs affichent leur propre banniere
    // par-dessus le menu, et le bouton ferait doublon.
    evenement.preventDefault?.();
    invite = evenement;
    bouton.hidden = false;
  });

  // Installe depuis la barre d'adresse plutot que depuis le bouton : il n'y a
  // plus rien a proposer.
  fenetre.addEventListener('appinstalled', () => {
    invite = null;
    bouton.hidden = true;
  });

  bouton.addEventListener('click', async () => {
    if (!invite) return;

    const demande = invite;
    invite = null;
    // Cache des le clic : qu'on installe ou qu'on renonce, cette invite-la est
    // consommee et ne peut plus etre rouverte.
    bouton.hidden = true;
    await demande.prompt();
  });
}
