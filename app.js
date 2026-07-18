// Alongside — vanilla ES module. Local-first, zero backend.
// See STRATEGY.md for the design rationale.

import { initPrime } from './game.js';
import { initDive } from './dive.js';

const KEY = 'alongside.v1';

const CAPTIONS = {
  start:        ["let's do this. i'm here.", "settle in.", "here we go."],
  idle:         ["still here.", "you've got this.", "no rush.", "keeping you company.", "one thing at a time."],
  quarter:      ["you're in it."],
  half:         ["halfway. nice."],
  threeQuarter: ["almost there."],
  pause:        ["no worries. back when you are."],
  resume:       ["back at it."],
  end:          ["done. well held.", "nicely held.", "that's a session."],
};

// ---- state ----
const state = load();

function load() {
  const base = { history: [], settings: { defaultMinutes: 25, chattiness: 'normal' }, game: {}, dive: {} };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return {
      history: Array.isArray(raw.history) ? raw.history : [],
      settings: { ...base.settings, ...(raw.settings || {}) },
      game: raw.game && typeof raw.game === 'object' ? raw.game : {},
      dive: raw.dive && typeof raw.dive === 'object' ? raw.dive : {},
    };
  } catch {
    return base;
  }
}
function save() { localStorage.setItem(KEY, JSON.stringify(state)); }

// ---- helpers ----
function svg(name, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
// deterministic pseudo-random from a string (FNV-1a → xorshift)
function seed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  };
}
function uid() {
  if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---- routing ----
const VIEWS = ['dive', 'prime', 'home', 'session', 'reflect', 'history', 'settings'];
let primeCtl = null; // set at startup, after initPrime()
let diveCtl = null;  // set at startup, after initDive()
function show(view) {
  VIEWS.forEach(v => document.getElementById('view-' + v).classList.toggle('hidden', v !== view));
  if (primeCtl) (view === 'prime' ? primeCtl.enter() : primeCtl.leave());
  if (diveCtl) (view === 'dive' ? diveCtl.enter() : diveCtl.leave());
  if (view === 'home') renderHome();
  if (view === 'history') renderHistory();
  if (view === 'settings') renderSettings();
}
function route() {
  const v = location.hash.replace(/^#\/?/, '') || 'dive';
  show(VIEWS.includes(v) ? v : 'dive');
}
window.addEventListener('hashchange', route);

// ---- caption bubble ----
const captionEl = document.getElementById('caption');
let captionHideTimer = null;
function sayCaption(text) {
  if (state.settings.chattiness === 'off') return;
  captionEl.textContent = text;
  captionEl.classList.add('show');
  if (captionHideTimer) clearTimeout(captionHideTimer);
  captionHideTimer = setTimeout(() => captionEl.classList.remove('show'), 5000);
}

// ---- home view ----
const intentionInput   = document.getElementById('intention-input');
const customMinutesInput = document.getElementById('custom-minutes');
const startBtn         = document.getElementById('start-btn');
const totalsEl         = document.getElementById('totals');
const comebackEl       = document.getElementById('comeback');
const minBtns          = [...document.querySelectorAll('.min-btn')];

let selectedMinutes = state.settings.defaultMinutes;

function setSelectedMinutes(m) {
  selectedMinutes = m;
  minBtns.forEach(b => b.classList.toggle('active', Number(b.dataset.min) === m));
}
minBtns.forEach(b => b.addEventListener('click', () => {
  customMinutesInput.value = '';
  setSelectedMinutes(Number(b.dataset.min));
}));
customMinutesInput.addEventListener('input', () => {
  const v = Number(customMinutesInput.value);
  if (v > 0 && v <= 180) {
    selectedMinutes = v;
    minBtns.forEach(b => b.classList.remove('active'));
  }
});
startBtn.addEventListener('click', () => {
  startSession({
    minutes: Math.max(1, Math.min(180, Number(selectedMinutes) || 25)),
    intention: intentionInput.value.trim() || '(no intention set)',
  });
});

function renderHome() {
  const total = state.history.reduce((s, h) => s + (h.actualMinutes || 0), 0);
  const count = state.history.length;
  totalsEl.textContent = count === 0
    ? "your first session grows the first flower."
    : `${count} session${count === 1 ? '' : 's'} · ${total} focus-min · your garden is growing.`;

  const hint = comebackHint();
  if (hint) { comebackEl.textContent = hint; comebackEl.classList.remove('hidden'); }
  else comebackEl.classList.add('hidden');

  setSelectedMinutes(state.settings.defaultMinutes);
  renderWorld();
}
function comebackHint() {
  const last = state.history[state.history.length - 1];
  if (!last) return null;
  const daysSince = (Date.now() - last.startedAt) / 86400000;
  if (daysSince > 3) return "welcome back. 15 minutes is plenty to warm up.";
  return null;
}

// ---- session view ----
const timerEl              = document.getElementById('timer');
const progressEl           = document.getElementById('progress');
const sessionIntentionEl   = document.getElementById('session-intention');
const pauseBtn             = document.getElementById('pause-btn');
const stopBtn              = document.getElementById('stop-btn');

let sess = null;
let tickHandle = null;
let milestones = { q: false, h: false, tq: false };
let lastIdleAt = 0;
let wakeLock = null;

async function acquireWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch { /* not fatal */ }
}
function releaseWakeLock() {
  if (wakeLock) { try { wakeLock.release(); } catch {} wakeLock = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && sess && !wakeLock) acquireWakeLock();
});

