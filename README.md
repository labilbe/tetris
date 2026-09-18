# Tetris

Un Tetris jouable dans le navigateur, en HTML/Canvas et JavaScript vanilla. Aucun build, et aucune dépendance côté navigateur — seul le serveur multijoueur en a une, `ws`.

Le moteur de jeu est **pur et déterministe** : il n'accède ni au DOM, ni à l'horloge, ni à `Math.random`. C'est ce qui permet de le tester sous Node et, à terme, de faire jouer plusieurs joueurs sur la même partie.

## Lancer le jeu

Le projet utilise des modules ES : il faut le servir en HTTP, un double-clic sur `index.html` ne suffit pas.

```bash
npm start          # sert le dossier sur http://localhost:1984
```

### Depuis le réseau local

Le serveur écoute sur toutes les interfaces (`0.0.0.0`), pas seulement sur localhost : les autres machines du réseau peuvent donc ouvrir le jeu directement, sans rien changer au lancement.

Il suffit de remplacer `localhost` par l'adresse de la machine qui sert le jeu, par exemple `http://192.168.66.12:1984`. Pour retrouver cette adresse :

```powershell
Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.PrefixOrigin -eq 'Dhcp' } |
  Select-Object IPAddress, InterfaceAlias
```

Si la connexion est refusée depuis une autre machine, c'est le pare-feu Windows : ses règles pour Node.js doivent couvrir le profil du réseau utilisé (Domain, Private ou Public). Pour ouvrir explicitement ce seul port, dans un terminal **administrateur** :

```powershell
New-NetFirewallRule -DisplayName "Tetris (port 1984)" -Direction Inbound `
  -Protocol TCP -LocalPort 1984 -Action Allow -Profile Domain,Private
```

Le jeu étant entièrement local au navigateur, chaque machine joue sa propre partie : la page partagée ne fait pas encore un jeu partagé — c'est l'objet du multijoueur.

## Tester

```bash
npm test           # tests du moteur, sans navigateur
```

## Menu

Au chargement, un menu propose « Partie solo » et « Multijoueur ». Le multijoueur demande le serveur (`npm run server`) ; sans lui, le menu affiche l'échec de connexion et reste utilisable en solo.

Ce menu joue un second rôle : le clic qui lance la partie est aussi le geste que les navigateurs exigent avant d'autoriser le son. La musique démarre donc avec la partie, sans rien demander de plus au joueur.

## Commandes

| Touche | Action |
| --- | --- |
| ← / → | Déplacer la pièce |
| ↓ | Descente douce (+1 point) |
| ↑ | Rotation |
| Espace | Chute rapide (+2 points par ligne parcourue) |
| P | Pause |
| G | Afficher / masquer la projection d'atterrissage (affichée par défaut) |
| M | Couper / remettre la musique |

En pause, l'écran propose « Reprendre » et « Recommencer » ; en fin de partie, seulement « Rejouer ».

## Règles

- Grille de 10 × 20 cases, 7 pièces classiques (I, J, L, O, S, T, Z).
- Distribution en « sac de 7 » : chaque pièce sort une fois par cycle.
- Score par lignes effacées simultanément : 100 / 300 / 500 / 800, multiplié par le niveau.
- Le niveau augmente toutes les 10 lignes et accélère la descente.
- Une projection translucide peut indiquer où la pièce va atterrir : affichée par défaut, elle se coupe avec `G` ou la case « Projection », et le choix est mémorisé par le navigateur.

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
    protocol.js   vocabulaire réseau, partagé avec le serveur
    transport.js  achemine les actions (local, ou WebSocket)
  view/
    preferences.js réglages locaux (projection, musique)
  main.js       câblage : DOM + horloge + boucle de jeu
server/
  rooms.js      salons : qui attend qui, avec quelle graine (fonctions pures)
  index.js      le réseau, et rien d'autre
test/
  engine.test.js  tests du moteur
  midi.test.js    tests du lecteur MIDI
  rooms.test.js   tests des salons
```

Trois règles tiennent l'ensemble :

1. **Le moteur ne mute jamais son état.** `reduce(state, action)` et `tick(state, deltaMs)` renvoient un nouvel état.
2. **Le temps est un paramètre**, jamais une lecture d'horloge interne. Une partie peut donc être rejouée à l'identique — c'est la base de la réconciliation client/serveur.
3. **Les commandes sont des actions sérialisables** (`{ type: 'move', dx: -1 }`), jamais des appels directs. Ce sont elles qui transiteront sur le réseau.

## Multijoueur

```bash
npm run server     # serveur de jeu sur le port 1985
npm start          # dans un autre terminal, la page sur le port 1984
```

Chaque joueur ouvre la page et choisit « Multijoueur ». Le salon accueille de **2 à 6 joueurs**.

