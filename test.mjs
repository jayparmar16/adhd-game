// Runnable check for the pure game logic. Run: node test.mjs
import assert from 'node:assert';
import { aabb, nearMiss, difficulty, runScore, PLAYER_SIZE } from './runner.js';
import { parseVideoId } from './chart.js';
import {
  createBoard, spawnPiece, cellsOf, collides, tryMove, rotate, dropDistance,
  merge, clearLines, fallInterval, COLS, ROWS,
} from './stax.js';
import {
  beatInterval, nearestBeatOffset, judge, windowFor, bpmForLevel, easeFor,
  START_BPM, MAX_BPM,
} from './pulse.js';
import { par, stepLevel, TICK_S } from './dda.js';
import {
  xpForLevel, levelFromXp, levelProgress, awardXp, isUnlocked, XP,
} from './progress.js';
import {
  defaultAvatar, sanitize, cycle, pose, colorMap, OPTIONS,
} from './avatar.js';
import {
  createRun, speedOf, voidTarget, addMomentum, decayMomentum,
  startJump, cutJump, startDash, startPulse, canDash, canPulse, isInvulnerable,
  resolveHazard, takeHit, makeHazard, ANSWER,
  GROUND_Y, PLAYER_X, MAX_FOCUS, PULSE_COST,
} from './flats.js';

// avatar.colorMap needs a palette; use a stub so tests stay DOM-free
const colorMapOf = a => colorMap(a, {
  black: '#000', white: '#fff', skin: ['#1', '#2', '#3', '#4'],
  suit: ['#1', '#2', '#3', '#4'], hair: ['#1', '#2', '#3', '#4'],
  warm: ['#1', '#2', '#3', '#4'], grey: ['#1', '#2', '#3', '#4'],
  danger: ['#1', '#2', '#3', '#4'], bg: ['#1', '#2', '#3', '#4'], void: ['#1', '#2', '#3', '#4'],
});

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
assert.ok(difficulty(1e6, 60).speed <= 1400, 'speed is capped');
assert.ok(difficulty(1e6, 60).spawnGap >= 0.34, 'spawn gap floored');
assert.ok(difficulty(1e6, 60).maxH <= 0.55, 'obstacle height capped so a gap always remains');

// --- the shared DDA formula (dda.js) ---
{
  assert.equal(TICK_S, 15, 'difficulty re-evaluates every 15s of play');

  // symmetric in log space: double par → +gain, half par → −gain
  assert.equal(stepLevel(10, 200, 100), 13, 'double par → +3');
  assert.equal(stepLevel(10, 50, 100), 7, 'half par → −3');
  assert.equal(stepLevel(10, 100, 100), 10, 'exactly par → unchanged');

  // responsive: a big overperformance jumps several levels in ONE tick
  assert.equal(stepLevel(0, 400, 100), 6, '4× par jumps +6 at once');
  assert.ok(stepLevel(0, 1600, 100) > stepLevel(0, 400, 100), 'better play → bigger jump');

  // small deviations sit in the round() dead band, so it settles
  assert.equal(stepLevel(10, 105, 100), 10, '+5% is within the dead band');
  assert.equal(stepLevel(10, 95, 100), 10, '−5% is within the dead band');

  // clamped, and a scoreless window always eases off
  assert.equal(stepLevel(0, 1, 1e6), 0, 'level floored at 0');
  assert.equal(stepLevel(60, 1e9, 100), 60, 'level ceilinged at 60');
  assert.equal(stepLevel(10, 0, 100), 7, 'scored nothing → ease off');

  // par rises with level, so staying ahead requires improving
  assert.ok(par(10, 100) > par(0, 100), 'par climbs with level');
  assert.equal(par(0, 100), 100, 'par at level 0 is the base');
}

// --- FLUX starts at a medium difficulty, not a gentle one ---
assert.ok(difficulty(0, 0).speed >= 400, 'level 0 is medium, not slow');
assert.ok(difficulty(0, 40).speed > difficulty(0, 20).speed, 'curve has not saturated by level 20');

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

  assert.ok(fallInterval(10) < fallInterval(0), 'higher level falls faster');
  assert.ok(fallInterval(999) >= 190, 'fall interval floored — load rises, but never frantic');
  assert.ok(fallInterval(0) <= 620, 'level 0 is a medium pace, not a crawl');
}

