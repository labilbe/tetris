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

**Pour jouer ensemble**, lancez aussi le serveur de jeu sur cette même machine :

```bash
npm run server     # port 1985
npm start          # port 1984, dans un autre terminal
```

Chacun ouvre `http://<adresse>:1984` et choisit « Multijoueur ». Le jeu se connecte au serveur sur la machine qui lui a servi la page : rien à configurer chez les invités.

Si la connexion est refusée depuis une autre machine, c'est le pare-feu Windows : ses règles pour Node.js doivent couvrir le profil du réseau utilisé (Domain, Private ou Public). Pour ouvrir explicitement ces deux ports, dans un terminal **administrateur** :

```powershell
New-NetFirewallRule -DisplayName "Tetris" -Direction Inbound `
  -Protocol TCP -LocalPort 1984,1985 -Action Allow -Profile Domain,Private
```

### Sur téléphone

Deux chemins, selon ce qu'on veut :

- **En ligne** : <https://labilbe.github.io/tetris/> — rien à lancer, mais le solo seulement, faute de serveur en face.
- **Sur le réseau local** : l'adresse de la machine qui sert la page, par exemple `http://192.168.66.12:1984`. Le multijoueur y fonctionne, le serveur tournant sur cette machine.

Le pavé tactile apparaît automatiquement, et la boîte de jeu se met à l'échelle de l'écran.

## Tester

```bash
npm test           # tests du moteur, sans navigateur
```

