// The Prime games — three flow primers tuned to different ADHD arousal states:
// FLUX (bored/understimulated → action), STAX (racing/wired → visuospatial calm),
// PULSE (foggy/can't-start → rhythmic activation). A 3-question check-in routes
// to the right one; each hands off, primed, to real work. See STRATEGY.md.
import { PLAYER_SIZE, aabb, nearMiss, difficulty, runScore } from './runner.js';
import {
  createBoard, spawnPiece, cellsOf, collides, tryMove, rotate, dropDistance,
  merge, clearLines, fallInterval, COLS, ROWS,
} from './stax.js';
import {
  START_BPM, beatInterval, nearestBeatOffset, judge, bpmForLevel, windowFor, easeFor,
} from './pulse.js';
import { TICK_S, par, stepLevel } from './dda.js';
import { createYTClock } from './yt.js';
import { parseVideoId } from './chart.js';

const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;
const RAIL_PAD = 46;          // px from top/bottom edge to a rail
const GRAVITY = 2600;         // px/s^2
const FLIP_KICK = 120;        // px/s pop on flip, for responsiveness
const NEARMISS_PX = 26;
const PRIME_HINT_S = 150;     // after this much play, nudge toward the handoff

const PIECE_COLORS = { I: '#39d0ff', O: '#f4d47c', T: '#ff2da1', S: '#7bc47f', Z: '#ff4d6d', J: '#7b9bff', L: '#ff9d4d' };

const CHECKIN_QUESTIONS = [
  { q: "How's your engine right now?", opts: [
      { label: 'Racing — wired, can’t slow down', vote: 'stax' },
      { label: 'Flat — bored, nothing grabs', vote: 'flux' },
      { label: 'Heavy — foggy, can’t start', vote: 'pulse' },
  ]},
  { q: "What's your head doing?", opts: [
      { label: 'Too many tabs open', vote: 'stax' },
      { label: 'Hungry for something to happen', vote: 'flux' },
      { label: 'Blank — molasses', vote: 'pulse' },
  ]},
  { q: 'What should the next few minutes do?', opts: [
      { label: 'Calm me down', vote: 'stax' },
      { label: 'Give me a jolt', vote: 'flux' },
      { label: 'Get me rolling', vote: 'pulse' },
  ]},
];
// Per game: why it was picked, what you're trying to DO, and the controls for
// each input kind. `basePar` is the score expected in one 15s tick at level 0.
const GAME_META = {
  flux: {
    title: 'FLUX', why: 'Bored mind → FLUX. Give it real stakes to chase.',
    goal: 'Dodge the neon blocks. Thread them close for bonus points.',
    keys: [['space / click', 'flip gravity']],
    touch: [['tap anywhere', 'flip gravity']],
    basePar: 900,
  },
  stax: {
    title: 'STAX', why: 'Racing mind → STAX. Give the loop something to hold.',
    goal: 'Fill a row to clear it. No game over — just keep stacking.',
    keys: [['← →', 'move'], ['↑', 'rotate'], ['↓', 'soft drop'], ['space', 'hard drop']],
    touch: [['tap left / right', 'move'], ['tap middle', 'rotate'], ['swipe down', 'hard drop']],
    basePar: 150,
  },
  pulse: {
    title: 'PULSE', why: 'Foggy? → PULSE. Small wins, rising tempo, get you rolling.',
    goal: 'Tap the moment the ring meets the dot.',
    keys: [['space / click', 'tap on the beat']],
    touch: [['tap anywhere', 'tap on the beat']],
    basePar: 150,
  },
};

