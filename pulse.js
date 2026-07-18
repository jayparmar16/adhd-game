// PULSE — pure gameplay logic for the ignite-slot tempo-tap ring.
// No DOM, no audio. Unit-checkable in node (test.mjs).

export const START_BPM = 60;
export const MAX_BPM = 132;
export const BASE_WINDOW = { perfect: 0.07, good: 0.14 };

export function beatInterval(bpm) { return 60 / bpm; } // seconds per beat

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

// DDA: a hit streak nudges tempo up; a miss streak widens the window and eases tempo down.
export function stepPulse(bpm, window, hitStreak, missStreak) {
  let nextBpm = bpm;
  let next = window;
  if (hitStreak > 0 && hitStreak % 4 === 0) nextBpm = Math.min(MAX_BPM, bpm + 2);
  if (missStreak >= 3) {
    nextBpm = Math.max(START_BPM, bpm - 2);
    next = { perfect: Math.min(0.14, window.perfect + 0.01), good: Math.min(0.26, window.good + 0.015) };
  }
  return { bpm: nextBpm, window: next };
}
