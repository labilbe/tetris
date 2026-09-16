'use strict';

const COLS = 10;
const ROWS = 20;
const CELL = 30;

// Chaque piece est une matrice carree : la rotation se fait par transposition.
const PIECES = {
  I: { color: '#4ad9e4', cells: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]] },
  J: { color: '#5a7cf5', cells: [[1, 0, 0], [1, 1, 1], [0, 0, 0]] },
  L: { color: '#f0a03c', cells: [[0, 0, 1], [1, 1, 1], [0, 0, 0]] },
  O: { color: '#f3d13e', cells: [[1, 1], [1, 1]] },
  S: { color: '#63d471', cells: [[0, 1, 1], [1, 1, 0], [0, 0, 0]] },
  T: { color: '#b46ce8', cells: [[0, 1, 0], [1, 1, 1], [0, 0, 0]] },
  Z: { color: '#ef5a6f', cells: [[1, 1, 0], [0, 1, 1], [0, 0, 0]] },
};

const TYPES = Object.keys(PIECES);
const POINTS = [0, 100, 300, 500, 800]; // par nombre de lignes effacees

const boardCanvas = document.getElementById('board');
const boardCtx = boardCanvas.getContext('2d');
const nextCanvas = document.getElementById('next');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const toggleBtn = document.getElementById('toggle');
const restartBtn = document.getElementById('restart');
const overlay = document.getElementById('overlay');
const overlayText = document.getElementById('overlay-text');

/** @type {(string|null)[][]} grille des cases figees, null = vide */
let grid;
let current;
let next;
let score;
let lines;
let level;
let dropCounter;
let lastTime;
let paused;
let gameOver;
let bag = [];

function emptyGrid() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(null));
}

// Sac de 7 pieces : garantit une distribution equilibree.
function nextType() {
  if (bag.length === 0) {
    bag = TYPES.slice();
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
  }
  return bag.pop();
}

function spawn() {
  const type = nextType();
  const piece = PIECES[type];
  return {
    type,
    color: piece.color,
    cells: piece.cells.map((row) => row.slice()),
    x: Math.floor((COLS - piece.cells.length) / 2),
    y: 0,
  };
}

function collides(piece, offsetX = 0, offsetY = 0, cells = piece.cells) {
  for (let y = 0; y < cells.length; y++) {
    for (let x = 0; x < cells[y].length; x++) {
      if (!cells[y][x]) continue;
      const nx = piece.x + x + offsetX;
      const ny = piece.y + y + offsetY;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && grid[ny][nx]) return true;
    }
  }
  return false;
}

function rotate(cells) {
  const size = cells.length;
  const out = Array.from({ length: size }, () => new Array(size).fill(0));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      out[x][size - 1 - y] = cells[y][x];
    }
  }
  return out;
}

function tryRotate() {
  const rotated = rotate(current.cells);
  // Wall kick simple : on decale la piece si la rotation sort du plateau.
  for (const dx of [0, -1, 1, -2, 2]) {
    if (!collides(current, dx, 0, rotated)) {
      current.cells = rotated;
      current.x += dx;
      return;
    }
  }
}

function merge() {
  current.cells.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value) {
        const ny = current.y + y;
        if (ny >= 0) grid[ny][current.x + x] = current.color;
      }
    });
  });
}

function clearLines() {
  let cleared = 0;
  for (let y = ROWS - 1; y >= 0; y--) {
    if (grid[y].every((cell) => cell !== null)) {
      grid.splice(y, 1);
      grid.unshift(new Array(COLS).fill(null));
      cleared++;
      y++; // la ligne qui vient de descendre doit etre reexaminee
    }
  }
  if (cleared > 0) {
    lines += cleared;
    score += POINTS[cleared] * level;
    level = Math.floor(lines / 10) + 1;
    updateStats();
  }
}

function dropInterval() {
  return Math.max(80, 1000 - (level - 1) * 80);
}

function lockPiece() {
  merge();
  clearLines();
  current = next;
  next = spawn();
  drawNext();
  if (collides(current)) {
    gameOver = true;
    showOverlay('Game over');
  }
}

function softDrop() {
  if (collides(current, 0, 1)) {
    lockPiece();
  } else {
    current.y++;
  }
  dropCounter = 0;
}