// --- PULSE: tempo-tap ring ---
{
  const interval = beatInterval(60);
  assert.equal(interval, 1, '60 bpm = 1s beats');
  assert.ok(Math.abs(nearestBeatOffset(0.02, interval)) < 0.03, 'tap just after a beat reads as a small positive offset');
  assert.ok(Math.abs(nearestBeatOffset(0.98, interval)) < 0.03, 'tap just before the next beat reads as a small offset too');
  const slow = windowFor(60);
  assert.equal(judge(0.02, slow), 'perfect', 'inside the perfect window');
  assert.equal(judge(0.15, slow), 'good', 'inside the good window');
  assert.equal(judge(0.4, slow), 'miss', 'outside both windows');

  // the bug this fixes: an ABSOLUTE window gets relatively easier as beats
  // shorten. Windows must shrink with tempo to stay proportionally demanding.
  const fast = windowFor(180);
  assert.ok(fast.good < slow.good, 'faster tempo tightens the window');
  assert.ok(fast.good / beatInterval(180) <= slow.good / beatInterval(60) + 1e-9,
    'window never becomes a LARGER share of the beat as tempo rises');

  // tempo from level, clamped
  assert.equal(bpmForLevel(0), START_BPM, 'level 0 starts at the resting on-ramp');
  assert.ok(bpmForLevel(10) > bpmForLevel(0), 'tempo climbs with level');
  assert.equal(bpmForLevel(999), MAX_BPM, 'tempo capped');

  // anti-frustration slack
  assert.equal(easeFor(1), 0, 'clean play gets no slack');
  assert.ok(easeFor(0.3) > easeFor(0.6), 'a bad patch grants more slack');
  assert.ok(windowFor(120, easeFor(0.3)).good > windowFor(120, 0).good, 'ease widens the window');
}

// --- DIVE: progression (progress.js) ---
{
  assert.equal(levelFromXp(0), 0, 'start at level 0');
  assert.ok(xpForLevel(2) > xpForLevel(1), 'each level costs more than the last');
  assert.equal(levelFromXp(xpForLevel(3)), 3, 'exactly enough xp reaches the level');
  assert.equal(levelFromXp(xpForLevel(3) - 1), 2, 'one short stays below');

  const p = levelProgress(xpForLevel(1));
  assert.ok(p >= 0 && p <= 1, 'progress is a 0..1 fraction');
  assert.equal(levelProgress(xpForLevel(2)), 0, 'progress resets on hitting a level');

  // the whole point of the design: real work must outweigh playing
  assert.ok(XP.focusBlock > XP.mission * 5,
    'a real focus block is worth far more than a mission — the game must not become the procrastination');

  const res = awardXp(0, XP.focusBlock + XP.reflection);
  assert.ok(res.xp > 0 && res.level >= 1, 'a focus block with reflection levels you up from zero');
  assert.ok(res.leveled, 'crossing a boundary reports leveled');
  assert.ok(res.unlocked.length >= 1, 'levelling reports what it unlocked');
  assert.equal(awardXp(0, 0).leveled, false, 'no xp, no level');

  // cosmetic gating
  assert.ok(isUnlocked('visor', 'band', 0), 'starter options are always available');
  assert.ok(!isUnlocked('suit', 'danger', 0), 'later cosmetics are gated at level 0');
  assert.ok(isUnlocked('suit', 'danger', 9), 'and available once earned');
}

// --- DIVE: avatar (avatar.js) ---
{
  const a = defaultAvatar();
  assert.ok(colorMapOf(a), 'default avatar produces a colour map');
  const posed = pose(a, 'run', 0.25);
  assert.ok(posed.parts.length > 0, 'posing yields drawable parts');
  assert.notDeepEqual(pose(a, 'run', 0).parts[1], pose(a, 'run', 0.5).parts[1],
    'the run cycle actually animates between phases');
  assert.notDeepEqual(pose(a, 'run', 0).parts, pose(a, 'jump', 0).parts,
    'jumping uses a different silhouette than running');

  // storage round-trip must never yield a broken character
  const dirty = { name: 'x'.repeat(50), head: 'nope', hair: null, visor: 1, suit: {}, skin: 99, hairColor: 'zzz' };
  const clean = sanitize(dirty);
  assert.ok(clean.name.length <= 10, 'name is clamped');
  assert.ok(OPTIONS.head.includes(clean.head), 'bad head falls back to a valid one');
  assert.ok(OPTIONS.skin.includes(clean.skin), 'bad skin falls back to a valid one');
  assert.deepEqual(sanitize(sanitize(dirty)), clean, 'sanitize is idempotent');

  const cycled = cycle(a, 'hair', 1);
  assert.notEqual(cycled.hair, a.hair, 'cycling changes the option');
  let back = cycle(cycled, 'hair', -1);
  assert.equal(back.hair, a.hair, 'cycling back returns the original');
}

