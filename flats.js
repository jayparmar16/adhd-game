// THE FLATS — pure mission logic. No DOM, no canvas, node-testable.
//
// Fiction and mechanic agree here: the Flats is where an understimulated mind
// goes, and the danger is STILLNESS. An erasing void trails you and closes in
// whenever you stop pushing. You cannot idle your way through — which is what
// understimulation actually feels like.
//
// Depth comes from three verbs answering four hazards, tied together by one
// momentum economy that is simultaneously your score, your safety margin and
// your Focus regen.

export const GROUND_Y = 132;     // virtual px — top of the floor
export const PLAYER_X = 72;      // player's fixed screen column

// Deliberately smaller than the 9x16 sprite. A forgiving hitbox is standard
// practice: near-misses read as skill rather than as the game cheating.
export const HIT_DX = 2;
export const HIT_W = 5;
export const HIT_H = 13;
export const GRAVITY = 560;      // px/s^2
export const JUMP_V = -168;      // initial jump velocity
export const JUMP_CUT = 0.45;    // release early → clip upward velocity
export const DASH_TIME = 0.26;   // seconds of dash (also the i-frame window)
export const DASH_CD = 0.62;
export const PULSE_COST = 34;    // Focus spent per pulse
export const PULSE_RADIUS = 58;
export const MAX_FOCUS = 100;

export const HAZARDS = ['static', 'rift', 'monolith', 'lure'];

// Each hazard has exactly one right answer, so there is something to learn.
// This table is the contract the depth check in the tests asserts against.
export const ANSWER = {
  static: 'dash',      // a swarm you must pass THROUGH — jumping does not clear it
  rift: 'jump',        // a gap in the floor
  monolith: 'pulse',   // solid matter; shatter it or route around and lose time
  lure: 'dash',        // drags you sideways; break its pull with a dash
};

export function createRun(level = 0) {
  return {
    t: 0,
    dist: 0,
    y: GROUND_Y,
    vy: 0,
    grounded: true,
    state: 'run',
    dashT: 0, dashCd: 0,
    focus: MAX_FOCUS,
    momentum: 0.35,      // 0..1
    voidX: -70,          // the erasing void, in world-relative px behind player
    hazards: [],
    shards: [],
    particles: [],
    score: 0,
    shardsTaken: 0,
    hits: 0,
    dead: false,
    spawnAt: 120,
    slowmo: 0,
    level,
    hitFlash: 0,
    pulseFx: 0,
  };
}

// Speed rises with momentum and level. Momentum is the moment-to-moment lever;
// level is the session-long DDA (dda.js) turning the whole curve up.
export function speedOf(run) {
  return 76 + run.momentum * 92 + run.level * 3.4;
}

// The void closes when you are slow and falls back when you push. This is the
// pressure that makes idling fatal.
export function voidTarget(run) {
  return -18 - run.momentum * 62;
}

export function addMomentum(run, amount) {
  run.momentum = Math.max(0, Math.min(1, run.momentum + amount));
}

// Momentum bleeds constantly, so standing still is never stable.
export function decayMomentum(run, dt) {
  addMomentum(run, -0.055 * dt);
}

export function canDash(run) { return run.dashCd <= 0 && !run.dead; }
export function canPulse(run) { return run.focus >= PULSE_COST && !run.dead; }
export function isInvulnerable(run) { return run.dashT > 0; }

export function startJump(run) {
  if (run.dead || !run.grounded) return false;
  run.vy = JUMP_V;
  run.grounded = false;
  run.state = 'jump';
  return true;
}

// Releasing the button early clips the rise — variable jump height is the
// difference between one flat verb and a controllable one.
export function cutJump(run) {
  if (run.vy < 0) run.vy *= JUMP_CUT;
}

export function startDash(run) {
  if (!canDash(run)) return false;
  run.dashT = DASH_TIME;
  run.dashCd = DASH_CD;
  run.state = 'dash';
  addMomentum(run, 0.06);
  return true;
}

