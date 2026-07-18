// DIVE — the mode controller. Creator → mission → results.
//
// All UI draws inside the low-res pixel buffer, including menus and the HUD.
// Wrapping a pixel canvas in crisp DOM widgets is a large part of why the
// previous build read as a prototype, so nothing here is HTML chrome.
import {
  createDisplay, clear, rect, rectOutline, ditherRect, drawSprite,
  text, textCenter, textShadow, textWidth, P, VW, VH, CHAR_W,
} from './pixel.js';
import {
  defaultAvatar, randomAvatar, sanitize, cycle, colorMap, pose,
  OPTIONS, NAMES, AVATAR_W, AVATAR_H,
} from './avatar.js';
import {
  createRun, speedOf, voidTarget, addMomentum, decayMomentum,
  startJump, cutJump, startDash, startPulse, canDash, canPulse, isInvulnerable,
  resolveHazard, takeHit, runScore, nextGap, pickHazard, makeHazard, makeShard,
  overlaps, GROUND_Y, PLAYER_X, GRAVITY, MAX_FOCUS, DASH_CD, PULSE_COST, ANSWER,
  HIT_DX, HIT_W, HIT_H,
} from './flats.js';
import { xpForLevel, levelFromXp, levelProgress, awardXp, isUnlocked, XP } from './progress.js';
import { TICK_S, par, stepLevel } from './dda.js';

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const BASE_PAR = 420;   // score expected in one 15s window at level 0