// --- DIVE: the depth contract (flats.js) ---
// Each hazard must have a DIFFERENT correct answer, or the four are reskins of
// one another. This asserts the right verb resolves it and a wrong verb fails.
{
  // the hitbox lives in flats.js now — resolveHazard owns it

  // STATIC: dashing pierces it, jumping into it does not
  {
    const run = createRun(0);
    const h = makeHazard('static', PLAYER_X - 1, 0, () => 0.5);
    h.y = GROUND_Y - h.h;
    assert.equal(resolveHazard(run, h), 'hit', 'walking into static hurts');
    startDash(run);
    assert.equal(resolveHazard(run, h), 'pierce', 'dashing pierces static');
  }

  // MONOLITH: solid even while dashing — must be pulsed
  {
    const run = createRun(0);
    const h = makeHazard('monolith', PLAYER_X - 1, 0, () => 0.5);
    h.y = GROUND_Y - h.h;
    startDash(run);
    assert.equal(resolveHazard(run, h), 'hit',
      'dashing does NOT solve a monolith — this is what makes it distinct from static');
    run.hazards = [h];
    const shattered = startPulse(run);
    assert.equal(shattered, 1, 'pulse shatters the monolith');
    assert.equal(resolveHazard(run, h), 'none', 'shattered monolith is harmless');
  }

  // RIFT: only jumping clears it
  {
    const run = createRun(0);
    const h = makeHazard('rift', PLAYER_X - 1, 0, () => 0.5);
    assert.equal(resolveHazard(run, h), 'fall', 'running into a rift drops you');
    startJump(run);
    run.y = GROUND_Y - 30;
    assert.equal(resolveHazard(run, h), 'none', 'jumping clears the rift');
  }

  // LURE: dashing resists the pull, otherwise it drags you
  {
    const run = createRun(0);
    const h = makeHazard('lure', PLAYER_X - 1, 0, () => 0.5);
    h.y = GROUND_Y - 20;
    assert.equal(resolveHazard(run, h), 'pulled', 'the lure drags an unprotected diver');
    startDash(run);
    assert.equal(resolveHazard(run, h), 'resist', 'dashing breaks the pull');
  }

  // the answers table must stay in step with the behaviour above
  assert.equal(ANSWER.static, 'dash');
  assert.equal(ANSWER.monolith, 'pulse');
  assert.equal(ANSWER.rift, 'jump');
  assert.notEqual(ANSWER.static, ANSWER.monolith, 'static and monolith need different verbs');
}

// --- DIVE: the momentum economy ---
{
  const run = createRun(0);
  const start = run.momentum;
  addMomentum(run, 0.2);
  assert.ok(run.momentum > start, 'good play builds momentum');
  assert.ok(speedOf(run) > speedOf({ ...run, momentum: 0 }), 'momentum makes you faster');
  assert.ok(voidTarget(run) < voidTarget({ ...run, momentum: 0 }),
    'momentum pushes the void further back — momentum IS the safety margin');

  addMomentum(run, 5);
  assert.equal(run.momentum, 1, 'momentum is capped at 1');
  addMomentum(run, -9);
  assert.equal(run.momentum, 0, 'momentum floors at 0');

  const idle = createRun(0);
  const before = idle.momentum;
  decayMomentum(idle, 1);
  assert.ok(idle.momentum < before, 'momentum bleeds — standing still is never stable');

  // resource rules
  const r2 = createRun(0);
  r2.focus = PULSE_COST - 1;
  assert.equal(canPulse(r2), false, 'cannot pulse without focus');
  r2.focus = MAX_FOCUS;
  assert.ok(canPulse(r2), 'can pulse with focus');
  assert.ok(startDash(r2), 'first dash works');
  assert.equal(canDash(r2), false, 'dash respects its cooldown');
  assert.ok(isInvulnerable(r2), 'dashing grants i-frames');

  // a hit costs real momentum
  const r3 = createRun(0);
  addMomentum(r3, 0.5);
  const pre = r3.momentum;
  takeHit(r3);
  assert.ok(r3.momentum < pre - 0.2, 'taking a hit costs serious momentum');

  // variable jump height
  const r4 = createRun(0);
  startJump(r4);
  const full = r4.vy;
  const r5 = createRun(0);
  startJump(r5); cutJump(r5);
  assert.ok(r5.vy > full, 'releasing early clips the jump — height is controllable');
  assert.equal(startJump(r5), false, 'cannot double jump');
}

console.log('all runner / stax / pulse / dive checks passed');
