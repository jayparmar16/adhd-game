// The pixel-art pipeline. Everything visual goes through here.
//
// The single most important rule: the whole game is drawn to a fixed 320x180
// buffer and then blitted to the screen at an INTEGER scale with smoothing off.
// That makes inconsistent pixel sizes structurally impossible, which is the
// difference between pixel art that reads as authentic and pixel art that
// reads as cheap. Nothing should ever draw straight to the display canvas.

export const VW = 320;   // virtual (low-res) width
export const VH = 180;   // virtual (low-res) height

// One locked palette. Each hue is a dark→light ramp so shading stays coherent;
// picking arbitrary hex values at call sites is what makes art look muddy.
export const P = {
  black: '#04030a',
  white: '#f2f0ff',
  bg: ['#07060f', '#100d1f', '#1b1733', '#2a2450'],
  suit: ['#123b4d', '#1d6b7d', '#2fa8b8', '#7fe3e8'],   // the diver
  skin: ['#6b3d2e', '#a35f43', '#d4906b', '#f0c39b'],
  hair: ['#2a1a3a', '#4a2d63', '#7a4d94', '#b183c9'],
  warm: ['#5c2a10', '#a8541c', '#e89c3c', '#ffe08a'],   // shards, energy
  danger: ['#4a0d24', '#8f1d3d', '#d63a5e', '#ff8fa3'], // hazards
  grey: ['#1a1a22', '#3a3a48', '#6a6a7d', '#a8a8bd'],
  void: ['#1a0520', '#2e0733', '#520d4d', '#8b1a6b'],   // the erasing void
};

// 5x7 bitmap font. All in-game text renders from this — mixing crisp DOM text
// with pixel sprites is a dead giveaway, so the game never uses system fonts.
const G = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#...#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['.###.', '#...#', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '#...#', '.###.'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ',': ['.....', '.....', '.....', '.....', '.##..', '.##..', '.#...'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  "'": ['..#..', '..#..', '.....', '.....', '.....', '.....', '.....'],
  '>': ['.#...', '..#..', '...#.', '....#', '...#.', '..#..', '.#...'],
  '<': ['...#.', '..#..', '.#...', '#....', '.#...', '..#..', '...#.'],
  '(': ['...#.', '..#..', '.#...', '.#...', '.#...', '..#..', '...#.'],
  ')': ['.#...', '..#..', '...#.', '...#.', '...#.', '..#..', '.#...'],
  '%': ['##..#', '##.#.', '..#..', '.#...', '#.##.', '..###', '.....'],
  '*': ['.....', '#.#.#', '.###.', '#####', '.###.', '#.#.#', '.....'],
  '=': ['.....', '.....', '#####', '.....', '#####', '.....', '.....'],
};
export const CHAR_W = 6;   // 5px glyph + 1px letter spacing
export const CHAR_H = 7;

// Creates the low-res buffer plus the integer-scaled presenter.
export function createDisplay(canvas) {
  const buf = document.createElement('canvas');
  buf.width = VW; buf.height = VH;
  const ctx = buf.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const out = canvas.getContext('2d');
  out.imageSmoothingEnabled = false;
  let scale = 1;

  function resize() {
    const host = canvas.parentElement;
    const availW = Math.max(
      (host && host.clientWidth) || 0,
      window.innerWidth || 0,
      VW,
    );
    // leave room for page chrome; never exceed the viewport
    const availH = Math.max(160, (window.innerHeight || VH * 3) - 190);
    // INTEGER scale only — a fractional scale is what produces uneven pixels
    scale = Math.max(1, Math.min(5, Math.floor(Math.min(availW / VW, availH / VH))));
    canvas.width = VW * scale;
    canvas.height = VH * scale;
    canvas.style.width = VW * scale + 'px';
    canvas.style.height = VH * scale + 'px';
    const o = canvas.getContext('2d');
    o.imageSmoothingEnabled = false;
    return scale;
  }

  function present() {
    const o = canvas.getContext('2d');
    o.imageSmoothingEnabled = false;
    o.clearRect(0, 0, canvas.width, canvas.height);
    o.drawImage(buf, 0, 0, VW, VH, 0, 0, VW * scale, VH * scale);
  }

  // Maps a client-space point to virtual pixels, for input hit-testing.
  function toVirtual(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale };
  }

  resize();
  return { ctx, present, resize, toVirtual, getScale: () => scale, VW, VH };
}

// ---- primitives (all coordinates are virtual px and get snapped) ----

export function clear(ctx, color = P.bg[0]) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, VW, VH);
}

export function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

export function rectOutline(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillRect(x + w - 1, y, 1, h);
}

// Ordered 4x4 Bayer dither — gives gradients without leaving the palette.
const BAYER = [
  [0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5],
];
export function ditherRect(ctx, x, y, w, h, colorA, colorB, mix) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  const t = Math.max(0, Math.min(1, mix)) * 16;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const on = BAYER[py & 3][px & 3] < t;
      ctx.fillStyle = on ? colorB : colorA;
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
}

// Draws a sprite defined as rows of palette-key characters.
// `map` turns each char into a color; '.' and ' ' are transparent.
export function drawSprite(ctx, rows, x, y, map, flip = false) {
  x = Math.round(x); y = Math.round(y);
  for (let ry = 0; ry < rows.length; ry++) {
    const row = rows[ry];
    for (let rx = 0; rx < row.length; rx++) {
      const ch = row[rx];
      if (ch === '.' || ch === ' ') continue;
      const color = map[ch];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x + (flip ? row.length - 1 - rx : rx), y + ry, 1, 1);
    }
  }
}

export function textWidth(str) { return String(str).length * CHAR_W - 1; }

export function text(ctx, str, x, y, color = P.white) {
  const s = String(str).toUpperCase();
  x = Math.round(x); y = Math.round(y);
  ctx.fillStyle = color;
  for (let i = 0; i < s.length; i++) {
    const g = G[s[i]];
    if (!g) continue;
    for (let ry = 0; ry < 7; ry++) {
      const row = g[ry];
      for (let rx = 0; rx < 5; rx++) {
        if (row[rx] === '#') ctx.fillRect(x + i * CHAR_W + rx, y + ry, 1, 1);
      }
    }
  }
}

export function textCenter(ctx, str, cx, y, color = P.white) {
  text(ctx, str, Math.round(cx - textWidth(str) / 2), y, color);
}

// Text with a 1px drop shadow — keeps HUD readable over busy backgrounds.
export function textShadow(ctx, str, x, y, color = P.white, shadow = P.black) {
  text(ctx, str, x + 1, y + 1, shadow);
  text(ctx, str, x, y, color);
}
