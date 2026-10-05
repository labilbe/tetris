/**
 * Fabrique les icones PNG de l'application installable.
 *
 * Pourquoi un script plutot que trois fichiers commites : l'icone n'existe
 * qu'une fois, dans favicon.svg, et c'est elle qui doit rester la source. Un
 * PNG retouche a la main finirait par ne plus ressembler au dessin du jeu, et
 * personne ne s'en apercevrait. Ici le dessin est redit en coordonnees, et les
 * trois tailles en sortent ensemble.
 *
 * Pourquoi pas le SVG directement dans le manifeste : Chrome ne retient, pour
 * decider qu'une page est installable, que des icones matricielles. Un PNG de
 * 192 et un de 512 sont le minimum qu'il demande.
 *
 * Aucune dependance : zlib suffit a ecrire un PNG, et le projet tient a ne rien
 * avoir a installer pour se construire.
 *
 *   node scripts/icones.mjs
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Les couleurs de favicon.svg : le fond du panneau, et le cyan de la piece. */
const FOND = [0x1c, 0x1e, 0x29];
const PIECE = [0x4a, 0xd9, 0xe4];

/**
 * La piece S de favicon.svg, dans le meme repere de 32 unites.
 *
 * Les cases font 8 et sont rognees de 0.75 sur chaque bord : c'est l'equivalent
 * du contour de 1.5 couleur du fond que trace le SVG, et c'est ce liset sombre
 * qui fait lire quatre cases plutot qu'un escalier plein.
 */
const CASES = [
  [12, 8], [20, 8], [4, 16], [12, 16],
];
const COTE = 8;
const LISET = 0.75;

/** Quatre sous-echantillons par axe : de quoi lisser les arrondis. */
const FINESSE = 4;

/** CRC-32, comme le PNG l'exige a la fin de chaque bloc. */
const TABLE_CRC = Array.from({ length: 256 }, (_, octet) => {
  let valeur = octet;
  for (let bit = 0; bit < 8; bit += 1) {
    valeur = valeur & 1 ? 0xedb88320 ^ (valeur >>> 1) : valeur >>> 1;
  }
  return valeur >>> 0;
});

function crc32(octets) {
  let reste = 0xffffffff;
  for (const octet of octets) reste = TABLE_CRC[(reste ^ octet) & 0xff] ^ (reste >>> 8);
  return (reste ^ 0xffffffff) >>> 0;
}

function bloc(type, donnees) {
  const entete = Buffer.alloc(4);
  entete.writeUInt32BE(donnees.length);
  const corps = Buffer.concat([Buffer.from(type, 'ascii'), donnees]);
  const empreinte = Buffer.alloc(4);
  empreinte.writeUInt32BE(crc32(corps));
  return Buffer.concat([entete, corps, empreinte]);
}

/**
 * Encode un tableau RGBA en PNG.
 *
 * Filtre 0 sur chaque ligne (aucun), ce que zlib comprime tres bien sur des
 * aplats : ces icones pesent quelques centaines d'octets.
 */
function encoderPng(pixels, taille) {
  const lignes = Buffer.alloc((taille * 4 + 1) * taille);
  for (let y = 0; y < taille; y += 1) {
    const debut = y * (taille * 4 + 1);
    lignes[debut] = 0;
    pixels.copy(lignes, debut + 1, y * taille * 4, (y + 1) * taille * 4);
  }

  const entete = Buffer.alloc(13);
  entete.writeUInt32BE(taille, 0);
  entete.writeUInt32BE(taille, 4);
  entete[8] = 8;   // 8 bits par canal
  entete[9] = 6;   // RGBA
  entete[10] = 0;  // compression deflate
  entete[11] = 0;  // filtrage standard
  entete[12] = 0;  // pas d'entrelacement

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloc('IHDR', entete),
    bloc('IDAT', deflateSync(lignes, { level: 9 })),
    bloc('IEND', Buffer.alloc(0)),
  ]);
}

