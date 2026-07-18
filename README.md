# FLUX / STAX / PULSE

Three free, open-source **flow-state games** for adults with ADHD, plus a 3-question check-in that picks the right one for how you feel right now.

ADHD isn't a fixed lack of attention — it's unstable arousal *regulation*, and the same brain can be wired-and-racing at 10am and foggy-and-stuck at 3pm. So instead of one game, there are three, each tuned to a different arousal state:

- **Racing / wired** → **STAX**, a slow neon block-stacker. Visuospatial load crowds out the verbal racing thoughts.
- **Flat / bored** → **FLUX**, a gravity-flip runner. Fast, real stakes, the loop an understimulated brain craves.
- **Foggy / can't start** → **PULSE**, a tempo-tap ring that ramps from 60 to ~132 bpm. External rhythm nudges a stalled system toward optimal arousal.

Answer 3 taps (or skip straight to a game) and it launches. Every game gets you a few minutes in — then hands you off, primed, into your real work. No account, no tracking, no subscription.

> Not a medical device. Not a treatment for ADHD. A wellness tool informed by published research. If ADHD is affecting your life, please talk to a clinician.

See the [strategy and evidence](./STRATEGY.md) for the research behind the check-in and each game's design.

## Try it

No install, no build step:

```sh
python -m http.server 8080
# then open http://localhost:8080
```

All three games work fully offline. Adding background music (optional, FLUX/STAX only) needs a network connection (it plays via the YouTube embed).

## How to play

- Open it → answer **3 taps** about how you feel right now (or hit "I know what I want" and pick a game directly).
- **FLUX:** tap / click / space to flip gravity. Snap between rails to dodge neon blocks. **Near-miss** an obstacle to build your multiplier. Crash = instant restart.
- **STAX:** ←/→ to move, ↑ to rotate, ↓ to soft-drop (swipe down on touch = hard drop). Clear lines for a soft glow. Topping out just clears the board and keeps going — no crash, no shake.
- **PULSE:** tap / click / space the instant the ring closes on the target. Tempo climbs on a hit streak, eases off on a miss streak.
- Every game **adapts to you** between runs — FLUX and STAX carry a persisted skill/level, PULSE carries a persisted starting tempo — so it stays in the flow channel: never boring, never hopeless.
- When you're warmed up, hit **Stop** → **Start a focus block** and it carries you into the task you named, with a calm timer and a garden that grows each session.

Optionally paste a **YouTube link** on the start screen and your song plays underneath as a backing track (FLUX and STAX only — PULSE has its own click track).

## Design guardrails (from the [strategy doc](./STRATEGY.md))

- The check-in is 3 taps, always skippable, never blocks getting to a game.
- Continuous motion + instant/soft retry (quiets the self-monitoring prefrontal cortex → flow).
- Real stakes where the state calls for it (FLUX), zero fail-state where it doesn't (STAX) — matched to arousal, not one-size-fits-all.
- Adaptive difficulty in all three (challenge ≈ skill).
- Nudges you toward your real task the longer you play — a dopamine game shouldn't become the procrastination.
- Colorblind-safe (shapes/position, not just hue), respects `prefers-reduced-motion`, no strobing.

## What's in it

- **FLUX** — gravity-flip runner (`runner.js`)
- **STAX** — falling-block stacker (`stax.js`)
- **PULSE** — tempo-tap ring (`pulse.js`)
- The check-in, shared canvas engine, and handoff live in `game.js`; optional YouTube music via `yt.js`
- **Alongside** — the handoff destination: a calm focus timer, session reflection, and a garden that grows one flower per focus block (`app.js`)
- Full local-first storage (no account), export/import as JSON, PWA install + offline

## Roadmap

- Time-of-day auto-suggestion once there's enough check-in history to learn from
- More obstacle types / hazard variety and a daily seed
- Peer body-doubling rooms (WebRTC) for the focus layer
- CBT skills micro-cards between sessions

## Tech

Vanilla HTML / CSS / JS ES modules. Zero build step, zero npm dependencies. Canvas game engine, static PWA. Deploys free from any static host (GitHub Pages, Cloudflare Pages).

Run the logic self-check: `node test.mjs`.

## Contributing

Issues and PRs welcome. Design principles: real stakes but never punishing, retention over intensity, no dark patterns. A change that adds a guilt notification, an account requirement, or anything designed to keep you *in* the app rather than launch you into your work is out of scope.

## License

MIT. See [LICENSE](./LICENSE).
