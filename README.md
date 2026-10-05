# Tetris

Un Tetris jouable dans le navigateur, en HTML/Canvas et JavaScript vanilla. Aucun build et **aucune dépendance d'exécution**. La page est un paquet de fichiers statiques ; seul le multijoueur demande un relais, et c'est un Worker de trois fichiers.

Le moteur de jeu est **pur et déterministe** : il n'accède ni au DOM, ni à l'horloge, ni à `Math.random`. C'est ce qui permet de le tester sous Node, et de donner à tous les joueurs la même suite de pièces.

## Jouer

**En ligne, rien à installer :** <https://labilbe.github.io/tetris/>. Solo et multijoueur y fonctionnent tous les deux.

Pour jouer à plusieurs, partagez le lien du salon — par exemple <https://labilbe.github.io/tetris/?salon=K7M2P>. Qui l'ouvre arrive dans le même salon.

### En local

Le projet utilise des modules ES : il faut le servir en HTTP, un double-clic sur `index.html` ne suffit pas.

```bash
npm start          # sert le dossier sur http://localhost:1984
```

Le solo n'a besoin de rien d'autre. Pour travailler sur le **multijoueur**, lancez aussi le relais :

```bash
npm run relais     # le Worker Cloudflare, en local, sur le port 8787
```

puis ouvrez la page en lui désignant ce relais :

```
http://localhost:1984/?salon=ESSAI&relais=ws://127.0.0.1:8787
```

Deux onglets sur cette adresse jouent l'un contre l'autre sans rien déployer. Le paramètre `?relais=` l'emporte sur l'adresse par défaut : c'est ce qui permet d'essayer, et de dépanner, sans toucher au code.

### Sur téléphone

<https://labilbe.github.io/tetris/>, et c'est le même jeu — multijoueur compris. Le pavé tactile apparaît automatiquement, et la boîte de jeu se met à l'échelle de l'écran.

## Tester

```bash
npm test           # sans navigateur, et sans rien à installer
```

L'arbitrage y est compris : `test/host.test.js` éprouve le salon, la graine, les éliminations et le verdict sans ouvrir une seule connexion, parce que l'arbitre renvoie ses messages au lieu de les émettre.

Ce que `node --test` ne couvre pas — les connexions réelles et le DOM — s'éprouve avec le relais local, et sans navigateur : deux clients WebSocket dans un même script suffisent à vérifier qu'un salon se forme, que la partie démarre **chez les deux** avec la même graine, que le handicap va bien à l'autre et pas à soi, et que le verdict tombe. C'est l'essai qui manquait cruellement à la version pair-à-pair, et qui a motivé le retour à un relais.

