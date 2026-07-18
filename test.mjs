// Runnable check for the pure game logic. Run: node test.mjs
import assert from 'node:assert';
import { aabb, nearMiss, difficulty, stepSkill, runScore, PLAYER_SIZE } from './runner.js';
import { parseVideoId } from './chart.js';
import {
  createBoard, spawnPiece, cellsOf, collides, tryMove, rotate, dropDistance,
  merge, clearLines, levelFromLines, fallInterval, COLS, ROWS,
} from './stax.js';
import {
  beatInterval, nearestBeatOffset, judge, stepPulse, START_BPM, BASE_WINDOW,
} from './pulse.js';

// --- collision ---
assert.ok(aabb(0, 0, 10, 10, 5, 5, 10, 10), 'overlap');
assert.ok(!aabb(0, 0, 10, 10, 20, 20, 5, 5), 'no overlap');
assert.ok(!aabb(0, 0, 10, 10, 10, 0, 5, 10), 'edge-adjacent is not overlap');

// --- near-miss: player just above an obstacle rising from the floor ---
// player at y=100 (size 22 → bottom 122); obstacle top at y=140 → gap 18 < 26
assert.ok(nearMiss(100, 100, PLAYER_SIZE, 100, 140, 30, 60, 26), 'close pass counts');
// far away vertically → not a near miss
assert.ok(!nearMiss(100, 100, PLAYER_SIZE, 100, 300, 30, 60, 26), 'far pass does not');
// not horizontally overlapping → not a near miss
assert.ok(!nearMiss(100, 100, PLAYER_SIZE, 400, 140, 30, 60, 26), 'no horizontal overlap');
// actually colliding is not a "near" miss (gap <= 0)
assert.ok(!nearMiss(100, 130, PLAYER_SIZE, 100, 140, 30, 60, 26), 'overlap is not near-miss');

// --- difficulty monotonicity ---
const d0 = difficulty(0, 0);
const dFar = difficulty(3000, 0);
const dSkilled = difficulty(0, 10);
assert.ok(dFar.speed > d0.speed, 'faster further out');
assert.ok(dSkilled.speed > d0.speed, 'faster at higher skill');
assert.ok(dFar.spawnGap < d0.spawnGap, 'obstacles closer further out');
assert.ok(difficulty(1e6, 40).speed <= 900, 'speed is capped');
assert.ok(d0.spawnGap >= 0.6, 'spawn gap floored');

// --- DDA staircase: keep runs near ~25s ---
assert.equal(stepSkill(5, 60), 6, 'long survival → harder');
assert.equal(stepSkill(5, 5), 4, 'quick death → easier');
assert.equal(stepSkill(5, 25), 5, 'in-band → unchanged');
assert.equal(stepSkill(0, 1), 0, 'skill floored at 0');
assert.equal(stepSkill(40, 999), 40, 'skill ceilinged at 40');

// --- score ---
assert.equal(runScore(123.9, 200), 323, 'metres floored + near-miss bank');

// --- youtube id parsing ---
assert.equal(parseVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
assert.equal(parseVideoId('https://youtu.be/dQw4w9WgXcQ?t=30'), 'dQw4w9WgXcQ');
assert.equal(parseVideoId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
assert.equal(parseVideoId('https://example.com/nope'), null);
assert.equal(parseVideoId(''), null);

// --- STAX: falling-block stacker ---
{
  const board = createBoard();
  assert.equal(board.cells.length, COLS * ROWS, 'board is COLS x ROWS');

  // O piece at spawn should not collide with an empty board
  const o = spawnPiece('O');
  assert.ok(!collides(board, o), 'fresh piece fits on empty board');

  // move off the left edge should fail
  const atEdge = { ...o, x: 0 };
  assert.equal(tryMove(board, atEdge, -1, 0), null, 'cannot move past the left wall');
  assert.ok(tryMove(board, atEdge, 1, 0), 'can move right from the edge');

  // dropDistance lands on the floor
  const dropped = dropDistance(board, { ...o, y: -1 });
  const landed = { ...o, y: -1 + dropped };
  assert.ok(!collides(board, landed), 'hard-drop position is legal');
  assert.ok(collides(board, { ...landed, y: landed.y + 1 }), 'one row further is not');

  // rotate an I piece twice returns to a fitting shape (kick or no-op, never invalid)
  const i = spawnPiece('I');
  const r1 = rotate(board, i);
  assert.ok(!collides(board, r1), 'rotated I piece still fits');

  // fill the bottom row, clear it
  const full = { ...createBoard(), cells: createBoard().cells.map((c, i) => (i >= (ROWS - 1) * COLS ? 'T' : 0)) };
  const cl = clearLines(full);
  assert.equal(cl.cleared, 1, 'one full row clears');
  assert.ok(cl.board.cells.every(c => !c), 'cleared board is empty again');

  // merge writes the piece's cells into the board
  const placed = merge(createBoard(), { ...o, y: ROWS - 2 });
  assert.ok(placed.cells.some(Boolean), 'merge writes cells');

  assert.ok(levelFromLines(12) > levelFromLines(0), 'level rises with lines cleared');
  assert.ok(fallInterval(10) < fallInterval(0), 'higher level falls faster');
  assert.ok(fallInterval(999) >= 320, 'fall interval floored — stays gentle, never frantic');
}

// --- PULSE: tempo-tap ring ---
{
  const interval = beatInterval(60);
  assert.equal(interval, 1, '60 bpm = 1s beats');
  assert.ok(Math.abs(nearestBeatOffset(0.02, interval)) < 0.03, 'tap just after a beat reads as a small positive offset');
  assert.ok(Math.abs(nearestBeatOffset(0.98, interval)) < 0.03, 'tap just before the next beat reads as a small offset too');
  assert.equal(judge(0.02, BASE_WINDOW), 'perfect', 'inside the perfect window');
  assert.equal(judge(0.1, BASE_WINDOW), 'good', 'inside the good window');
  assert.equal(judge(0.3, BASE_WINDOW), 'miss', 'outside both windows');

  const afterHits = stepPulse(60, BASE_WINDOW, 4, 0);
  assert.equal(afterHits.bpm, 62, 'a 4-hit streak nudges tempo up');
  const afterMisses = stepPulse(100, BASE_WINDOW, 0, 3);
  assert.equal(afterMisses.bpm, 98, 'a 3-miss streak eases tempo back down');
  assert.ok(afterMisses.window.perfect > BASE_WINDOW.perfect, 'miss streak widens the timing window');
  assert.equal(stepPulse(START_BPM, BASE_WINDOW, 0, 3).bpm, START_BPM, 'tempo never drops below the starting bpm');
}

console.log('all runner.js / stax.js / pulse.js checks passed');
