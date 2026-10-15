# HalfLife Courier

A procedurally generative typeface built from Courier, where every sentence renders differently, and a webpage that lets it decay.

## HalfLife (`half_life/`)

"All work and no play makes Jack a dull boy." repeated down four columns. It starts as plain Courier and decays as the page goes on: first the serifs, terminals and tittles change, then whole strokes and letters (weight, tilt, cuts, extenders, spacing, misstrikes, faint ink), until near the end the letters and lines close in and overlap past reading. The letters never stop changing, slowly at the top and constantly at the bottom. Every visitor gets their own seed.

## The lab (`index.html`)

The tool the typeface is tuned in. Each disruption is a dropdown of sliders, in the order the rules run:

- Ascenders / Descenders: extender length
- Kerning: spacing between letter pairs
- Line spacing: distance from each line to the one above
- Tilt: each letter turned slightly
- Stroke weight: each line of a letter at its own weight
- Truncation: a stroke cut, with a serif or tear after the gap
- Scatter: strokes coming loose from their letters
- Terminals / Serifs: serifs to tear terminals and back, rounded or sharp, changing direction
- Tittles: dots of i and j replaced by symbols or shifted

## How it is built

- `glyphs.js` draws Courier as skeleton strokes in font units, with the serif each stroke end carries.
- `engine.js` builds each letter from its skeleton and applies the rules. Every random choice is a fixed roll per seed, letter and rule, so moving a slider never reshuffles the rest.
- `half_life/` draws the page on canvases in background workers (`worker.js`, `render.js`). `schedule.js` maps how far down the page a line is to how decayed it is.

## Running it

It needs to be served, not opened as a file, because the page uses web workers:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000/ for the lab and http://localhost:8000/half_life/ for the page.