export function initPrime({ state, save, startFocus }) {
  const el = id => document.getElementById(id);
  const canvas = el('game-canvas');
  const ctx = canvas.getContext('2d');
  const subViews = ['prime-checkin', 'prime-setup', 'prime-play', 'prime-peak'];

  const g = state.game = state.game || {};
  g.skill = g.skill ?? 0;
  g.bestScore = g.bestScore ?? 0;
  g.bestDist = g.bestDist ?? 0;
  g.recent = Array.isArray(g.recent) ? g.recent : [];
  g.totalRuns = g.totalRuns ?? 0;
  g.staxLevel = g.staxLevel ?? 0;
  g.staxBest = g.staxBest ?? 0;
  // migrate: older builds persisted a raw bpm instead of a level
  g.pulseLevel = g.pulseLevel ?? (g.pulseBpm ? Math.round((g.pulseBpm - START_BPM) / 6) : 0);
  g.pulseBestCombo = g.pulseBestCombo ?? 0;
  g.checkins = Array.isArray(g.checkins) ? g.checkins : [];

  let W = 720, H = 460;       // logical (CSS px) play size
  let music = null;           // yt background clock (audio only)
  let activeGame = 'flux';    // 'flux' | 'stax' | 'pulse'
  let run = null;             // FLUX state
  let stax = null;            // STAX state
  let pulse = null;           // PULSE state
  let raf = null;
  let lastT = 0;
  let playElapsed = 0;        // seconds of active play this visit
  let shake = 0;
  let hitStop = 0;            // seconds of freeze on crash (FLUX only)
  let audio = null;           // WebAudio for sfx
  let checkinStep = 0;
  let checkinVotes = [];
  let pointerStart = null;
  // Which control set to show. Seeded from the device, then corrected by the
  // first real input — handles touchscreen laptops and tablets with keyboards.
  let touchMode = matchMedia('(pointer: coarse)').matches;
  let tickAt = 0;             // next playElapsed value at which the DDA ticks
  let tickScore = 0;          // score banked at the start of the current window
  let sessionScore = 0;       // monotonic score this visit — drives the DDA
  let levelFlash = 0;         // seconds of "LEVEL UP" flash remaining

  function sub(name) {
    subViews.forEach(v => el(v).classList.toggle('hidden', v !== name));
    document.body.classList.toggle('in-game', name === 'prime-play');
  }

  // ---------- audio (tiny WebAudio sfx) ----------
  function ac() {
    if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch {} }
    return audio;
  }
  function blip(freq, dur, type = 'sine', vol = 0.12) {
    const a = ac(); if (!a) return;
    const t = a.currentTime;
    const o = a.createOscillator(), gain = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(gain).connect(a.destination);
    o.start(t); o.stop(t + dur);
  }
  const sfxFlip = () => blip(520, 0.09, 'triangle', 0.09);
  const sfxNear = () => blip(1200, 0.06, 'sine', 0.06);
  const sfxTick = () => blip(220, 0.05, 'sine', 0.07);
  function sfxCrash() {
    const a = ac(); if (!a) return;
    const t = a.currentTime;
    const o = a.createOscillator(), gain = a.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(320, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.3);
    gain.gain.setValueAtTime(0.16, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(gain).connect(a.destination);
    o.start(t); o.stop(t + 0.33);
  }

  // ---------- check-in (3 questions → route to a game) ----------
  function resetCheckin() {
    checkinStep = 0; checkinVotes = [];
    renderCheckinStep();
  }
  function renderCheckinStep() {
    const q = CHECKIN_QUESTIONS[checkinStep];
    el('checkin-question').textContent = q.q;
    el('checkin-progress').textContent = `${checkinStep + 1} / ${CHECKIN_QUESTIONS.length}`;
    const box = el('checkin-options');
    box.innerHTML = '';
    q.opts.forEach(o => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'checkin-opt';
      b.textContent = o.label;
      b.addEventListener('click', () => answerCheckin(o.vote));
      box.append(b);
    });
  }
  function answerCheckin(vote) {
    checkinVotes.push(vote);
    checkinStep++;
    if (checkinStep >= CHECKIN_QUESTIONS.length) finishCheckin();
    else renderCheckinStep();
  }
  function finishCheckin() {
    const tally = {};
    checkinVotes.forEach(v => { tally[v] = (tally[v] || 0) + 1; });
    const max = Math.max(...Object.values(tally));
    const leaders = Object.keys(tally).filter(k => tally[k] === max);
    const winner = leaders.length === 1 ? leaders[0] : checkinVotes[2]; // 1/1/1 tie → Q3 wins
    logCheckin(winner);
    chooseGame(winner);
  }
  function logCheckin(mode) {
    g.checkins.push({ t: Date.now(), game: mode });
    if (g.checkins.length > 200) g.checkins = g.checkins.slice(-200);
    save();
  }
  el('checkin-skip').addEventListener('click', () => { sub('prime-checkin'); el('checkin-q').classList.add('hidden'); el('checkin-chips').classList.remove('hidden'); });
  el('checkin-chips').querySelectorAll('[data-game]').forEach(b => {
    b.addEventListener('click', () => chooseGame(b.dataset.game));
  });

  // ---------- controls / instructions ----------
  function controlRows(mode) {
    const meta = GAME_META[mode];
    return touchMode ? meta.touch : meta.keys;
  }
  function renderControls() {
    const meta = GAME_META[activeGame];
    el('control-goal').textContent = meta.goal;
    const box = el('control-rows');
    box.innerHTML = '';
    controlRows(activeGame).forEach(([key, action]) => {
      const row = document.createElement('div');
      row.className = 'control-row';
      const k = document.createElement('kbd');
      k.textContent = key;
      const a = document.createElement('span');
      a.textContent = action;
      row.append(k, a);
      box.append(row);
    });
    // compact one-liner for the play screen
    el('game-keys').textContent = controlRows(activeGame)
      .map(([k, a]) => `${k} ${a}`).join(' · ');
  }
  function setTouchMode(isTouch) {
    if (touchMode === isTouch) return;
    touchMode = isTouch;
    renderControls();
  }
  document.addEventListener('keydown', () => setTouchMode(false));

  function chooseGame(mode) {
    activeGame = mode;
    const meta = GAME_META[mode];
    el('game-title').textContent = meta.title;
    el('game-why').textContent = meta.why;
    renderControls();
    el('yt-field').classList.toggle('hidden', mode === 'pulse');
    el('checkin-q').classList.remove('hidden');
    el('checkin-chips').classList.add('hidden');
    sub('prime-setup');
    renderRecent();
  }

  // ---------- setup screen ----------
  function renderRecent() {
    const box = el('recent-songs');
    box.innerHTML = '';
    if (!g.recent.length) return;
    const label = document.createElement('span');
    label.className = 'recent-label'; label.textContent = 'recent:';
    box.append(label);
    g.recent.slice(0, 4).forEach(r => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'recent-chip';
      b.textContent = r.title || r.videoId;
      b.addEventListener('click', () => { el('yt-url').value = `https://youtu.be/${r.videoId}`; startFromSetup(); });
      box.append(b);
    });
  }

  el('prime-play-btn').addEventListener('click', startFromSetup);
  el('yt-url').addEventListener('keydown', e => { if (e.key === 'Enter') startFromSetup(); });
  el('prime-intention').addEventListener('keydown', e => { if (e.key === 'Enter') startFromSetup(); });
  el('retake-checkin').addEventListener('click', e => { e.preventDefault(); sub('prime-checkin'); resetCheckin(); });

  function startFromSetup() {
    el('prime-error').textContent = '';
    ac();  // unlock audio inside the user gesture
    const raw = el('yt-url').value.trim();
    if (raw && activeGame !== 'pulse') {
      const id = parseVideoId(raw);
      if (!id) { el('prime-error').textContent = "That doesn't look like a YouTube link — leave it blank to play without music."; return; }
      startMusic(id);
    }
    // fresh session: the DDA window spans the whole visit, not a single run
    playElapsed = 0;
    sessionScore = 0;
    resetDda();
    startGame(activeGame);
  }

  function startMusic(videoId) {
    stopMusic();
    el('yt-holder').className = 'playing';
    createYTClock(videoId, 'yt-player', {
      onError: () => { el('yt-holder').className = 'hidden'; },
    }).then(m => {
      music = m;
      fetchTitle(videoId);
    }).catch(() => { el('yt-holder').className = 'hidden'; });
  }
  function stopMusic() {
    if (music) { try { music.stop(); } catch {} music = null; }
    el('yt-holder').className = 'hidden';
  }
  function fetchTitle(videoId) {
    fetch(`https://www.youtube.com/oembed?url=https://youtu.be/${videoId}&format=json`)
      .then(r => r.json())
      .then(d => {
        g.recent = [{ videoId, title: d.title }, ...g.recent.filter(r => r.videoId !== videoId)].slice(0, 4);
        save();
      }).catch(() => {});
  }

  // ---------- shared play-mode plumbing ----------
  function beginPlay() {
    sub('prime-play');   // make the container visible first so resize() reads a real width
    resize();
    lastT = performance.now();
    if (!raf) raf = requestAnimationFrame(frame);
  }
  function fillBg() {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#160d2e'); bg.addColorStop(0.55, '#241147'); bg.addColorStop(1, '#0a0618');
    ctx.fillStyle = bg; ctx.fillRect(-20, -20, W + 40, H + 40);
  }
  function startGame(mode) {
    activeGame = mode;
    if (mode === 'flux') startRun();
    else if (mode === 'stax') staxStart();
    else if (mode === 'pulse') pulseStart();
  }

  // ---------- the DDA (see dda.js) ----------
  // One mechanism for all three games: every TICK_S of active play, compare the
  // score earned in that window against par for the current level.
  const LEVEL_KEY = { flux: 'skill', stax: 'staxLevel', pulse: 'pulseLevel' };
  function getLevel() { return g[LEVEL_KEY[activeGame]] || 0; }
  function setLevel(v) { g[LEVEL_KEY[activeGame]] = v; }

  function resetDda() {
    tickAt = playElapsed + TICK_S;
    tickScore = sessionScore;
  }

  function ddaTick() {
    const scored = sessionScore - tickScore;
    tickScore = sessionScore;
    const before = getLevel();
    const after = stepLevel(before, scored, par(before, GAME_META[activeGame].basePar));
    if (activeGame === 'pulse' && pulse) {
      // grant slack after a bad patch, tighten back when playing clean
      pulse.ease = easeFor(pulse.winTaps ? pulse.winHits / pulse.winTaps : 1);
      pulse.winHits = 0; pulse.winTaps = 0;
      setPulseBpm(bpmForLevel(after));   // also refreshes the window with the new ease
    }
    if (after === before) return;
    setLevel(after);
    if (after > before) { levelFlash = 1.2; blip(880, 0.12, 'triangle', 0.10); }
    save();
  }

  // ================= FLUX (bored/understimulated → action) =================
  function startRun() {
    beginPlay();
    const railTop = RAIL_PAD, railBot = H - RAIL_PAD - PLAYER_SIZE;
    run = {
      dist: 0, gravDir: 1, dead: false, deadAt: 0,
      px: W * 0.26, py: railBot, vy: 0,
      railTop, railBot,
      obstacles: [], particles: [], stars: makeStars(),
      spawnTimer: 0, nextGap: 0.8,
      mult: 1, nearBank: 0, sinceNear: 0,
      score: 0, newBest: false,
      grid: 0,
    };
    g.totalRuns++;
    updateHud();
  }

  function die() {
    if (run.dead) return;
    run.dead = true;
    run.deadAt = performance.now();
    run.score = runScore(run.dist, run.nearBank);
    shake = 1; hitStop = 0.09;
    sfxCrash();
    burst(run.px + PLAYER_SIZE / 2, run.py + PLAYER_SIZE / 2, 34, '#ff4d6d');
    if (run.score > g.bestScore) { g.bestScore = run.score; run.newBest = true; }
    if (run.dist > g.bestDist) g.bestDist = Math.floor(run.dist);
    save();   // difficulty itself is handled by the 15s DDA tick, not by dying
    updateHud();
  }

  function retry() {
    // frictionless: keep music playing, keep skill, just relaunch
    startRun();
  }

  function toPeak() {
    const bestDist = g.bestDist;
    el('peak-title').textContent = "You're primed.";
    el('peak-stats').textContent =
      `${Math.floor(run ? run.dist : 0)} m this run · best ${g.bestScore.toLocaleString()} pts · ${bestDist} m furthest · skill ${g.skill}`;
    const intention = el('prime-intention').value.trim();
    el('peak-focus-btn').textContent = intention ? `Start focus: ${intention}` : 'Start a focus block';
    el('peak-nudge').textContent = playElapsed > PRIME_HINT_S
      ? "you're deep in it now — spend this focus on your task before it fades."
      : "caught the wave? best time to start is right now.";
    if (run) { run = null; }
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    sub('prime-peak');
    if (!REDUCED_MOTION) confetti();
  }

  function flip() {
    if (!run) return;
    if (run.dead) {
      // crashed → instant retry (the one-more-go loop); ignore taps during hit-stop
      if (performance.now() - run.deadAt > 180) retry();
      return;
    }
    run.gravDir *= -1;
    run.vy = run.gravDir * FLIP_KICK;
    sfxFlip();
    burst(run.px, run.py + PLAYER_SIZE / 2, 8, '#39d0ff');
  }

  function frameFlux(dt) {
    if (!run) return;
    if (hitStop > 0) { hitStop -= dt; draw(); return; }

    if (!run.dead) {
      run._elapsed = (run._elapsed || 0) + dt;
      const d = difficulty(run.dist, g.skill);
      const gained = d.speed * dt / 8;   // metres (8px ≈ 1m)
      run.dist += gained;
      sessionScore += gained;
      run.grid = (run.grid + d.speed * dt) % 40;

      // physics
      run.vy += GRAVITY * run.gravDir * dt;
      run.py += run.vy * dt;
      if (run.py < run.railTop) { run.py = run.railTop; run.vy = 0; }
      if (run.py > run.railBot) { run.py = run.railBot; run.vy = 0; }

      // spawn
      run.spawnTimer += dt;
      if (run.spawnTimer >= run.nextGap) {
        run.spawnTimer = 0;
        run.nextGap = d.spawnGap * (0.8 + Math.random() * 0.5);
        spawnObstacle(d);
      }

      // move + collide + near-miss
      run.sinceNear += dt;
      for (const o of run.obstacles) {
        o.x -= d.speed * dt;
        if (aabb(run.px, run.py, PLAYER_SIZE, PLAYER_SIZE, o.x, o.y, o.w, o.h)) { die(); break; }
        if (!o.scored && nearMiss(run.px, run.py, PLAYER_SIZE, o.x, o.y, o.w, o.h, NEARMISS_PX)) {
          o.scored = true;
          run.nearBank += 25 * run.mult;
          sessionScore += 25 * run.mult;
          run.mult = Math.min(9, run.mult + 1);
          run.sinceNear = 0;
          sfxNear();
          spark(run.px + PLAYER_SIZE, run.py);
        }
      }
      if (run.sinceNear > 2.4) run.mult = 1;     // multiplier decays if you stop taking risks
      run.obstacles = run.obstacles.filter(o => o.x + o.w > -20);

      // prime nudge (non-blocking)
      if (playElapsed > PRIME_HINT_S && !run._nudged) { run._nudged = true; run.showNudge = 90; }
    }

    updateParticles(dt);
    if (shake > 0) shake = Math.max(0, shake - dt * 3);
    updateHud();
    draw();
  }

  function spawnObstacle(d) {
    const playH = run.railBot - run.railTop + PLAYER_SIZE;
    const h = playH * (0.14 + Math.random() * d.maxH);
    const fromTop = Math.random() < 0.5;
    const w = 20 + Math.random() * 20;
    const y = fromTop ? 0 : H - h;
    run.obstacles.push({ x: W + 10, y, w, h, fromTop, scored: false });
  }

  // FLUX particles
  function burst(x, y, n, color) {
    if (REDUCED_MOTION) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 60 + Math.random() * 260;
      run.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + Math.random() * 0.4, t: 0, color });
    }
  }
  function spark(x, y) {
    if (REDUCED_MOTION) return;
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2, s = 40 + Math.random() * 120;
      run.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.35, t: 0, color: '#fff59d' });
    }
  }
  function trail() {
    if (REDUCED_MOTION || !run || run.dead) return;
    run.particles.push({
      x: run.px, y: run.py + PLAYER_SIZE / 2,
      vx: -120, vy: (Math.random() - 0.5) * 30, life: 0.3, t: 0, color: '#39d0ff',
    });
  }
  function updateParticles(dt) {
    if (!run.dead && Math.random() < 0.7) trail();
    for (const p of run.particles) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 400 * dt; }
    run.particles = run.particles.filter(p => p.t < p.life);
  }
  function makeStars() {
    const s = [];
    for (let i = 0; i < 40; i++) s.push({ x: Math.random(), y: Math.random(), z: 0.3 + Math.random() * 0.7 });
    return s;
  }

  function draw() {
    ctx.save();
    if (shake > 0) {
      const m = shake * 12;
      ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
    }
    fillBg();
    drawGridHorizon();
    drawStars();

    // rails
    ctx.strokeStyle = 'rgba(57,208,255,0.35)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, RAIL_PAD - 4); ctx.lineTo(W, RAIL_PAD - 4);
    ctx.moveTo(0, H - RAIL_PAD + 4); ctx.lineTo(W, H - RAIL_PAD + 4); ctx.stroke();

    if (run) {
      drawParticles();
      drawObstacles();
      drawPlayer();
      if (run.dead) drawDeadOverlay();
      else if (run.showNudge > 0) { run.showNudge--; drawNudge(); }
    }
    drawLevelFlash();
    ctx.restore();
  }

  function drawGridHorizon() {
    const hy = H * 0.5;
    ctx.strokeStyle = 'rgba(255,45,161,0.18)'; ctx.lineWidth = 1;
    const off = run ? run.grid : 0;
    for (let i = -1; i < 20; i++) {
      const x = ((i * 40 - off) % (W + 40));
      ctx.beginPath(); ctx.moveTo(x, hy); ctx.lineTo(x - (x - W / 2) * 1.4, H); ctx.stroke();
    }
    for (let r = 0; r < 8; r++) {
      const y = hy + (H - hy) * (r / 8) * (r / 8);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
  }
  function drawStars() {
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    const off = run ? run.grid : 0;
    for (const s of run.stars || []) {
      const x = ((s.x * W - off * s.z) % W + W) % W;
      ctx.globalAlpha = s.z * 0.6; ctx.fillRect(x, s.y * H * 0.5, 2, 2);
    }
    ctx.globalAlpha = 1;
  }
  function drawObstacles() {
    for (const o of run.obstacles) {
      ctx.save();
      ctx.shadowColor = o.fromTop ? '#ff2da1' : '#39d0ff';
      ctx.shadowBlur = 16;
      ctx.fillStyle = o.fromTop ? '#ff2da1' : '#39d0ff';
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(o.x, o.fromTop ? o.y + o.h - 3 : o.y, o.w, 3);
      ctx.restore();
    }
  }
  function drawPlayer() {
    const x = run.px, y = run.py, s = PLAYER_SIZE;
    ctx.save();
    ctx.shadowColor = '#7bffea'; ctx.shadowBlur = 20;
    ctx.fillStyle = run.dead ? '#ff4d6d' : '#7bffea';
    ctx.fillRect(x, y, s, s);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(x + s * 0.28, y + s * 0.28, s * 0.44, s * 0.44);
    ctx.restore();
  }
  function drawParticles() {
    for (const p of run.particles) {
      const a = 1 - p.t / p.life;
      ctx.globalAlpha = a; ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, 3, 3);
    }
    ctx.globalAlpha = 1;
  }
  function drawDeadOverlay() {
    ctx.fillStyle = 'rgba(10,6,24,0.66)'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
    ctx.font = '600 30px system-ui, sans-serif';
    ctx.fillText(run.newBest ? 'NEW BEST!' : 'CRASHED', W / 2, H / 2 - 18);
    ctx.font = '16px system-ui, sans-serif'; ctx.fillStyle = '#c9c2e8';
    ctx.fillText(`${Math.floor(run.dist)} m · ${run.score.toLocaleString()} pts`, W / 2, H / 2 + 10);
    ctx.fillStyle = '#7bffea';
    ctx.fillText('tap / space to go again', W / 2, H / 2 + 40);
    ctx.textAlign = 'left';
  }
  function drawNudge() {
    ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(244,212,124,0.95)';
    ctx.font = '15px system-ui, sans-serif';
    ctx.fillText("warmed up — hit Stop to ride it into your task", W / 2, 30);
    ctx.textAlign = 'left';
  }

  function updateHud() {
    el('hud-dist').textContent = `${run ? Math.floor(run.dist) : 0} m · lvl ${g.skill}`;
    el('hud-mult').textContent = `×${run ? run.mult : 1}`;
    el('hud-best').textContent = `best ${g.bestScore.toLocaleString()}`;
    el('hud-mult').classList.toggle('hot', !!run && run.mult >= 3);
  }

  // Shown over the canvas whenever the DDA steps you up — makes the escalation felt.
  function drawLevelFlash() {
    if (levelFlash <= 0) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, levelFlash);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f4d47c';
    ctx.font = '700 26px system-ui, sans-serif';
    ctx.fillText(`LEVEL ${getLevel()}`, W / 2, 44);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  // ================= STAX (racing/wired → visuospatial calm) =================
  function staxStart() {
    beginPlay();
    stax = {
      board: createBoard(), piece: spawnPiece(), next: spawnPiece(),
      fallTimer: 0, lines: 0, score: 0, flash: 0,
    };
    g.staxRuns = (g.staxRuns || 0) + 1;
    updateHudStax();
  }

  function staxLockPiece() {
    stax.board = merge(stax.board, stax.piece);
    const cl = clearLines(stax.board);
    stax.board = cl.board;
    if (cl.cleared) {
      const points = [0, 100, 300, 500, 800][cl.cleared] || cl.cleared * 200;
      stax.lines += cl.cleared;
      stax.score += points;
      sessionScore += points;   // feeds the 15s DDA tick
      stax.flash = 0.25;
      sfxNear();
    }
    stax.piece = stax.next;
    stax.next = spawnPiece();
    if (collides(stax.board, stax.piece)) staxTopOut();
  }
  function staxTopOut() {
    // no fail state: soft-clear and keep going. Difficulty is the DDA's job.
    if (stax.lines > g.staxBest) g.staxBest = stax.lines;
    g.staxLevel = Math.max(0, g.staxLevel - 1); // ease back a touch
    save();
    stax.board = createBoard();
    stax.piece = spawnPiece();
    stax.next = spawnPiece();
    stax.flash = 0.4;
  }

  function staxTryMove(dx, dy) {
    const moved = tryMove(stax.board, stax.piece, dx, dy);
    if (moved) { stax.piece = moved; sfxTick(); }
    return moved;
  }
  function staxRotate() { stax.piece = rotate(stax.board, stax.piece); sfxTick(); }
  function staxHardDrop() {
    const dist = dropDistance(stax.board, stax.piece);
    stax.piece = { ...stax.piece, y: stax.piece.y + dist };
    staxLockPiece();
  }
  function staxTap(x) {
    if (!stax) return;
    const third = W / 3;
    if (x < third) staxTryMove(-1, 0);
    else if (x > third * 2) staxTryMove(1, 0);
    else staxRotate();
  }
  function staxKey(e) {
    if (!stax) return;
    if (e.code === 'ArrowLeft')  { e.preventDefault(); staxTryMove(-1, 0); }
    else if (e.code === 'ArrowRight') { e.preventDefault(); staxTryMove(1, 0); }
    else if (e.code === 'ArrowUp') { e.preventDefault(); staxRotate(); }
    else if (e.code === 'ArrowDown') { e.preventDefault(); staxTryMove(0, 1); }
    else if (e.code === 'Space') { e.preventDefault(); staxHardDrop(); }   // parity with swipe-down on touch
  }

  function frameStax(dt) {
    if (!stax) return;
    stax.fallTimer += dt;
    const interval = fallInterval(g.staxLevel) / 1000;
    if (stax.fallTimer >= interval) {
      stax.fallTimer = 0;
      const moved = tryMove(stax.board, stax.piece, 0, 1);
      if (moved) stax.piece = moved;
      else staxLockPiece();
    }
    if (stax.flash > 0) stax.flash = Math.max(0, stax.flash - dt);
    updateHudStax();
    drawStax();
  }

  function drawStax() {
    ctx.save();
    fillBg();
    const cell = Math.min((W - 40) / COLS, (H - 40) / ROWS);
    const boardW = cell * COLS, boardH = cell * ROWS;
    const ox = (W - boardW) / 2, oy = (H - boardH) / 2;
    ctx.strokeStyle = 'rgba(123,255,234,0.1)'; ctx.lineWidth = 1;
    for (let x = 0; x <= COLS; x++) { ctx.beginPath(); ctx.moveTo(ox + x * cell, oy); ctx.lineTo(ox + x * cell, oy + boardH); ctx.stroke(); }
    for (let y = 0; y <= ROWS; y++) { ctx.beginPath(); ctx.moveTo(ox, oy + y * cell); ctx.lineTo(ox + boardW, oy + y * cell); ctx.stroke(); }
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const v = stax.board.cells[y * COLS + x];
      if (v) drawStaxCell(ox + x * cell, oy + y * cell, cell, PIECE_COLORS[v]);
    }
    for (const [x, y] of cellsOf(stax.piece)) {
      if (y >= 0) drawStaxCell(ox + x * cell, oy + y * cell, cell, PIECE_COLORS[stax.piece.type]);
    }
    if (stax.flash > 0) { ctx.fillStyle = `rgba(123,255,234,${stax.flash * 0.5})`; ctx.fillRect(ox, oy, boardW, boardH); }
    drawLevelFlash();
    ctx.restore();
  }
  function drawStaxCell(x, y, s, color) {
    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = REDUCED_MOTION ? 0 : 8;
    ctx.fillStyle = color; ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
    ctx.restore();
  }

  function updateHudStax() {
    el('hud-dist').textContent = `${stax.lines} lines`;
    el('hud-mult').textContent = `lvl ${g.staxLevel}`;
    el('hud-best').textContent = `best ${g.staxBest}`;
    el('hud-mult').classList.toggle('hot', levelFlash > 0);
  }

  function toPeakStax() {
    el('peak-title').textContent = 'Settled.';
    el('peak-stats').textContent = `${stax.lines} lines cleared · best ${Math.max(g.staxBest, stax.lines)} · level ${g.staxLevel}`;
    const intention = el('prime-intention').value.trim();
    el('peak-focus-btn').textContent = intention ? `Start focus: ${intention}` : 'Start a focus block';
    el('peak-nudge').textContent = playElapsed > PRIME_HINT_S ? "quieter now — good time to move." : "settled? ride it into your task.";
    if (stax.lines > g.staxBest) g.staxBest = stax.lines;
    save();   // g.staxLevel is already current — the DDA tick owns it
    stax = null;
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    sub('prime-peak');
    if (!REDUCED_MOTION) confetti();
  }

  // ================= PULSE (foggy/can't-start → rhythmic activation) =================
  function pulseStart() {
    beginPlay();
    const bpm = bpmForLevel(g.pulseLevel);
    pulse = {
      startT: performance.now() / 1000, bpm, ease: 0, window: windowFor(bpm, 0),
      score: 0, combo: 0, bestCombo: 0, winHits: 0, winTaps: 0,
      lastBeatPlayed: -1, hitFlash: 0, missFlash: 0,
    };
    g.pulseRuns = (g.pulseRuns || 0) + 1;
    updateHudPulse();
  }

  // Re-anchor the beat grid so a tempo change keeps the current phase — without
  // this the beat audibly jumps and in-flight taps get judged against a grid
  // that moved under them.
  function setPulseBpm(next) {
    if (!pulse || next === pulse.bpm) return;
    const now = performance.now() / 1000;
    const oldIv = beatInterval(pulse.bpm);
    const phase = ((now - pulse.startT) % oldIv) / oldIv;
    const newIv = beatInterval(next);
    pulse.startT = now - phase * newIv;
    pulse.bpm = next;
    pulse.lastBeatPlayed = Math.floor((now - pulse.startT) / newIv);
    pulse.window = windowFor(next, pulse.ease);
  }

  function pulseTap() {
    if (!pulse) return;
    const t = performance.now() / 1000 - pulse.startT;
    const interval = beatInterval(pulse.bpm);
    const result = judge(nearestBeatOffset(t, interval), pulse.window);
    pulse.winTaps++;
    if (result === 'miss') {
      pulse.combo = 0;
      pulse.missFlash = 0.15;
    } else {
      const points = result === 'perfect' ? 15 : 8;
      pulse.combo++;
      pulse.winHits++;
      pulse.bestCombo = Math.max(pulse.bestCombo, pulse.combo);
      pulse.score += points;
      sessionScore += points;   // feeds the 15s DDA tick
      pulse.hitFlash = 0.15;
      sfxNear();
    }
  }

  function framePulse(dt) {
    if (!pulse) return;
    const t = performance.now() / 1000 - pulse.startT;
    const interval = beatInterval(pulse.bpm);
    const beatIdx = Math.floor(t / interval);
    if (beatIdx > pulse.lastBeatPlayed) { pulse.lastBeatPlayed = beatIdx; sfxTick(); }
    if (pulse.hitFlash > 0) pulse.hitFlash = Math.max(0, pulse.hitFlash - dt);
    if (pulse.missFlash > 0) pulse.missFlash = Math.max(0, pulse.missFlash - dt);
    updateHudPulse();
    drawPulse(t, interval);
  }

  function drawPulse(t, interval) {
    ctx.save();
    fillBg();
    const cx = W / 2, cy = H / 2;
    const phase = (t % interval) / interval;
    const ringR = 90 * (1 - phase) + 14;
    ctx.strokeStyle = 'rgba(57,208,255,0.8)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, ringR, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = pulse.hitFlash > 0 ? '#7bffea' : (pulse.missFlash > 0 ? '#ff4d6d' : '#39d0ff');
    ctx.beginPath(); ctx.arc(cx, cy, 14, 0, Math.PI * 2); ctx.fill();
    ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
    ctx.font = '600 22px system-ui, sans-serif';
    ctx.fillText(`${Math.round(pulse.bpm)} bpm`, cx, cy - 120);
    ctx.textAlign = 'left';
    drawLevelFlash();
    ctx.restore();
  }

  function updateHudPulse() {
    el('hud-dist').textContent = `${Math.round(pulse.bpm)} bpm`;
    el('hud-mult').textContent = `combo ${pulse.combo}`;
    el('hud-best').textContent = `best ${g.pulseBestCombo}`;
    el('hud-mult').classList.toggle('hot', pulse.combo >= 8);
  }

  function toPeakPulse() {
    el('peak-title').textContent = "Engine's running.";
    el('peak-stats').textContent = `${pulse.bestCombo} best combo · ${Math.round(pulse.bpm)} bpm reached · score ${pulse.score}`;
    const intention = el('prime-intention').value.trim();
    el('peak-focus-btn').textContent = intention ? `Start focus: ${intention}` : 'Start a focus block';
    el('peak-nudge').textContent = 'warmed up — go.';
    if (pulse.bestCombo > g.pulseBestCombo) g.pulseBestCombo = pulse.bestCombo;
    g.pulseLevel = Math.max(0, g.pulseLevel - 1); // resume a touch below your peak
    save();
    pulse = null;
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    sub('prime-peak');
    if (!REDUCED_MOTION) confetti();
  }

  // ---------- shared handoff buttons ----------
  el('game-quit').addEventListener('click', () => {
    if (activeGame === 'flux') { if (run && !run.dead) run.score = runScore(run.dist, run.nearBank); toPeak(); }
    else if (activeGame === 'stax') toPeakStax();
    else if (activeGame === 'pulse') toPeakPulse();
  });
  el('peak-focus-btn').addEventListener('click', () => {
    const intention = el('prime-intention').value.trim();
    el('prime-intention').value = '';
    stopMusic();
    startFocus(intention);
  });
  el('peak-again-btn').addEventListener('click', () => startGame(activeGame));
  el('peak-later-btn').addEventListener('click', () => { stopMusic(); sub('prime-setup'); renderRecent(); });

  // ---------- input ----------
  function onKey(e) {
    if (el('prime-play').classList.contains('hidden')) return;
    if (activeGame === 'flux') { if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') { e.preventDefault(); flip(); } }
    else if (activeGame === 'stax') staxKey(e);
    else if (activeGame === 'pulse') { if (e.code === 'Space') { e.preventDefault(); pulseTap(); } }
  }
  document.addEventListener('keydown', onKey);
  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    setTouchMode(e.pointerType === 'touch');
    const rect = canvas.getBoundingClientRect();
    pointerStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    if (activeGame === 'flux') flip();
    else if (activeGame === 'pulse') pulseTap();
  });
  canvas.addEventListener('pointerup', e => {
    if (activeGame !== 'stax' || !pointerStart) return;
    const rect = canvas.getBoundingClientRect();
    const dy = (e.clientY - rect.top) - pointerStart.y;
    if (dy > 40) staxHardDrop();
    else staxTap(pointerStart.x);
    pointerStart = null;
  });

  // ---------- loop ----------
  function frame() {
    raf = requestAnimationFrame(frame);
    const now = performance.now();
    let dt = (now - lastT) / 1000;
    lastT = now;
    if (dt > 0.05) dt = 0.05;           // clamp after tab-switch

    // Play time accrues across deaths, so the DDA still ticks in FLUX.
    const active = activeGame === 'flux' ? !!(run && !run.dead) : !!(stax || pulse);
    if (active) {
      playElapsed += dt;
      if (playElapsed >= tickAt) { tickAt = playElapsed + TICK_S; ddaTick(); }
    }
    if (levelFlash > 0) levelFlash = Math.max(0, levelFlash - dt);

    if (activeGame === 'flux') frameFlux(dt);
    else if (activeGame === 'stax') frameStax(dt);
    else if (activeGame === 'pulse') framePulse(dt);
  }

  // ---------- render plumbing ----------
  function resize() {
    const wrap = canvas.parentElement;
    W = Math.min(760, wrap.clientWidth || 760);
    H = Math.round(W * 0.62);
    canvas.width = W * devicePixelRatio;
    canvas.height = H * devicePixelRatio;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    if (run) { run.railTop = RAIL_PAD; run.railBot = H - RAIL_PAD - PLAYER_SIZE; run.px = W * 0.26; }
  }
  addEventListener('resize', () => { if (run || stax || pulse) resize(); });

  function confetti() {
    const host = el('prime-peak');
    for (let i = 0; i < 22; i++) {
      const p = document.createElement('span');
      p.className = 'confetti';
      p.style.left = 20 + Math.random() * 60 + '%';
      p.style.background = ['#39d0ff', '#ff2da1', '#7bffea', '#f4d47c'][i % 4];
      p.style.animationDelay = Math.random() * 0.3 + 's';
      host.append(p);
      setTimeout(() => p.remove(), 1800);
    }
  }

  // ---------- route integration ----------
  return {
    enter() { stopMusic(); sub('prime-checkin'); resetCheckin(); el('prime-error').textContent = ''; },
    leave() {
      run = null; stax = null; pulse = null;
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      stopMusic();
      document.body.classList.remove('in-game');
    },
  };
}
