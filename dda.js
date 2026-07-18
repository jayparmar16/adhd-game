// The one difficulty formula, shared by all three games.
// Every TICK_S of active play, compare the score earned in that window against
// a par value for the current level. Beat par → level up, proportionally.
// No DOM. Unit-checkable in node (test.mjs).

export const TICK_S = 15;

// Score a player at `level` is expected to earn in one tick window.
// Rises with level, so staying ahead requires genuinely improving.
export function par(level, basePar, growth = 0.18) {
  return basePar * (1 + level * growth);
}

// Log-proportional staircase: double par → +gain levels, half par → −gain.
// Symmetric, responsive (4× par jumps +6 at once), and self-limiting because
// par climbs with level. Math.round gives a ~±11% dead band for free, so it
// settles instead of oscillating.
export function stepLevel(level, scored, levelPar, { gain = 3, min = 0, max = 60 } = {}) {
  if (scored <= 0 || levelPar <= 0) return Math.max(min, level - gain);
  const delta = Math.round(gain * Math.log2(scored / levelPar));
  return Math.min(max, Math.max(min, level + delta));
}
