'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#7986cb', // J - indigo
  '#ffb74d', // L - orange
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const nameEntry = document.getElementById('name-entry');
const nameInput = document.getElementById('name-input');
const saveBtn = document.getElementById('save-btn');
const recordsPanel = document.getElementById('records-panel');
const recordsBody = document.getElementById('records-body');
const statsLine = document.getElementById('stats-line');
const clearBtn = document.getElementById('clear-btn');
const clearConfirm = document.getElementById('clear-confirm');

const RECORDS_KEY = 'tetris.records';
const STATS_KEY = 'tetris.stats';
const MAX_RECORDS = 5;

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId, combo, maxCombo;
let pendingRecord = null; // record por guardar al terminar la partida
let savedIndex = -1;      // fila recién guardada (resaltada)

function readStorage(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
}

function writeStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* sin almacenamiento */ }
}

function loadRecords() {
  const data = readStorage(RECORDS_KEY);
  if (!Array.isArray(data)) return [];
  return data
    .filter(r => r && Number.isFinite(r.score))
    .map(r => ({
      name: String(r.name ?? 'Anónimo').slice(0, 12),
      score: r.score, lines: Number(r.lines) || 0, level: Number(r.level) || 1, date: String(r.date ?? ''),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RECORDS);
}

function loadStats() {
  const s = readStorage(STATS_KEY) || {};
  return { bestCombo: Number(s.bestCombo) || 0, maxLines: Number(s.maxLines) || 0 };
}

// posición en el top para una puntuación, o -1 si no entra
function recordPosition(s) {
  if (s <= 0) return -1;
  const recs = loadRecords();
  let pos = recs.findIndex(r => s > r.score);
  if (pos === -1) pos = recs.length;
  return pos < MAX_RECORDS ? pos : -1;
}

function renderRecords() {
  const list = loadRecords();
  let hi = savedIndex;
  if (pendingRecord && (hi = recordPosition(pendingRecord.score)) !== -1) {
    list.splice(hi, 0, { name: '(vos)', score: pendingRecord.score, lines: pendingRecord.lines, level: pendingRecord.level, date: '' });
    list.length = Math.min(list.length, MAX_RECORDS);
  }
  recordsBody.textContent = '';
  if (!list.length) {
    const tr = recordsBody.insertRow();
    const td = tr.insertCell();
    td.colSpan = 6;
    td.className = 'empty';
    td.textContent = 'Sin records todavía';
  }
  list.forEach((r, i) => {
    const tr = recordsBody.insertRow();
    if (i === hi) tr.className = 'highlight';
    [i + 1, r.name, r.score.toLocaleString(), r.lines, r.level, r.date].forEach(v => {
      tr.insertCell().textContent = v;
    });
  });
  const st = loadStats();
  statsLine.textContent = `Mejor combo: ${st.bestCombo} · Líneas máximas: ${st.maxLines}`;
}

function showRecords() {
  clearConfirm.classList.add('hidden');
  clearBtn.classList.remove('hidden');
  renderRecords();
  recordsPanel.classList.remove('hidden');
}

function saveRecord() {
  if (!pendingRecord) return;
  const recs = loadRecords();
  const entry = { ...pendingRecord, name: nameInput.value.trim().slice(0, 12) || 'Anónimo' };
  const pos = recordPosition(entry.score);
  recs.splice(pos === -1 ? recs.length : pos, 0, entry);
  recs.length = Math.min(recs.length, MAX_RECORDS);
  writeStorage(RECORDS_KEY, recs);
  savedIndex = recs.indexOf(entry);
  pendingRecord = null;
  nameEntry.classList.add('hidden');
  renderRecords();
}

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 7) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    combo++;
    maxCombo = Math.max(maxCombo, combo);
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  } else {
    combo = 0;
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  merge();
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = '#22222e';
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  const stats = loadStats();
  stats.bestCombo = Math.max(stats.bestCombo, maxCombo);
  stats.maxLines = Math.max(stats.maxLines, lines);
  writeStorage(STATS_KEY, stats);
  savedIndex = -1;
  pendingRecord = null;
  nameEntry.classList.add('hidden');
  if (recordPosition(score) !== -1) {
    pendingRecord = { score, lines, level, date: new Date().toLocaleDateString('es-AR') };
    nameEntry.classList.remove('hidden');
  }
  restartBtn.textContent = 'Reiniciar';
  showRecords();
  overlay.classList.remove('hidden');
  if (pendingRecord) nameInput.focus();
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  if (gameOver) return;
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  combo = 0;
  maxCombo = 0;
  pendingRecord = null;
  savedIndex = -1;
  nameEntry.classList.add('hidden');
  recordsPanel.classList.add('hidden');
  nameInput.value = '';
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', () => {
  restartBtn.blur();
  saveRecord(); // si quedó un record sin guardar, se guarda con el nombre actual
  init();
});
saveBtn.addEventListener('click', saveRecord);
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveRecord(); });
clearBtn.addEventListener('click', () => {
  clearBtn.classList.add('hidden');
  clearConfirm.classList.remove('hidden');
});
document.getElementById('clear-no').addEventListener('click', () => {
  clearConfirm.classList.add('hidden');
  clearBtn.classList.remove('hidden');
});
document.getElementById('clear-yes').addEventListener('click', () => {
  try { localStorage.removeItem(RECORDS_KEY); localStorage.removeItem(STATS_KEY); } catch (e) { /* sin almacenamiento */ }
  savedIndex = -1;
  showRecords();
});

// pantalla de inicio: el juego arranca al pulsar "Jugar"
gameOver = true;
showRecords();