Pour essayer le multijoueur sans être plusieurs, voir [Jouer contre l'IA](#jouer-contre-lia).

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
| Maj+← / → | Multijoueur : regarder un autre joueur |
| A | Multijoueur : rendre la main à la réalisation automatique |

Sur écran tactile — ou dans une fenêtre étroite — un pavé de commandes apparaît sous le plateau : déplacer, tourner, descendre, chute rapide. Maintenir le doigt sur une flèche répète le déplacement, comme une touche enfoncée.

L'écran de pause propose « Reprendre » et « Retour au menu ». En fin de partie, seul le retour au menu subsiste — c'est là qu'on rechoisit le mode et qu'on relance une partie.

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
  ai/
    player.js     où poser la pièce : décision pure, sans horloge ni réseau
  render/       affichage
    canvas.js     dessine un état reçu en paramètre
    hud.js        score, niveau, overlay pause / fin de partie
  input/
    keyboard.js   traduit les touches en actions
    touch.js      traduit les appuis du pavé tactile en actions
  audio/
    midi.js       lecteur de fichier MIDI, sans dépendance
    music.js      synthèse Web Audio, calée sur l'état du jeu
  net/
    protocol.js   vocabulaire réseau, partagé avec le serveur
    transport.js  achemine les actions (local, ou WebSocket)
    snapshot.js   instantané de plateau : ce que les autres voient de notre partie
    garbage.js    tirage des colonnes de handicap, côté émetteur
  view/
    preferences.js réglages locaux (projection, musique, pseudo)
    camera.js     qui regarde-t-on dans le multiplex, et jusqu'à quand
  main.js       câblage : DOM + horloge + boucle de jeu
server/
  rooms.js      salons : qui attend qui, avec quelle graine (fonctions pures)
  index.js      le réseau, et rien d'autre
  bot.js        adversaires artificiels : de vrais clients, pour essayer seul
test/
  engine.test.js    tests du moteur
  midi.test.js      tests du lecteur MIDI
  rooms.test.js     tests des salons
  multiplex.test.js instantané de plateau et caméra
  ai.test.js        décision de l'IA et tirage du handicap
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

Chaque joueur ouvre la page et choisit « Multijoueur ». Le salon accueille **autant de joueurs que voulu** ; il en faut simplement deux pour jouer.

Dès le second joueur, un bouton « Lancer la partie » apparaît. **Rien ne démarre tout seul** : ce sont les présents qui décident du moment, sans quoi un arrivant de plus lancerait la partie à leur place. Une fois lancée, le salon n'accepte plus personne — un retardataire manquerait le début et jouerait une autre partie.

**Le salon ne survit pas à sa partie.** Dès que le vainqueur est désigné, il est fermé, et la partie suivante repart d'un salon neuf, graine comprise. Ce refus des retardataires ne doit pas survivre à la partie qu'il protégeait : comme un salon ne disparaissait qu'une fois vide, un seul joueur resté devant son écran de verdict suffisait à accueillir tous les autres par « La partie a déjà commencé dans ce salon » — sans qu'aucune partie ne soit en cours.

Fermer plutôt que rouvrir évite au passage un piège : un joueur encore devant son verdict compterait comme présent dans un salon rouvert, un autre pourrait lancer la partie avec ce fantôme, et l'attendrait indéfiniment.

### Ce qui circule sur le réseau

**La partie ne circule pas : une graine, puis des actions.** Le moteur étant déterministe, la même graine suivie de la même suite d'actions produit le même jeu partout. Le serveur n'a donc aucune règle de Tetris à connaître ; il réunit les joueurs, impose la graine et donne un ordre unique aux actions.

Un second canal, `board`, transporte des **instantanés de plateau** — mais uniquement pour regarder les autres jouer (voir [Le multiplex](#le-multiplex--regarder-les-autres-jouer)). Il ne décide de rien : le perdre ou le fausser ne change aucune partie, et le serveur le relaie sans le lire. C'est ce qui l'autorise à côtoyer le canal d'actions sans le contaminer.

```
client  -> serveur : { type: 'join', room, name }
client  -> serveur : { type: 'begin' }
client  -> serveur : { type: 'action', action }
client  -> serveur : { type: 'over' }
client  -> serveur : { type: 'board', board }          (affichage seul)
serveur -> client  : { type: 'waiting', players, min, names }
serveur -> client  : { type: 'start', seed, playerId, players, names }
serveur -> client  : { type: 'action', playerId, action }
serveur -> client  : { type: 'board', playerId, board }  (affichage seul)
serveur -> client  : { type: 'eliminated', playerId, remaining }
serveur -> client  : { type: 'finished', winner }
serveur -> client  : { type: 'left', playerId }
```

Le vocabulaire est défini une seule fois, dans `src/net/protocol.js`, importé par le client comme par le serveur : les deux côtés ne peuvent pas diverger.

Une action n'est **pas** appliquée au moment de la frappe : elle part au serveur et n'agit qu'à son retour. C'est le choix le plus simple, au prix d'un aller-retour. La prédiction locale (appliquer tout de suite, puis rejouer depuis le dernier état confirmé) se greffera dans le transport, et nulle part ailleurs.

Les actions de l'adversaire arrivent par le même canal que les siennes et sont distinguées par `playerId`.

### Blocs de handicap

Effacer **au moins deux lignes d'un coup** envoie des blocs gris aux autres joueurs. Ils **tombent du haut** et se posent sur leur pile, colonne par colonne. Une seule ligne n'envoie rien.

| Lignes effacées | Blocs envoyés |
| --- | --- |
| 2 | 5 |
| 3 | 10 |
| 4 | 20 |

Le compte est en blocs, pas en lignes : cinq blocs ne valent qu'une demi-ligne de matière, mais répartie de façon bien plus gênante qu'une ligne pleine.

**Un bloc tombe, il ne se glisse donc jamais sous un surplomb** : il s'arrête sur la première case occupée de sa colonne. C'est ce qui distingue ce handicap d'une ligne poussée par le bas — au lieu de décaler proprement la pile, il coiffe les puits et crée des creux inaccessibles.

**Le handicap est identique chez tous les receveurs.** C'est une contrainte plus forte qu'il n'y paraît : les colonnes ne peuvent pas être tirées chez chacun, ce qui donnerait des plateaux différents, ni tirées avec le générateur du jeu, dont l'avance est synchronisée avec la suite de pièces. Elles sont donc tirées une fois par l'émetteur et **voyagent dans l'action** — `{ type: 'garbage', columns: [0, 0, 3, 7] }`.

C'est aussi la seule action qui s'applique aux *autres* et non à soi : celui qui efface les lignes ne se pénalise pas. Une colonne qui atteint le plafond termine la partie du receveur.

**Un bloc de handicap ne complète jamais une rangée.** Il l'effacerait, donc allégerait la pile de celui qui le subit : un cadeau, pas une gêne. Un bloc dont la colonne visée bouclerait une rangée part donc sur la colonne suivante qui l'accepte — et se perd, plutôt que d'offrir une ligne, dans le cas limite où aucune ne l'accepte.

Corollaire : un handicap ne fait **jamais disparaître de cases** du plateau qui le reçoit. La pile ne peut que monter.

### Éliminations

Un joueur qui perd est **éliminé**, et la partie continue entre les autres : son plateau se fige et affiche « Éliminé — la partie continue ». **Le dernier en jeu l'emporte** — « Gagné ! » pour lui, « Perdu » pour les autres. À deux, cela revient bien à « le premier qui perd a perdu ».

Une déconnexion **en cours de partie** vaut élimination : quitter ne bloque donc jamais les autres, et peut même couronner le dernier resté.

Avant le lancement, en revanche, un joueur qui entre puis ressort du salon n'annule rien : ceux qui patientent voient simplement le compte baisser.

Le panneau affiche le nombre de joueurs encore en jeu. Une fois la partie terminée, le seul choix offert est le retour au menu : relancer seul une partie en réseau n'aurait pas de sens, les autres ne suivraient pas.

### Le multiplex : regarder les autres jouer

Chaque joueur choisit un **pseudo** au menu, retenu d'une partie à l'autre. Sans lui, « le joueur en difficulté » ne désignerait qu'un identifiant que personne ne reconnaît. Deux homonymes sont numérotés (`Franck`, `Franck 2`).

**Le champ arrive pré-rempli avec le nom Windows de la machine.** Sur un poste nommé `POSTE-12`, le menu propose `POSTE-12` avant qu'on ait rien tapé — un pseudo déjà saisi n'est jamais remplacé, et reste mémorisé d'une partie à l'autre.

Ce nom vient du **serveur**, pas de la page. Un navigateur ne peut pas lire le nom de sa machine : aucune API ne l'expose, et c'est voulu — ce serait un identifiant stable de plus à offrir au premier site visité. Le serveur, lui, tourne sur la machine et connaît son nom (`os.hostname()`, suffixe de domaine retiré). Il l'expose à côté du WebSocket, sur le même port :

```
GET http://<hôte>:1985/nom   ->   {"name":"POSTE-12"}
```

Deux garde-fous, qui expliquent la forme de cette réponse :

- **Elle n'est donnée qu'à un joueur de cette machine**, reconnu à son adresse de bouclage ; sinon `{"name":""}`. Le nom de l'hôte n'est pas celui d'un invité du réseau local : le lui proposer ferait jouer tout le monde sous le même nom, numéroté derrière l'hôte.
- **L'en-tête CORS n'est émis que pour une page de la même machine** (origine et hôte de même nom, le port différant puisque la page est servie à côté). Sans cela, n'importe quel site visité pourrait demander ce nom à la machine de son visiteur — ce que le navigateur a précisément raison de lui refuser.

Le serveur annonce le nom retenu au démarrage :

```
Serveur de jeu en ecoute sur le port 1985 (2 joueurs minimum, sans maximum)
Pseudo par defaut sur cette machine : POSTE-12
```

Si le serveur de jeu n'est pas lancé, la requête échoue sans bruit : on n'empêche personne de jouer en solo faute d'avoir trouvé un nom.

#### Les invités du réseau prennent un nom tiré au sort

**Le nom d'une machine distante n'est pas connaissable depuis le serveur.** Ce n'est pas faute d'avoir cherché : toutes les voies ont été mesurées, d'un poste vers un autre du même réseau.

| Méthode | Résultat |
| --- | --- |
| DNS inverse (`dns.reverse`, PTR) | `ENOTFOUND` |
| Résolveur du système (`getnameinfo`) | `ENOTFOUND` après 4,9 s |
| PTR demandé au DNS du réseau | « DNS name does not exist » |
| NetBIOS (`nbtstat -A`) | « Host not found » |
| mDNS inverse (224.0.0.251) | aucune réponse |
| LLMNR inverse (224.0.0.252) | aucune réponse |

Un réseau peut très bien résoudre les noms **dans le sens direct** sans savoir faire l'inverse : c'est le cas ici, la zone directe existe et la zone inverse non. Et deviner coûterait cher — sur une machine où Docker est installé, le fichier `hosts` fait répondre `kubernetes.docker.internal` pour `127.0.0.1`. Un faux nom vaut moins que pas de nom.

Faute de machine identifiable, la page **tire alors un pseudo au sort** : un fleuve ou une ville de Russie (`Volga`, `Baikal`, `Souzdal`…), autre clin d'œil à Moscou. Aucun n'est un prénom d'adversaire artificiel, pour qu'un humain ne se confonde pas avec une IA dans le multiplex.

Un nom quelconque vaut mieux qu'un champ vide : sans lui, tous les invités s'appelleraient `Joueur`, numérotés les uns derrière les autres, et la caméra annoncerait « Joueur 3 » sans que personne ne se reconnaisse.

#### Ce qui est mémorisé, et ce qui ne l'est pas

Le pseudo est enregistré **dès qu'il change**, et non au lancement d'une partie en réseau : on le corrige, puis on joue en solo ou on ferme l'onglet, il est là à la visite suivante.

| Origine du pseudo | Mémorisé ? |
| --- | --- |
| Saisi par le joueur | oui, à la frappe |
| Tiré au sort | oui, aussitôt — sinon le joueur changerait d'identité à chaque rechargement |
| Nom de la machine | **non** — il est redemandé à chaque visite, et suit donc un renommage |

Un pseudo déjà retenu l'emporte toujours sur les deux autres : ni la machine ni le hasard ne reprennent la main sur un choix fait.

Une vignette à gauche du plateau montre **un adversaire à la fois**, et non tous : à un salon sans maximum, une grille de plateaux ne tiendrait ni à l'écran ni au regard. C'est la caméra qui choisit.

**Comment le plateau d'un autre arrive jusqu'à nous.** Chacun émet un instantané de son propre plateau cinq fois par seconde, que le serveur relaie tel quel — un bloc opaque qu'il ne lit pas. C'est un **second canal, purement décoratif** (`board`), à côté du canal d'actions qui, lui, reste seul maître de la partie : un instantané perdu, tardif ou incohérent ne change le jeu de personne, il fait au pire sauter une vignette.

C'est ce qui écarte la difficulté qui avait fait renoncer à cette fonctionnalité : rejouer la partie d'un adversaire à partir de ses actions supposerait de dater celles-ci, sa gravité avançant sur *son* horloge. Une image toute faite n'a pas d'horloge. Le format est du texte — une lettre par case, vingt chaînes de dix caractères — lisible dans un journal réseau et assez léger pour partir sans cérémonie.

**La caméra.** Par défaut elle réalise toute seule :

- quelqu'un est **en difficulté** (pile ≥ 14 rangées sur 20) : elle se porte sur lui, la plus haute pile d'abord, et y reste tant que ça dure ;
- sinon elle **tourne** toutes les 5 secondes, dans l'ordre d'arrivée — un multiplex qui fait le tour des tables.

<kbd>Maj</kbd>+<kbd>←</kbd> / <kbd>→</kbd>, ou les flèches de la vignette, passent la main au joueur : la caméra se fige alors sur son choix, même si un autre est en danger. <kbd>A</kbd> ou le bouton **Auto** rend la main à la réalisation. Les flèches nues restent au jeu — une pièce qui ne répond plus parce qu'on regardait ailleurs serait le pire des échanges.

La hauteur de pile est mesurée **sans la pièce en cours** : sinon une pièce qui vient d'apparaître ferait croire à une pile au plafond, et la caméra se précipiterait sur un joueur qui va très bien.

La colonne du multiplex est **réservée même en solo**, où elle est simplement invisible : la faire apparaître au passage en réseau décalerait tout le plateau. Sur écran étroit, où la mise en page s'empile, elle n'apparaît qu'en réseau — y réserver 200 px de hauteur à toute partie solo coûterait plus que le décalage évité.

### Jouer contre l'IA

Le multijoueur se teste mal à un joueur : il faut être deux pour lancer une partie, et le multiplex n'a rien à montrer tant que personne d'autre ne joue. D'où des adversaires artificiels.

```bash
npm run server     # dans un terminal
npm run bots       # dans un autre : trois adversaires
npm start          # dans un troisième : la page
```

Ils entrent dans le salon et **attendent que vous lanciez la partie** — comme des invités, et pour la même raison : rien ne démarre à la place des présents. Après chaque partie ils reviennent d'eux-mêmes dans le salon, si bien qu'on les lance une fois pour la soirée.

| Option | Effet |
| --- | --- |
| `5` (un nombre nu) | cinq adversaires plutôt que trois |
| `--adresse <0..1>` | probabilité de bien jouer (défaut `0.9`) |
| `--delai <ms>` | millisecondes entre deux actions (défaut `80`) |
| `--lancer` | lancer la partie sans attendre de joueur humain |
| `--salon`, `--hote`, `--port` | rejoindre un autre salon, ou un serveur distant |
| `--aide` | le détail |

Par exemple `npm run bots -- 5 --adresse 0.8`.

**Ce sont de vrais clients.** Ils ouvrent une connexion WebSocket, dérivent leur plateau de la graine commune, n'agissent que par les actions d'un joueur au clavier et émettent leurs instantanés au même rythme qu'un navigateur. Le serveur ne les distingue pas d'une page ouverte, et c'est tout l'intérêt : ce qu'on exerce ainsi, c'est la vraie chaîne — salon, ordre des actions, handicap, multiplex, éliminations — et non une maquette à côté du jeu.

**L'IA ne voit que son propre plateau**, et aucun état qu'un joueur n'aurait pas. Elle juge chaque pose possible de la pièce en cours sur quatre mesures — hauteur de pile, cases couvertes, dénivelé, lignes effacées — et garde la meilleure. Les cases couvertes pèsent lourd : c'est le seul dégât qu'on ne répare pas en jouant bien, une case coiffée le restant jusqu'à ce que sa rangée s'efface.

**`--adresse` sert aux essais, pas à la difficulté.** À `1` l'IA ne perd jamais : sa pile ne monte pas, donc la caméra ne se porte jamais sur un joueur en difficulté, personne n'est éliminé et aucune partie ne se termine — on ne verrait précisément rien de ce qu'on voulait voir. En dessous, elle se trompe pour de bon : un placement au hasard de temps en temps, avec les trous que cela creuse. À `0.9`, une partie à trois dure une minute et finit par désigner un vainqueur ; à `0.8`, elle est nettement plus courte.

La décision vit dans `src/ai/player.js` : des fonctions pures sur un état de jeu, sans horloge ni réseau, comme le moteur et la caméra. `server/bot.js` ne garde que le temps et la connexion. C'est ce partage qui rend la politique de jeu testable coup par coup (`test/ai.test.js`), ce qu'aucune partie observée ne prouverait — une IA qui joue mal étant très difficile à distinguer d'une IA malchanceuse.

Une dernière chose que l'IA ne sait pas faire : **viser une colonne sous un surplomb**. Y glisser une pièce demanderait de simuler les rotations avec leurs décalages, et le handicap en crée justement. Le pilote tranche plus simplement — s'il pousse deux fois sans que rien ne bouge, il lâche la pièce là où elle est. Une pièce mal posée de loin en loin est un défaut d'IA, pas un blocage.

### Ce qui reste à faire

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
