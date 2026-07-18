// Progression — pure logic, node-testable.
//
// Deliberate asymmetry: playing a mission earns a little, finishing REAL focus
// work earns a lot. STRATEGY.md names the risk that a dopamine game becomes the
// procrastination; this is the structural answer. The avatar is a record of
// work actually done, not time spent playing.

export const XP = {
  mission: 15,        // completing a dive
  focusBlock: 120,    // completing a real focus session
  reflection: 30,     // bonus for rating the session afterwards
};

// Rising cost per level: 100, 250, 450, 700, ...
export function xpForLevel(level) {
  if (level <= 0) return 0;
  return 25 * level * (level + 3);
}

export function levelFromXp(xp) {
  let lvl = 0;
  while (xpForLevel(lvl + 1) <= xp) lvl++;
  return lvl;
}

// Progress toward the next level, 0..1 — for the XP bar.
export function levelProgress(xp) {
  const lvl = levelFromXp(xp);
  const cur = xpForLevel(lvl);
  const next = xpForLevel(lvl + 1);
  if (next <= cur) return 1;
  return Math.max(0, Math.min(1, (xp - cur) / (next - cur)));
}

// Cosmetic unlocks. Gated on level, which is mostly earned by real work —
// so a new look is evidence of focus sessions completed.
export const UNLOCKS = [
  { level: 1, kind: 'visor', value: 'full', label: 'FULL VISOR' },
  { level: 2, kind: 'suit', value: 'warm', label: 'EMBER SUIT' },
  { level: 3, kind: 'hair', value: 'tall', label: 'TALL CREST' },
  { level: 4, kind: 'suit', value: 'danger', label: 'CRIMSON SUIT' },
  { level: 5, kind: 'hair', value: 'long', label: 'LONG HAIR' },
  { level: 6, kind: 'suit', value: 'grey', label: 'ASH SUIT' },
];

export function unlockedAt(level) {
  return UNLOCKS.filter(u => u.level <= level);
}

// What a given level just unlocked — drives the "NEW" callout on level-up.
export function newlyUnlocked(fromLevel, toLevel) {
  return UNLOCKS.filter(u => u.level > fromLevel && u.level <= toLevel);
}

export function isUnlocked(kind, value, level) {
  const gated = UNLOCKS.find(u => u.kind === kind && u.value === value);
  return !gated || gated.level <= level;
}

// Adds xp and reports whether a level boundary was crossed.
export function awardXp(current, amount) {
  const before = levelFromXp(current);
  const xp = Math.max(0, current + amount);
  const after = levelFromXp(xp);
  return { xp, level: after, leveled: after > before, unlocked: newlyUnlocked(before, after) };
}
