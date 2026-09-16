/**
 * Rendu canvas. Ne connait que l'etat qu'on lui passe : il ne le modifie jamais
 * et ne decide de rien. Remplacable (WebGL, ASCII, plusieurs plateaux cote a
 * cote en multijoueur) sans toucher au moteur.
 */

import { COLS, ROWS, STATUS } from '../engine/constants.js';
import { ghostRow } from '../engine/state.js';

const CELL = 30;
const GHOST_ALPHA = 0.22;
const NEXT_GRID_SPAN = 5; // la zone "piece suivante" fait 5 cases de large

function drawCell(ctx, x, y, color, size) {
  ctx.fillStyle = color;
  ctx.fillRect(x * size, y * size, size, size);
  ctx.strokeStyle = 'rgba(0, 0, 0, .35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x * size + 1, y * size + 1, size - 2, size - 2);
}

function drawGridLines(ctx) {
  ctx.strokeStyle = 'rgba(255, 255, 255, .04)';
  ctx.lineWidth = 1;
  for (let x = 1; x < COLS; x++) {
    ctx.beginPath();
    ctx.moveTo(x * CELL, 0);
    ctx.lineTo(x * CELL, ROWS * CELL);
    ctx.stroke();
  }
  for (let y = 1; y < ROWS; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * CELL);
    ctx.lineTo(COLS * CELL, y * CELL);
    ctx.stroke();
  }
}

/**
 * @param {{ board: HTMLCanvasElement, next: HTMLCanvasElement }} canvases
 */
export function createRenderer({ board, next }) {
  const boardCtx = board.getContext('2d');
  const nextCtx = next.getContext('2d');

  function drawBoard(state) {
    boardCtx.clearRect(0, 0, board.width, board.height);
    drawGridLines(boardCtx);

    state.grid.forEach((row, y) => {
      row.forEach((color, x) => {
        if (color) drawCell(boardCtx, x, y, color, CELL);
      });
    });

    const piece = state.current;

    if (state.status !== STATUS.OVER) {
      const gy = ghostRow(state);
      boardCtx.globalAlpha = GHOST_ALPHA;
      piece.cells.forEach((row, y) => {
        row.forEach((value, x) => {
          if (value) drawCell(boardCtx, piece.x + x, gy + y, piece.color, CELL);
        });
      });
      boardCtx.globalAlpha = 1;
    }

    piece.cells.forEach((row, y) => {
      row.forEach((value, x) => {
        if (value && piece.y + y >= 0) {
          drawCell(boardCtx, piece.x + x, piece.y + y, piece.color, CELL);
        }
      });
    });
  }

  function drawNext(state) {
    nextCtx.clearRect(0, 0, next.width, next.height);
    const piece = state.next;
    const size = next.width / NEXT_GRID_SPAN;
    const offsetX = (next.width - piece.cells.length * size) / 2;
    const offsetY = (next.height - piece.cells.length * size) / 2;

    nextCtx.save();
    nextCtx.translate(offsetX, offsetY);
    piece.cells.forEach((row, y) => {
      row.forEach((value, x) => {
        if (value) drawCell(nextCtx, x, y, piece.color, size);
      });
    });
    nextCtx.restore();
  }

  return {
    /** @param {import('../engine/state.js').GameState} state */
    draw(state) {
      drawBoard(state);
      drawNext(state);
    },
  };
}
