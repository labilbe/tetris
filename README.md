# Tetris

Un Tetris jouable dans le navigateur, en HTML/Canvas et JavaScript vanilla. Aucune dépendance, aucun build.

Le moteur de jeu est **pur et déterministe** : il n'accède ni au DOM, ni à l'horloge, ni à `Math.random`. C'est ce qui permet de le tester sous Node et, à terme, de faire jouer plusieurs joueurs sur la même partie.

## Lancer le jeu

Le projet utilise des modules ES : il faut le servir en HTTP, un double-clic sur `index.html` ne suffit pas.

```bash
npm start          # sert le dossier sur http://localhost:1984
```

## Tester

```bash
npm test           # tests du moteur, sans navigateur
```

## Commandes

| Touche | Action |
| --- | --- |
| ← / → | Déplacer la pièce |
| ↓ | Descente douce (+1 point) |
| ↑ | Rotation |
| Espace | Chute rapide (+2 points par ligne parcourue) |
| P | Pause |
| G | Afficher / masquer la projection d'atterrissage (masquée par défaut) |
| M | Couper / remettre la musique |

## Règles

- Grille de 10 × 20 cases, 7 pièces classiques (I, J, L, O, S, T, Z).
- Distribution en « sac de 7 » : chaque pièce sort une fois par cycle.
- Score par lignes effacées simultanément : 100 / 300 / 500 / 800, multiplié par le niveau.
- Le niveau augmente toutes les 10 lignes et accélère la descente.
- Une projection translucide peut indiquer où la pièce va atterrir : masquée par défaut, elle s'active avec `G` ou la case « Projection », et le choix est mémorisé par le navigateur.

## Architecture

Le découpage isole le moteur de tout ce qui est spécifique au navigateur.

```
src/
  engine/       moteur pur : aucune dépendance au navigateur
    constants.js  dimensions, pièces, barème des points
    rng.js        générateur à graine (xorshift32), purement fonctionnel
    state.js      createState / reduce / tick
  render/       affichage
    canvas.js     dessine un état reçu en paramètre
    hud.js        score, niveau, overlay pause / game over
  input/
    keyboard.js   traduit les touches en actions
  audio/
    midi.js       lecteur de fichier MIDI, sans dépendance
    music.js      synthèse Web Audio, calée sur l'état du jeu
  net/
    transport.js  achemine les actions (local, ou WebSocket)
  view/
    preferences.js réglages locaux (projection, musique)
  main.js       câblage : DOM + horloge + boucle de jeu
test/
  engine.test.js  tests du moteur
  midi.test.js    tests du lecteur MIDI
```

Trois règles tiennent l'ensemble :

1. **Le moteur ne mute jamais son état.** `reduce(state, action)` et `tick(state, deltaMs)` renvoient un nouvel état.
2. **Le temps est un paramètre**, jamais une lecture d'horloge interne. Une partie peut donc être rejouée à l'identique — c'est la base de la réconciliation client/serveur.
3. **Les commandes sont des actions sérialisables** (`{ type: 'move', dx: -1 }`), jamais des appels directs. Ce sont elles qui transiteront sur le réseau.

### Vers le multijoueur

Le seam est `src/net/transport.js`. `createLocalTransport` renvoie les actions immédiatement ; `createWebSocketTransport` les fait passer par un serveur qui impose la graine et l'ordre des actions. Le serveur reste à écrire — le transport WebSocket n'a donc pas encore été testé contre une implémentation réelle.

Protocole prévu :

```
serveur -> client : { type: 'start', seed }
serveur -> client : { type: 'action', playerId, action }
client  -> serveur : { type: 'action', action }
```

La graine **doit** venir du serveur : sans elle, deux joueurs ne voient pas la même séquence de pièces.

## Musique

Le thème est **Korobeïniki**, chanson populaire russe de 1861 reprise par Tetris. La bande-son est le fichier `assets/korobeiniki.mid`.

Aucun navigateur ne lit le MIDI nativement. Le fichier est donc analysé par `src/audio/midi.js` — un lecteur de Standard MIDI File sans dépendance, qui rend une liste de notes datées en secondes — puis joué par un petit synthétiseur Web Audio (`src/audio/music.js`) :

- onde triangulaire sous le sol 2, carrée au-dessus ;
- les notes écrites au-dessus du do 8 ne sont pas musicales, c'est la piste rythmique : elles sont rendues en bruit filtré plutôt qu'en sifflement ;
- un compresseur en sortie, le morceau montant jusqu'à une dizaine de voix simultanées.

Le lecteur MIDI ne dépend pas du navigateur : il tourne aussi sous Node, ce qui permet de le tester directement sur la bande-son (`test/midi.test.js`).

La musique tourne en boucle pendant la partie et s'arrête en même temps que le jeu. On la coupe avec `M` ou la case « Musique » ; le choix est mémorisé.

Elle est active par défaut mais **ne démarre qu'à la première interaction** avec la page (clic ou touche) : les navigateurs interdisent de lancer du son avant un geste de l'utilisateur. En pratique elle se lance dès la première touche de déplacement.

Pour changer de morceau, il suffit de remplacer `assets/korobeiniki.mid` par un autre fichier MIDI (ou de passer `src` à `createMusic`).