/** Un rectangle, eventuellement a coins arrondis, dans le repere de 32 unites. */
function dedans(x, y, forme) {
  const { gauche, haut, droite, bas, rayon = 0 } = forme;
  if (x < gauche || x > droite || y < haut || y > bas) return false;
  if (!rayon) return true;

  // Hors des quatre carres d'angle, le rectangle suffit ; dedans, c'est le
  // quart de cercle qui tranche.
  const dx = x < gauche + rayon ? gauche + rayon - x : x > droite - rayon ? x - (droite - rayon) : 0;
  const dy = y < haut + rayon ? haut + rayon - y : y > bas - rayon ? y - (bas - rayon) : 0;
  return dx * dx + dy * dy <= rayon * rayon;
}

/**
 * Peint les formes, de l'arriere vers l'avant, par sur-echantillonnage.
 *
 * @param {number} taille cote de l'image en pixels
 * @param {Array<{forme: object, couleur: number[]}>} couches
 */
function peindre(taille, couches) {
  const pixels = Buffer.alloc(taille * taille * 4);
  const echelle = 32 / taille;
  const pas = echelle / FINESSE;

  for (let py = 0; py < taille; py += 1) {
    for (let px = 0; px < taille; px += 1) {
      for (const { forme, couleur } of couches) {
        let touches = 0;
        for (let sy = 0; sy < FINESSE; sy += 1) {
          for (let sx = 0; sx < FINESSE; sx += 1) {
            const x = (px * FINESSE + sx + 0.5) * pas;
            const y = (py * FINESSE + sy + 0.5) * pas;
            if (dedans(x, y, forme)) touches += 1;
          }
        }
        if (!touches) continue;

        // Fusion classique : la couche de devant recouvre d'autant qu'elle
        // couvre de sous-echantillons.
        const alpha = touches / (FINESSE * FINESSE);
        const base = (py * taille + px) * 4;
        for (let canal = 0; canal < 3; canal += 1) {
          pixels[base + canal] = Math.round(pixels[base + canal] * (1 - alpha) + couleur[canal] * alpha);
        }
        pixels[base + 3] = Math.round(pixels[base + 3] * (1 - alpha) + 255 * alpha);
      }
    }
  }

  return pixels;
}

/**
 * Les couches d'une icone.
 *
 * @param {boolean} masquable Une icone masquable est rognee par le systeme —
 *   en cercle sur Android. Le fond doit donc couvrir tout le carre, sans
 *   arrondi a nous, et la piece se replier dans la zone sure du centre. L'autre
 *   icone, elle, est affichee telle quelle : c'est a elle de porter les coins
 *   arrondis, comme favicon.svg.
 */
function couches(masquable) {
  const fond = masquable
    ? { gauche: 0, haut: 0, droite: 32, bas: 32 }
    : { gauche: 0, haut: 0, droite: 32, bas: 32, rayon: 6 };

  // 0.7 autour du centre : la zone sure d'une icone masquable est le disque des
  // 80 % centraux, et la piece la plus large (24 unites sur 32) y entre a cette
  // reduction.
  const reduction = masquable ? 0.7 : 1;
  const place = (valeur) => 16 + (valeur - 16) * reduction;

  return [
    { forme: fond, couleur: FOND },
    ...CASES.map(([x, y]) => ({
      forme: {
        gauche: place(x + LISET),
        haut: place(y + LISET),
        droite: place(x + COTE - LISET),
        bas: place(y + COTE - LISET),
      },
      couleur: PIECE,
    })),
  ];
}

const demandes = [
  { fichier: 'assets/icone-192.png', taille: 192, masquable: false },
  { fichier: 'assets/icone-512.png', taille: 512, masquable: false },
  { fichier: 'assets/icone-masquable-512.png', taille: 512, masquable: true },
];

for (const { fichier, taille, masquable } of demandes) {
  const png = encoderPng(peindre(taille, couches(masquable)), taille);
  writeFileSync(join(racine, fichier), png);
  console.log(`${fichier} — ${taille}×${taille}, ${png.length} octets`);
}