Pour jouer sans être plusieurs, voir [Jouer contre l'IA](#jouer-contre-lia).

## Menu

Au chargement, un menu propose « Partie solo » et « Multijoueur », avec deux champs : le **pseudo** et le **code du salon**, tous deux pré-remplis et retenus d'une visite à l'autre.

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
    protocol.js   vocabulaire réseau, partagé avec le relais
    transport.js  le contrat d'acheminement des actions, et le mode solo
    socket.js     le transport réseau : une WebSocket vers le relais
    relais.js     l'adresse du relais, surchargeable par ?relais=
    host.js       l'arbitre : salon, graine, verdict (fonctions pures)
    rooms.js      salons : qui attend qui, avec quelle graine (fonctions pures)
    bots.js       adversaires artificiels : la décision et le pilote
    bot-client.js chaque adversaire, branché sur le relais
    snapshot.js   instantané de plateau : ce que les autres voient de notre partie
    garbage.js    tirage des colonnes de handicap, côté émetteur
  view/
    preferences.js réglages locaux (projection, musique, pseudo, salon)
    camera.js     qui regarde-t-on dans le multiplex, et jusqu'à quand
  main.js       câblage : DOM + horloge + boucle de jeu
worker/
  index.js      le relais : route le jeu et la lecture du journal
  salon.js      un salon : branche l'arbitre sur des WebSockets, et consigne
  registre.js   quelles parties ont eu lieu, et dans quel salon
test/
  engine.test.js    tests du moteur
  midi.test.js      tests du lecteur MIDI
  protocol.test.js  codes de salon et pseudos
  rooms.test.js     tests des salons
  host.test.js      tests de l'arbitre : salon, graine, verdict
  bots.test.js      tests du pilote des adversaires artificiels
  multiplex.test.js instantané de plateau et caméra
  ai.test.js        décision de l'IA et tirage du handicap
```

Trois règles tiennent l'ensemble :

1. **Le moteur ne mute jamais son état.** `reduce(state, action)` et `tick(state, deltaMs)` renvoient un nouvel état.
2. **Le temps est un paramètre**, jamais une lecture d'horloge interne. Une partie peut donc être rejouée à l'identique — c'est la base de la réconciliation client/serveur.
3. **Les commandes sont des actions sérialisables** (`{ type: 'move', dx: -1 }`), jamais des appels directs. Ce sont elles qui transiteront sur le réseau.

## Multijoueur

Chaque joueur ouvre la page, vérifie le **code du salon** et choisit « Multijoueur ». Deux joueurs qui tapent le même code se retrouvent, où qu'ils soient. Le plus simple reste de partager le lien : il porte le code (`?salon=K7M2P`), et l'écran d'attente offre un bouton pour le copier.

Le salon accueille **autant de joueurs que voulu** ; il en faut simplement deux pour jouer.

### Le relais

Un **Worker Cloudflare** réunit les joueurs : `worker/`, une centaine de lignes. Un salon y est un *Durable Object* nommé d'après son code, si bien que deux parties ne se connaissent jamais. La page, elle, reste statique et servie par GitHub Pages.

Le relais **ne connaît aucune règle de Tetris** et ne calcule aucun plateau. Il attribue les identifiants, tient la composition du salon, tire la graine, arbitre les éliminations, et transmet le reste sans le lire.

Tout cet arbitrage vit dans `src/net/host.js` — pur, sans réseau, couvert par `node --test`. Le Worker ne fait que le brancher sur des WebSockets : les gestionnaires **renvoient** les messages à émettre au lieu de les pousser eux-mêmes. C'est ce qui permet au même fichier de tourner dans un Worker, qui n'a ni Node ni `ws`, et d'être éprouvé sans ouvrir une connexion.

#### Pourquoi pas du pair-à-pair ?

Le jeu a connu une version sans aucun serveur, où les navigateurs se parlaient directement en WebRTC. Elle n'a jamais fonctionné de façon fiable, et la leçon mérite d'être écrite : les pannes y étaient **silencieuses**. Un message qui ne part pas, un message qui n'arrive pas, et rien dans l'API pour le dire — quatre pannes successives, dont une seule a pu être reproduite hors d'une partie réelle.

Le reproche de fond n'est pas la bibliothèque : c'est qu'**on ne pouvait pas l'éprouver**. Deux pairs ne se découvraient jamais dans un navigateur de développement, donc le seul juge était une partie entre deux vraies machines, avec un aller-retour par hypothèse. Un relais, lui, se lance en local et se vérifie en dix secondes depuis un script — ce qu'on fait maintenant à chaque changement.

S'y ajoutait une limite irréductible : les réseaux à NAT symétrique refusent toute connexion directe, et environ un joueur sur dix ne pouvait pas jouer du tout.

Dès le second joueur, un bouton « Lancer la partie » apparaît. **Rien ne démarre tout seul** : ce sont les présents qui décident du moment, sans quoi un arrivant de plus lancerait la partie à leur place. Une fois lancée, le salon n'accepte plus personne — un retardataire manquerait le début et jouerait une autre partie.

**Le salon ne survit pas à sa partie.** Dès que le vainqueur est désigné, il est fermé, et la partie suivante repart d'un salon neuf, graine comprise. Ce refus des retardataires ne doit pas survivre à la partie qu'il protégeait : comme un salon ne disparaissait qu'une fois vide, un seul joueur resté devant son écran de verdict suffisait à accueillir tous les autres par « La partie a déjà commencé dans ce salon » — sans qu'aucune partie ne soit en cours.

Fermer plutôt que rouvrir évite au passage un piège : un joueur encore devant son verdict compterait comme présent dans un salon rouvert, un autre pourrait lancer la partie avec ce fantôme, et l'attendrait indéfiniment.

### Ce qui circule sur le réseau

**Presque rien, et c'est le point le plus important du multijoueur.**

Chaque joueur ne joue que son propre plateau. Personne ne simule celui d'un autre : les plateaux adverses n'arrivent que sous forme d'images toutes faites, cinq fois par seconde, pour le multiplex. La graine commune ne sert donc qu'à donner à tous la **même suite de pièces** — c'est du confort, pas de la correction.

Il n'y a par conséquent **rien à synchroniser, et aucun ordre à imposer**. Ce qui circule se réduit à :

```
client -> relais : { type: 'join', room, name, reprise? }
client -> relais : { type: 'begin' }
client -> relais : { type: 'over' }
client -> relais : { type: 'action', action }      le handicap
client -> relais : { type: 'board', board }        affichage seul

relais -> client : { type: 'waiting', room, players, min, names }
relais -> client : { type: 'start', seed, playerId, players, names }
relais -> client : { type: 'eliminated', playerId, remaining }
relais -> client : { type: 'finished', winner }
relais -> client : { type: 'away', playerId, secondes }   coupe, place gardee
relais -> client : { type: 'back', playerId }              revenu
relais -> client : { type: 'left', playerId }
relais -> client : { type: 'error', message }
relais -> autres : { type: 'action', playerId, action }
relais -> autres : { type: 'board', playerId, board }
```

Les deux dernières lignes vont **à tous sauf leur émetteur** : celui qui efface les lignes ne se pénalise pas, et il a déjà son plateau sous les yeux.

Le vocabulaire est défini une seule fois, dans `src/net/protocol.js`, importé par la page comme par le Worker : les deux côtés ne peuvent pas diverger.

**Une touche s'applique immédiatement**, en réseau comme en solo — alors même qu'un serveur est de retour dans l'histoire. Dans la toute première version, chaque action partait au serveur et n'agissait qu'à son retour : un aller-retour par touche, pour garantir un ordre dont on vient de voir qu'il ne servait à rien. La « prédiction locale » qu'on envisageait alors de greffer n'a plus d'objet.

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

### Quand la connexion tombe

Une connexion perdue **n'est pas un abandon**. On ne peut pas distinguer celui qui ferme son onglet de celui dont le Wi-Fi hoquette, et éliminer sur-le-champ punissait le second pour attraper le premier.

Le joueur coupé garde donc sa place **trente secondes**. Son plateau se fige — continuer à jouer sans pouvoir recevoir de handicap serait un avantage indu — et un compte à rebours s'affiche pendant que le navigateur se rebranche, une fois par seconde. Son identifiant, tiré au sort par le relais et dit à lui seul, lui tient lieu de laissez-passer pour reprendre sa place.

Les autres voient qu'il est coupé et continuent de jouer. **Aucun vainqueur n'est désigné dans l'intervalle** : à deux, une coupure ne doit pas faire gagner l'autre par forfait avant l'échéance.

Passé le délai, il est éliminé pour de bon, et le jeu le lui dit plutôt que de le laisser devant un écran figé.

L'état du salon est rangé dans le stockage à chaque changement, si bien qu'un **redémarrage du relais** — ce qui arrive à chaque déploiement — ne perd plus la partie : les joueurs se reconnectent et la reprennent. C'est le défaut qui a motivé tout ceci : une rotation de secret avait coupé une partie en cours, et le journal l'a montré à la seconde près.

### Éliminations

Un joueur qui perd est **éliminé**, et la partie continue entre les autres : son plateau se fige et affiche « Éliminé — la partie continue ». **Le dernier en jeu l'emporte** — « Gagné ! » pour lui, « Perdu » pour les autres. À deux, cela revient bien à « le premier qui perd a perdu ».

Une déconnexion **en cours de partie** vaut élimination : quitter ne bloque donc jamais les autres, et peut même couronner le dernier resté.

Avant le lancement, en revanche, un joueur qui entre puis ressort du salon n'annule rien : ceux qui patientent voient simplement le compte baisser.

Le panneau affiche le nombre de joueurs encore en jeu. Une fois la partie terminée, le seul choix offert est le retour au menu : relancer seul une partie en réseau n'aurait pas de sens, les autres ne suivraient pas.

### Le multiplex : regarder les autres jouer

Chaque joueur choisit un **pseudo** au menu, retenu d'une partie à l'autre. Sans lui, « le joueur en difficulté » ne désignerait qu'un identifiant que personne ne reconnaît. Deux homonymes sont numérotés (`Franck`, `Franck 2`).

**Le champ arrive pré-rempli avec un nom tiré au sort** : un fleuve ou une ville de Russie (`Volga`, `Baikal`, `Souzdal`…), autre clin d'œil à Moscou. Aucun n'est un prénom d'adversaire artificiel, pour qu'un humain ne se confonde pas avec une IA dans le multiplex — et comme les deux listes vivent désormais dans le même fichier, un test vérifie qu'elles ne se croisent jamais.

Un nom quelconque vaut mieux qu'un champ vide : sans lui, tous les joueurs s'appelleraient `Joueur`, numérotés les uns derrière les autres, et la caméra annoncerait « Joueur 3 » sans que personne ne se reconnaisse.

Le champ proposait autrefois le **nom Windows de la machine**, demandé au serveur de jeu — un navigateur ne pouvant pas le lire lui-même, aucune API ne l'exposant, et c'est voulu : ce serait un identifiant stable de plus à offrir au premier site visité. Sans serveur, plus personne ne le connaît. La perte est mince : la page étant servie depuis Internet, la quasi-totalité des joueurs n'y avaient de toute façon pas droit.

#### Ce qui est mémorisé

Le pseudo est enregistré **dès qu'il change**, et non au lancement d'une partie en réseau : on le corrige, puis on joue en solo ou on ferme l'onglet, il est là à la visite suivante. Un pseudo déjà retenu l'emporte toujours sur un tirage au sort : le hasard ne reprend jamais la main sur un choix fait.

Le **code du salon** suit la même règle, avec une priorité de plus : un code reçu dans un lien l'emporte sur le dernier salon joué. Qui ouvre l'invitation d'un ami doit atterrir chez lui, pas dans son propre salon de la veille.

Une vignette à gauche du plateau montre **un adversaire à la fois**, et non tous : à un salon sans maximum, une grille de plateaux ne tiendrait ni à l'écran ni au regard. C'est la caméra qui choisit.

**Comment le plateau d'un autre arrive jusqu'à nous.** Chacun émet un instantané de son propre plateau cinq fois par seconde, que le relais transmet aux autres sans le lire. C'est un **canal purement décoratif** (`board`) : un instantané perdu, tardif ou incohérent ne change le jeu de personne, il fait au pire sauter une vignette.

C'est ce qui écarte la difficulté qui avait fait renoncer à cette fonctionnalité : rejouer la partie d'un adversaire à partir de ses actions supposerait de dater celles-ci, sa gravité avançant sur *son* horloge. Une image toute faite n'a pas d'horloge. Le format est du texte — une lettre par case, vingt chaînes de dix caractères — lisible dans un journal réseau et assez léger pour partir sans cérémonie.

**La caméra.** Par défaut elle réalise toute seule :

- quelqu'un est **en difficulté** (pile ≥ 14 rangées sur 20) : elle se porte sur lui, la plus haute pile d'abord, et y reste tant que ça dure ;
- sinon elle **tourne** toutes les 5 secondes, dans l'ordre d'arrivée — un multiplex qui fait le tour des tables.

<kbd>Maj</kbd>+<kbd>←</kbd> / <kbd>→</kbd>, ou les flèches de la vignette, passent la main au joueur : la caméra se fige alors sur son choix, même si un autre est en danger. <kbd>A</kbd> ou le bouton **Auto** rend la main à la réalisation. Les flèches nues restent au jeu — une pièce qui ne répond plus parce qu'on regardait ailleurs serait le pire des échanges.

La hauteur de pile est mesurée **sans la pièce en cours** : sinon une pièce qui vient d'apparaître ferait croire à une pile au plafond, et la caméra se précipiterait sur un joueur qui va très bien.

La colonne du multiplex est **réservée même en solo**, où elle est simplement invisible : la faire apparaître au passage en réseau décalerait tout le plateau. Sur écran étroit, où la mise en page s'empile, elle n'apparaît qu'en réseau — y réserver 200 px de hauteur à toute partie solo coûterait plus que le décalage évité.

### Jouer contre l'IA

Le multijoueur se joue mal à un joueur : il en faut deux pour lancer une partie, et le multiplex n'a rien à montrer tant que personne d'autre ne joue. En ligne, où l'on arrive souvent seul, un salon vide ne servirait à rien. D'où des adversaires artificiels, **dans l'écran d'attente** : un bouton « Ajouter un adversaire », jusqu'à cinq.

**Chacun ouvre sa propre connexion**, depuis le navigateur de celui qui l'ajoute. Le relais ne les distingue pas d'une page ouverte : un bot entre dans le salon, joue, pénalise ses voisins et se fait éliminer comme n'importe qui.

**Ils parlent exactement le langage d'un joueur.** Ils dérivent leur plateau de la graine commune, n'agissent que par les actions d'un joueur au clavier, et émettent leurs instantanés au même rythme qu'un navigateur. C'est tout l'intérêt : ce qu'on exerce ainsi, c'est la vraie chaîne — salon, handicap, multiplex, éliminations — et non une maquette à côté du jeu.

Ils vivent sur **la même image que le jeu** : pas de minuterie à eux, pas de second rythme. `src/net/bots.js` reçoit le temps en paramètre depuis la boucle de rendu, exactement comme le moteur. Si l'onglet passe en arrière-plan, ils gèlent avec la partie — ce qui est le comportement souhaitable. C'est aussi ce qui rend leur partie reproductible, donc testable sans attendre (`test/bots.test.js`).

Le plafond de cinq n'est pas arbitraire : ils tournent dans l'onglet de celui qui les ajoute, et au-delà c'est sa propre partie qui saccade.

Deux réglages vivent dans le code plutôt que dans l'interface, `adresse` (probabilité de bien jouer, défaut `0.9`) et `delai` (millisecondes entre deux actions, défaut `80`).

**L'IA ne voit que son propre plateau**, et aucun état qu'un joueur n'aurait pas. Elle juge chaque pose possible de la pièce en cours sur quatre mesures — hauteur de pile, cases couvertes, dénivelé, lignes effacées — et garde la meilleure. Les cases couvertes pèsent lourd : c'est le seul dégât qu'on ne répare pas en jouant bien, une case coiffée le restant jusqu'à ce que sa rangée s'efface.

**`--adresse` sert aux essais, pas à la difficulté.** À `1` l'IA ne perd jamais : sa pile ne monte pas, donc la caméra ne se porte jamais sur un joueur en difficulté, personne n'est éliminé et aucune partie ne se termine — on ne verrait précisément rien de ce qu'on voulait voir. En dessous, elle se trompe pour de bon : un placement au hasard de temps en temps, avec les trous que cela creuse. À `0.9`, une partie à trois dure une minute et finit par désigner un vainqueur ; à `0.8`, elle est nettement plus courte.

La décision vit dans `src/ai/player.js` : des fonctions pures sur un état de jeu, sans horloge ni réseau, comme le moteur et la caméra. `src/net/bots.js` ne garde que le temps, et `src/net/bot-client.js` que la connexion. C'est ce partage qui rend la politique de jeu testable coup par coup (`test/ai.test.js`), ce qu'aucune partie observée ne prouverait — une IA qui joue mal étant très difficile à distinguer d'une IA malchanceuse. Ce découpage a survécu intact à deux refontes du réseau : seule la couche de connexion a changé.

Une dernière chose que l'IA ne sait pas faire : **viser une colonne sous un surplomb**. Y glisser une pièce demanderait de simuler les rotations avec leurs décalages, et le handicap en crée justement. Le pilote tranche plus simplement — s'il pousse deux fois sans que rien ne bouge, il lâche la pièce là où elle est. Une pièce mal posée de loin en loin est un défaut d'IA, pas un blocage.

### Le journal des parties

**Le relais consigne tout ce qu'il voit**, horodaté, salon par salon : arrivées, départs, lancement, graine, handicaps, éliminations, verdicts, et les erreurs qu'il renvoie. C'est actif par défaut et il n'y a rien à déclencher — un journal qu'il faut penser à activer n'est jamais là le jour où l'on en a besoin.

Les instantanés de plateau en sont exclus : cinq par seconde et par joueur, ils noieraient tout ce qui se lit, et ils n'expliquent rien.

La lecture demande un jeton, posé une fois :

```bash
npx wrangler secret put JOURNAL_SECRET
```

Sans secret configuré, personne ne lit — un journal ouvert exposerait les pseudos et les horaires de jeu à qui devine un code de salon.

```
/journal?jeton=…                      les 20 dernières parties, tous salons
/journal?salon=CASA&jeton=…           la dernière partie de ce salon
/journal?salon=CASA&partie=3&jeton=…  une partie précise
```

La première adresse sert à retrouver une partie dont on ne se souvient plus du code ; chaque ligne porte le lien vers son journal. Une partie ressemble à ceci :

```
19:56:59.842 recu  f0e54ae1  {"type":"join","room":"CASA","name":"deicy"}
19:56:59.843 emis  —         {"pour":"tous","type":"waiting","players":2,"names":["deicy","franck"]}
19:57:00.155 emis  f0e54ae1  {"pour":"f0e54ae1","type":"start","seed":2224352997,…}
19:57:00.558 recu  4efa8724  {"type":"action","action":{"type":"garbage","columns":[2,5,7]}}
19:57:00.867 emis  —         {"pour":"tous","type":"finished","winner":"4efa8724…"}
```

Chaque salon garde ses vingt dernières parties, et s'élague tout seul.

**Ce que le journal ne peut pas faire :** rejouer un plateau pièce par pièce. Les touches ne traversent jamais le réseau — c'est ce qui rend le jeu instantané — si bien que le relais ignore tout des mouvements de chacun. Il raconte l'histoire du salon, pas celle d'une partie.

### Déployer le relais

Le relais se déploie séparément de la page. Il faut un compte Cloudflare gratuit, une seule fois :

```bash
npx wrangler login                      # ouvre le navigateur, une fois pour toutes
npx wrangler secret put JOURNAL_SECRET  # le jeton de lecture du journal
npm run deploy                          # publie le relais
```

La commande affiche l'adresse obtenue, de la forme `https://tetris-relais.<sous-domaine>.workers.dev`. Reportez-la dans `src/net/relais.js` (en `wss://`), puis poussez la page.

Le palier gratuit suffit très largement, et surtout **il ne met rien en veille** : il n'y a pas de démarrage à froid à subir avant la première partie.

### Ce qui reste à faire

- **Une partie en cours ne survit pas a un salon vide** : si tous les joueurs se coupent en meme temps, le salon se ferme a l echeance et la partie est perdue. Le delai de trente secondes couvre une coupure, pas une panne generale.
- **Rien n'authentifie un joueur** : le relais croit les messages qu'il reçoit, sauf l'identifiant, qu'il attribue lui-même. Entre amis, cela suffit.
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
