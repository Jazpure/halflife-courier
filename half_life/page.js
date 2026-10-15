// HalfLife Courier: the page. Lays out the columns, keeps the clock, asks the
// workers for blocks of rows near the screen and puts each block on the page
// as its own small canvas, so the browser scrolls them without any redrawing.
(function () {
  const HL = window.HALFLIFE;
  const PHRASE = 'All work and no play makes Jack a dull boy.';
  const WORDS = PHRASE.split(' ');
  const NARROW = 24;           // characters across a narrow column
  const SINGLE = 26;           // characters across the single column on phones
  const WIDE = 4 / 3;          // the rightmost column is a third wider
  const ROWS = 1300;           // rows per column
  const LH = 1250, BASE = 860; // line height and baseline, in font units
  const BLOCK = 4;             // rows drawn together
  const MIN_GAP = 0.3;         // seconds: the most often one block is redrawn

  // a seed of one's own, kept in this browser
  let seed = 0;
  try { seed = +localStorage.getItem('halflife.seed') || 0; } catch (e) {}
  if (!seed) {
    seed = 1 + Math.floor(Math.random() * 2147483646);
    try { localStorage.setItem('halflife.seed', String(seed)); } catch (e) {}
  }

  const sheet = document.getElementById('sheet');
  const head = document.querySelector('header');
  const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#1f2a52';

  // Each column is one long run of the phrase, starting at a different word.
  // Like a typist deciding when to return the carriage, each line may end a
  // little short of the column (mostly by a character or two, sometimes by
  // more), so the words never settle into a repeating pattern down the page.
  // Where the letters squeeze together near the end, more of them fit.
  function wrapColumn(c, chars, D) {
    const lines = [];
    let line = '', w = (c * 3) % WORDS.length;
    let limit = chars;
    while (lines.length < ROWS) {
      const word = WORDS[w];
      w = (w + 1) % WORDS.length;
      if (!line) line = word;
      else if (line.length + 1 + word.length <= limit) line += ' ' + word;
      else {
        lines.push(line);
        line = word;
        const r = Math.min(ROWS - 1, lines.length);
        const room = Math.floor(chars / HL.params(D[r]).track);
        limit = room - Math.floor(Math.pow(HL.unit(seed, c, lines.length, 5), 2) * 9);   // usually full, now and then short
      }
    }
    return lines;
  }

  let L = null;
  function layout() {
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    const cols = vw < 640 ? 1 : vw < 1000 ? 2 : 4;   // four on desktop, one on phones
    const side = cols === 1 ? 20 : Math.round(Math.min(64, Math.max(24, vw * 0.04)));
    const gutter = cols === 1 ? 0 : Math.round(Math.min(48, Math.max(20, vw * 0.025)));
    const weights = cols === 1 ? [1] : cols === 2 ? [1, WIDE] : [1, 1, 1, WIDE];
    const avail = vw - 2 * side - (cols - 1) * gutter;
    const unitW = avail / weights.reduce((a, b) => a + b, 0);
    const fontPx = cols === 1 ? avail / (SINGLE * 0.6) : unitW / (NARROW * 0.6);
    const u = fontPx / 1000;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rowH = LH * u;
    head.style.paddingLeft = side + 'px';
    const textTop = head.offsetTop + head.offsetHeight + Math.round(fontPx * 1.2);
    const D = new Float64Array(ROWS);
    for (let r = 0; r < ROWS; r++) D[r] = HL.decayAt(r / (ROWS - 1));
    const columns = [];
    let x = side, bottom = 0;
    for (let c = 0; c < cols; c++) {
      const w = unitW * weights[c];
      const chars = cols === 1 ? SINGLE : Math.floor(w / (0.6 * fontPx) + 0.01);
      const lines = wrapColumn(c, chars, D);
      const top = new Float64Array(ROWS);
      let y = 0;
      for (let r = 1; r < ROWS; r++) {
        // each line a little nearer to or further from the one above, and
        // near the end much nearer
        const P = HL.params(D[r]);
        y += rowH * P.lineStep * (1 + (HL.unit(seed, c, r, 9) * 2 - 1) * P.leading / 100);
        top[r] = y;
      }
      columns.push({ x, w, chars, lines, top, D, seed: HL.hash(seed, c) });
      x += w + gutter;
      bottom = Math.max(bottom, y + rowH);
    }
    sheet.style.height = Math.ceil(textTop + bottom + fontPx * 8) + 'px';
    const cfg = [vw, cols, fontPx.toFixed(3), dpr, seed].join('|');
    L = { vw, vh, cols, fontPx, u, dpr, textTop, columns, cfg, rowH, blocks: Math.ceil(ROWS / BLOCK) };
  }

  // Room around a block for letters that lean or wander out of it.
  function pads(D) {
    const P = HL.params(D);
    const lean = Math.sin(P.tilt.angle * Math.PI / 180) * 0.66;
    const drift = P.scatter.on ? P.scatter.offset / 1000 : 0;
    return {
      padX: L.fontPx * (0.6 + lean + drift + 0.5 * P.kerning.amount / 100),
      padY: L.fontPx * (0.45 + lean + 0.7 * drift + 0.2 * P.extenders.asc / 100 + 0.2),
    };
  }

  const blockTop = (col, k) => col.top[k * BLOCK];
  const blockBottom = (col, k) => col.top[Math.min(ROWS - 1, k * BLOCK + BLOCK - 1)] + L.rowH;

  // ---------- blocks: one canvas each, placed in the page
  const store = new Map();     // "c:k" → { el, cfg, t, next }
  const pending = new Set();
  const forceNext = new Set();

  // Frame rate guard: if frames slow down, blocks are refreshed less often,
  // so the constant change never costs smoothness. "Slow" is measured
  // against this display's own normal frame time, so 50, 60 or 120 Hz
  // screens are all judged fairly.
  let load = 1, avgFrame = 16.7, lastFrame = 0, normal = 16.7, frames = 0;
  const recent = [];

  const canWork = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' &&
    typeof OffscreenCanvas.prototype.transferToImageBitmap === 'function';
  const workers = [], inflight = [];
  if (canWork) {
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    for (let i = 0; i < n; i++) {
      const w = new Worker('worker.js');
      w.onmessage = e => { if (e.data && e.data.ready) return; inflight[i] = Math.max(0, inflight[i] - 1); e.data.forEach(take); };
      workers.push(w);
      inflight.push(0);
    }
  }

  function place(el, key, res) {
    const i = key.indexOf(':'), col = L.columns[+key.slice(0, i)], k = +key.slice(i + 1);
    el.style.left = (col.x - res.padX) + 'px';
    el.style.top = (L.textTop + blockTop(col, k) - res.padY) + 'px';
    el.style.width = (el.width / res.scale) + 'px';
    el.style.height = (el.height / res.scale) + 'px';
  }

  function take(res) {
    pending.delete(res.key);
    if (!L || res.cfg !== L.cfg) { if (res.bmp && res.bmp.close) res.bmp.close(); return; }
    const old = store.get(res.key);
    if (res.same) {
      if (old && old.cfg === res.cfg) { old.t = res.t; old.next = res.next; }
      else forceNext.add(res.key);     // the worker had it, the page didn't: ask again from scratch
      return;
    }
    let el;
    if (res.bmp instanceof HTMLCanvasElement) {          // drawn here, without workers
      el = res.bmp;
      if (old) old.el.replaceWith(el); else sheet.append(el);
    } else {
      el = old ? old.el : document.createElement('canvas');
      if (!old) sheet.append(el);
      el.width = res.bmp.width; el.height = res.bmp.height;
      (el._ctx || (el._ctx = el.getContext('bitmaprenderer'))).transferFromImageBitmap(res.bmp);
    }
    el.className = 'blk';
    place(el, res.key, res);
    store.set(res.key, { el, cfg: res.cfg, t: res.t, next: res.next });
  }

  // without workers, blocks are drawn here a few at a time
  let local = null;
  function loadLocal() {
    if (local) return;
    local = 'loading';
    const add = src => new Promise(ok => { const s = document.createElement('script'); s.src = src; s.onload = ok; document.head.append(s); });
    add('../glyphs.js').then(() => add('../engine.js')).then(() => add('render.js')).then(() => { local = window.HALFLIFE_RENDER; });
  }

  function job(c, k, t) {
    const col = L.columns[c];
    const r0 = k * BLOCK, r1 = Math.min(ROWS - 1, r0 + BLOCK - 1);
    const y0 = col.top[r0];
    const rows = [];
    for (let r = r0; r <= r1; r++) rows.push({ row: r, text: col.lines[r], D: col.D[r], y: col.top[r] - y0, adv: HL.params(col.D[r]).track });
    const key = c + ':' + k;
    const box = pads(col.D[r1]);
    return {
      key, cfg: L.cfg, seed: col.seed, col: c, t, rows, force: forceNext.delete(key), ink,
      u: L.u, dpr: L.dpr, w: col.w, h: blockBottom(col, k) - y0, padX: box.padX, padY: box.padY, base: BASE,
    };
  }

  // first block whose bottom is below y (column coordinates)
  function blockAt(col, y) {
    let lo = 0, hi = L.blocks - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (blockBottom(col, m) < y) lo = m + 1; else hi = m; }
    return lo;
  }

  function drop(key) {
    const v = store.get(key);
    if (v) { v.el.remove(); store.delete(key); }
  }

  function schedule(t) {
    const sy = window.scrollY;
    const view0 = sy - L.textTop, view1 = view0 + L.vh;
    const want = [];
    for (let c = 0; c < L.cols; c++) {
      const col = L.columns[c];
      const k0 = Math.max(0, blockAt(col, view0 - L.vh * 0.25) - 1);
      const k1 = Math.min(L.blocks - 1, blockAt(col, view1 + L.vh * 0.6) + 1);
      for (let k = k0; k <= k1; k++) {
        const key = c + ':' + k;
        if (pending.has(key)) continue;
        const have = store.get(key);
        const top = blockTop(col, k), bot = blockBottom(col, k);
        const visible = bot > view0 - L.fontPx * 2 && top < view1 + L.fontPx * 2;
        const missing = !have || have.cfg !== L.cfg;
        // Blocks on screen keep changing; blocks just off it are only kept
        // ready. Crowded blocks (many more letters) refresh less often, and
        // if frames are slowing down, changes wait until they recover.
        const gap = MIN_GAP * load * (1 + 2 * (1 - HL.params(col.D[k * BLOCK]).lineStep));
        if (!missing && !(visible && load < 4.5 && t >= have.next && t - have.t >= gap)) continue;
        // Missing blocks fill from the middle of the screen out. Blocks that
        // are only due a change go in random order, so changes pop up all over
        // the screen instead of rippling out from one place.
        const pri = missing ? Math.abs((top + bot) / 2 - (view0 + view1) / 2) : 1e6 + Math.random() * 1e5;
        want.push({ c, k, key, pri: pri + (visible ? 0 : 1e7) });
      }
    }
    // let go of blocks far from the screen
    for (const key of [...store.keys()]) {
      const i = key.indexOf(':'), col = L.columns[+key.slice(0, i)], k = +key.slice(i + 1);
      if (!col || blockBottom(col, k) < view0 - L.vh * 0.7 || blockTop(col, k) > view1 + L.vh * 1.2) drop(key);
    }
    want.sort((a, b) => a.pri - b.pri);

    if (workers.length) {
      const batches = workers.map(() => []);
      for (const w of want) {
        const wi = (w.c * 7919 + w.k) % workers.length;
        if (inflight[wi] >= (load > 2 ? 1 : 2) || batches[wi].length >= 3) continue;
        batches[wi].push(job(w.c, w.k, t));
        pending.add(w.key);
      }
      batches.forEach((b, wi) => { if (b.length) { inflight[wi]++; workers[wi].postMessage({ jobs: b }); } });
    } else {
      loadLocal();
      if (local && local !== 'loading') {
        const stop = performance.now() + 8;
        for (const w of want) {
          if (performance.now() > stop) break;
          const j = job(w.c, w.k, t);
          const r = local.block(j, (cw, ch) => Object.assign(document.createElement('canvas'), { width: cw, height: ch }));
          take(r.canvas ? { key: j.key, cfg: j.cfg, t: j.t, next: r.next, bmp: r.canvas, scale: j.dpr, padX: j.padX, padY: j.padY }
                        : { key: j.key, cfg: j.cfg, t: j.t, next: r.next, same: true });
        }
      }
    }
  }

  const t0 = performance.now();
  function frame(now) {
    if (lastFrame) {
      const dt = Math.min(100, now - lastFrame);
      avgFrame = avgFrame * 0.9 + dt * 0.1;
      recent.push(dt);
      if (recent.length > 120) recent.shift();
      if (recent.length === 120 && ++frames % 30 === 0) {
        normal = recent.slice().sort((a, b) => a - b)[18];      // the display's usual frame time
      }
      if (avgFrame > normal * 1.3) load = Math.min(5, load * 1.04);
      else if (avgFrame < normal * 1.12) load = Math.max(1, load * 0.98);
    }
    lastFrame = now;
    schedule((performance.now() - t0) / 1000);
    requestAnimationFrame(frame);
  }

  let rt = 0;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      const before = L && L.cfg;
      layout();
      if (L.cfg !== before) {
        for (const key of [...store.keys()]) drop(key);
        pending.clear();
        workers.forEach(w => w.postMessage({ reset: true }));
      }
    }, 120);
  });

  layout();
  requestAnimationFrame(frame);

  // for checking the page by hand
  window.HALFLIFE_PAGE = { get layout() { return L; }, store, seed, BLOCK, get load() { return load; } };
})();
