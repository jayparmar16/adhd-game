// STAX — pure gameplay logic for the calm-slot falling-block stacker.
// No DOM, no canvas. Unit-checkable in node (test.mjs).

export const COLS = 10, ROWS = 16;

const SHAPES = {
  I: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
  O: [[1,1],[1,1]],
  T: [[0,1,0],[1,1,1],[0,0,0]],
  S: [[0,1,1],[1,1,0],[0,0,0]],
  Z: [[1,1,0],[0,1,1],[0,0,0]],
  J: [[1,0,0],[1,1,1],[0,0,0]],
  L: [[0,0,1],[1,1,1],[0,0,0]],
};
export const PIECE_TYPES = Object.keys(SHAPES);

function rotateCW(m) {
  const n = m.length;
  const out = Array.from({ length: n }, () => Array(n).fill(0));
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out[x][n - 1 - y] = m[y][x];
  return out;
}

export function spawnPiece(type, rng = Math.random) {
  const t = type || PIECE_TYPES[Math.floor(rng() * PIECE_TYPES.length)];
  const shape = SHAPES[t];
  return { type: t, shape, x: Math.floor((COLS - shape.length) / 2), y: -1 };
}

export function cellsOf(piece) {
  const out = [];
  const n = piece.shape.length;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (piece.shape[y][x]) out.push([piece.x + x, piece.y + y]);
  }
  return out;
}

export function createBoard(cols = COLS, rows = ROWS) {
  return { cols, rows, cells: new Array(cols * rows).fill(0) };
}

export function collides(board, piece) {
  for (const [x, y] of cellsOf(piece)) {
    if (x < 0 || x >= board.cols || y >= board.rows) return true;
    if (y >= 0 && board.cells[y * board.cols + x]) return true;
  }
  return false;
}

export function tryMove(board, piece, dx, dy) {
  const next = { ...piece, x: piece.x + dx, y: piece.y + dy };
  return collides(board, next) ? null : next;
}

// Rotate with a small kick: try in place, then nudge left/right a couple cells.
export function rotate(board, piece) {
  const rotated = { ...piece, shape: rotateCW(piece.shape) };
  for (const dx of [0, -1, 1, -2, 2]) {
    const attempt = { ...rotated, x: rotated.x + dx };
    if (!collides(board, attempt)) return attempt;
  }
  return piece;
}

export function dropDistance(board, piece) {
  let dy = 0;
  while (!collides(board, { ...piece, y: piece.y + dy + 1 })) dy++;
  return dy;
}

export function merge(board, piece) {
  const cells = board.cells.slice();
  for (const [x, y] of cellsOf(piece)) {
    if (y >= 0 && x >= 0 && x < board.cols && y < board.rows) cells[y * board.cols + x] = piece.type;
  }
  return { ...board, cells };
}

export function clearLines(board) {
  const full = [];
  for (let y = 0; y < board.rows; y++) {
    const row = board.cells.slice(y * board.cols, y * board.cols + board.cols);
    if (row.every(Boolean)) full.push(y);
  }
  if (!full.length) return { board, cleared: 0 };
  const keep = [];
  for (let y = 0; y < board.rows; y++) {
    if (!full.includes(y)) keep.push(board.cells.slice(y * board.cols, y * board.cols + board.cols));
  }
  while (keep.length < board.rows) keep.unshift(new Array(board.cols).fill(0));
  return { board: { ...board, cells: keep.flat() }, cleared: full.length };
}

// Gentle DDA: level rises slowly with lines cleared (absorption, not adrenaline).
export function levelFromLines(totalLines) { return Math.floor(totalLines / 6); }
export function fallInterval(level) { return Math.max(320, 850 - level * 45); } // ms
