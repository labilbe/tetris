/*
 * Service worker : ce qui rend le jeu installable, et jouable hors ligne.
 *
 * Il ne sert qu'a cela. Aucune regle de Tetris ne passe par ici, et il ne voit
 * jamais le relais : une WebSocket n'est pas une requete fetch, le multijoueur
 * reste donc exactement ce qu'il etait, et s'arrete de lui-meme sans reseau.
 *
 * Ce fichier est un script classique, pas un module : la liste des fichiers y
 * est ecrite en toutes lettres plutot qu'importee du reste du jeu. Un module
 * demanderait un navigateur recent pour l'unique confort de ne pas repeter des
 * chemins ; a la place, un test (test/installation.test.js) verifie que la
 * liste ne prend pas de retard sur le contenu du dossier.
 */

/*
 * Le nom du cache porte sa version. Changez-la des que l'un des fichiers
 * ci-dessous change : c'est ce qui declenche la reinstallation complete.
 *
 * Rien n'est jamais remplace dans un cache en service. Le nouveau se remplit a
 * cote, et ne prend la main qu'une fois tous les onglets de l'ancienne version
 * fermes — sans skipWaiting, volontairement : un onglet qui melangerait des
 * modules de deux versions tomberait en panne de la facon la plus obscure qui
 * soit.
 */
const CACHE = 'tetris-v3';

/**
 * Tout ce qu'il faut pour jouer, relu au premier chargement.
 *
 * Les chemins sont relatifs : la page vit sous /tetris/ sur GitHub Pages, et a
 * la racine en developpement.
 */
const FICHIERS = [
  './',
  'index.html',
  'style.css',
  'favicon.svg',
  'manifest.webmanifest',
  'assets/korobeiniki.mid',
  'assets/icone-192.png',
  'assets/icone-512.png',
  'assets/icone-masquable-512.png',
  'src/main.js',
  'src/ai/player.js',
  'src/audio/midi.js',
  'src/audio/music.js',
  'src/engine/constants.js',
  'src/engine/rng.js',
  'src/engine/state.js',
  'src/input/keyboard.js',
  'src/input/touch.js',
  'src/net/absences.js',
  'src/net/bot-client.js',
  'src/net/bots.js',
  'src/net/garbage.js',
  'src/net/host.js',
  'src/net/protocol.js',
  'src/net/relais.js',
  'src/net/rooms.js',
  'src/net/snapshot.js',
  'src/net/socket.js',
  'src/net/transport.js',
  'src/render/canvas.js',
  'src/render/hud.js',
  'src/view/camera.js',
  'src/view/installation.js',
  'src/view/preferences.js',
];

self.addEventListener('install', (event) => {
  // reload : sans cela le navigateur pourrait remplir le cache neuf avec les
  // copies perimees de son propre cache HTTP, et la nouvelle version serait
  // l'ancienne.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(
    FICHIERS.map((fichier) => new Request(fichier, { cache: 'reload' })),
  )));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const noms = await caches.keys();
    await Promise.all(noms.filter((nom) => nom !== CACHE).map((nom) => caches.delete(nom)));
    // Prendre la main tout de suite sur les onglets deja ouverts : sans cela le
    // tout premier chargement resterait sans service worker, donc sans mode
    // hors ligne tant que le joueur n'a pas recharge.
    await self.clients.claim();
  })());
});

/**
 * Le cache d'abord : le jeu est fige, et c'est aussi ce qui le rend immediat.
 *
 * Une version plus recente n'est donc jamais vue par un onglet deja ouvert ;
 * elle arrive au chargement suivant, quand le navigateur relit sw.js. C'est le
 * prix du hors-ligne, et il est juste : mieux vaut une partie d'hier qui se
 * lance qu'une partie d'aujourd'hui qui attend le reseau.
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);

    // ignoreSearch : la page est souvent ouverte avec ?salon=… ou ?relais=… ;
    // c'est bien la meme page, et un lien d'invitation doit marcher hors ligne
    // comme le reste.
    const connu = await cache.match(request, { ignoreSearch: true });
    if (connu) return connu;

    try {
      return await fetch(request);
    } catch (erreur) {
      // Hors ligne, et rien en cache. Si c'est une navigation, la page du jeu
      // vaut mieux que l'ecran de dinosaure du navigateur.
      if (request.mode === 'navigate') {
        const page = await cache.match('index.html');
        if (page) return page;
      }
      throw erreur;
    }
  })());
});
