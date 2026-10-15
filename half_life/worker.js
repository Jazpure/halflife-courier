// Builds and draws blocks of rows off the page's main thread.
self.window = self;
importScripts('../glyphs.js', '../engine.js', 'schedule.js', 'render.js');

self.onmessage = e => {
  const msg = e.data;
  if (msg.reset) { self.HALFLIFE_RENDER.reset(); return; }
  const out = [], transfer = [];
  for (const job of msg.jobs) {
    const { canvas, next } = self.HALFLIFE_RENDER.block(job, (w, h) => new OffscreenCanvas(w, h));
    const base = { key: job.key, cfg: job.cfg, t: job.t, next, scale: job.dpr, padX: job.padX, padY: job.padY };
    if (!canvas) { out.push({ ...base, same: true }); continue; }
    const bmp = canvas.transferToImageBitmap();
    out.push({ ...base, bmp });
    transfer.push(bmp);
  }
  self.postMessage(out, transfer);
};
self.postMessage({ ready: true });