export function initDive({ state, save, startFocus }) {
  const el = id => document.getElementById(id);
  const canvas = el('dive-canvas');
  if (!canvas) return { enter() {}, leave() {} };
  const disp = createDisplay(canvas);
  const ctx = disp.ctx;

  const d = state.dive = state.dive || {};
  d.avatar = sanitize(d.avatar);
  d.xp = d.xp ?? 0;
  d.best = d.best ?? 0;
  d.dives = d.dives ?? 0;
  d.created = d.created ?? false;
  d.level = d.level ?? 0;          // DDA difficulty level (separate from XP level)

  let screen = 'creator';          // creator | brief | play | results
  let run = null;
  let raf = null;
  let lastT = 0;
  let anim = 0;                    // global animation clock
  let touch = matchMedia('(pointer: coarse)').matches;
  let audio = null;
  let tickAt = 0, tickScore = 0, levelFlash = 0;
  let creatorRow = 0;
  let lastResult = null;
  let stars = [];
  const keys = new Set();

  const CREATOR_ROWS = ['head', 'hair', 'visor', 'suit', 'skin', 'hairColor'];
  const ROW_LABEL = { head: 'FACE', hair: 'HAIR', visor: 'VISOR', suit: 'SUIT', skin: 'SKIN', hairColor: 'HAIR COL' };

  // ---------- audio (reuses the tiny WebAudio approach from game.js) ----------
  function ac() {
    if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch {} }
    return audio;
  }
  function blip(freq, dur, type = 'square', vol = 0.08) {
    const a = ac(); if (!a) return;
    const t = a.currentTime;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t); o.stop(t + dur);
  }
  const sfxJump = () => blip(420, 0.08, 'square', 0.06);
  const sfxDash = () => blip(680, 0.1, 'sawtooth', 0.05);
  const sfxPulse = () => blip(240, 0.22, 'triangle', 0.09);
  const sfxShard = () => blip(1180, 0.06, 'square', 0.05);
  const sfxHit = () => blip(120, 0.24, 'sawtooth', 0.1);
  const sfxUi = () => blip(560, 0.04, 'square', 0.04);

  // ---------- background ----------
  function seedStars() {
    stars = [];
    for (let i = 0; i < 44; i++) {
      stars.push({ x: Math.random() * VW, y: Math.random() * (GROUND_Y - 20), z: 0.2 + Math.random() * 0.8 });
    }
  }
  seedStars();

  function drawBackdrop(scroll) {
    // vertical gradient via dithered bands — stays inside the palette
    clear(ctx, P.bg[0]);
    ditherRect(ctx, 0, 0, VW, 46, P.bg[0], P.bg[1], 0.55);
    ditherRect(ctx, 0, 46, VW, 40, P.bg[1], P.bg[2], 0.5);

    for (const s of stars) {
      const x = ((s.x - scroll * s.z * 0.22) % VW + VW) % VW;
      rect(ctx, x, s.y, 1, 1, s.z > 0.7 ? P.grey[3] : P.grey[2]);
    }
    // far parallax ridge
    for (let i = 0; i < 26; i++) {
      const w = 26;
      const x = ((i * w - scroll * 0.1) % (VW + w) + VW + w) % (VW + w) - w;
      const h = 14 + ((i * 37) % 13);
      rect(ctx, x, GROUND_Y - 34 - h, w - 2, h, P.bg[2]);
    }
    // near parallax ridge — runs down to the floor so there is no dead black
    // band between the skyline and the ground plane
    for (let i = 0; i < 20; i++) {
      const w = 34;
      const x = ((i * w - scroll * 0.28) % (VW + w) + VW + w) % (VW + w) - w;
      const h = 18 + ((i * 53) % 16);
      rect(ctx, x, GROUND_Y - h, w - 3, h + 4, P.bg[3]);
      rect(ctx, x, GROUND_Y - h, w - 3, 1, P.void[1]);
    }
    // haze settling at ground level
    ditherRect(ctx, 0, GROUND_Y - 10, VW, 10, P.bg[3], P.bg[2], 0.5);
  }

  function drawGround(scroll, run) {
    rect(ctx, 0, GROUND_Y, VW, VH - GROUND_Y, P.bg[1]);
    // fade the underground away so the slab recedes instead of sitting flat
    ditherRect(ctx, 0, GROUND_Y + 12, VW, 18, P.bg[1], P.bg[0], 0.5);
    rect(ctx, 0, GROUND_Y + 30, VW, VH - GROUND_Y - 30, P.bg[0]);
    ditherRect(ctx, 0, GROUND_Y, VW, 4, P.bg[3], P.suit[0], 0.5);
    // rift gaps punch through the floor
    if (run) {
      for (const h of run.hazards) {
        if (h.kind === 'rift' && !h.dead) rect(ctx, h.x, GROUND_Y, h.w, VH - GROUND_Y, P.bg[0]);
      }
    }
    for (let i = 0; i < 40; i++) {
      const x = ((i * 11 - scroll * 0.9) % (VW + 11) + VW + 11) % (VW + 11) - 11;
      let onRift = false;
      if (run) for (const h of run.hazards) {
        if (h.kind === 'rift' && !h.dead && x > h.x - 2 && x < h.x + h.w) onRift = true;
      }
      if (!onRift) rect(ctx, x, GROUND_Y + 6 + (i % 3), 3, 1, P.bg[2]);
    }
  }

  // ---------- avatar drawing ----------
  function drawAvatar(avatar, x, y, state, phase, scale = 1) {
    const map = colorMap(avatar, P);
    const p = pose(avatar, state, phase);
    for (const part of p.parts) {
      const m = part.dim ? { ...map, s: map.d, S: map.s } : map;
      if (scale === 1) {
        drawSprite(ctx, part.rows, x + part.x, y + part.y, m);
      } else {
        // integer-scaled draw for the creator preview — still pixel-exact
        for (let ry = 0; ry < part.rows.length; ry++) {
          for (let rx = 0; rx < part.rows[ry].length; rx++) {
            const ch = part.rows[ry][rx];
            if (ch === '.' || ch === ' ') continue;
            const c = m[ch];
            if (!c) continue;
            rect(ctx, x + (part.x + rx) * scale, y + (part.y + ry) * scale, scale, scale, c);
          }
        }
      }
    }
  }

  // ---------- creator ----------
  function drawCreator() {
    drawBackdrop(anim * 8);
    drawGround(anim * 8, null);

    rect(ctx, 0, 0, VW, 16, P.bg[0]);
    textShadow(ctx, d.created ? 'YOUR DIVER' : 'CREATE YOUR DIVER', 8, 5, P.suit[3]);

    // preview panel
    rect(ctx, 12, 24, 92, 108, P.bg[1]);
    rectOutline(ctx, 12, 24, 92, 108, P.suit[1]);
    drawAvatar(d.avatar, 32, 40, 'run', (anim * 2) % 1, 4);
    textCenter(ctx, d.avatar.name, 58, 118, P.warm[3]);

    // options list
    const ox = 116, oy = 28;
    CREATOR_ROWS.forEach((key, i) => {
      const y = oy + i * 15;
      const sel = i === creatorRow;
      if (sel) rect(ctx, ox - 3, y - 3, 192, 13, P.bg[3]);
      text(ctx, ROW_LABEL[key], ox, y, sel ? P.white : P.grey[3]);
      const val = String(d.avatar[key]);
      const locked = !isUnlocked(key, d.avatar[key], levelFromXp(d.xp));
      text(ctx, sel ? '<' : ' ', ox + 58, y, P.suit[3]);
      text(ctx, val, ox + 68, y, locked ? P.danger[2] : P.warm[2]);
      text(ctx, sel ? '>' : ' ', ox + 68 + textWidth(val) + 6, y, P.suit[3]);
    });

    const by = oy + CREATOR_ROWS.length * 15 + 6;
    drawButton('RANDOM', ox, by, 60, 'random');
    drawButton('NAME', ox + 66, by, 48, 'name');
    drawButton(d.created ? 'DIVE >' : 'BEGIN >', ox, by + 18, 126, 'begin', true);

    const lvl = levelFromXp(d.xp);
    text(ctx, `LEVEL ${lvl}`, 12, 140, P.suit[3]);
    drawXpBar(12, 150, 120);
    text(ctx, touch ? 'TAP TO CHANGE' : 'ARROWS + ENTER', 12, 162, P.grey[2]);
  }

  const buttons = [];
  function drawButton(label, x, y, w, id, primary = false) {
    const h = 13;
    rect(ctx, x, y, w, h, primary ? P.suit[1] : P.bg[3]);
    rectOutline(ctx, x, y, w, h, primary ? P.suit[3] : P.grey[2]);
    textCenter(ctx, label, x + w / 2, y + 3, primary ? P.white : P.grey[3]);
    buttons.push({ x, y, w, h, id });
  }

  function drawXpBar(x, y, w) {
    rect(ctx, x, y, w, 5, P.bg[0]);
    rectOutline(ctx, x, y, w, 5, P.grey[1]);
    const p = levelProgress(d.xp);
    rect(ctx, x + 1, y + 1, Math.max(0, Math.round((w - 2) * p)), 3, P.warm[2]);
  }

  // ---------- brief ----------
  function drawBrief() {
    drawBackdrop(anim * 10);
    drawGround(anim * 10, null);
    rect(ctx, 24, 30, VW - 48, 116, P.bg[0]);
    rectOutline(ctx, 24, 30, VW - 48, 116, P.suit[1]);
    textCenter(ctx, 'THE FLATS', VW / 2, 40, P.suit[3]);
    const lines = [
      'NOTHING HAPPENS HERE.',
      'THAT IS WHAT MAKES IT DANGEROUS.',
      '',
      'THE VOID TAKES WHAT STOPS MOVING.',
      'KEEP YOUR MOMENTUM UP.',
    ];
    lines.forEach((l, i) => textCenter(ctx, l, VW / 2, 56 + i * 10, i < 2 ? P.grey[3] : P.white));
    const c = controls();
    c.forEach((row, i) => {
      text(ctx, row[0], 44, 112 + i * 10, P.warm[2]);
      text(ctx, row[1], 128, 112 + i * 10, P.grey[3]);
    });
    drawButton('DIVE >', VW / 2 - 32, 148, 64, 'dive', true);
  }

  function controls() {
    return touch
      ? [['TAP RIGHT', 'JUMP'], ['TAP LEFT', 'DASH'], ['PULSE BTN', 'SHATTER']]
      : [['SPACE', 'JUMP'], ['SHIFT/X', 'DASH'], ['Z', 'PULSE']];
  }

  // ---------- mission ----------
  function startRun() {
    run = createRun(d.level);
    d.dives++;
    tickAt = TICK_S; tickScore = 0;
    screen = 'play';
    lastT = performance.now();
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function spawnAhead() {
    const worldEnd = run.dist + VW + 40;
    while (run.spawnAt < worldEnd) {
      const kind = pickHazard(run.level, Math.random);
      run.hazards.push(makeHazard(kind, run.spawnAt - run.dist + PLAYER_X, run.level));
      if (Math.random() < 0.62) {
        run.shards.push(makeShard(run.spawnAt - run.dist + PLAYER_X + 24 + Math.random() * 20));
      }
      run.spawnAt += nextGap(run.level, Math.random);
    }
  }

  function stepRun(dt) {
    if (run.dead) return;
    const slow = run.slowmo > 0 ? 0.45 : 1;
    if (run.slowmo > 0) run.slowmo = Math.max(0, run.slowmo - dt);
    const sdt = dt * slow;

    run.t += sdt;
    const spd = speedOf(run);
    const move = spd * sdt;
    run.dist += move;

    decayMomentum(run, sdt);
    run.focus = Math.min(MAX_FOCUS, run.focus + (8 + run.momentum * 14) * sdt);
    if (run.dashT > 0) run.dashT = Math.max(0, run.dashT - dt);
    if (run.dashCd > 0) run.dashCd = Math.max(0, run.dashCd - dt);
    if (run.hitFlash > 0) run.hitFlash = Math.max(0, run.hitFlash - dt);
    if (run.pulseFx > 0) run.pulseFx = Math.max(0, run.pulseFx - dt);

    // physics
    run.vy += GRAVITY * sdt;
    run.y += run.vy * sdt;
    if (run.y >= GROUND_Y) {
      // only land if not over an open rift
      let overRift = false;
      for (const h of run.hazards) {
        if (h.kind === 'rift' && !h.dead && PLAYER_X + HIT_DX + HIT_W > h.x + 1 && PLAYER_X + HIT_DX < h.x + h.w - 1) overRift = true;
      }
      if (!overRift) {
        run.y = GROUND_Y; run.vy = 0; run.grounded = true;
        if (run.state === 'jump' || run.state === 'fall') run.state = 'run';
      } else if (run.y > VH + 20) {
        takeHit(run); sfxHit();
        run.y = GROUND_Y - 40; run.vy = 0;
      }
    } else {
      run.grounded = false;
      if (run.state !== 'dash' && run.state !== 'hit') run.state = run.vy < 0 ? 'jump' : 'fall';
    }
    if (run.dashT <= 0 && run.state === 'dash') run.state = run.grounded ? 'run' : 'fall';
    if (run.hitFlash <= 0 && run.state === 'hit') run.state = run.grounded ? 'run' : 'fall';

    // move + resolve world
    for (const h of run.hazards) {
      h.x -= move;
      const res = resolveHazard(run, h);
      if (res === 'hit' && !h.hit) {
        h.hit = true; takeHit(run); sfxHit();
        spark(PLAYER_X + 4, run.y - 8, P.danger[2], 10);
      } else if (res === 'pierce' && !h.scored) {
        h.scored = true; h.dead = true;
        addMomentum(run, 0.12); sfxDash();
        spark(h.x + h.w / 2, h.y + h.h / 2, P.suit[3], 8);
      } else if (res === 'pulled') {
        addMomentum(run, -0.5 * dt);
        run.dist -= h.pull * dt * 0.5;
      } else if (res === 'resist' && !h.scored) {
        h.scored = true; addMomentum(run, 0.1);
      } else if (res === 'fall' && run.grounded) {
        run.grounded = false; run.vy = 40;
      }
      // clean clear = momentum reward, so precision pays
      if (!h.scored && !h.dead && h.x + h.w < PLAYER_X && h.kind !== 'lure') {
        h.scored = true;
        addMomentum(run, 0.09);
      }
    }
    run.hazards = run.hazards.filter(h => h.x > -80);

    for (const s of run.shards) {
      s.x -= move;
      // shard pickup uses a generous box — collecting should feel easy
      if (!s.taken && overlaps(PLAYER_X - 1, run.y - AVATAR_H, AVATAR_W + 2, AVATAR_H, s.x, s.y, s.w, s.h)) {
        s.taken = true;
        run.shardsTaken++;
        addMomentum(run, 0.07);
        run.focus = Math.min(MAX_FOCUS, run.focus + 8);
        sfxShard();
        spark(s.x, s.y, P.warm[3], 6);
      }
    }
    run.shards = run.shards.filter(s => s.x > -20 && !s.taken);

    // the void closes on stillness
    const target = voidTarget(run);
    run.voidX += (target - run.voidX) * Math.min(1, dt * 1.6);
    if (run.voidX >= PLAYER_X - 4) endRun();

    run.score = runScore(run);
    spawnAhead();
    stepParticles(dt);

    // shared DDA — same formula the rest of the app uses
    if (run.t >= tickAt) {
      tickAt += TICK_S;
      const scored = run.score - tickScore;
      tickScore = run.score;
      const before = d.level;
      const after = stepLevel(before, scored, par(before, BASE_PAR));
      if (after !== before) {
        d.level = after;
        run.level = after;
        if (after > before) { levelFlash = 1.4; blip(900, 0.14, 'square', 0.08); }
        save();
      }
    }
  }

  function endRun() {
    run.dead = true;
    const score = runScore(run);
    const res = awardXp(d.xp, XP.mission);
    d.xp = res.xp;
    if (score > d.best) d.best = score;
    lastResult = { score, shards: run.shardsTaken, hits: run.hits, leveled: res.leveled, unlocked: res.unlocked, xpGain: XP.mission };
    save();
    sfxHit();
    setTimeout(() => { if (screen === 'play') screen = 'results'; }, 900);
  }

  // ---------- particles ----------
  function spark(x, y, color, n) {
    if (REDUCED) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 20 + Math.random() * 70;
      run.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.3 + Math.random() * 0.3, t: 0, color });
    }
  }
  function stepParticles(dt) {
    for (const p of run.particles) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 180 * dt; }
    run.particles = run.particles.filter(p => p.t < p.life);
  }

  // ---------- mission render ----------
  function drawPlay() {
    drawBackdrop(run.dist);
    drawGround(run.dist, run);

    // the void — a dithered wall of erasure at the left edge
    const vw = Math.max(0, run.voidX + 40);
    if (vw > 4) {
      rect(ctx, 0, 0, vw - 12, VH, P.void[0]);
      ditherRect(ctx, Math.max(0, vw - 12), 0, 12, VH, P.void[0], P.bg[0], 0.5);
      for (let i = 0; i < 10; i++) {
        const y = ((i * 23 + anim * 30) % VH);
        rect(ctx, Math.max(0, vw - 14 + (i % 3)), y, 2, 6, P.void[3]);
      }
    }

    for (const h of run.hazards) drawHazard(h);
    for (const s of run.shards) if (!s.taken) drawShard(s);

    for (const p of run.particles) {
      rect(ctx, p.x, p.y, 1, 1, p.color);
    }

    // player
    const flick = run.hitFlash > 0 && Math.floor(anim * 30) % 2 === 0;
    if (!flick) {
      if (isInvulnerable(run)) {
        for (let i = 1; i <= 3; i++) {
          const gm = colorMap(d.avatar, P);
          drawSpriteGhost(d.avatar, PLAYER_X - i * 6, run.y - AVATAR_H, run.state, (anim * 8) % 1, gm);
        }
      }
      drawAvatar(d.avatar, PLAYER_X, run.y - AVATAR_H, run.state, (anim * 8) % 1);
    }
    if (run.pulseFx > 0) {
      const r = (1 - run.pulseFx / 0.3) * 58;
      ringOutline(PLAYER_X + 3, run.y - 8, r, P.suit[3]);
    }

    drawHud();
    if (run.dead) {
      ditherRect(ctx, 0, 0, VW, VH, P.bg[0], P.void[0], 0.6);
      textCenter(ctx, 'TAKEN BY THE VOID', VW / 2, 78, P.danger[2]);
    }
  }

  function drawSpriteGhost(avatar, x, y, st, ph, map) {
    const p = pose(avatar, st, ph);
    for (const part of p.parts) {
      drawSprite(ctx, part.rows, x + part.x, y + part.y, { ...map, o: P.suit[0], s: P.suit[0], S: P.suit[1], d: P.suit[0], k: P.suit[0], K: P.suit[1], h: P.suit[0], H: P.suit[1], v: P.suit[1], g: P.suit[1] });
    }
  }

  function ringOutline(cx, cy, r, color) {
    for (let a = 0; a < 64; a++) {
      const t = (a / 64) * Math.PI * 2;
      rect(ctx, cx + Math.cos(t) * r, cy + Math.sin(t) * r, 1, 1, color);
    }
  }

  function drawHazard(h) {
    if (h.dead) return;
    if (h.kind === 'rift') return;  // drawn as a hole in the floor
    if (h.kind === 'static') {
      for (let i = 0; i < 26; i++) {
        const sx = h.x + ((i * 7 + Math.floor(anim * 40)) % h.w);
        const sy = h.y + ((i * 13 + Math.floor(anim * 25)) % h.h);
        rect(ctx, sx, sy, 2, 1, i % 3 === 0 ? P.danger[3] : P.danger[2]);
      }
      rectOutline(ctx, h.x, h.y, h.w, h.h, P.danger[1]);
    } else if (h.kind === 'monolith') {
      rect(ctx, h.x, h.y, h.w, h.h, P.grey[1]);
      rect(ctx, h.x + 1, h.y + 1, h.w - 2, h.h - 2, P.grey[2]);
      rect(ctx, h.x + 2, h.y + 3, 1, h.h - 6, P.grey[3]);
      rectOutline(ctx, h.x, h.y, h.w, h.h, P.black);
    } else if (h.kind === 'lure') {
      const pulse = 3 + Math.sin(anim * 6) * 2;
      ringOutline(h.x + h.w / 2, h.y + h.h / 2, 12 + pulse, P.void[2]);
      rect(ctx, h.x + 3, h.y + 3, h.w - 6, h.h - 6, P.void[3]);
      rect(ctx, h.x + 5, h.y + 5, h.w - 10, h.h - 10, P.white);
    }
  }

  function drawShard(s) {
    const bob = Math.sin(anim * 5 + s.x * 0.1) * 1.5;
    rect(ctx, s.x + 2, s.y + bob, 1, 5, P.warm[3]);
    rect(ctx, s.x, s.y + 2 + bob, 5, 1, P.warm[3]);
    rect(ctx, s.x + 1, s.y + 1 + bob, 3, 3, P.warm[2]);
  }

  function drawHud() {
    rect(ctx, 0, 0, VW, 14, P.bg[0]);
    textShadow(ctx, `${Math.floor(run.dist / 10)}M`, 4, 4, P.white);
    textShadow(ctx, `${run.shardsTaken}`, 62, 4, P.warm[3]);
    rect(ctx, 54, 5, 5, 5, P.warm[2]);

    // momentum — the core resource, so it gets the most visual weight
    text(ctx, 'MOM', 88, 4, P.grey[3]);
    rect(ctx, 108, 4, 62, 6, P.bg[0]);
    rectOutline(ctx, 108, 4, 62, 6, P.grey[2]);
    const mw = Math.round(60 * run.momentum);
    const mcol = run.momentum > 0.66 ? P.suit[3] : run.momentum > 0.33 ? P.warm[2] : P.danger[2];
    rect(ctx, 109, 5, mw, 4, mcol);

    text(ctx, 'FOC', 178, 4, P.grey[3]);
    rect(ctx, 198, 4, 48, 6, P.bg[0]);
    rectOutline(ctx, 198, 4, 48, 6, P.grey[2]);
    rect(ctx, 199, 5, Math.round(46 * (run.focus / MAX_FOCUS)), 4, canPulse(run) ? P.suit[2] : P.grey[2]);

    textShadow(ctx, `LV${d.level}`, 254, 4, P.suit[3]);
    if (run.dashCd > 0) rect(ctx, 286, 4, Math.round(28 * (1 - run.dashCd / DASH_CD)), 6, P.grey[2]);
    else textShadow(ctx, 'DASH', 286, 4, P.warm[2]);

    if (levelFlash > 0) {
      textCenter(ctx, 'LEVEL UP', VW / 2, 22, P.warm[3]);
    }
    if (touch) drawTouchControls();
  }

  function drawTouchControls() {
    // on-screen buttons, drawn in-palette so they belong to the art
    const y = VH - 26;
    rect(ctx, 4, y, 40, 22, P.bg[0]);
    rectOutline(ctx, 4, y, 40, 22, canDash(run) ? P.suit[2] : P.grey[1]);
    textCenter(ctx, 'DASH', 24, y + 8, canDash(run) ? P.suit[3] : P.grey[2]);

    rect(ctx, VW - 44, y, 40, 22, P.bg[0]);
    rectOutline(ctx, VW - 44, y, 40, 22, P.suit[2]);
    textCenter(ctx, 'JUMP', VW - 24, y + 8, P.suit[3]);

    rect(ctx, VW / 2 - 20, y, 40, 22, P.bg[0]);
    rectOutline(ctx, VW / 2 - 20, y, 40, 22, canPulse(run) ? P.warm[2] : P.grey[1]);
    textCenter(ctx, 'PULSE', VW / 2, y + 8, canPulse(run) ? P.warm[3] : P.grey[2]);
  }

  // ---------- results ----------
  function drawResults() {
    drawBackdrop(anim * 6);
    drawGround(anim * 6, null);
    rect(ctx, 30, 24, VW - 60, 128, P.bg[0]);
    rectOutline(ctx, 30, 24, VW - 60, 128, P.suit[1]);
    textCenter(ctx, 'DIVE COMPLETE', VW / 2, 32, P.suit[3]);
    drawAvatar(d.avatar, 44, 52, 'run', (anim * 2) % 1, 2);

    const r = lastResult || { score: 0, shards: 0, hits: 0, xpGain: 0 };
    const rows = [
      ['SCORE', String(r.score)],
      ['SHARDS', String(r.shards)],
      ['HITS', String(r.hits)],
      ['XP', `+${r.xpGain}`],
      ['BEST', String(d.best)],
    ];
    rows.forEach(([k, v], i) => {
      text(ctx, k, 108, 52 + i * 11, P.grey[3]);
      text(ctx, v, 190, 52 + i * 11, P.white);
    });

    const lvl = levelFromXp(d.xp);
    text(ctx, `LEVEL ${lvl}`, 108, 112, P.suit[3]);
    drawXpBar(108, 122, 120);
    if (r.unlocked && r.unlocked.length) {
      textCenter(ctx, `UNLOCKED: ${r.unlocked[0].label}`, VW / 2, 132, P.warm[3]);
    } else {
      textCenter(ctx, 'REAL FOCUS WORK EARNS THE MOST XP', VW / 2, 132, P.grey[2]);
    }

    drawButton('AGAIN', 40, 156, 56, 'again');
    drawButton('FOCUS >', 104, 156, 74, 'focus', true);
    drawButton('DIVER', 186, 156, 52, 'creator');
    drawButton('OUT', 246, 156, 34, 'out');
  }

  // ---------- loop ----------
  function frame() {
    raf = requestAnimationFrame(frame);
    const now = performance.now();
    let dt = (now - lastT) / 1000;
    lastT = now;
    if (dt > 0.05) dt = 0.05;
    anim += dt;
    if (levelFlash > 0) levelFlash = Math.max(0, levelFlash - dt);

    buttons.length = 0;
    if (screen === 'creator') drawCreator();
    else if (screen === 'brief') drawBrief();
    else if (screen === 'play') { stepRun(dt); drawPlay(); }
    else if (screen === 'results') drawResults();
    disp.present();
  }

  // ---------- input ----------
  function setTouch(v) { if (touch !== v) touch = v; }

  function onKey(e) {
    if (el('view-dive').classList.contains('hidden')) return;
    setTouch(false);
    if (keys.has(e.code)) return;
    keys.add(e.code);

    if (screen === 'play') {
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault(); if (startJump(run)) sfxJump();
      } else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyX') {
        e.preventDefault(); if (startDash(run)) sfxDash();
      } else if (e.code === 'KeyZ') {
        e.preventDefault(); if (startPulse(run) !== false) sfxPulse();
      } else if (e.code === 'Escape') { toResults(); }
      return;
    }
    if (screen === 'creator') {
      if (e.code === 'ArrowDown') { creatorRow = (creatorRow + 1) % CREATOR_ROWS.length; sfxUi(); }
      else if (e.code === 'ArrowUp') { creatorRow = (creatorRow - 1 + CREATOR_ROWS.length) % CREATOR_ROWS.length; sfxUi(); }
      else if (e.code === 'ArrowLeft') { changeOption(-1); }
      else if (e.code === 'ArrowRight') { changeOption(1); }
      else if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); beginDive(); }
      return;
    }
    if (screen === 'brief' && (e.code === 'Enter' || e.code === 'Space')) { e.preventDefault(); startRun(); }
    if (screen === 'results' && (e.code === 'Enter' || e.code === 'Space')) { e.preventDefault(); startRun(); }
  }
  function onKeyUp(e) {
    keys.delete(e.code);
    if (screen === 'play' && run && (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW')) cutJump(run);
  }

  function changeOption(dir) {
    const key = CREATOR_ROWS[creatorRow];
    const lvl = levelFromXp(d.xp);
    // skip locked options rather than letting the player select them
    let next = cycle(d.avatar, key, dir);
    let guard = 0;
    while (!isUnlocked(key, next[key], lvl) && guard++ < 12) next = cycle(next, key, dir);
    d.avatar = next;
    save(); sfxUi();
  }

  function beginDive() {
    d.created = true;
    save();
    screen = 'brief';
    sfxUi();
  }

  function toResults() {
    if (run && !run.dead) { run.dead = true; endRun(); }
    screen = 'results';
  }

  function hitButton(vx, vy) {
    return buttons.find(b => vx >= b.x && vx <= b.x + b.w && vy >= b.y && vy <= b.y + b.h);
  }

  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    setTouch(e.pointerType === 'touch');
    ac();
    const { x, y } = disp.toVirtual(e.clientX, e.clientY);

    if (screen === 'play') {
      if (touch) {
        const by = VH - 26;
        if (y >= by - 4) {
          if (x < 48) { if (startDash(run)) sfxDash(); return; }
          if (x > VW - 48) { if (startJump(run)) sfxJump(); return; }
          if (x > VW / 2 - 24 && x < VW / 2 + 24) { if (startPulse(run) !== false) sfxPulse(); return; }
        }
        // split the play area: left half dashes, right half jumps
        if (x < VW / 2) { if (startDash(run)) sfxDash(); }
        else { if (startJump(run)) sfxJump(); }
      } else {
        if (startJump(run)) sfxJump();
      }
      return;
    }

    const b = hitButton(x, y);
    if (!b) {
      if (screen === 'creator') {
        // tapping the option list selects/cycles it
        const idx = Math.floor((y - 25) / 15);
        if (x > 113 && idx >= 0 && idx < CREATOR_ROWS.length) {
          if (creatorRow === idx) changeOption(1);
          else { creatorRow = idx; sfxUi(); }
        }
      }
      return;
    }
    sfxUi();
    if (b.id === 'random') { d.avatar = sanitize(randomAvatar()); save(); }
    else if (b.id === 'name') { promptName(); }
    else if (b.id === 'begin') beginDive();
    else if (b.id === 'dive') startRun();
    else if (b.id === 'again') startRun();
    else if (b.id === 'creator') { screen = 'creator'; }
    else if (b.id === 'out') { location.hash = '#/home'; }
    else if (b.id === 'focus') {
      const intention = (el('dive-intention') && el('dive-intention').value.trim()) || '';
      startFocus(intention);
    }
  });
  canvas.addEventListener('pointerup', e => {
    if (screen === 'play' && run && !touch) cutJump(run);
  });

  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', onKeyUp);
  addEventListener('resize', () => { if (!el('view-dive').classList.contains('hidden')) disp.resize(); });

  // Called by app.js when a real focus session finishes — the big XP award.
  function awardFocus(withReflection) {
    const amount = XP.focusBlock + (withReflection ? XP.reflection : 0);
    const res = awardXp(d.xp, amount);
    d.xp = res.xp;
    save();
    return res;
  }

  return {
    enter() {
      document.body.classList.add('in-dive');
      disp.resize();
      screen = d.created ? 'brief' : 'creator';
      lastT = performance.now();
      if (!raf) raf = requestAnimationFrame(frame);
    },
    leave() {
      document.body.classList.remove('in-dive');
      run = null;
      if (raf) { cancelAnimationFrame(raf); raf = null; }
    },
    awardFocus,
  };

  function promptName() {
    const v = prompt('Name your diver (max 10):', d.avatar.name);
    if (v && v.trim()) { d.avatar = sanitize({ ...d.avatar, name: v.trim() }); save(); }
  }
}
