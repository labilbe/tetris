/**
 * Tests de la vue sur les adversaires : l'instantane qui voyage, et la camera
 * qui choisit le plan. Les deux sont purs, donc testables sans navigateur ni
 * serveur — c'est ce qui permet de verifier la politique de cadrage image par
 * image, ce qu'aucun test manuel ne ferait.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { COLS, GARBAGE_COLOR, PIECES, ROWS, STATUS } from '../src/engine/constants.js';
import { createState } from '../src/engine/state.js';
import { NAME_MAX, cleanName, randomName } from '../src/net/protocol.js';
import { decodeBoard, encodeBoard } from '../src/net/snapshot.js';
import { DANGER, ROTATION_MS, automatique, cadrer, createCamera, viser } from '../src/view/camera.js';

const SEED = 12345;

describe('instantane de plateau', () => {
  it('fait l aller-retour sans perdre les couleurs', () => {
    const state = createState(SEED);
    const grid = state.grid.map((row) => row.slice());
    grid[ROWS - 1][0] = PIECES.T.color;
    grid[ROWS - 1][1] = GARBAGE_COLOR;

    const lu = decodeBoard(encodeBoard({ ...state, grid, status: STATUS.OVER }));

    assert.equal(lu.grid[ROWS - 1][0], PIECES.T.color);
    assert.equal(lu.grid[ROWS - 1][1], GARBAGE_COLOR);
    assert.equal(lu.grid[ROWS - 1][2], null);
  });

  it('incruste la piece en cours : sans elle, on ne verrait personne jouer', () => {
    const state = createState(SEED);
    const lu = decodeBoard(encodeBoard(state));

    const occupees = lu.grid.flat().filter(Boolean).length;
    assert.equal(occupees, state.current.cells.flat().filter(Boolean).length);
  });

  it('mesure la hauteur sans la piece en cours', () => {
    // Sinon une piece qui vient d'apparaitre ferait croire a une pile au
    // plafond, et la camera se precipiterait sur un joueur qui va bien.
    const state = createState(SEED);
    assert.equal(encodeBoard(state).hauteur, 0);

    const grid = state.grid.map((row) => row.slice());
    grid[ROWS - 3][4] = GARBAGE_COLOR;
    assert.equal(encodeBoard({ ...state, grid }).hauteur, 3);
  });

  it('refuse ce qui n a pas la bonne forme', () => {
    // Cela vient du reseau, donc de n'importe qui : aucune confiance.
    assert.equal(decodeBoard(null), null);
    assert.equal(decodeBoard({}), null);
    assert.equal(decodeBoard({ rows: ['trop court'] }), null);
    assert.equal(decodeBoard({ rows: Array.from({ length: ROWS }, () => 'x') }), null);
    assert.equal(decodeBoard({ rows: Array.from({ length: ROWS }, () => '.'.repeat(COLS)) }).hauteur, 0);
  });

  it('ignore les lettres inconnues plutot que de rejeter la vignette', () => {
    const rows = Array.from({ length: ROWS }, () => '?'.repeat(COLS));
    const lu = decodeBoard({ rows, hauteur: -5, score: 'x' });

    assert.ok(lu, 'la vignette reste lisible');
    assert.equal(lu.grid.flat().filter(Boolean).length, 0, 'aucune case inventee');
    assert.equal(lu.hauteur, 0, 'une hauteur absurde est ramenee a zero');
    assert.equal(lu.score, 0);
  });
});

describe('camera du multiplex', () => {
  const rival = (id, hauteur = 0, vivant = true) => ({ id, hauteur, vivant });

  it('ouvre sur le premier adversaire', () => {
    const camera = cadrer(createCamera(), [rival('a'), rival('b')], 0);
    assert.equal(camera.focus, 'a');
  });

  it('tourne au bout du temps de plan quand tout le monde va bien', () => {
    let camera = cadrer(createCamera(), [rival('a'), rival('b'), rival('c')], 0);
    const rivaux = [rival('a'), rival('b'), rival('c')];

    camera = cadrer(camera, rivaux, ROTATION_MS - 1);
    assert.equal(camera.focus, 'a', 'le plan tient sa duree');

    camera = cadrer(camera, rivaux, ROTATION_MS);
    assert.equal(camera.focus, 'b');

    camera = cadrer(camera, rivaux, 2 * ROTATION_MS);
    assert.equal(camera.focus, 'c');

    camera = cadrer(camera, rivaux, 3 * ROTATION_MS);
    assert.equal(camera.focus, 'a', 'la rotation boucle');
  });

  it('se porte sur celui qui est en difficulte, et y reste', () => {
    const rivaux = [rival('a'), rival('b', DANGER), rival('c')];
    let camera = cadrer(createCamera(), rivaux, 0);
    assert.equal(camera.focus, 'b');

    // La rotation ne reprend pas tant que la pile est haute.
    camera = cadrer(camera, rivaux, 10 * ROTATION_MS);
    assert.equal(camera.focus, 'b');
  });

  it('prefere la pile la plus haute quand plusieurs sont en danger', () => {
    const rivaux = [rival('a', DANGER), rival('b', DANGER + 3), rival('c', DANGER + 1)];
    assert.equal(cadrer(createCamera(), rivaux, 0).focus, 'b');
  });

  it('reprend la rotation une fois le danger passe', () => {
    let camera = cadrer(createCamera(), [rival('a'), rival('b', DANGER)], 0);
    assert.equal(camera.focus, 'b');

    const calmes = [rival('a'), rival('b')];
    camera = cadrer(camera, calmes, ROTATION_MS);
    assert.equal(camera.focus, 'a');
  });

  it('ne regarde jamais un joueur elimine', () => {
    const camera = cadrer(createCamera(), [rival('a', 0, false), rival('b')], 0);
    assert.equal(camera.focus, 'b');
  });

  it('n a plus de plan quand il ne reste personne', () => {
    const camera = cadrer(createCamera(), [rival('a', 0, false)], 0);
    assert.equal(camera.focus, null);
  });

  it('respecte le choix manuel, meme quand un autre est en danger', () => {
    const rivaux = [rival('a'), rival('b', DANGER + 5)];
    let camera = viser(createCamera(), rivaux, 1, 0);
    assert.equal(camera.mode, 'manuel');
    assert.equal(camera.focus, 'a');

    camera = cadrer(camera, rivaux, 10 * ROTATION_MS);
    assert.equal(camera.focus, 'a', 'la camera ne part pas toute seule');
  });

  it('rend la main a l automatique quand celui qu on regardait sort', () => {
    let camera = viser(createCamera(), [rival('a'), rival('b')], 1, 0);
    camera = cadrer(camera, [rival('a', 0, false), rival('b')], 100);

    assert.equal(camera.mode, 'auto');
    assert.equal(camera.focus, 'b');
  });

  it('fait defiler les joueurs dans les deux sens', () => {
    const rivaux = [rival('a'), rival('b'), rival('c')];
    let camera = viser(createCamera(), rivaux, 1, 0);
    assert.equal(camera.focus, 'a');

    camera = viser(camera, rivaux, 1, 0);
    assert.equal(camera.focus, 'b');

    camera = viser(camera, rivaux, -1, 0);
    assert.equal(camera.focus, 'a');

    camera = viser(camera, rivaux, -1, 0);
    assert.equal(camera.focus, 'c', 'la liste boucle par le bas');
  });

  it('revient a la realisation automatique sur demande', () => {
    const rivaux = [rival('a'), rival('b')];
    let camera = viser(createCamera(), rivaux, 1, 0);
    camera = automatique(camera, 0);

    assert.equal(camera.mode, 'auto');
    camera = cadrer(camera, rivaux, ROTATION_MS);
    assert.equal(camera.focus, 'b', 'la rotation repart');
  });
});

describe('pseudo recu du reseau', () => {
  it('coupe un pseudo trop long', () => {
    assert.equal(cleanName('a'.repeat(50)).length, NAME_MAX);
  });

  it('refuse un nom invisible', () => {
    // Espaces seuls ou caracteres de controle : de quoi se rendre anonyme a
    // l'ecran tout en occupant une ligne.
    assert.equal(cleanName('   '), 'Joueur');
    assert.equal(cleanName('\u0000\u0007'), 'Joueur');
    assert.equal(cleanName(42), 'Joueur');
    assert.equal(cleanName(undefined), 'Joueur');
  });

  it('garde un pseudo normal intact', () => {
    assert.equal(cleanName('Léa'), 'Léa');
    assert.equal(cleanName('  Franck  '), 'Franck');
  });
});

describe('pseudo tire au sort', () => {
  it('suit le tirage, et ne sort jamais de la liste', () => {
    // Les deux bouts du tirage : un hasard mal borne donnerait undefined, donc
    // un champ vide chez le joueur.
    const premier = randomName(() => 0);
    const dernier = randomName(() => 0.999999);

    assert.equal(typeof premier, 'string');
    assert.equal(typeof dernier, 'string');
    assert.notEqual(premier, dernier);
  });

  it('tient dans un pseudo, et traverse le nettoyage sans changer', () => {
    // Un nom propose qui serait tronque ou rejete a l'arrivee ne vaudrait rien :
    // le joueur verrait un nom dans le champ et un autre a l'ecran.
    for (let i = 0; i < 100; i++) {
      const nom = randomName();
      assert.ok(nom.length > 0 && nom.length <= NAME_MAX, `longueur : ${nom}`);
      assert.equal(cleanName(nom), nom);
    }
  });

  it('ne reprend aucun prenom des adversaires artificiels', () => {
    // Sinon un humain et une IA porteraient le meme nom dans le multiplex, et
    // le salon les numeroterait l'un derriere l'autre.
    const bots = new Set(['Nina', 'Sacha', 'Vadim', 'Lena', 'Iouri', 'Sveta', 'Boris', 'Katia']);
    const tires = new Set();
    for (let i = 0; i < 500; i++) tires.add(randomName());

    for (const nom of tires) assert.ok(!bots.has(nom), `${nom} est un nom de bot`);
    assert.ok(tires.size > 1, 'le tirage propose bien plusieurs noms');
  });
});