Dès que deux joueurs sont présents, un bouton « Lancer la partie » apparaît : les présents décident eux-mêmes du départ. Attendre le salon plein rendrait une partie à trois impossible. Le départ est automatique si le salon atteint son maximum.

### Ce qui circule sur le réseau

**Ni plateau, ni pièces : une graine, puis des actions.** Le moteur étant déterministe, la même graine suivie de la même suite d'actions produit le même jeu partout. Le serveur n'a donc aucune règle de Tetris à connaître ; il réunit les joueurs, impose la graine et donne un ordre unique aux actions.

```
client  -> serveur : { type: 'join', room }
client  -> serveur : { type: 'begin' }
client  -> serveur : { type: 'action', action }
client  -> serveur : { type: 'over' }
serveur -> client  : { type: 'waiting', players, min, max }
serveur -> client  : { type: 'start', seed, playerId, players }
serveur -> client  : { type: 'action', playerId, action }
serveur -> client  : { type: 'eliminated', playerId, remaining }
serveur -> client  : { type: 'finished', winner }
serveur -> client  : { type: 'left', playerId }
```

Le vocabulaire est défini une seule fois, dans `src/net/protocol.js`, importé par le client comme par le serveur : les deux côtés ne peuvent pas diverger.

Une action n'est **pas** appliquée au moment de la frappe : elle part au serveur et n'agit qu'à son retour. C'est le choix le plus simple, au prix d'un aller-retour. La prédiction locale (appliquer tout de suite, puis rejouer depuis le dernier état confirmé) se greffera dans le transport, et nulle part ailleurs.

Les actions de l'adversaire arrivent par le même canal que les siennes et sont distinguées par `playerId`.

### Éliminations

Un joueur qui perd est **éliminé**, et la partie continue entre les autres : son plateau se fige et affiche « Éliminé — la partie continue ». **Le dernier en jeu l'emporte** — « Gagné ! » pour lui, « Perdu » pour les autres. À deux, cela revient bien à « le premier qui perd a perdu ».

Une déconnexion vaut élimination : quitter en cours de partie ne bloque donc jamais les autres, et peut même couronner le dernier resté.

Le panneau affiche le nombre de joueurs encore en jeu. Une fois la partie terminée, le seul choix offert est le retour au menu : relancer seul une partie en réseau n'aurait pas de sens, les autres ne suivraient pas.

### Ce qui reste à faire

- **Afficher les plateaux des autres joueurs.** Leurs actions sont déjà reçues ; reste à en dériver leurs plateaux. La difficulté n'est pas les actions mais la gravité, qui avance sur *leur* horloge : il faudra dater les actions pour rejouer leurs parties fidèlement.
- **Les lignes envoyées aux adversaires**, qui font l'intérêt du jeu à plusieurs.
- **Choisir son salon** : le code de salon existe dans le protocole, l'interface n'en propose pas encore.
- **Reconnexion** : aujourd'hui, un joueur qui part met fin à la partie.
- **La pause est locale** : elle arrête son propre plateau sans arrêter celui de l'adversaire. À deux, c'est un avantage indu — il faudra soit la mettre en commun, soit l'interdire en réseau.

## Musique

Le thème est **Korobeïniki**, chanson populaire russe de 1861 reprise par Tetris. La bande-son est le fichier `assets/korobeiniki.mid`.

Aucun navigateur ne lit le MIDI nativement. Le fichier est donc analysé par `src/audio/midi.js` — un lecteur de Standard MIDI File sans dépendance, qui rend une liste de notes datées en secondes — puis joué par un petit synthétiseur Web Audio (`src/audio/music.js`) :

- onde triangulaire sous le sol 2, carrée au-dessus ;
- les notes écrites au-dessus du do 8 ne sont pas musicales, c'est la piste rythmique : elles sont rendues en bruit filtré plutôt qu'en sifflement ;
- un compresseur en sortie, le morceau montant jusqu'à une dizaine de voix simultanées.

Le lecteur MIDI ne dépend pas du navigateur : il tourne aussi sous Node, ce qui permet de le tester directement sur la bande-son (`test/midi.test.js`).

La musique tourne en boucle pendant la partie et s'arrête en même temps que le jeu. On la coupe avec `M` ou la case « Musique » ; le choix est mémorisé.

Elle est active par défaut. Les navigateurs interdisent de lancer du son avant un geste de l'utilisateur : c'est le rôle du menu de démarrage — le clic sur « Partie solo » est ce geste, et la musique part donc en même temps que la partie.

Pour changer de morceau, il suffit de remplacer `assets/korobeiniki.mid` par un autre fichier MIDI (ou de passer `src` à `createMusic`).
