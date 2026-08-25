# token-engine

Turns Claude Code token throughput into an engine note. The server tails Claude
Code's session transcripts and streams token bursts to a browser tachometer; the
page synthesises the engine sound from those bursts in real time.

A big agentic refactor pulls through the gears. A one-line answer is a throttle
blip. Silence decays back to a lopey idle.

## Install

You need Node and a browser. That's the whole list — there are no dependencies,
no `npm install`, and no build step. Any Node from 12 onward works (the code uses
nothing newer; verified on 15).

```sh
git clone https://github.com/msolters/token-engine.git
cd token-engine
node server.js
```

You should see:

```
token-engine running -> http://localhost:4321
watching: /Users/you/.claude/projects
```

Open **http://localhost:4321** and click **START ENGINE**. The click is required —
browsers refuse to start audio without one — so nothing will make a sound until
you press it.

Then go use Claude Code in another window and listen.

### Checking it's actually working

In the page header, the indicator should read **LINK**, and the left panel should
say **watching ~/.claude**. The odometer climbs as Claude Code burns tokens.

If it says **no transcripts found**, the server looked in the wrong place — see
`CLAUDE_PROJECTS` below.

If you hear nothing at all, work through these in order:

1. Did you press START ENGINE? It toggles to KILL ENGINE when running.
2. Drag the **demo throttle** slider up. That drives the engine by hand and
   proves the audio path works without waiting on any token traffic.
3. Open the browser console. It should log
   `[token-engine] simulation clock: audio-worklet`. If it says `timer` instead,
   the AudioWorklet failed to load and the engine will freeze whenever the window
   is covered — the warning line above it says why.

### Options

```sh
PORT=5000 node server.js                     # serve on a different port
CLAUDE_PROJECTS=/custom/path node server.js  # if your transcripts live elsewhere
```

### Keeping it running

`node server.js` runs in the foreground and stops when you close the terminal or
press Ctrl-C. To leave it running in the background:

```sh
nohup node server.js > /tmp/token-engine.log 2>&1 &
```

### Tuning the sound without the server

Open `test.html` directly in a browser — no server needed, just double-click it.
It drives the same audio graph with direct RPM and throttle sliders and a dBFS
output meter, so you can judge the engine note without waiting for token traffic.

## Files

| file | what it is |
| --- | --- |
| `server.js` | tails `~/.claude/projects/**/*.jsonl`, streams token bursts over SSE |
| `index.html` | the tachometer and the Web Audio engine synth |
| `test.html` | isolated audio bench — no server, no SSE, direct RPM/throttle control, dBFS meter |

## How it works

`server.js` watches the JSONL transcripts Claude Code appends to as it works,
pulls the `usage` block out of each line, and emits the delta every 250 ms as a
Server-Sent Event. Cache *reads* are deliberately excluded from the token count:
they're enormous and cheap, and including them pegs the throttle on every turn
of a long session.

`index.html` converts tokens/sec into throttle, feeds a simulated drivetrain
(idle 850, redline 3200, six gears), and drives a Web Audio graph: sawtooths
through tanh distortion and body resonances, amplitude-chugged at the cylinder
firing rate, plus intake hiss and decel burble pops.

## Tuning notes

These constants were fitted against captured sessions rather than guessed. If
you change one, the others are load-bearing:

**`SHIFT_UP` / `SHIFT_DN` / `SHIFT_DROP` (`index.html`)** — shift points are
absolute RPM, the way an automatic behaves, *not* a fraction of redline. Tying
upshifts to redline means every gear past 1st has an equilibrium below the
trigger once the load term is in, so the box can never leave 1st.

**`load = rpm * 0.45`** — an always-on drivetrain/aero term. Without it, drag is
`(1 - eff) * …`, which goes to zero at full throttle, so wide-open has nothing
opposing it and the engine climbs to the limiter and parks there.

**EMA decay in the SSE handler (`0.92`)** — this is the single most important
number for feel. Claude Code writes usage in **discrete impulses at request
completion**, never continuously; every burst is one 250 ms tick. So how long a
"rip" feels is set entirely by whether the EMA still remembers the last impulse
when the next one lands. Too short and full throttle collapses between requests
and the engine never gets past 3rd or 4th. Too long and it hangs high and never
returns to idle. 0.92 (≈2.1 s half-life) reaches top gear on a sustained agentic
run while still idling ~a third of the time on ordinary traffic.

**Full-throttle threshold (10,000 tok/s)** — real Claude Code throughput bursts
to 5,000–16,000 tok/s. The throttle curve is a normalised log,
`log1p(6·ema/full) / log1p(6)`: zero at rest, exactly 1.0 at the threshold, and
gentle in between.

**Tonal core sits an octave below the firing frequency.** A sawtooth pitched at
`fire` on top of amplitude modulation at `fire` reads as a wasp. The modulation
alone already implies the firing rate and generates the upper harmonics for free.

**The simulation is clocked off an `AudioWorklet`, not `requestAnimationFrame`.**
This is not an optimisation — it's required for correctness. Chrome throttles rAF
to ~1 Hz and eventually stops it whenever the tab is hidden or the window is
fully occluded, which is this app's normal operating state: you're in a terminal,
not staring at the gauge. Web Audio keeps rendering on its own thread, so a
throttled rAF doesn't pause the sound, it freezes the *parameters* — the graph
sustains whatever RPM it last saw. rAF is demoted to painting pixels.

## Caveats

The transcript format is internal to Claude Code and changes between versions.
If an update breaks parsing, the engine just sits at idle — the demo throttle
slider still works regardless.

The server tails *every* project under `~/.claude/projects`, so any concurrent
Claude Code session on the machine revs the same needle.
