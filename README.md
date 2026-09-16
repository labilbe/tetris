# Tetris

Un Tetris jouable dans le navigateur, en HTML/Canvas et JavaScript vanilla. Aucune dépendance, aucun build.

## Lancer le jeu

Ouvrir `index.html` dans un navigateur.

Ou, pour servir les fichiers en local :

```bash
npx serve .
```

## Commandes

| Touche | Action |
| --- | --- |
| ← / → | Déplacer la pièce |
| ↓ | Descente douce (+1 point) |
| ↑ | Rotation |
| Espace | Chute rapide (+2 points par ligne parcourue) |
| P | Pause |

## Règles

- Grille de 10 × 20 cases, 7 pièces classiques (I, J, L, O, S, T, Z).
- Distribution en « sac de 7 » : chaque pièce sort une fois par cycle.
- Score par lignes effacées simultanément : 100 / 300 / 500 / 800, multiplié par le niveau.
- Le niveau augmente toutes les 10 lignes et accélère la descente.
- Une projection translucide indique où la pièce va atterrir.

## Structure

| Fichier | Rôle |
| --- | --- |
| `index.html` | Structure de la page (canvas, panneau, overlay) |
| `style.css` | Mise en page et thème sombre |
| `tetris.js` | Logique du jeu : grille, pièces, collisions, rendu |
