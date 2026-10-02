/**
 * Tests de l'adversaire artificiel.
 *
 * La decision etant pure, on peut lui presenter un plateau fabrique et verifier
 * ce qu'elle en fait — ce qu'aucune partie observee ne prouverait, une IA qui
 * joue mal restant tres difficile a distinguer d'une IA malchanceuse.
 *
 * Les tirages sont fournis par le test : rien ici ne depend de Math.random.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { COLS, PIECES, ROWS, STATUS } from '../src/engine/constants.js';
import { createState, reduce } from '../src/engine/state.js';
import { choisir, evaluer, formes, placements, prochaineAction } from '../src/ai/player.js';
import { drawGarbageColumns } from '../src/net/garbage.js';

const SEED = 12345;

/** Un etat avec la piece voulue et une grille fabriquee ligne par ligne. */
function plateau(type, lignes = []) {
  const state = createState(SEED);
  const grid = state.grid.map((row) => row.slice());

  // Les lignes sont donnees du bas vers le haut : « ..####.... » se lit comme on
  // la verrait a l'ecran.
  lignes.forEach((ligne, depuisLeBas) => {
    const y = ROWS - 1 - depuisLeBas;
    [...ligne].forEach((caractere, x) => {
      grid[y][x] = caractere === '.' ? null : PIECES.T.color;
    });
  });

  const piece = PIECES[type];
  return {
    ...state,
    grid,
    current: {
      type,
      color: piece.color,
      cells: piece.cells.map((row) => row.slice()),
      x: Math.floor((COLS - piece.cells.length) / 2),
      y: 0,
    },
  };
}

describe('formes d une piece', () => {
  it('donne quatre orientations a un T, une seule a un O', () => {
    assert.equal(formes(PIECES.T.cells).length, 4);
    assert.equal(formes(PIECES.O.cells).length, 1);
  });

  it('garde les quatre etats du S, la ou le moteur les distingue', () => {
    // Le moteur tourne la matrice, pas la forme : un S remis a l'endroit occupe
    // d'autres cases de sa matrice 3x3. Les deux etats se posent au meme endroit
    // — la chute rattrape le decalage — mais rien ne gagne a les confondre ici.
    assert.equal(formes(PIECES.S.cells).length, 4);
  });
});

