// PULSE — pure gameplay logic for the ignite-slot tempo-tap ring.
// No DOM, no audio. Unit-checkable in node (test.mjs).

export const START_BPM = 60;
export const MAX_BPM = 190;

export function beatInterval(bpm) { return 60 / bpm; } // seconds per beat

// Tempo from level (level comes from the shared 15s tick in dda.js). A brand-new
// user starts at a resting-heartbeat 60bpm — the activation on-ramp for a stalled
// brain — but the ramp is fast and the reached tempo persists between sessions.
export function bpmForLevel(level) { return Math.min(MAX_BPM, START_BPM + level * 6); }

// Timing windows scale WITH the beat, so the game stays proportionally demanding
// as tempo rises. (An absolute window gets relatively easier as beats shorten.)
// `ease` widens both windows after a bad patch, for anti-frustration.
// Strictly proportional — an absolute clamp would make the window a *smaller*
// share of the beat at slow tempo than at fast, re-creating the inversion.
export function windowFor(bpm, ease = 0) {
  const iv = beatInterval(bpm);
  return {
    perfect: iv * 0.11 + ease,
    good: iv * 0.24 + ease,
  };
}

// Signed offset (seconds) from t to the nearest beat, range (-interval/2, interval/2].
export function nearestBeatOffset(t, interval) {
  const mod = ((t % interval) + interval) % interval;
  return mod > interval / 2 ? mod - interval : mod;
}

export function judge(offset, window) {
  const a = Math.abs(offset);
  if (a <= window.perfect) return 'perfect';
  if (a <= window.good) return 'good';
  return 'miss';
}

// Accuracy over the last tick window decides how much slack to grant.
// Missing a lot → widen the windows; playing clean → tighten back to baseline.
export function easeFor(hitRate) {
  if (hitRate >= 0.8) return 0;
  if (hitRate >= 0.5) return 0.02;
  return 0.05;
}
