// YouTube IFrame Player wrapper with a drift-corrected local song clock,
// plus a WebAudio metronome clock with the same interface.
// Both expose: songTime(), isPlaying(), pause(), resume(), stop(), duration().

let apiPromise = null;
function loadYTApi() {
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;
  apiPromise = new Promise(resolve => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.append(s);
  });
  return apiPromise;
}

const ERROR_MESSAGES = {
  2: "That doesn't look like a valid video.",
  5: "This video can't play in the browser player.",
  100: "Video not found (removed or private).",
  101: "This video blocks embedding — try another upload of the song.",
  150: "This video blocks embedding — try another upload of the song.",
};

// events: onPlaying, onFreeze(reason), onEnded, onError(message)
export async function createYTClock(videoId, mountId, events = {}) {
  await loadYTApi();
  const clock = {
    _offset: null,        // songTime - perfNow (seconds), EMA-smoothed
    _playing: false,
    _player: null,
    _dur: 0,
    songTime() {
      if (this._offset == null) return 0;
      return performance.now() / 1000 + this._offset;
    },
    isPlaying() { return this._playing; },
    // ponytail: EMA over the postMessage-bridge clock; α=0.15, hard reset on state change
    sync() {
      if (!this._player || !this._playing) return;
      const raw = this._player.getCurrentTime() - performance.now() / 1000;
      this._offset = this._offset == null ? raw : this._offset + 0.15 * (raw - this._offset);
    },
    hardSync() {
      if (!this._player) return;
      this._offset = this._player.getCurrentTime() - performance.now() / 1000;
    },
    pause() { try { this._player.pauseVideo(); } catch {} },
    resume() { try { this._player.playVideo(); } catch {} },
    stop() { try { this._player.stopVideo(); this._player.destroy(); } catch {} this._playing = false; },
    duration() { return this._dur; },
  };

  clock._player = new YT.Player(mountId, {
    width: 320, height: 180, videoId,
    playerVars: {
      playsinline: 1, rel: 0, controls: 0, disablekb: 1,
      enablejsapi: 1, origin: location.origin,
    },
    events: {
      onReady: e => { clock._dur = e.target.getDuration() || 0; e.target.playVideo(); },
      onStateChange: e => {
        const S = YT.PlayerState;
        if (e.data === S.PLAYING) {
          clock._playing = true;
          clock._dur = clock._dur || e.target.getDuration() || 0;
          clock.hardSync();
          events.onPlaying && events.onPlaying();
        } else if (e.data === S.ENDED) {
          clock._playing = false;
          events.onEnded && events.onEnded();
        } else if (e.data === S.BUFFERING || e.data === S.PAUSED || e.data === S.UNSTARTED) {
          // covers buffering, manual pause, and ad interruptions
          clock._playing = false;
          events.onFreeze && events.onFreeze(e.data === S.BUFFERING ? 'buffering' : 'paused');
        }
      },
      onError: e => {
        clock._playing = false;
        events.onError && events.onError(ERROR_MESSAGES[e.data] || 'The video failed to load.');
      },
    },
  });
  return clock;
}

// Metronome: same interface, no network. Click track via WebAudio.
export function createMetronomeClock(bpm, durationSec, events = {}) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const t0 = ctx.currentTime + 0.15;
  let nextClick = 0;
  let stopped = false;
  const spb = 60 / bpm;

  function scheduleClicks() {
    if (stopped) return;
    while (t0 + nextClick * spb < ctx.currentTime + 0.5) {
      const t = t0 + nextClick * spb;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.value = nextClick % 4 === 0 ? 880 : 660;
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      osc.connect(g).connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.07);
      nextClick++;
    }
    const elapsed = ctx.currentTime - t0;
    if (elapsed >= durationSec) {
      stopped = true;
      events.onEnded && events.onEnded();
      return;
    }
    setTimeout(scheduleClicks, 120);
  }
  scheduleClicks();
  setTimeout(() => events.onPlaying && events.onPlaying(), 200);

  return {
    songTime() { return ctx.currentTime - t0; },
    isPlaying() { return !stopped; },
    sync() {}, hardSync() {},
    pause() {}, resume() {},
    stop() { stopped = true; try { ctx.close(); } catch {} },
    duration() { return durationSec; },
  };
}
