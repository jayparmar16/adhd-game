# DIVE

A free, open-source **pixel action game** for adults with ADHD, where you build a character you keep.

You are a **Diver**, descending into your own mind. Each mental state is a place, and in each the hazard *is* the state. The first is **THE FLATS** — where an understimulated mind goes, and the danger is stillness: an erasing void trails you and takes whatever stops moving. You can't idle your way through, which is what understimulation actually feels like.

Three verbs, four hazards, each needing a different answer:

| Hazard | Answer |
|---|---|
| **Static swarm** | **Dash** through it — jumping won't clear it |
| **Rift** | **Jump** it |
| **Monolith** | **Pulse** to shatter it (dashing does *not* work) |
| **Lure** | **Dash** to break its pull |

Tying them together is a **momentum economy**: near-misses, shards and clean dashes build momentum, which is simultaneously your speed, your score, your Focus regen, and how far back you push the void. Hits and hesitation drain it.

**Your Diver levels up mostly from real focus work**, not from playing — a mission earns ~15 XP, a real focus block earns 120. The best gear unlocks only from work actually done, so the game can't become the procrastination.

> Also included: **FLUX / STAX / PULSE**, three earlier arcade-style primers behind a 3-question state check-in (at `#/prime`).

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
- Each game shows a **how-to-play card** with its goal and the controls **for your device** — key hints on desktop, tap/swipe hints on a phone.
- **FLUX:** flip gravity to dodge the neon blocks. **Near-miss** one to build your multiplier. Crash = instant restart.
- **STAX:** fill a row to clear it. Topping out just clears the board and keeps going — no crash, no shake.
- **PULSE:** tap the moment the ring meets the dot. Tempo climbs as you land them.
- Every game **adapts to you**: every 15 seconds it compares what you scored against par for your level and moves the level by `round(3 · log₂(scored/par))` — beat par by 4× and you jump 6 levels at once. It converges on your edge in about a minute and persists between sessions, so you start warm next time.
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

- **DIVE** — the pixel game: render pipeline (`pixel.js`), parametric avatar (`avatar.js`), THE FLATS (`flats.js`), XP/unlocks (`progress.js`), controller (`dive.js`)
- **FLUX** — gravity-flip runner (`runner.js`)
- **STAX** — falling-block stacker (`stax.js`)
- **PULSE** — tempo-tap ring (`pulse.js`)
- **The difficulty formula** — one shared adaptive staircase used by every game (`dda.js`)
- The check-in, arcade engine, and handoff live in `game.js`; optional YouTube music via `yt.js`

## Art pipeline

Everything draws to a fixed **320×180** buffer, then blits to screen at an **integer** scale with smoothing off. That one rule makes inconsistent pixel sizes structurally impossible. Add a locked ~20-colour palette with proper ramps, a hand-defined 5×7 bitmap font, and canvas-native UI (no crisp DOM widgets sitting next to sprites), and the art reads as deliberate rather than cheap. The avatar is assembled from parametric parts and posed procedurally, so customization and gear are data rather than hand-drawn frames.
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
