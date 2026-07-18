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

// Difficulty rises with distance travelled and with the persisted skill level,
// keeping challenge ≈ skill (the flow channel / EndeavorOTC-style curation).
export function difficulty(distance, skill) {
  const t = distance / 1000;
  const speed = Math.min(900, 250 + skill * 20 + t * 85);        // px/s
  const spawnGap = Math.max(0.6, 1.2 - skill * 0.025 - t * 0.05); // s between obstacles
  const maxH = Math.min(0.42, 0.2 + skill * 0.012 + t * 0.03);    // fraction of play height
  return { speed, spawnGap, maxH };
}

// Between-run staircase: nudge skill so a typical run lasts ~`target` seconds.
// Survive long → harder next time; die fast → ease off. This is the DDA.
export function stepSkill(skill, survivedSeconds, target = 25) {
  if (survivedSeconds > target * 1.5) return Math.min(40, skill + 1);
  if (survivedSeconds < target * 0.4) return Math.max(0, skill - 1);
  return skill;
}

// Score = metres + near-miss bank, both scaled by the live multiplier.
export function runScore(distance, nearMissBank) {
  return Math.floor(distance) + nearMissBank;
}