function startSession({ minutes, intention }) {
  sess = {
    id: uid(),
    intention,
    startedAt: Date.now(),
    plannedMs: minutes * 60000,
    plannedMinutes: minutes,
    paused: false,
    pausedAt: null,
    pausedTotalMs: 0,
  };
  milestones = { q: false, h: false, tq: false };
  lastIdleAt = Date.now();
  sessionIntentionEl.textContent = intention;
  pauseBtn.textContent = 'Pause';
  acquireWakeLock();
  location.hash = '#/session';
  sayCaption(pick(CAPTIONS.start));
  startTick();
  tick(); // initial paint
}

function startTick() { if (!tickHandle) tickHandle = setInterval(tick, 500); }
function stopTick()  { if (tickHandle) { clearInterval(tickHandle); tickHandle = null; } }

function elapsedMs() {
  if (!sess) return 0;
  const now = Date.now();
  const raw = now - sess.startedAt - sess.pausedTotalMs;
  return sess.paused ? raw - (now - sess.pausedAt) : raw;
}

function tick() {
  if (!sess) { stopTick(); return; }
  const el = elapsedMs();
  const remain = Math.max(0, sess.plannedMs - el);
  const mm = String(Math.floor(remain / 60000)).padStart(2, '0');
  const ss = String(Math.floor((remain % 60000) / 1000)).padStart(2, '0');
  timerEl.textContent = `${mm}:${ss}`;
  progressEl.value = Math.min(1, el / sess.plannedMs);

  const pct = el / sess.plannedMs;
  if (!milestones.q  && pct >= 0.25) { milestones.q  = true; sayCaption(pick(CAPTIONS.quarter)); }
  if (!milestones.h  && pct >= 0.50) { milestones.h  = true; sayCaption(pick(CAPTIONS.half)); }
  if (!milestones.tq && pct >= 0.75) { milestones.tq = true; sayCaption(pick(CAPTIONS.threeQuarter)); }

  // Idle "still here" — respects chattiness. Skip if we're near the end.
  const idleInterval = state.settings.chattiness === 'quiet' ? 10 * 60000 : 5 * 60000;
  if (!sess.paused && Date.now() - lastIdleAt > idleInterval && sess.plannedMs - el > 60000) {
    lastIdleAt = Date.now();
    sayCaption(pick(CAPTIONS.idle));
  }

  if (remain <= 0) finishSession(true);
}

pauseBtn.addEventListener('click', () => {
  if (!sess) return;
  if (sess.paused) {
    sess.pausedTotalMs += Date.now() - sess.pausedAt;
    sess.paused = false;
    sess.pausedAt = null;
    pauseBtn.textContent = 'Pause';
    lastIdleAt = Date.now();
    sayCaption(pick(CAPTIONS.resume));
  } else {
    sess.paused = true;
    sess.pausedAt = Date.now();
    pauseBtn.textContent = 'Resume';
    sayCaption(pick(CAPTIONS.pause));
  }
});
stopBtn.addEventListener('click', () => {
  if (!sess) return;
  if (confirm("End the session early?")) finishSession(false);
});