function hardDrop() {
  let distance = 0;
  while (!collides(current, 0, 1)) {
    current.y++;
    distance++;
  }
  score += distance * 2;
  updateStats();
  lockPiece();
  dropCounter = 0;
}

function move(dx) {
  if (!collides(current, dx, 0)) current.x += dx;
}

function drawCell(ctx, x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
  ctx.strokeStyle = 'rgba(0, 0, 0, .35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
}

function ghostY() {
  let offset = 0;
  while (!collides(current, 0, offset + 1)) offset++;
  return current.y + offset;
}

function drawGridLines() {
  boardCtx.strokeStyle = 'rgba(255, 255, 255, .04)';
  boardCtx.lineWidth = 1;
  for (let x = 1; x < COLS; x++) {
    boardCtx.beginPath();
    boardCtx.moveTo(x * CELL, 0);
    boardCtx.lineTo(x * CELL, ROWS * CELL);
    boardCtx.stroke();
  }
  for (let y = 1; y < ROWS; y++) {
    boardCtx.beginPath();
    boardCtx.moveTo(0, y * CELL);
    boardCtx.lineTo(COLS * CELL, y * CELL);
    boardCtx.stroke();
  }
}

function draw() {
  boardCtx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);
  drawGridLines();

  grid.forEach((row, y) => {
    row.forEach((color, x) => {
      if (color) drawCell(boardCtx, x, y, color);
    });
  });

  if (!gameOver) {
    const gy = ghostY();
    boardCtx.globalAlpha = 0.22;
    current.cells.forEach((row, y) => {
      row.forEach((value, x) => {
        if (value) drawCell(boardCtx, current.x + x, gy + y, current.color);
      });
    });
    boardCtx.globalAlpha = 1;
  }

  current.cells.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value && current.y + y >= 0) {
        drawCell(boardCtx, current.x + x, current.y + y, current.color);
      }
    });
  });
}

function drawNext() {
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const size = next.cells.length;
  const cell = nextCanvas.width / 5;
  const offsetX = (nextCanvas.width - size * cell) / 2;
  const offsetY = (nextCanvas.height - size * cell) / 2;
  next.cells.forEach((row, y) => {
    row.forEach((value, x) => {
      if (!value) return;
      nextCtx.fillStyle = next.color;
      nextCtx.fillRect(offsetX + x * cell, offsetY + y * cell, cell, cell);
      nextCtx.strokeStyle = 'rgba(0, 0, 0, .35)';
      nextCtx.lineWidth = 2;
      nextCtx.strokeRect(offsetX + x * cell + 1, offsetY + y * cell + 1, cell - 2, cell - 2);
    });
  });
}

function updateStats() {
  scoreEl.textContent = score;
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function showOverlay(text) {
  overlayText.textContent = text;
  overlay.hidden = false;
}

function loop(time = 0) {
  const delta = time - lastTime;
  lastTime = time;

  if (!paused && !gameOver) {
    dropCounter += delta;
    if (dropCounter > dropInterval()) softDrop();
    draw();
  }

  requestAnimationFrame(loop);
}

function setPaused(value) {
  if (gameOver) return;
  paused = value;
  toggleBtn.textContent = paused ? 'Reprendre' : 'Pause';
  if (paused) showOverlay('Pause');
  else overlay.hidden = true;
}

function reset() {
  grid = emptyGrid();
  bag = [];
  current = spawn();
  next = spawn();
  score = 0;
  lines = 0;
  level = 1;
  dropCounter = 0;
  lastTime = 0;
  paused = false;
  gameOver = false;
  overlay.hidden = true;
  toggleBtn.textContent = 'Pause';
  updateStats();
  drawNext();
  draw();
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'p' || event.key === 'P') {
    setPaused(!paused);
    return;
  }
  if (paused || gameOver) return;

  switch (event.key) {
    case 'ArrowLeft':
      move(-1);
      break;
    case 'ArrowRight':
      move(1);
      break;
    case 'ArrowDown':
      softDrop();
      score += 1;
      updateStats();
      break;
    case 'ArrowUp':
      tryRotate();
      break;
    case ' ':
      hardDrop();
      break;
    default:
      return;
  }
  event.preventDefault();
  draw();
});

toggleBtn.addEventListener('click', () => setPaused(!paused));
restartBtn.addEventListener('click', reset);

reset();
loop();
