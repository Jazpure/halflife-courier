// Geometry and the disruption rules. Glyphs come from glyphs.js.
//
// Every random choice is a fixed roll per (seed, letter position, stroke, end,
// rule), so a slider only moves a threshold: raising "Serif to terminal" from
// 10% to 20% keeps the first 10% and adds more, it never reshuffles them.

(function () {
  // ---------- vectors
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const mul = (a, k) => [a[0] * k, a[1] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  const len = a => Math.hypot(a[0], a[1]);
  const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
  const perp = a => [-a[1], a[0]];
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const f = n => (Math.round(n * 10) / 10).toString();
  const pt = p => f(p[0]) + ' ' + f(p[1]);
  const DEG = Math.PI / 180;

  // ---------- seeded rolls
  function mix32(h) {
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function roll(seed, idx, si, ei, k) {
    let h = mix32(seed >>> 0);
    h = mix32(h ^ Math.imul(idx + 1, 0x9e3779b1));
    h = mix32(h ^ Math.imul(si + 1, 0x85ebca77));
    h = mix32(h ^ Math.imul(ei + 1, 0xc2b2ae3d));
    h = mix32(h ^ Math.imul(k + 1, 0x27d4eb2f));
    return h / 4294967296;
  }
  function hashStr(s) {
    let h = 0x811c9dc5;
    for (const c of s) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }

  // ---------- paths
  function ellipseArc(cx, cy, rx, ry, a0, a1) {
    const segs = [];
    const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / 90));
    const step = (a1 - a0) / n * DEG;
    for (let i = 0; i < n; i++) {
      const t0 = a0 * DEG + i * step, t1 = t0 + step;
      const k = 4 / 3 * Math.tan(step / 4);
      const p0 = [cx + rx * Math.cos(t0), cy + ry * Math.sin(t0)];
      const p3 = [cx + rx * Math.cos(t1), cy + ry * Math.sin(t1)];
      const p1 = add(p0, mul([-rx * Math.sin(t0), ry * Math.cos(t0)], k));
      const p2 = sub(p3, mul([-rx * Math.sin(t1), ry * Math.cos(t1)], k));
      segs.push([p0, p1, p2, p3]);
    }
    return segs;
  }
  const lineSeg = (a, b) => { const s = [a, add(a, mul(sub(b, a), 1 / 3)), add(a, mul(sub(b, a), 2 / 3)), b]; s.line = true; return s; };
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  function splitBez(s, t) {
    const l1 = lerp(s[0], s[1], t), l2 = lerp(s[1], s[2], t), l3 = lerp(s[2], s[3], t);
    const m1 = lerp(l1, l2, t), m2 = lerp(l2, l3, t), p = lerp(m1, m2, t);
    return [[s[0], l1, m1, p], [p, m2, l3, s[3]]];
  }

  function parsePath(str) {
    const tok = str.match(/[A-Za-z]|-?\d*\.?\d+/g);
    let i = 0, cur = null;
    const segs = [];
    const num = () => parseFloat(tok[i++]);
    while (i < tok.length) {
      const c = tok[i++];
      if (c === 'M') cur = [num(), num()];
      else if (c === 'L') { const p = [num(), num()]; segs.push(lineSeg(cur, p)); cur = p; }
      else if (c === 'H') { const p = [num(), cur[1]]; segs.push(lineSeg(cur, p)); cur = p; }
      else if (c === 'V') { const p = [cur[0], num()]; segs.push(lineSeg(cur, p)); cur = p; }
      else if (c === 'C') {
        const a = [num(), num()], b = [num(), num()], p = [num(), num()];
        segs.push([cur, a, b, p]); cur = p;
      } else if (c === 'E') {
        const arc = ellipseArc(num(), num(), num(), num(), num(), num());
        if (!cur) cur = arc[0][0];
        else if (len(sub(cur, arc[0][0])) > 0.5) segs.push(lineSeg(cur, arc[0][0]));
        segs.push(...arc);
        cur = arc[arc.length - 1][3];
      }
    }
    const first = segs[0][0], last = segs[segs.length - 1][3];
    return { segs, closed: len(sub(first, last)) < 0.5 };
  }

  function segsToD(segs, closed, map = p => p) {
    let d = 'M' + pt(map(segs[0][0]));
    for (const s of segs) d += 'C' + pt(map(s[1])) + ' ' + pt(map(s[2])) + ' ' + pt(map(s[3]));
    return closed ? d + 'Z' : d;
  }

  function bez(s, t) {
    const u = 1 - t;
    return [
      u * u * u * s[0][0] + 3 * u * u * t * s[1][0] + 3 * u * t * t * s[2][0] + t * t * t * s[3][0],
      u * u * u * s[0][1] + 3 * u * u * t * s[1][1] + 3 * u * t * t * s[2][1] + t * t * t * s[3][1],
    ];
  }

  // Polyline sample of a stroke with running arc length.
  function samplePolyline(segs) {
    const pts = [segs[0][0]];
    for (const s of segs) for (let k = 1; k <= 24; k++) pts.push(bez(s, k / 24));
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + len(sub(pts[i], pts[i - 1])));
    return { pts, cum };
  }

  // Point a set arc distance back from an end, with the stroke's direction
  // there (pointing further away from the end).
  function pointBackT(st, fromEnd, dist) {
    const P = st.poly, n = P.length;
    let acc = 0;
    for (let k = 1; k < n; k++) {
      const a = fromEnd ? P[n - k] : P[k - 1], b = fromEnd ? P[n - k - 1] : P[k];
      const l = len(sub(b, a));
      if (acc + l >= dist) return { p: add(a, mul(sub(b, a), (dist - acc) / (l || 1))), t: norm(sub(b, a)) };
      acc += l;
    }
    const a = fromEnd ? P[1] : P[n - 2], b = fromEnd ? P[0] : P[n - 1];
    return { p: b, t: norm(sub(b, a)) };
  }

  // Segment and parameter at an arc distance from the stroke's start.
  function locate(st, arc) {
    const { cum } = st;
    let k = 0;
    while (k < cum.length - 2 && cum[k + 1] < arc) k++;
    const kk = k + clamp((arc - cum[k]) / ((cum[k + 1] - cum[k]) || 1), 0, 1);
    const seg = Math.min(Math.floor(kk / 24), st.segs.length - 1);
    return { seg, t: clamp((kk - seg * 24) / 24, 0, 1) };
  }

  // The stroke's segments with `a0` cut off its start and `a1` off its end.
  function trimSegs(st, a0, a1) {
    if (!(a0 > 0) && !(a1 > 0)) return st.segs;
    const p = locate(st, Math.max(a0, 0)), q = locate(st, st.length - Math.max(a1, 0));
    if (p.seg === q.seg) {
      const left = splitBez(st.segs[q.seg], q.t)[0];
      return [splitBez(left, q.t > 0 ? p.t / q.t : 0)[1]];
    }
    return [splitBez(st.segs[p.seg], p.t)[1], ...st.segs.slice(p.seg + 1, q.seg), splitBez(st.segs[q.seg], q.t)[0]];
  }

  function endInfo(segs, atEnd) {
    if (!atEnd) {
      const s = segs[0];
      let v = sub(s[0], s[1]);
      if (len(v) < 1e-6) v = sub(s[0], s[2]);
      return { E: s[0], d: norm(v) };
    }
    const s = segs[segs.length - 1];
    let v = sub(s[3], s[2]);
    if (len(v) < 1e-6) v = sub(s[3], s[1]);
    return { E: s[3], d: norm(v) };
  }

  // Arc distance of polyline vertex k from one end of its stroke.
  const arcFrom = (st, k, atEnd) => atEnd ? st.length - st.cum[k] : st.cum[k];

  // Does any centreline point of the glyph pass the test? The stroke that owns
  // the end is skipped near that end, where it is always close by.
  function anyPoint(g, si, atEnd, ownSkip, test) {
    for (let j = 0; j < g.strokes.length; j++) {
      const st = g.strokes[j];
      for (let k = 0; k < st.poly.length; k++) {
        if (j === si && arcFrom(st, k, atEnd) < ownSkip) continue;
        if (test(st.poly[k])) return true;
      }
    }
    return false;
  }

  function distToSeg(p, a, b) {
    const ab = sub(b, a);
    const t = clamp(dot(sub(p, a), ab) / (dot(ab, ab) || 1), 0, 1);
    return len(sub(p, add(a, mul(ab, t))));
  }

  // A plain end is a free terminal unless it sits on another stroke (a join).
  function isFreeEnd(g, si, end) {
    for (let j = 0; j < g.strokes.length; j++) {
      const st = g.strokes[j];
      for (let k = 1; k < st.poly.length; k++) {
        if (j === si && Math.max(arcFrom(st, k, end.atEnd), arcFrom(st, k - 1, end.atEnd)) < 40) continue;
        if (distToSeg(end.E, st.poly[k - 1], st.poly[k]) < 6) return false;
      }
    }
    return true;
  }

  // The serif a free terminal would get. Curved ends get a beak on the inside
  // of the curve (vertical, unless the end itself is near vertical). Straight
  // ends get a two sided slab square to the stroke.
  function terminalSerifSpec(st, end) {
    const d = end.d;
    const t1 = mul(pointBackT(st, end.atEnd, Math.min(50, st.length * 0.4)).t, -1);
    const turn = cross(t1, d);
    const curved = Math.abs(turn) > Math.sin(8 * DEG);
    if (!curved) return { ax: Math.abs(d[0]) >= Math.abs(d[1]) ? 'v' : 'h', n: 55, p: 55 };
    const ax = Math.abs(d[1]) > 0.9 ? 'h' : 'v';
    const concave = turn > 0 ? perp(d) : mul(perp(d), -1);
    const k = dot(concave, ax === 'h' ? [1, 0] : [0, 1]);
    if (Math.abs(k) < 0.15) return { ax, n: 55, p: 55 };
    return k > 0 ? { ax, n: 0, p: 80 } : { ax, n: 80, p: 0 };
  }

  // ---------- stroke pieces
  // Positions along a stroke are kept as fractional sample indices (24 per
  // segment), so they stay put when the extender stretch rebuilds the samples.
  function arcAtK(st, K) {
    const k = Math.floor(K);
    if (k >= st.cum.length - 1) return st.length;
    return st.cum[k] + (K - k) * (st.cum[k + 1] - st.cum[k]);
  }

  // Where a stroke turns a corner (the vertex of a v, the bar of an e meeting
  // its bowl): one line ends there and another begins.
  function cornerSplits(st) {
    if (st.closed) return [];
    const out = [];
    for (let b = 1; b < st.segs.length; b++) {
      const a = st.segs[b - 1], c = st.segs[b];
      let tin = sub(a[3], a[2]);
      if (len(tin) < 1e-6) tin = sub(a[3], a[1]);
      let tout = sub(c[1], c[0]);
      if (len(tout) < 1e-6) tout = sub(c[2], c[0]);
      if (dot(norm(tin), norm(tout)) < Math.cos(25 * DEG)) out.push(b * 24);
    }
    return out;
  }

  // t along p0→p1 where it properly crosses q0→q1, or null.
  function segCross(p0, p1, q0, q1) {
    const r = sub(p1, p0), s = sub(q1, q0), den = cross(r, s);
    if (Math.abs(den) < 1e-9) return null;
    const qp = sub(q0, p0), t = cross(qp, s) / den, u = cross(qp, r) / den;
    return t > 0 && t < 1 && u > 0 && u < 1 ? t : null;
  }

  // Where another stroke ends on this one or crosses it, away from its own
  // ends (the shoulder of an h on its stem, the bar of a t across its stem).
  function meetSplits(g, si) {
    const st = g.strokes[si];
    if (st.closed) return [];
    const P = st.poly, found = [];
    const add_ = K => { const a = arcAtK(st, K); if (a > 30 && a < st.length - 30) found.push(K); };
    g.strokes.forEach((o, j) => {
      if (j === si) return;
      for (const e of o.ends) {
        let best = Infinity, bestK = 0;
        for (let k = 1; k < P.length; k++) {
          const ab = sub(P[k], P[k - 1]);
          const t = clamp(dot(sub(e.E, P[k - 1]), ab) / (dot(ab, ab) || 1), 0, 1);
          const dd = len(sub(e.E, add(P[k - 1], mul(ab, t))));
          if (dd < best) { best = dd; bestK = k - 1 + t; }
        }
        if (best < 6) add_(bestK);
      }
      const Q = o.poly;
      for (let k = 1; k < P.length; k++) for (let m = 1; m < Q.length; m++) {
        const t = segCross(P[k - 1], P[k], Q[m - 1], Q[m]);
        if (t !== null) add_(k - 1 + t);
      }
    });
    found.sort((a, b) => a - b);
    const merged = [];
    for (const K of found) if (!merged.length || arcAtK(st, K) - arcAtK(st, merged[merged.length - 1]) > 20) merged.push(K);
    return merged;
  }

  function compileGlyph(ch, g) {
    const isLetter = /^[A-Za-z]$/.test(ch);
    const out = { strokes: [], dots: g.dots || [], tittle: g.tittle || null };
    out.strokes = g.s.map(([path, s0, s1]) => {
      const { segs, closed } = parsePath(path);
      const { pts, cum } = samplePolyline(segs);
      return {
        segs, closed, d: segsToD(segs, closed), poly: pts, cum, length: cum[cum.length - 1],
        ends: closed ? [] : [
          { ...endInfo(segs, false), spec: s0 || null, atEnd: false },
          { ...endInfo(segs, true), spec: s1 || null, atEnd: true },
        ],
      };
    });
    if (isLetter) out.strokes.forEach((st, si) => st.ends.forEach(end => {
      if (!end.spec && isFreeEnd(out, si, end)) end.termSpec = terminalSerifSpec(st, end);
    }));
    out.strokes.forEach((st, si) => { st.cornerK = cornerSplits(st); st.meetK = meetSplits(out, si); });
    out.strokes.forEach((st, si) => st.ends.forEach(e => { e.joined = !isFreeEnd(out, si, e); }));
    // centreline bounds, used to scale a symbol into a tittle
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    let ix0 = Infinity, iy0 = Infinity, ix1 = -Infinity, iy1 = -Infinity;
    const grow = (p, r) => {
      x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
      ix0 = Math.min(ix0, p[0] - r); ix1 = Math.max(ix1, p[0] + r); iy0 = Math.min(iy0, p[1] - r); iy1 = Math.max(iy1, p[1] + r);
    };
    for (const st of out.strokes) for (const p of st.poly) grow(p, 28);
    for (const p of out.dots) grow(p, 38);
    out.box = { x0, y0, x1, y1 };
    out.ratio = (iy1 - iy0) / (ix1 - ix0);   // ink height to width at the default weight
    // lowercase extenders: anything well above the x-height or below the baseline
    const lower = /^[a-z]$/.test(ch);
    out.hasAsc = lower && y1 > X_HEIGHT + 60;
    out.hasDesc = lower && y0 < -60;
    return out;
  }

  const X_HEIGHT = 430, EXT = 200;   // x-height; ascender and descender depth beyond it

  // The same glyph with its skeleton moved by mapY (per instance). Serif specs,
  // terminal specs and joins carry over; ends and samples are rebuilt.
  function deriveGlyph(g, mapY) {
    const mapSeg = s => {
      const a = [s[0][0], mapY(s[0][1])], b = [s[3][0], mapY(s[3][1])];
      return s.line ? lineSeg(a, b) : [a, [s[1][0], mapY(s[1][1])], [s[2][0], mapY(s[2][1])], b];
    };
    return {
      ...g,
      strokes: g.strokes.map(st => {
        const segs = st.segs.map(mapSeg);
        const { pts, cum } = samplePolyline(segs);
        return {
          ...st, segs, d: segsToD(segs, st.closed), poly: pts, cum, length: cum[cum.length - 1],
          ends: st.ends.map(e => ({ ...e, ...endInfo(segs, e.atEnd) })),
        };
      }),
    };
  }

  const COMPILED = {};
  for (const [ch, g] of Object.entries(window.COURIER_SKELETON)) COMPILED[ch] = compileGlyph(ch, g);

  // ---------- overlap checks (cached per glyph, end and size)
  const cache = new Map();
  const memo = (key, fn) => {
    if (!cache.has(key)) { if (cache.size > 40000) cache.clear(); cache.set(key, fn()); }
    return cache.get(key);
  };

  // Would this slab run into another part of the letter (a shoulder, a bowl,
  // a bar)? Used to keep serifs facing away from those strokes.
  function slabBlocked(ch, g, si, end, spec, h) {
    const key = `s|${ch}|${si}|${+end.atEnd}|${spec.ax}|${Math.round(spec.n)}|${Math.round(spec.p)}|${Math.round(h)}`;
    return memo(key, () => {
      const s = spec.ax === 'h' ? [1, 0] : [0, 1];
      let w = perp(s);
      if (dot(w, end.d) < 0) w = mul(w, -1);
      const dir = spec.p > 0 ? s : mul(s, -1);
      const L = Math.max(spec.n, spec.p), pad = h * 1.15;
      return anyPoint(g, si, end.atEnd, 3 * h, p => {
        const r = sub(p, end.E), u = dot(r, dir), v = dot(r, w);
        return u > h * 0.5 && u < L + pad && v > -h - pad && v < h + pad;
      });
    });
  }

  // ---------- shapes
  const circle = (c, r) =>
    `M${pt([c[0] + r, c[1]])}A${f(r)} ${f(r)} 0 1 0 ${pt([c[0] - r, c[1]])}A${f(r)} ${f(r)} 0 1 0 ${pt([c[0] + r, c[1]])}Z`;

  // Polygon with optional rounded corners (radius per vertex, 0 = sharp).
  function roundPoly(pts, radii) {
    const n = pts.length;
    let d = '';
    for (let i = 0; i < n; i++) {
      const p = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
      const cmd = i ? 'L' : 'M';
      let r = radii[i];
      const la = len(sub(p, a)), lb = len(sub(b, p));
      if (r > 0.01 && la > 0.01 && lb > 0.01) {
        const e1 = norm(sub(p, a)), e2 = norm(sub(b, p));
        const th = Math.acos(clamp(-dot(e1, e2), -1, 1));
        if (th > 0.01 && th < Math.PI - 0.01) {
          let t = r / Math.tan(th / 2);
          const tmax = Math.min(la, lb) * 0.5;
          if (t > tmax) { t = tmax; r = t * Math.tan(th / 2); }
          const A = sub(p, mul(e1, t)), B = add(p, mul(e2, t));
          d += cmd + pt(A) + `A${f(r)} ${f(r)} 0 0 ${cross(e1, e2) > 0 ? 1 : 0} ` + pt(B);
          continue;
        }
      }
      d += cmd + pt(p);
    }
    return d + 'Z';
  }

  // A slab serif sitting on a stroke end.
  //   u runs along the slab (axis s), v across it (w points away from the
  //   letter). The slab is one stroke weight thick, its outer edge where a
  //   round end would have reached.
  function serifPath(E, d, spec, sw, look) {
    const h = sw / 2;
    const s = spec.ax === 'h' ? [1, 0] : [0, 1];
    let w = perp(s);
    if (dot(w, d) < 0) w = mul(w, -1);
    const hw = h / Math.max(0.3, Math.abs(dot(s, perp(d))));
    const negTip = spec.n > hw + 1, posTip = spec.p > hw + 1;
    const a = Math.max(spec.n, hw), b = Math.max(spec.p, hw);
    const rr = look.rounded ? look.round * h : 0;
    const tv = look.rounded ? -h : -h + look.taper * 2 * h;
    const P = [], R = [];
    P.push([-a, h]); R.push(rr);
    P.push([b, h]); R.push(rr);
    if (posTip) { P.push([b, tv]); R.push(rr); P.push([hw, -h]); R.push(0); }
    else { P.push([b, -h]); R.push(0); }
    if (negTip) { P.push([-hw, -h]); R.push(0); P.push([-a, tv]); R.push(rr); }
    else { P.push([-a, -h]); R.push(0); }
    const world = P.map(([u, v]) => add(E, add(mul(s, u), mul(w, v))));
    return roundPoly(world, R);
  }

  // Tear terminal. A round bulb forms the end of the stroke: it is pulled back
  // so its tip reaches exactly where the round end did (never past the
  // baseline or x-height), it sits flush with the stroke's outer edge, and it
  // swells toward `side`. The stroke is trimmed under it. Its back glides into
  // the stroke along a curve that leaves the bulb on its tangent and lands on
  // the stroke's edge on the edge's own direction, so there is no corner.
  //
  // Local frame: x along the stroke (out of the end), y toward the bulb side.
  const TEAR_LEN = 0.9;   // fixed: the tail length Jasper chose, in weights
  // The bulb is an ellipse: R across the stroke, R × elong along it.
  function tearFrame(sw, T) {
    const h = sw / 2;
    const R = Math.max(T.size * sw, h * 1.05);
    const RL = R * (T.elong || 1);
    const pull = RL - h;  // how far the bulb sits back from the old end
    return { h, R, RL, pull, C: [-pull, (R - h) + T.lean * R] };
  }
  function tearPath(st, end, side, sw, T) {
    const { h, R, RL, pull, C } = tearFrame(sw, T);
    const d = end.d, n = side;
    const toW = q => add(end.E, add(mul(d, q[0]), mul(n, q[1])));

    // Where the glide leaves the bulb, and the direction it leaves in.
    const a1 = 150 * DEG;
    const B = [C[0] + RL * Math.cos(a1), C[1] + R * Math.sin(a1)];
    const tB = norm([-RL * Math.sin(a1), R * Math.cos(a1)]);

    // With no glide, land where the original straight sided tear of length
    // TEAR_LEN met the stroke's edge (measured from the bulb), so the tear
    // keeps that overall length.
    const C0 = [0, C[1]];
    const P = [-TEAR_LEN * sw, 0];
    const D = sub(C0, P), dist = len(D), u = mul(D, 1 / dist);
    const phi = Math.acos(clamp((h - R) / dist, -1, 1));
    const rot = (v, a) => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];
    let m = rot(u, phi);
    const m2 = rot(u, -phi);
    if (m2[1] > m[1]) m = m2;
    const A = add(P, mul(m, h)), Bo = add(C0, mul(m, R));
    let corner = -(B[0] + pull);
    if (Bo[1] > h && A[1] < h) corner = -(Bo[0] + (A[0] - Bo[0]) * (Bo[1] - h) / (Bo[1] - A[1]));
    const back = Math.min(Math.max(corner + R - h, -B[0] + 0.3 * h) + T.glide * sw, st.length * 0.85);
    const Et = pointBackT(st, end.atEnd, Math.min(pull, st.length * 0.5)).p;

    const { p: Sc, t: tb } = pointBackT(st, end.atEnd, back);
    let nl = perp(tb);
    if (dot(nl, n) < 0) nl = mul(nl, -1);
    const S = add(Sc, mul(nl, h));
    const Bw = toW(B), tBw = add(mul(d, tB[0]), mul(n, tB[1]));
    const gap = len(sub(S, Bw));
    const P1 = add(Bw, mul(tBw, gap * 0.45));
    const P2 = sub(S, mul(tb, gap * 0.55));

    const arc = ellipseArc(C[0], C[1], RL, R, -90, 150).map(sg => sg.map(toW));
    let path = 'M' + pt(arc[0][0]);
    for (const sg of arc) path += 'C' + pt(sg[1]) + ' ' + pt(sg[2]) + ' ' + pt(sg[3]);
    path += 'C' + pt(P1) + ' ' + pt(P2) + ' ' + pt(S) + 'L' + pt(Sc) + 'L' + pt(Et) + 'Z';
    return path;
  }

  function tearBlocked(ch, g, si, end, side, sw, T) {
    const { h, R, RL, C } = tearFrame(sw, T);
    const key = `t|${ch}|${si}|${+end.atEnd}|${Math.round(side[0] * 9)}|${Math.round(side[1] * 9)}|${Math.round(R)}|${Math.round(RL)}|${Math.round(C[1])}|${Math.round(h)}`;
    return memo(key, () => {
      const Cw = add(end.E, add(mul(end.d, C[0]), mul(side, C[1])));
      return anyPoint(g, si, end.atEnd, 2 * RL + 2 * h, p => len(sub(p, Cw)) < Math.max(R, RL) + h * 1.1);
    });
  }

  // ---------- rules
  // Category: Terminals / Serifs.
  //   1. Serif to terminal: chance a serif becomes a tear terminal.
  //   2. Terminal to serif: chance a free terminal becomes a serif. Always a
  //      share of the first chance, so it is always the lesser rate.
  //   3. Rounded or sharp: serifs that stay serifs are one or the other.
  //   4. Direction change: a serif or tear moves to the other side of its
  //      stroke, keeping square to it. Two sided serifs are left alone, and
  //      nothing turns toward a shoulder, bowl or bar it would run into.
  function serifRule(ctx, end, spec, roll, C) {
    const res = { kind: 'serif', spec, rounded: true, flipped: false, canFlip: false };
    if (!C.on) { res.base = true; return res; }
    const oneSided = (spec.n > 0) !== (spec.p > 0);
    const s = spec.ax === 'h' ? [1, 0] : [0, 1];
    const flip = roll(3) < C.flip / 100;

    if (ctx.mayTear && roll(1) < C.convert / 100) {
      res.kind = 'tear';
      const hint = oneSided ? mul(s, spec.p > spec.n ? 1 : -1) : mul(s, roll(4) < 0.5 ? -1 : 1);
      let side = sub(hint, mul(end.d, dot(hint, end.d)));
      side = len(side) < 1e-3 ? perp(end.d) : norm(side);
      if (!oneSided && ctx.tearBlocked(side) && !ctx.tearBlocked(mul(side, -1))) side = mul(side, -1);
      res.canFlip = !ctx.tearBlocked(mul(side, -1));
      if (flip && res.canFlip) { side = mul(side, -1); res.flipped = true; }
      res.side = side;
      return res;
    }

    res.rounded = roll(2) < C.rounded / 100;
    if (oneSided) {
      const turned = { ax: spec.ax, n: spec.p, p: spec.n };
      res.canFlip = !ctx.slabBlocked(turned);
      if (flip && res.canFlip) { res.spec = turned; res.flipped = true; }
    }
    return res;
  }

  // Category: Tittles. Pool of symbols short enough to sit on a stem.
  const poolCache = new Map();
  function tittlePool(maxRatio) {
    const key = maxRatio.toFixed(3);
    if (!poolCache.has(key)) {
      const pool = window.TITTLE_SYMBOLS.filter(([ch]) => COMPILED[ch] && COMPILED[ch].ratio <= maxRatio);
      const total = pool.reduce((a, [, w]) => a + w, 0);
      poolCache.set(key, pool.map(([ch, w]) => ({ ch, w, share: w / total, ratio: COMPILED[ch].ratio })));
    }
    return poolCache.get(key);
  }
  function pickSymbol(x, maxRatio) {
    const pool = tittlePool(maxRatio);
    let acc = 0;
    for (const s of pool) { acc += s.share; if (x < acc) return s.ch; }
    return pool.length ? pool[pool.length - 1].ch : null;
  }

  // Symbols are drawn at half the weight, scaled into a small box on the stem.
  const SYM_W = 300, SYM_H = 190, SYM_KMAX = 0.45;
  function drawTittle(c, sym, sw, bodies, fills) {
    const rt = sw * 0.68;
    if (!sym) { fills.push([circle(c, rt), 'tt']); return; }
    if (sym === '¨') {
      for (const sx of [-1, 1]) fills.push([circle([c[0] + sx * 1.4 * rt, c[1]], rt * 0.8), 'hy']);
      return;
    }
    const g = COMPILED[sym];
    const sws = sw * 0.5;
    const bw = Math.max(g.box.x1 - g.box.x0, 1), bh = Math.max(g.box.y1 - g.box.y0, 1);
    const k = Math.min((SYM_W - sws) / bw, (SYM_H - sws) / bh, SYM_KMAX);
    const mid = [(g.box.x0 + g.box.x1) / 2, (g.box.y0 + g.box.y1) / 2];
    const map = q => add(c, mul(sub(q, mid), k));
    for (const st of g.strokes) bodies.push({ d: segsToD(st.segs, st.closed, map), w: sws, cls: 'bs hy' });
    for (const p of g.dots) fills.push([circle(map(p), sws * 0.68), 'hy']);
  }

  // Build one letter at one position. Returns SVG fragments in font units.
  // Category: Ascenders / Descenders. Stretches the part of a lowercase letter
  // above the x-height (or below the baseline) by a random amount within the
  // range, so each extender ends a little higher or lower.
  function extenders(base, idx, seed, P) {
    const A = P.extenders;
    if (!A.on || !(base.hasAsc || base.hasDesc)) return base;
    const r = k => roll(seed, idx, 95, 0, k);
    const da = base.hasAsc ? (r(1) * 2 - 1) * A.asc / 100 : 0;    // as a share of EXT
    const dd = base.hasDesc ? (r(2) * 2 - 1) * A.desc / 100 : 0;
    if (!da && !dd) return base;
    return deriveGlyph(base, y => y > X_HEIGHT ? X_HEIGHT + (y - X_HEIGHT) * (1 + da) : y < 0 ? y * (1 + dd) : y);
  }

  // Category: Stroke weight. A letter's lines run from an end or a meeting
  // point to the next one: the corner of a v splits it into two lines, and
  // (optionally) so does a shoulder joining a stem or a bar crossing it. Each
  // line gets its own weight within the range.
  function strokePieces(st, si, idx, seed, P) {
    const W = P.weights, sw = P.base.weight;
    if (!W.on) return { cuts: [], w: [sw] };
    const ks = (W.meets ? st.cornerK.concat(st.meetK) : st.cornerK).slice().sort((a, b) => a - b);
    const cuts = [];
    for (const k of ks) {
      const a = arcAtK(st, k);
      if (!cuts.length || a - cuts[cuts.length - 1] > 20) cuts.push(a);
    }
    const w = [];
    for (let i = 0; i <= cuts.length; i++) w.push(sw * (1 + (roll(seed, idx, si, 10 + i, 7) * 2 - 1) * W.amount / 100));
    return { cuts, w };
  }

  // Category: Truncation. A letter may be cut once, somewhere along one of
  // its strokes. One side of the cut stops flat; the other starts with a serif
  // or a tear; between them is a small clear gap. Cuts keep away from stroke
  // ends, corners and joins, so both parts stay readable.
  function planCut(ch, g, idx, seed, P) {
    const T = P.truncation;
    if (!T || !T.on || !/^[A-Za-z]$/.test(ch)) return null;
    const r = k => roll(seed, idx, 89, 0, k);
    if (r(1) >= T.chance / 100) return null;
    const sw = P.base.weight;
    const span = T.gap * sw + sw / 2;   // flat end to the treated end's centre
    const cands = [];
    g.strokes.forEach((st, si) => {
      const L = st.length;
      if (L < 220) return;
      const avoid = [];
      if (!st.closed) { const m = Math.max(110, 0.2 * L); avoid.push([0, m], [L - m, L]); }
      for (const K of st.cornerK.concat(st.meetK)) { const a = arcAtK(st, K); avoid.push([a - 60 - span, a + 60 + span]); }
      let free = [[0, L]];
      for (const [x0, x1] of avoid) {
        free = free.flatMap(([u0, u1]) => x1 <= u0 || x0 >= u1 ? [[u0, u1]]
          : [[u0, Math.max(u0, x0)], [Math.min(u1, x1), u1]].filter(([a, b]) => b - a > 1));
      }
      const tot = free.reduce((a, [u0, u1]) => a + u1 - u0, 0);
      if (tot > 1) cands.push({ si, free, tot });
    });
    if (!cands.length) return null;
    const c = cands[Math.min(cands.length - 1, Math.floor(r(2) * cands.length))];
    let x = r(3) * c.tot, at = c.free[0][0];
    for (const [u0, u1] of c.free) { if (x <= u1 - u0) { at = u0 + x; break; } x -= u1 - u0; }
    return { si: c.si, at, span, after: r(4) < 0.5, tear: r(5) < T.tearShare / 100, coin: r(6) < 0.5, round: r(7) };
  }

  // A stroke-like part of `st` between two arcs. With wrap (closed strokes) it
  // runs from a0 on round through the start to a1.
  function makePart(st, a0, a1, wrap) {
    const segs = wrap ? [...trimSegs(st, a0, 0), ...trimSegs(st, 0, st.length - a1)] : trimSegs(st, a0, st.length - a1);
    const { pts, cum } = samplePolyline(segs);
    return { segs, closed: false, d: segsToD(segs, false), poly: pts, cum, length: cum[cum.length - 1], from: a0 };
  }

  // A part turned by `a` radians about point c.
  const rotAbout = (p, c, a) => {
    const x = p[0] - c[0], y = p[1] - c[1], co = Math.cos(a), si = Math.sin(a);
    return [c[0] + x * co - y * si, c[1] + x * si + y * co];
  };
  // A part turned by `a` radians about point c, then moved by (dx, dy).
  function movePart(part, c, a, dx = 0, dy = 0) {
    if (!a && !dx && !dy) return part;
    const segs = part.segs.map(s => s.map(p => add(rotAbout(p, c, a), [dx, dy])));
    const { pts, cum } = samplePolyline(segs);
    return { ...part, segs, d: segsToD(segs, part.closed), poly: pts, cum, length: cum[cum.length - 1] };
  }
  const turnPart = (part, c, a) => movePart(part, c, a);

  function buildGlyph(ch, idx, seed, P, stats) {
    const base = COMPILED[ch];
    if (!base) return null;
    const g = extenders(base, idx, seed, P);
    const sw = P.base.weight;
    const C = P.serifs;
    const look = { round: C.on ? C.roundness / 100 : 0.5, taper: C.sharpness / 100 };
    const tear = { size: C.tearSize, elong: C.tearElong, glide: C.tearGlide, lean: C.tearLean };
    const bodies = [];      // strokes: {d, w?, cls?}
    const under = [];       // round ends, joints and dots: [pathD, className]
    const fills = [];       // serifs, tears, tittles: drawn last so colour stays on top
    const marks = [];       // skeleton markers
    const plan = planCut(ch, g, idx, seed, P);
    if (plan) stats.truncated++;

    // Category: Scatter. At the far end of decay a letter comes apart: each
    // stroke, and each part of a cut stroke, may drift and turn on its own.
    let scatterN = 0;
    function scatter(part, si) {
      const S = P.scatter;
      if (!S || !S.on || !S.chance) return part;
      const r = q => roll(seed, idx, si, 40 + scatterN, q);
      scatterN++;
      if (r(1) >= S.chance / 100) return part;
      const mid = part.poly[Math.floor(part.poly.length / 2)];
      return movePart(part, mid, (r(2) * 2 - 1) * S.angle * DEG, (r(3) * 2 - 1) * S.offset, (r(4) * 2 - 1) * S.offset * 0.7);
    }

    // The serif or tear that starts a part after a cut. It sits on the
    // outside of a curve; on a straight stroke a coin picks the side. Either
    // way it turns away from any part of the letter it would run into.
    function cutTreatment(st, part, end, ew, trim) {
      const eh = ew / 2, d = end.d;
      const t1 = mul(pointBackT(part, end.atEnd, Math.min(60, part.length * 0.4)).t, -1);
      const turn = cross(t1, d);
      const curved = Math.abs(turn) > Math.sin(6 * DEG);
      let side = curved ? (turn > 0 ? mul(perp(d), -1) : perp(d)) : mul(perp(d), plan.coin ? -1 : 1);
      const skip = plan.span / 2 + 3 * eh;
      const near = (k) => {
        const a = st.cum[k], dd = Math.abs(a - plan.at);
        return (st.closed ? Math.min(dd, st.length - dd) : dd) < skip;
      };
      const hits = test => g.strokes.some((o, j) => o.poly.some((p, k) => !(j === plan.si && near(k)) && test(p)));
      const ax = Math.abs(d[0]) >= Math.abs(d[1]) ? 'v' : 'h';
      const s = ax === 'h' ? [1, 0] : [0, 1];
      const serifLen = 75 * P.base.serifLen;
      const specFor = sd => (dot(sd, s) > 0.05 || (Math.abs(dot(sd, s)) <= 0.05 && plan.coin)) ? { ax, n: 0, p: serifLen } : { ax, n: serifLen, p: 0 };
      const blocked = sd => {
        if (plan.tear) {
          const f = tearFrame(ew, tear);
          const Cw = add(end.E, add(mul(d, f.C[0]), mul(sd, f.C[1])));
          return hits(p => len(sub(p, Cw)) < Math.max(f.R, f.RL) + eh * 1.1);
        }
        const spec = specFor(sd);
        let w = perp(s);
        if (dot(w, d) < 0) w = mul(w, -1);
        const dir = spec.p > 0 ? s : mul(s, -1), pad = eh * 1.15;
        return hits(p => {
          const rr = sub(p, end.E), u = dot(rr, dir), v = dot(rr, w);
          return u > eh * 0.5 && u < serifLen + pad && v > -eh - pad && v < eh + pad;
        });
      };
      if (blocked(side) && !blocked(mul(side, -1))) side = mul(side, -1);
      if (plan.tear) {
        stats.cutTears++;
        const cut = Math.min(tearFrame(ew, tear).pull, part.length * 0.5);
        trim[end.atEnd ? 1 : 0] = cut;
        under.push([circle(pointBackT(part, end.atEnd, cut).p, eh), '']);
        fills.push([tearPath(part, end, side, ew, tear), 'hc']);
      } else {
        stats.cutSerifs++;
        const rounded = C.on ? plan.round < C.rounded / 100 : true;
        fills.push([serifPath(end.E, d, specFor(side), ew, { ...look, rounded }), 'hc']);
      }
      marks.push([end.E, 'cut']);
    }

    // Ends, then bodies, for one stroke or one part of a cut stroke.
    function drawPart(st, si, part, pc, endMeta, first) {
      for (const w of pc.w) { stats.lines++; stats.wMin = Math.min(stats.wMin, w); stats.wMax = Math.max(stats.wMax, w); }
      const trim = [0, 0];  // arc cut from the start and the end, under tears
      [false, true].forEach((atEnd, ix) => {
        const meta = endMeta[ix];
        if (!meta) return;
        const end = { ...meta, ...endInfo(part.segs, atEnd), atEnd };
        // whatever sits on an end takes the weight of the line it ends
        const ew = atEnd ? pc.w[pc.w.length - 1] : pc.w[0], eh = ew / 2;
        if (meta.cut === 'flat') { marks.push([end.E, 'cut']); return; }
        if (meta.cut === 'treat') { cutTreatment(st, part, end, ew, trim); return; }
        const ei = meta.ei;
        const r = k => roll(seed, idx, si, ei, k);
        // overlap checks run on the unmodified letter; the shapes barely move
        const bend = base.strokes[si].ends[ei];
        const ctx = {
          mayTear: !!end.spec,
          slabBlocked: spec => slabBlocked(ch, base, si, bend, spec, eh),
          tearBlocked: side => tearBlocked(ch, base, si, bend, side, ew, tear),
        };
        let spec = end.spec, fromTerminal = false;
        if (!spec && end.termSpec) {
          stats.terminals++;
          if (C.on && r(5) < (C.toSerif / 100) * (C.convert / 100)) { spec = end.termSpec; fromTerminal = true; stats.termToSerif++; }
        }
        if (!spec) { under.push([circle(end.E, eh), '']); marks.push([end.E, 'plain']); return; }

        spec = { ...spec, n: spec.n * P.base.serifLen, p: spec.p * P.base.serifLen };
        const res = serifRule(ctx, end, spec, r, C);
        if (!fromTerminal) stats.serifs++;
        if (res.canFlip) stats.canFlip++;
        if (res.flipped) stats.flipped++;
        if (res.kind === 'tear') {
          stats.tears++;
          const cut = Math.min(tearFrame(ew, tear).pull, part.length * 0.5);
          trim[atEnd ? 1 : 0] = cut;
          under.push([circle(pointBackT(part, atEnd, cut).p, eh), '']);
          fills.push([tearPath(part, end, res.side, ew, tear), res.flipped ? 'hb' : 'ht']);
        } else {
          if (!res.base) { if (res.rounded) stats.rounded++; else stats.sharp++; }
          const cls = res.flipped ? 'hf' : fromTerminal ? 'hn' : '';
          fills.push([serifPath(end.E, end.d, res.spec, ew, { ...look, rounded: res.base || res.rounded }), cls]);
        }
        marks.push([end.E, 'serif']);
      });

      // one body per line; where two lines meet, a round joint the width of
      // the heavier one
      const bounds = [0, ...pc.cuts, part.length];
      for (let i = 0; i < pc.w.length; i++) {
        const a0 = bounds[i] + (i === 0 ? trim[0] : 0);
        const a1 = part.length - bounds[i + 1] + (i === pc.w.length - 1 ? trim[1] : 0);
        if (i > 0) {
          const p = pointBackT(part, false, bounds[i]).p;
          under.push([circle(p, Math.max(pc.w[i - 1], pc.w[i]) / 2), '']);
          marks.push([p, 'split']);
        }
        if (part.length - a0 - a1 < 1) continue;
        const whole = pc.w.length === 1 && !trim[0] && !trim[1];
        bodies.push({ d: whole ? part.d : segsToD(trimSegs(part, a0, a1), part.closed), w: pc.w[i], skel: first && i === 0 ? st.d : null });
      }
    }

    // Line weights for the arc range [a0, a1] of a stroke.
    const subPieces = (pc, a0, a1) => {
      const cuts = pc.cuts.filter(c => c > a0 + 1 && c < a1 - 1).map(c => c - a0);
      const i0 = pc.cuts.filter(c => c <= a0 + 1).length;
      return { cuts, w: pc.w.slice(i0, i0 + cuts.length + 1) };
    };

    g.strokes.forEach((st, si) => {
      const pc = strokePieces(st, si, idx, seed, P);
      const own = st.ends.map((e, ei) => ({ spec: e.spec, termSpec: e.termSpec, ei }));
      if (!plan || plan.si !== si) { drawPart(st, si, scatter(st, si), pc, st.closed ? [null, null] : own, true); return; }

      // cut this stroke: `lo` and `hi` are the arcs either side of the gap
      const L = st.length, half = plan.span / 2;
      const lo = plan.at - half, hi = plan.at + half;
      const loMeta = { cut: plan.after ? 'flat' : 'treat' }, hiMeta = { cut: plan.after ? 'treat' : 'flat' };
      // Each side of the cut can lean and weigh differently, within the Tilt
      // and Stroke weight ranges. The weight of the side after the gap is
      // rolled fresh. A side leans only if it is free; a side still joined to
      // the rest of the letter (a shoulder, a bowl, another stroke) keeps its
      // angle so the letter holds together.
      const rc = k => roll(seed, idx, 89, 0, k);
      const sideTilt = k => P.tilt.on ? (rc(k) * 2 - 1) * P.tilt.angle * DEG : 0;
      const freshW = P.weights.on ? sw * (1 + (rc(12) * 2 - 1) * P.weights.amount / 100) : null;
      if (!st.closed) {
        const meetArcs = st.meetK.map(K => arcAtK(st, K));
        const joinedIn = (a0, a1) => meetArcs.some(a => a > a0 && a < a1);
        const hinge = pointBackT(st, false, plan.at).p;   // the middle of the gap
        const pcA = subPieces(pc, 0, lo), pcB = subPieces(pc, hi, L);
        if (freshW) pcB.w[0] = freshW;
        const tA = joinedIn(0, lo) || st.ends[0].joined ? 0 : sideTilt(10);
        const tB = joinedIn(hi, L) || st.ends[1].joined ? 0 : sideTilt(11);
        stats.sideTilts += !!tA + !!tB;
        drawPart(st, si, scatter(turnPart(makePart(st, 0, lo, false), hinge, tA), si), pcA, [own[0], loMeta], true);
        drawPart(st, si, scatter(turnPart(makePart(st, hi, L, false), hinge, tB), si), pcB, [hiMeta, own[1]], false);
      } else {
        // A closed stroke opens into one stroke, from just past the gap round
        // to just before it. Its two halves are the two sides; they hinge at
        // the point opposite the gap, and if their turns would close the gap
        // they turn the other way.
        const a0 = ((hi % L) + L) % L, a1 = ((lo % L) + L) % L;
        const ring = makePart(st, a0, a1, a0 > a1);
        const mid = ring.length / 2;
        const joint = pointBackT(ring, false, mid).p;
        let t1 = sideTilt(10), t2 = sideTilt(11);
        const lip1 = ring.poly[0], lip2 = ring.poly[ring.poly.length - 1];
        if (len(sub(rotAbout(lip1, joint, t1), rotAbout(lip2, joint, t2))) < len(sub(lip1, lip2))) { t1 = -t1; t2 = -t2; }
        stats.sideTilts += !!t1 + !!t2;
        const w1 = pc.w[0], w2 = freshW || pc.w[0];
        const h1 = turnPart(makePart(ring, 0, mid, false), joint, t1), h2 = turnPart(makePart(ring, mid, ring.length, false), joint, t2);
        const s1 = scatter(h1, si), s2 = scatter(h2, si);
        drawPart(st, si, s1, { cuts: [], w: [w1] }, [hiMeta, null], true);
        drawPart(st, si, s2, { cuts: [], w: [w2] }, [null, loMeta], false);
        if (s1 === h1 && s2 === h2) under.push([circle(joint, Math.max(w1, w2) / 2), '']);
      }
    });
    for (const dpt of g.dots) under.push([circle(dpt, sw * 0.68), '']);

    if (g.tittle) {
      const T = P.tittles;
      const r = k => roll(seed, idx, 97, 0, k);
      let c = g.tittle;
      let sym = null;
      if (T.on) {
        const unit = (4 / 3) * 1000 / P.base.size;   // font units per point at this size
        c = [c[0] + (r(1) * 2 - 1) * T.shiftX * unit, c[1] + (r(2) * 2 - 1) * T.shiftY * unit];
        if (r(3) < T.chance / 100) sym = pickSymbol(r(4), T.maxRatio);
      }
      const S = P.scatter;
      if (S && S.on && r(6) < S.chance / 100) c = [c[0] + (r(7) * 2 - 1) * S.offset, c[1] + (r(8) * 2 - 1) * S.offset * 0.7];
      stats.tittles++;
      if (sym) stats.symbols++;
      drawTittle(c, sym, sw, bodies, fills);
      marks.push([g.tittle, 'tittle']);
    }
    return { bodies, fills: under.concat(fills), marks };
  }

  // Category: Kerning. The gap before the letter at `idx` opens or closes by a
  // random amount within the range, as a share of the 600 u cell. Offsets add
  // up along a line, so the spacing drifts the way set type does.
  function kernUnits(idx, seed, P) {
    const K = P.kerning;
    if (!K.on || !K.amount) return 0;
    return (roll(seed, idx, 93, 0, 1) * 2 - 1) * K.amount / 100 * 600;
  }

  // Category: Tilt. Each letter turns by a random angle within the range,
  // about the middle of its x-height on the cell's centre line, the way a
  // typewriter slug sits a little off true.
  const TILT_PIVOT = [300, X_HEIGHT / 2];
  function tiltDegrees(idx, seed, P) {
    const T = P.tilt;
    if (!T.on || !T.angle) return 0;
    return (roll(seed, idx, 91, 0, 1) * 2 - 1) * T.angle;
  }

  // Category: Line spacing. The distance from each line to the one above it
  // changes by a random amount within the range, as a share of the line
  // height, so the leading runs along a spectrum the way a typewriter's
  // platen advances unevenly.
  function leadUnits(line, seed, P, lineHeight) {
    const L = P.leading;
    if (!L || !L.on || !L.amount) return 0;
    return (roll(seed, line, 87, 0, 1) * 2 - 1) * L.amount / 100 * lineHeight;
  }

  window.GENCOURIER = { buildGlyph, kernUnits, leadUnits, tiltDegrees, TILT_PIVOT, hashStr, mix32, tittlePool, has: ch => ch in COMPILED };
})();