describe('evaluation d un plateau', () => {
  it('prefere le plateau vide au plateau charge', () => {
    const vide = plateau('T').grid;
    const charge = plateau('T', ['##########'.replace(/#/g, '#')]).grid;

    assert.ok(evaluer(vide, 0) > evaluer(charge, 0));
  });

  it('penalise une case couverte plus qu une case posee', () => {
    // Meme nombre de cases, mais la seconde en coiffe une vide.
    const plat = plateau('T', ['#.........', '..........']).grid;
    const troue = plateau('T', ['..........', '#.........']).grid;

    assert.ok(evaluer(plat, 0) > evaluer(troue, 0));
  });

  it('paie les lignes effacees', () => {
    const grid = plateau('T').grid;
    assert.ok(evaluer(grid, 4) > evaluer(grid, 0));
  });
});

describe('placements possibles', () => {
  it('ne propose que des poses qui tiennent sur le plateau', () => {
    const state = plateau('T', ['#####.....', '###.......']);

    for (const place of placements(state)) {
      assert.ok(place.x + place.cells.length > 0, 'la piece touche le plateau');
      assert.ok(place.y >= 0 && place.y < ROWS, `pose hors plateau : y=${place.y}`);

      // Chaque case pleine de la pose est dans la grille, et sur une case libre.
      place.cells.forEach((ligne, dy) => ligne.forEach((valeur, dx) => {
        if (!valeur) return;
        const y = place.y + dy;
        const x = place.x + dx;
        assert.ok(y >= 0 && y < ROWS && x >= 0 && x < COLS, 'case hors plateau');
        assert.equal(state.grid[y][x], null, 'case deja occupee');
      }));
    }
  });

  it('couvre les dix colonnes sur un plateau vide', () => {
    const vus = new Set();
    for (const place of placements(plateau('O'))) vus.add(place.x);
    assert.equal(vus.size, COLS - 1); // le O fait deux cases de large
  });

  it('ne propose rien quand la piece est deja coincee', () => {
    // Plateau plein jusqu au plafond : aucune pose n'existe.
    const state = plateau('T', Array.from({ length: ROWS }, () => '##########'));
    assert.deepEqual(placements(state), []);
  });
});

describe('choix du placement', () => {
  it('complete la ligne quand elle est a portee', () => {
    // Une rangee a laquelle il manque les deux dernieres cases, et un O pour les
    // combler : le meilleur coup est evident, et il efface.
    const state = plateau('O', ['########..']);
    const place = choisir(state, { adresse: 1 });

    assert.equal(place.lignes, 1);
    assert.equal(place.x, 8);
  });

  it('pose a plat plutot que de creuser un trou', () => {
    // Un I sur un plateau vide ne doit pas se dresser a la verticale.
    const state = plateau('I');
    const place = choisir(state, { adresse: 1 });
    const hauteurPose = place.cells.filter((ligne) => ligne.some(Boolean)).length;

    assert.equal(hauteurPose, 1, 'le I reste couche');
  });

  it('se trompe quand l adresse le veut, et jamais quand elle vaut 1', () => {
    const state = plateau('O', ['########..']);

    // Tirage force : le premier appel decide de bien jouer ou non, le second
    // choisit le placement rate.
    const rate = choisir(state, { adresse: 0, alea: () => 0 });
    const applique = choisir(state, { adresse: 1, alea: () => 0.999 });

    assert.notEqual(rate.x, 8, 'le tirage a bien detourne du meilleur coup');
    assert.equal(applique.x, 8, 'a adresse 1, aucun tirage ne detourne');
  });

  it('renvoie null plutot que de lever quand rien ne tient', () => {
    const state = plateau('T', Array.from({ length: ROWS }, () => '##########'));
    assert.equal(choisir(state, { adresse: 1 }), null);
  });
});

describe('suite d actions vers le placement', () => {
  it('tourne d abord, vise ensuite, lache enfin', () => {
    const state = plateau('I');
    const cible = { cells: formes(PIECES.I.cells)[1], x: 0, y: 0, lignes: 0, note: 0 };

    // Orientation differente : la rotation passe avant tout.
    assert.equal(prochaineAction(state, cible).type, 'rotate');

    // Bonne orientation, mauvaise colonne : on se deplace vers elle.
    const tourne = { ...state, current: { ...state.current, cells: cible.cells } };
    const mouvement = prochaineAction(tourne, cible);
    assert.equal(mouvement.type, 'move');
    assert.equal(mouvement.dx, -1, 'la cible est a gauche');

    // Tout est en place : il ne reste qu a lacher.
    const aligne = { ...tourne, current: { ...tourne.current, x: cible.x } };
    assert.equal(prochaineAction(aligne, cible).type, 'hardDrop');
  });

  it('lache la piece quand il n y a plus de cible', () => {
    assert.equal(prochaineAction(plateau('T'), null).type, 'hardDrop');
  });

  it('mene la piece au placement vise en quelques actions', () => {
    // La boucle du pilote, en miniature : rejuger l'action a chaque coup doit
    // finir par poser la piece, et non tourner en rond.
    let state = plateau('O', ['########..']);
    const cible = choisir(state, { adresse: 1 });
    const lignesAvant = state.lines;

    let garde = 0;
    while (state.lines === lignesAvant && garde++ < 20) {
      state = reduce(state, prochaineAction(state, cible));
    }

    assert.ok(garde < 20, 'la piece a ete posee sans tourner en rond');
    assert.equal(state.lines, lignesAvant + 1, 'la ligne visee est bien partie');
  });

  it('ne joue jamais une action inconnue du moteur', () => {
    const connues = new Set(['move', 'rotate', 'softDrop', 'hardDrop']);
    let state = plateau('S', ['#####.....', '##........']);

    for (let i = 0; i < 40; i++) {
      const action = prochaineAction(state, choisir(state, { adresse: 1 }));
      assert.ok(connues.has(action.type), `action inconnue : ${action.type}`);
      state = reduce(state, action);
      if (state.status !== STATUS.PLAYING) break;
    }
  });
});

describe('une partie entiere jouee par l IA', () => {
  it('tient longtemps sans mourir quand elle joue au mieux', () => {
    // Le seul test qui juge la qualite du jeu, et il la juge grossierement :
    // survivre a deux cents pieces sur un plateau de vingt rangees demande de ne
    // pas empiler n'importe ou. C'est une garantie faible, mais elle attraperait
    // une evaluation inversee ou des poids melanges.
    let state = createState(SEED);
    let pieces = 0;

    while (pieces < 200 && state.status === STATUS.PLAYING) {
      const cible = choisir(state, { adresse: 1 });
      const avant = state.next;

      let garde = 0;
      while (state.next === avant && state.status === STATUS.PLAYING && garde++ < 20) {
        state = reduce(state, prochaineAction(state, cible));
      }
      pieces++;
    }

    assert.equal(state.status, STATUS.PLAYING, `morte apres ${pieces} pieces`);
    assert.ok(state.lines >= 60, `trop peu de lignes : ${state.lines}`);
  });

  it('finit par mourir quand elle joue n importe ou', () => {
    // L'inverse, qui vaut autant : une adresse basse doit vraiment faire perdre,
    // sinon le reglage ne servirait a rien pour essayer les eliminations.
    let state = createState(SEED);
    let alea = createRngTest(7);
    let pieces = 0;

    while (pieces < 300 && state.status === STATUS.PLAYING) {
      const cible = choisir(state, { adresse: 0, alea });
      let garde = 0;
      const avant = state.next;
      while (state.next === avant && state.status === STATUS.PLAYING && garde++ < 20) {
        state = reduce(state, prochaineAction(state, cible));
      }
      pieces++;
    }

    assert.equal(state.status, STATUS.OVER, 'un jeu au hasard doit finir par perdre');
  });
});

/** Petit generateur reproductible, pour que le test au hasard ne varie pas. */
function createRngTest(graine) {
  let x = graine;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

describe('tirage des colonnes de handicap', () => {
  it('tire un bloc par unite envoyee, et rien pour une seule ligne', () => {
    assert.equal(drawGarbageColumns(1, () => 0).length, 0);
    assert.equal(drawGarbageColumns(2, () => 0).length, 5);
    assert.equal(drawGarbageColumns(3, () => 0).length, 10);
    assert.equal(drawGarbageColumns(4, () => 0).length, 20);
  });

  it('ne tire que des colonnes du plateau', () => {
    const alea = createRngTest(3);
    for (const colonne of drawGarbageColumns(4, alea)) {
      assert.ok(Number.isInteger(colonne) && colonne >= 0 && colonne < COLS);
    }
  });

  it('repartit les blocs : une passe ne repete pas une colonne', () => {
    // Dix blocs, donc exactement une passe complete plus rien : chaque colonne
    // doit apparaitre une fois, sinon ils s'empileraient au meme endroit.
    const colonnes = drawGarbageColumns(3, createRngTest(11));
    assert.equal(new Set(colonnes).size, COLS);
  });
});