function finishSession(completed) {
  stopTick();
  releaseWakeLock();
  if (!sess) return;
  const actualMs = Math.min(sess.plannedMs, Math.max(0, elapsedMs()));
  const actualMinutes = Math.max(1, Math.round(actualMs / 60000));
  pendingReflection = {
    id: sess.id,
    intention: sess.intention,
    startedAt: sess.startedAt,
    endedAt: Date.now(),
    plannedMinutes: sess.plannedMinutes,
    actualMinutes,
    completed,
    focusRating: null,
    moodRating: null,
  };
  sess = null;
  sayCaption(pick(CAPTIONS.end));
  document.getElementById('reflect-summary').textContent =
    `${actualMinutes} min on "${pendingReflection.intention}". how did it feel?`;
  document.querySelectorAll('.rating button').forEach(b => b.classList.remove('active'));
  location.hash = '#/reflect';
}

// ---- reflect ----
let pendingReflection = null;

document.querySelectorAll('.rating').forEach(row => {
  row.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    row.querySelectorAll('button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    if (pendingReflection) pendingReflection[row.dataset.name + 'Rating'] = Number(b.dataset.val);
  });
});
// Real focus work is what actually levels the Diver — playing earns far less.
// This is the structural answer to "the game becomes the procrastination".
function awardFocusXp(withReflection) {
  if (!diveCtl || !diveCtl.awardFocus) return;
  const res = diveCtl.awardFocus(withReflection);
  if (res && res.leveled) {
    const what = res.unlocked && res.unlocked.length ? ` — unlocked ${res.unlocked[0].label}` : '';
    sayCaption(`your diver reached level ${res.level}${what}`);
  }
}

document.getElementById('save-reflect').addEventListener('click', () => {
  if (!pendingReflection) { location.hash = '#/'; return; }
  state.history.push(pendingReflection);
  const rated = pendingReflection.focusRating != null || pendingReflection.moodRating != null;
  save();
  awardFocusXp(rated);
  pendingReflection = null;
  intentionInput.value = '';
  location.hash = '#/';
});
document.getElementById('skip-reflect').addEventListener('click', () => {
  if (pendingReflection) { state.history.push(pendingReflection); save(); awardFocusXp(false); }
  pendingReflection = null;
  intentionInput.value = '';
  location.hash = '#/';
});

// ---- world (growing garden) ----
const worldSvg = document.getElementById('world-svg');
function renderWorld() {
  worldSvg.innerHTML = '';
  const W = 1000, H = 200;
  const groundY = H - 18;
  worldSvg.append(svg('rect', { x: 0, y: groundY, width: W, height: 18, fill: '#0e1a15' }));
  state.history.forEach(h => {
    const rng = seed(h.id);
    const x = 18 + rng() * (W - 36);
    const focus = h.focusRating || 3;
    const mood  = h.moodRating  || 3;
    const height = 26 + focus * 9 + rng() * 8;
    const hue = 200 + mood * 30 + rng() * 20;
    const yTop = groundY - height;
    worldSvg.append(svg('line', {
      x1: x, y1: groundY, x2: x, y2: yTop,
      stroke: '#2f4a35', 'stroke-width': 2, 'stroke-linecap': 'round',
    }));
    for (let p = 0; p < 5; p++) {
      const a = p * (Math.PI * 2 / 5) - Math.PI / 2;
      worldSvg.append(svg('circle', {
        cx: x + Math.cos(a) * 5, cy: yTop + Math.sin(a) * 5, r: 4,
        fill: `hsl(${Math.round(hue)}, 65%, 68%)`, opacity: 0.92,
      }));
    }
    worldSvg.append(svg('circle', { cx: x, cy: yTop, r: 3, fill: '#f4d47c' }));
  });
}

// ---- history view ----
const chartSvg           = document.getElementById('chart-svg');
const historySummaryEl   = document.getElementById('history-summary');
const recentSessionsEl   = document.getElementById('recent-sessions');

