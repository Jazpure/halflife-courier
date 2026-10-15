// HalfLife: how far a row sits down the page sets how decayed it is, and how
// decayed it is sets every rule. Shared by the page and its workers.
(function (root) {
  const clamp01 = x => Math.max(0, Math.min(1, x));
  const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

  // Position down the page (0 top, 1 bottom) to decay (0 to 1). Mutation
  // builds steadily from near the top: it doubles every 55% of the page.
  const DOUBLINGS = 1.8;
  const decayAt = t => (Math.pow(2, DOUBLINGS * clamp01(t)) - 1) / (Math.pow(2, DOUBLINGS) - 1);

  // Decay to settings. Three bands, so the hierarchy holds:
  //   small  serifs, terminals and tittles: arrive first, at full strength
  //          within the first fifth of the page
  //   large  whole strokes and letters (weight, tilt, cuts, extenders,
  //          spacing, misstrikes, faint ink): start early, grow past the
  //          lab's baselines by the middle of the page
  //   crowd  the last stretch: letters stay heavily mutated but stop getting
  //          worse; instead they squeeze together and the lines close in
  //          until they overlap and can't be read
  const cache = new Map();
  function params(D) {
    const q = Math.round(clamp01(D) * 128) / 128;
    if (cache.has(q)) return cache.get(q);
    const small = Math.pow(clamp01(q / 0.12), 0.8);
    const large = smooth(0.02, 0.7, q) * 1.4;
    const crowd = smooth(0.5, 0.92, q);
    const P = {
      D: q,
      base: { size: 110, weight: 56, serifLen: 1 },
      extenders: { on: true, asc: 18 * large + 18 * crowd, desc: 18 * large + 18 * crowd },
      kerning: { on: true, amount: 14 * large + 10 * crowd },
      tilt: { on: true, angle: 2.3 * large + 9 * crowd },
      weights: { on: true, amount: 20 * large + 14 * crowd, meets: true },
      truncation: { on: true, chance: 14 * large + 30 * crowd, gap: 0.4 + 0.3 * crowd, tearShare: 50 - 15 * crowd },
      scatter: { on: crowd > 0, chance: 30 * crowd, offset: 100 * crowd, angle: 30 * crowd },
      serifs: {
        on: true,
        convert: 10 * small + 10 * large, toSerif: 50,
        tearSize: 0.9, tearElong: 1.4, tearGlide: 1, tearLean: 0,
        rounded: 50, roundness: 100, sharpness: 25 + 25 * large,
        flip: 25 * small + 25 * large,
      },
      tittles: { on: true, chance: 20 * small + 35 * large, maxRatio: 1.35 + 1.2 * large, shiftX: 3 * small + 8 * large, shiftY: 1 * small + 3 * large },
      // typewriter faults, drawn by the page
      strike: { chance: 4 * large + 8 * crowd, shift: 30 + 40 * crowd },
      faint: { chance: 5 * large + 8 * crowd },
      leading: 8 * large + 6 * crowd,         // ± % of the line height, fixed per row
      track: 1 - 0.6 * crowd,                 // letter spacing, as a share of the 600 u cell
      lineStep: 1 - 0.7 * crowd,              // line spacing, as a share of the line height
      bounce: 160 * crowd,                    // each letter off its baseline by up to this, in font units
      // how often a letter changes, in seconds: practically never at the top,
      // every couple of seconds lower down; in the crowded end, where there
      // are many more letters on screen, each one changes a little less often
      period: q > 0 ? Math.min(1e7, 1.6 * (1 + 1.5 * crowd) / Math.pow(q, 1.6)) : Infinity,
    };
    cache.set(q, P);
    return P;
  }

  // Untouched Courier, for the closing line: every rule off.
  let plainP = null;
  function plain() {
    if (!plainP) {
      const P = params(0);
      plainP = {
        ...P, D: 0, period: Infinity, bounce: 0, track: 1, lineStep: 1,
        extenders: { ...P.extenders, on: false }, kerning: { ...P.kerning, on: false },
        tilt: { ...P.tilt, on: false }, weights: { ...P.weights, on: false },
        truncation: { ...P.truncation, on: false }, scatter: { ...P.scatter, on: false },
        serifs: { ...P.serifs, on: false }, tittles: { ...P.tittles, on: false },
        strike: { ...P.strike, chance: 0 }, faint: { chance: 0 },
      };
    }
    return plainP;
  }

  // small integer hash to a number in [0, 1)
  function mix32(h) {
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
    return (h ^ (h >>> 16)) >>> 0;
  }
  const hash = (...xs) => { let h = 0x2545f491; for (const x of xs) h = mix32(h ^ mix32(x >>> 0)); return h; };
  const unit = (...xs) => hash(...xs) / 4294967296;

  // Each letter changes on its own rhythm: a period a little longer or
  // shorter than its row's, and its own starting phase, so changes never
  // line up. Returns which version of the letter shows at time t, and when
  // the next one arrives.
  function epochAt(gb, t, period) {
    if (!isFinite(period)) return { epoch: 0, next: Infinity };
    const p = period * (0.7 + 0.6 * unit(gb, 11));
    const phase = unit(gb, 12) * p;
    const epoch = Math.floor((t + phase) / p);
    return { epoch, next: (epoch + 1) * p - phase };
  }

  root.HALFLIFE = { decayAt, params, plain, hash, unit, mix32, epochAt };
})(typeof self !== 'undefined' ? self : window);
