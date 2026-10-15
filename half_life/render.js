// Draws a block of rows of one column into a canvas. Runs in the workers (or
// on the page if workers can't draw). Needs glyphs.js, engine.js and
// schedule.js.
//
// Every letter changes on its own rhythm (HALFLIFE.epochAt), so which version
// of a letter shows is a pure function of the clock: any block can be drawn at
// any moment without remembering history.
(function (root) {
  const GC = root.GENCOURIER, HL = root.HALFLIFE;
  const DEG = Math.PI / 180;
  const PIVOT = GC.TILT_PIVOT;
  const stats = new Proxy({}, { get: (o, k) => (k in o ? o[k] : 0), set: (o, k, v) => { o[k] = v; return true; } });

  // A letter's drawable form for one epoch.
  function makeLetter(ch, i, gseed, P) {
    const out = { ch, kern: 0, tilt: 0, bodies: [], fills: [], strike: null, faint: 0 };
    if (ch === ' ') return out;
    out.kern = GC.kernUnits(i, gseed, P);
    out.bounce = P.bounce ? (HL.unit(gseed, 701) * 2 - 1) * P.bounce : 0;
    const g = GC.buildGlyph(ch, i, gseed, P, stats);
    if (!g) return out;
    out.tilt = GC.tiltDegrees(i, gseed, P);
    out.bodies = g.bodies.map(b => ({ p: new Path2D(b.d), w: b.w || P.base.weight, round: /\bbs\b/.test(b.cls || '') }));
    out.fills = g.fills.map(([d]) => new Path2D(d));
    // typewriter faults
    if (HL.unit(gseed, 501) < P.strike.chance / 100) {
      const phi = HL.unit(gseed, 502) * Math.PI * 2;
      out.strike = {
        dx: (HL.unit(gseed, 503) * 2 - 1) * P.strike.shift,
        dy: (HL.unit(gseed, 504) * 2 - 1) * P.strike.shift * 0.6,
        turn: (HL.unit(gseed, 505) * 2 - 1) * 4,
        clip: halfPlane(phi, (HL.unit(gseed, 506) * 2 - 1) * 90),
        alpha: 0.22 + 0.16 * HL.unit(gseed, 507),
      };
    }
    if (HL.unit(gseed, 601) < P.faint.chance / 100) out.faint = 0.3 + 0.4 * HL.unit(gseed, 602);
    out.speckle = Math.floor(HL.unit(gseed, 603) * 3);
    return out;
  }

  // The half of the letter a misstrike leaves: everything on one side of a
  // line through the middle of the letter.
  function halfPlane(phi, off) {
    const c = [300 + Math.cos(phi) * off, 300 + Math.sin(phi) * off];
    const n = [Math.cos(phi), Math.sin(phi)], t = [-n[1], n[0]], R = 4000;
    const p = new Path2D();
    p.moveTo(c[0] + t[0] * R, c[1] + t[1] * R);
    p.lineTo(c[0] - t[0] * R, c[1] - t[1] * R);
    p.lineTo(c[0] - t[0] * R + n[0] * R, c[1] - t[1] * R + n[1] * R);
    p.lineTo(c[0] + t[0] * R + n[0] * R, c[1] + t[1] * R + n[1] * R);
    p.closePath();
    return p;
  }

  function paint(ctx, L, alpha) {
    ctx.globalAlpha = alpha;
    for (const b of L.bodies) { ctx.lineWidth = b.w; ctx.lineCap = b.round ? 'round' : 'butt'; ctx.stroke(b.p); }
    for (const f of L.fills) ctx.fill(f);
  }

  function drawLetter(ctx, L, M) {
    ctx.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]);
    if (L.tilt) { ctx.translate(PIVOT[0], PIVOT[1]); ctx.rotate(L.tilt * DEG); ctx.translate(-PIVOT[0], -PIVOT[1]); }
    if (L.strike) {
      // the first try: half the letter, faint and off register
      const s = L.strike;
      ctx.save();
      ctx.translate(s.dx, s.dy);
      ctx.translate(300, 300); ctx.rotate(s.turn * DEG); ctx.translate(-300, -300);
      ctx.clip(s.clip);
      paint(ctx, L, s.alpha);
      ctx.restore();
    }
    paint(ctx, L, 1);
  }

  // Dry ink: a few patterns of tiny holes, punched out of faint letters.
  const patterns = new Map();
  function speckle(ctx, make, which) {
    if (patterns.has(which)) return patterns.get(which);
    const S = 96, c = make(S, S), g = c.getContext('2d');
    let s = 0x9e3779b9 ^ (which * 7919);
    const rnd = () => (s = HL.mix32(s + 0x6d2b79f5)) / 4294967296;
    const density = [0.08, 0.13, 0.19][which];
    g.fillStyle = '#000';
    for (let k = 0, n = Math.round(density * S * S / 4); k < n; k++) {
      g.beginPath(); g.arc(rnd() * S, rnd() * S, 0.5 + rnd() * 1.1, 0, Math.PI * 2); g.fill();
    }
    const pat = ctx.createPattern(c, 'repeat');
    patterns.set(which, pat);
    return pat;
  }

  const rows = new Map();   // "c:r" → { cfg, epochs, letters }
  let scratch = null;

  // Bring one row's letters up to time t. Returns whether any changed, and
  // when the next change in the row is due.
  function updateRow(job, R) {
    const P = job.plain ? HL.plain() : HL.params(R.D);
    const key = job.col + ':' + R.row;
    const prev = rows.get(key);
    const fresh = job.force || !prev || prev.cfg !== job.cfg;
    const n = R.text.length;
    const epochs = new Array(n), letters = new Array(n);
    let changed = fresh, next = Infinity;
    for (let i = 0; i < n; i++) {
      const gb = HL.hash(job.seed, job.col, R.row, i);
      const e = HL.epochAt(gb, job.t, P.period);
      epochs[i] = e.epoch;
      if (R.text[i] !== ' ' && e.next < next) next = e.next;
      if (!fresh && prev.epochs[i] === e.epoch && prev.letters[i]) { letters[i] = prev.letters[i]; continue; }
      changed = true;
      letters[i] = makeLetter(R.text[i], i, HL.hash(gb, e.epoch, 77), P);
    }
    rows.delete(key);
    rows.set(key, { cfg: job.cfg, epochs, letters });
    if (rows.size > 1200) rows.delete(rows.keys().next().value);
    return { changed, next, letters };
  }

  // job: { key, cfg, seed, col, t, rows: [{ row, text, D, y, adv }], u, dpr, w, h, padX, padY, base, ink, force }
  // Returns { canvas | null, next }: null when nothing in the block changed.
  function block(job, make) {
    let changed = false, next = Infinity;
    const done = job.rows.map(R => {
      const r = updateRow(job, R);
      changed = changed || r.changed;
      next = Math.min(next, r.next);
      return r.letters;
    });
    if (!changed) return { canvas: null, next };

    const W = Math.ceil((job.w + 2 * job.padX) * job.dpr), H = Math.ceil((job.h + 2 * job.padY) * job.dpr);
    const canvas = make(W, H), ctx = canvas.getContext('2d');
    const INK = job.ink;
    ctx.fillStyle = ctx.strokeStyle = INK;
    ctx.lineJoin = 'round';
    const k = job.dpr * job.u;
    job.rows.forEach((R, ri) => {
      const y0 = (job.padY + R.y + job.base * job.u) * job.dpr;
      done[ri].forEach((L, i) => {
        if (L.ch === ' ' || (!L.bodies.length && !L.fills.length)) return;
        // each letter keeps its own spacing offset, so a change moves only it
        // (and near the end the letters squeeze together: R.adv < 1)
        const x0 = (job.padX + (i * 600 * R.adv + L.kern * 0.6) * job.u) * job.dpr;
        const M = [k, 0, 0, -k, x0, y0 - L.bounce * k];
        if (!L.faint) { drawLetter(ctx, L, M); return; }
        // faint letters: drawn alone, punched with dry ink holes, then laid in light
        if (!scratch || scratch.width !== W || scratch.height !== H) scratch = make(W, H);
        const sc = scratch.getContext('2d');
        const rx = Math.max(0, Math.floor(x0 - 1800 * k)), rw = Math.min(W - rx, Math.ceil(4200 * k));
        sc.setTransform(1, 0, 0, 1, 0, 0);
        sc.clearRect(rx, 0, rw, H);
        sc.fillStyle = sc.strokeStyle = INK;
        sc.lineJoin = 'round';
        drawLetter(sc, L, M);
        sc.setTransform(1, 0, 0, 1, 0, 0);
        sc.globalAlpha = 1;
        sc.globalCompositeOperation = 'destination-out';
        sc.fillStyle = speckle(sc, make, L.speckle);
        sc.fillRect(rx, 0, rw, H);
        sc.globalCompositeOperation = 'source-over';
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = L.faint;
        ctx.drawImage(scratch, rx, 0, rw, H, rx, 0, rw, H);
        ctx.globalAlpha = 1;
      });
    });
    return { canvas, next };
  }

  function reset() { rows.clear(); }

  root.HALFLIFE_RENDER = { block, reset };
})(typeof self !== 'undefined' ? self : window);
