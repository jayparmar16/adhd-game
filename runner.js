// FLUX — pure gameplay logic. No DOM, no canvas. Unit-checkable in node (test.mjs).

export const PLAYER_SIZE = 22;

// Axis-aligned bounding-box overlap.
export function aabb(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// A near-miss: player horizontally overlaps the obstacle and clears it
// vertically by less than `thresh` px (but does NOT collide). Fuels the
// dopamine/near-miss reward loop.
export function nearMiss(px, py, ps, ox, oy, ow, oh, thresh) {
  const horiz = px < ox + ow && px + ps > ox;
  if (!horiz) return false;
  const gapBelow = oy - (py + ps);   // obstacle sits below the player
  const gapAbove = py - (oy + oh);   // obstacle sits above the player
  const gap = Math.max(gapBelow, gapAbove);
  return gap > 0 && gap < thresh;
}

// Difficulty rises with distance travelled and with the persisted level,
// keeping challenge ≈ skill (the flow channel / EndeavorOTC-style curation).
// Level 0 is a medium start, not a gentle one; caps sit high enough that a
// strong player never saturates the curve. Level comes from dda.js.
export function difficulty(distance, level) {
  const t = distance / 1000;
  const speed = Math.min(1400, 430 + level * 26 + t * 130);          // px/s
  const spawnGap = Math.max(0.34, 1.05 - level * 0.020 - t * 0.055); // s between obstacles
  const maxH = Math.min(0.55, 0.26 + level * 0.010 + t * 0.032);     // fraction of play height
  return { speed, spawnGap, maxH };
}

// Score = metres + near-miss bank, both scaled by the live multiplier.
export function runScore(distance, nearMissBank) {
  return Math.floor(distance) + nearMissBank;
}
