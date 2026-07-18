// The Diver — a parametric pixel character.
//
// The avatar is assembled from small part-sprites and posed procedurally rather
// than hand-drawn frame by frame. That is what makes customization and gear
// affordable: a new look is data, not new art. Customization matters here
// beyond taste — avatar identification is the mechanism behind the Proteus
// effect, so building your own Diver is load-bearing, not decoration.

// Character symbols used by every part sprite:
//   o = outline   s = suit(main)   S = suit(light)   d = suit(dark)
//   k = skin      K = skin(light)  h = hair          H = hair(light)
//   v = visor     g = glow accent
export const SYM = 'osSdkKehHvg';

// ---- parts ----------------------------------------------------------------

// All heads are 5px wide inside a 7px frame, so a narrow head sits on wider
// shoulders — that contrast is the silhouette. Eyes ('e') matter: without
// facial features a small head reads as a coloured bar, not a person.
export const HEADS = {
  round: [
    '.ooooooo.',
    '.okkkkko.',
    '.okekeko.',
    '.okkkkko.',
    '.okKkkko.',
    '.ooooooo.',
  ],
  narrow: [
    '..ooooo..',
    '..okkko..',
    '..oekeo..',
    '..okkko..',
    '..okkko..',
    '..okKko..',
    '..ooooo..',
  ],
  broad: [
    'ooooooooo',
    'okkkkkkko',
    'okkekekko',
    'okkkkkkko',
    'okkKkkkko',
    'ooooooooo',
  ],
};

export const HAIRS = {
  crop: ['.hhhhhhh.', '.hHHHHHh.'],
  swept: ['..hhhhhh.', '.hHHHHHh.'],
  tall: ['...hHh...', '..hhHhh..', '.hHHHHHh.'],
  bald: [],
  long: ['.hhhhhhh.', '.hHHHHHh.', '.h.....h.', '.h.....h.'],
};

// Visor overlays sit on the eye row. 'none' is the default so the face reads;
// a visor is a deliberate look, not something forced on every diver.
export const VISORS = {
  none: null,
  band: ['.ovvvvvo.'],
  full: ['.ovvvvvo.', '.ovvvvvo.'],
};

// Torso is the full 7px — wider than the head — and tapers at the waist, so the
// body has an actual shape instead of being one uniform column.
const TORSO = [
  'ooooooooo',
  'osSSSSSso',
  'osSSgSSso',
  'osSSSSSso',
  '.odddddo.',
];

// Arms use the light suit tone so they separate from the torso behind them.
const ARM = ['oS', 'oS', 'oS', 'od'];
const LEG = ['oss', 'oss', 'oss', 'ooo'];

// A 4-frame run: contact, passing, contact(opposite), passing. Legs are offset
// horizontally and lifted rather than driven by a sine — pixel art wants whole-
// pixel keyframes, and mirrored sine legs render phase 0 and 0.5 identically.
const RUN_FRAMES = [
  { fx: 1, fLift: 0, bx: -1, bLift: 0, aF: 0, aB: 1, bob: 0 },
  { fx: 0, fLift: 1, bx: 0, bLift: 0, aF: 1, aB: 0, bob: -1 },
  { fx: -1, fLift: 0, bx: 1, bLift: 0, aF: 1, aB: 0, bob: 0 },
  { fx: 0, fLift: 0, bx: 0, bLift: 1, aF: 0, aB: 1, bob: -1 },
];

// ---- customization --------------------------------------------------------

export const OPTIONS = {
  head: Object.keys(HEADS),
  hair: Object.keys(HAIRS),
  visor: Object.keys(VISORS),
  suit: ['suit', 'warm', 'danger', 'hair', 'grey'],   // palette ramp names
  skin: [0, 1, 2, 3],                                 // index into P.skin
  hairColor: ['hair', 'warm', 'suit', 'grey', 'danger'],
};

export function defaultAvatar() {
  return { name: 'DIVER', head: 'round', hair: 'crop', visor: 'none', suit: 'suit', skin: 2, hairColor: 'hair' };
}

export function randomAvatar(rand = Math.random) {
  const pick = a => a[Math.floor(rand() * a.length)];
  return {
    name: pick(NAMES),
    head: pick(OPTIONS.head),
    hair: pick(OPTIONS.hair),
    visor: pick(OPTIONS.visor),
    suit: pick(OPTIONS.suit),
    skin: pick(OPTIONS.skin),
    hairColor: pick(OPTIONS.hairColor),
  };
}