export function startPulse(run) {
  if (!canPulse(run)) return false;
  run.focus -= PULSE_COST;
  run.pulseFx = 0.3;
  run.slowmo = 0.22;
  let shattered = 0;
  for (const h of run.hazards) {
    if (h.dead) continue;
    if (h.kind !== 'monolith' && h.kind !== 'static') continue;
    if (Math.abs(h.x - PLAYER_X) <= PULSE_RADIUS) {
      h.dead = true;
      shattered++;
      addMomentum(run, 0.07);
    }
  }
  return shattered;
}

// ---- spawning -------------------------------------------------------------

// Higher level → tighter spacing and more of the demanding hazard types.
export function nextGap(level, rand = Math.random) {
  const base = Math.max(52, 116 - level * 2.6);
  return base + rand() * base * 0.55;
}

export function pickHazard(level, rand = Math.random) {
  // early levels lean on jump/dash; monolith and lure phase in as you improve
  const pool = ['rift', 'static'];
  if (level >= 3) pool.push('monolith');
  if (level >= 6) pool.push('lure');
  if (level >= 10) pool.push('static', 'monolith');
  return pool[Math.floor(rand() * pool.length)];
}

export function makeHazard(kind, x, level, rand = Math.random) {
  const h = { kind, x, dead: false, hit: false, scored: false };
  if (kind === 'rift') {
    h.w = 22 + Math.min(26, level * 1.5) + rand() * 12;
    h.y = GROUND_Y; h.h = 48;
  } else if (kind === 'static') {
    h.w = 16 + rand() * 12;
    h.h = 26 + rand() * 10;
    h.y = GROUND_Y - h.h;
  } else if (kind === 'monolith') {
    h.w = 10 + rand() * 6;
    h.h = 34 + rand() * 16;
    h.y = GROUND_Y - h.h;
  } else if (kind === 'lure') {
    h.w = 14; h.h = 14;
    h.y = GROUND_Y - 46 - rand() * 18;
    h.pull = 26 + level * 0.8;
  }
  return h;
}

export function makeShard(x, rand = Math.random) {
  // shards sit in the risky lane — high enough that taking them costs a jump
  return { x, y: GROUND_Y - 20 - rand() * 44, taken: false, w: 5, h: 5 };
}

// ---- collision ------------------------------------------------------------

export function overlaps(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// Resolves the player against one hazard and returns what happened.
// This is where "each hazard has a different answer" is actually enforced.
export function resolveHazard(run, h) {
  if (h.dead) return 'none';
  const pw = HIT_W, ph = HIT_H;
  const px = PLAYER_X + HIT_DX, py = run.y - ph;

  if (h.kind === 'rift') {
    // a gap: you are only safe if you are above it
    const over = px + pw > h.x && px < h.x + h.w;
    if (over && run.grounded) return 'fall';
    return 'none';
  }

  if (h.kind === 'lure') {
    // a field that drags you; dashing breaks the pull, otherwise it steals speed
    if (overlaps(px, py, pw, ph, h.x - 16, h.y - 16, h.w + 32, h.h + 32)) {
      return isInvulnerable(run) ? 'resist' : 'pulled';
    }
    return 'none';
  }

  // static + monolith are solid-ish bodies
  if (overlaps(px, py, pw, ph, h.x, h.y, h.w, h.h)) {
    if (h.kind === 'static') {
      // the whole point of static: dash clears it, jumping does not
      return isInvulnerable(run) ? 'pierce' : 'hit';
    }
    // monolith is solid even while dashing — it must be pulsed or avoided
    return 'hit';
  }
  return 'none';
}

export function takeHit(run) {
  run.hits++;
  run.hitFlash = 0.3;
  addMomentum(run, -0.3);
  run.focus = Math.max(0, run.focus - 12);
  run.state = 'hit';
}

// ---- scoring --------------------------------------------------------------

// Score feeds dda.js, so it must reflect skill rather than time survived.
export function runScore(run) {
  return Math.floor(run.dist * 0.6 + run.shardsTaken * 40 + run.momentum * 120);
}