function renderHistory() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const start = d.getTime(), end = start + 86400000;
    const mins = state.history
      .filter(h => h.startedAt >= start && h.startedAt < end)
      .reduce((s, h) => s + (h.actualMinutes || 0), 0);
    days.push({ date: d, mins });
  }
  const total = days.reduce((s, d) => s + d.mins, 0);
  const active = days.filter(d => d.mins > 0).length;
  historySummaryEl.textContent =
    active === 0
      ? "no sessions in the last 30 days."
      : `last 30 days: ${total} focus-min across ${active} day${active === 1 ? '' : 's'}.`;

  chartSvg.innerHTML = '';
  const W = 600, H = 200, PAD = 16;
  const max = Math.max(60, ...days.map(d => d.mins));
  const bw = (W - PAD * 2) / 30 - 2;
  days.forEach((d, i) => {
    const bh = (d.mins / max) * (H - PAD * 2);
    chartSvg.append(svg('rect', {
      x: PAD + i * ((W - PAD * 2) / 30),
      y: H - PAD - bh,
      width: bw,
      height: Math.max(1, bh),
      fill: d.mins > 0 ? '#7bc47f' : 'rgba(255,255,255,0.06)',
      rx: 2,
    }));
  });
  chartSvg.append(svg('line', {
    x1: PAD, y1: H - PAD, x2: W - PAD, y2: H - PAD,
    stroke: 'rgba(255,255,255,0.15)', 'stroke-width': 1,
  }));

  recentSessionsEl.innerHTML = '';
  const recent = state.history.slice(-8).reverse();
  if (recent.length === 0) {
    const li = document.createElement('li');
    li.textContent = "no sessions yet. one is enough to start.";
    recentSessionsEl.append(li);
  } else {
    recent.forEach(h => {
      const li = document.createElement('li');
      const d = new Date(h.startedAt);
      const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const timeStr = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      li.innerHTML =
        `<span>${dateStr} · ${timeStr} · ${h.actualMinutes} min` +
        (h.focusRating ? ` · focus ${h.focusRating}/5` : '') +
        `</span><br><span class="intent">${escapeHtml(h.intention)}</span>`;
      recentSessionsEl.append(li);
    });
  }
}

// ---- settings ----
const chattinessEl = document.getElementById('chattiness');
const defaultMinEl = document.getElementById('default-min');

function renderSettings() {
  chattinessEl.value = state.settings.chattiness;
  defaultMinEl.value = state.settings.defaultMinutes;
}
chattinessEl.addEventListener('change', () => {
  state.settings.chattiness = chattinessEl.value;
  save();
});
defaultMinEl.addEventListener('change', () => {
  const v = Number(defaultMinEl.value);
  if (v > 0 && v <= 180) { state.settings.defaultMinutes = v; save(); }
});
document.getElementById('export-btn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `alongside-data-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});
const importFile = document.getElementById('import-file');
document.getElementById('import-btn').addEventListener('click', () => importFile.click());
importFile.addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const text = await f.text();
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed.history)) throw new Error('bad file');
    if (confirm(`Import ${parsed.history.length} sessions? This replaces your current data.`)) {
      state.history = parsed.history;
      if (parsed.settings) state.settings = { ...state.settings, ...parsed.settings };
      save();
      alert('Imported.');
      route();
    }
  } catch {
    alert('Could not read that file.');
  }
  importFile.value = '';
});
document.getElementById('wipe-btn').addEventListener('click', () => {
  if (confirm("Erase all local data? This can't be undone.")) {
    localStorage.removeItem(KEY);
    location.reload();
  }
});

// ---- service worker (offline) ----
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* not fatal */ });
}

// ---- prime game (rhythm flow-primer) ----
primeCtl = initPrime({
  state,
  save,
  startFocus(intention) {
    startSession({
      minutes: state.settings.defaultMinutes,
      intention: intention || '(riding the wave)',
    });
  },
});

// ---- DIVE (pixel avatar game) ----
diveCtl = initDive({
  state,
  save,
  startFocus(intention) {
    startSession({
      minutes: state.settings.defaultMinutes,
      intention: intention || '(riding the wave)',
    });
  },
});

// ---- start ----
route();