export const NAMES = ['KESTREL', 'VESPER', 'ONYX', 'WREN', 'HALO', 'ASHER', 'NOVA', 'RIVEN', 'JUNO', 'CASS'];

// Cycles an option forward/backward — used by the creator's arrow buttons.
export function cycle(avatar, key, dir = 1) {
  const opts = OPTIONS[key];
  if (!opts) return avatar;
  const i = opts.indexOf(avatar[key]);
  const next = opts[(i + dir + opts.length) % opts.length];
  return { ...avatar, [key]: next };
}

// Round-trips through storage. Unknown values fall back to the default rather
// than rendering a broken character.
export function sanitize(a) {
  const d = defaultAvatar();
  if (!a || typeof a !== 'object') return d;
  const ok = (key, val) => OPTIONS[key].includes(val) ? val : d[key];
  return {
    name: (typeof a.name === 'string' && a.name.trim() ? a.name : d.name).slice(0, 10).toUpperCase(),
    head: ok('head', a.head),
    hair: ok('hair', a.hair),
    visor: ok('visor', a.visor),
    suit: ok('suit', a.suit),
    skin: OPTIONS.skin.includes(a.skin) ? a.skin : d.skin,
    hairColor: ok('hairColor', a.hairColor),
  };
}

// ---- rendering ------------------------------------------------------------

// Builds the char→color map for one avatar from the locked palette.
export function colorMap(avatar, P) {
  const suit = P[avatar.suit] || P.suit;
  const hair = P[avatar.hairColor] || P.hair;
  const skinBase = Math.max(0, Math.min(3, avatar.skin));
  return {
    o: P.black,
    s: suit[1], S: suit[2], d: suit[0],
    k: P.skin[skinBase], K: P.skin[Math.min(3, skinBase + 1)],
    // eyes flip to a light tone on dark skin, or they vanish into the face
    e: skinBase <= 1 ? P.white : P.black,
    h: hair[1], H: hair[2],
    v: suit[3], g: P.warm[2],
  };
}

// Poses the character procedurally. `phase` (0..1) drives the run cycle,
// `state` swaps to jump/dash silhouettes. Returns draw instructions so the
// renderer stays dumb and this stays testable.
export function pose(avatar, state, phase) {
  const head = HEADS[avatar.head] || HEADS.round;
  const hair = HAIRS[avatar.hair] || HAIRS.crop;
  const visor = VISORS[avatar.visor] || null;

  const f = RUN_FRAMES[Math.floor(((phase % 1) + 1) % 1 * RUN_FRAMES.length) % RUN_FRAMES.length];
  let { fx, fLift, bx, bLift, aF, aB, bob } = f;
  let lean = 0;

  if (state === 'jump') { fx = 1; fLift = 2; bx = -1; bLift = 0; aF = -1; aB = -1; bob = 0; }
  else if (state === 'fall') { fx = 1; fLift = 0; bx = -1; bLift = 1; aF = 2; aB = 2; bob = 0; }
  else if (state === 'dash') { fx = 2; fLift = 1; bx = -2; bLift = 1; aF = -2; aB = -2; bob = 1; lean = 1; }
  else if (state === 'hit') { fx = -1; fLift = 1; bx = 1; bLift = 0; aF = 2; aB = 2; bob = 1; }

  // Hair overlaps the skull, and the torso overlaps the head's bottom outline —
  // without that overlap the two black outline rows stack into a 2px gap that
  // reads as a missing neck.
  const hairY = bob;
  const headY = bob + Math.max(0, hair.length - 1);
  const torsoY = headY + head.length - 1;
  const legY = torsoY + TORSO.length;

  return {
    parts: [
      { rows: ARM, x: 0 - lean, y: torsoY + 1 + aB, dim: true },
      { rows: LEG, x: 1 + bx, y: legY - bLift },
      { rows: LEG, x: 5 + fx, y: legY - fLift },
      { rows: TORSO, x: 0, y: torsoY },
      { rows: head, x: 0 + lean, y: headY },
      ...(visor ? [{ rows: visor, x: 0 + lean, y: headY + 2 }] : []),
      { rows: hair, x: 0 + lean, y: hairY },
      { rows: ARM, x: 7 + lean, y: torsoY + 1 + aF },
    ],
    width: AVATAR_W,
    height: legY + LEG.length,
  };
}

// Drawn size in virtual px. Kept in sync with the layout above.
export const AVATAR_W = 9;
export const AVATAR_H = 16;
