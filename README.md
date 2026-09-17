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
    score.js      partition de Korobeïniki (mélodie + basse)
    music.js      synthèse Web Audio, calée sur l'état du jeu
  net/
    transport.js  achemine les actions (local, ou WebSocket)
  view/
    preferences.js réglages locaux (projection, musique)
  main.js       câblage : DOM + horloge + boucle de jeu
tools/
  generate-midi.js  écrit assets/korobeiniki.mid depuis la partition
test/
  engine.test.js  tests du moteur
  score.test.js   tests de la partition
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

Le thème est **Korobeïniki**, chanson populaire russe de 1861 — la mélodie reprise par Tetris. Elle est dans le domaine public ; c'est elle qui est notée ici, avec un accompagnement écrit pour ce projet, et non une transcription de l'arrangement Game Boy.

La partition vit dans `src/audio/score.js` et sert deux sorties :

- **En jeu**, elle est synthétisée en direct par Web Audio (`src/audio/music.js`) : une onde carrée pour la mélodie, une triangulaire pour la basse. Aucun navigateur ne lit le MIDI nativement, et embarquer un synthétiseur complet serait disproportionné pour quelques dizaines de notes.
- **En fichier**, `assets/korobeiniki.mid` est produit par `node tools/generate-midi.js` — format ouvert, ouvrable dans n'importe quel séquenceur.

La musique tourne en boucle pendant la partie et s'arrête en même temps que le jeu. On la coupe avec `M` ou la case « Musique » ; le choix est mémorisé.

Elle est active par défaut mais **ne démarre qu'à la première interaction** avec la page (clic ou touche) : les navigateurs interdisent de lancer du son avant un geste de l'utilisateur. En pratique elle se lance dès la première touche de déplacement.
