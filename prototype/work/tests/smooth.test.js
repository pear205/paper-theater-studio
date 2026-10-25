// smooth cut lines (corner-aware Chaikin, shared by the PDF and the editor preview): built-in sample, no samples/ needed
// usage: node smooth.test.js [url]   OUT_DIR=output folder
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const path = require('path');
const url = process.argv[2] || 'http://127.0.0.1:8765/prototype/paper-theater-studio.html';
const OUT = process.env.OUT_DIR || path.resolve(__dirname, '..');
const res = {}, errors = []; let fail = 0;
const check = (k, v, info) => { res[k] = v ? 'PASS' : { FAIL: info === undefined ? v : info }; if (!v) fail++; };

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => { try { return !!S.cv && !!S.W; } catch (e) { return false; } }, null, { timeout: 90000 });
  await page.evaluate(() => { hideAsk(); document.getElementById('fillHidden').checked = false; });

  // in-page helpers: how far (px) is the farthest polygon point from the filled pixels of arr (0 = on/inside the region)
  await page.evaluate(() => {
    window.__far = (arr, polys) => {
      const W = S.W, H = S.H, r = Math.ceil(0.5 * pxPerMm()) + 4; let worst = 0, bad = 0;
      for (const p of polys) for (const [qx, qy] of p) {
        if (!isFinite(qx) || !isFinite(qy) || qx < 0 || qy < 0 || qx > W - 1 || qy > H - 1) { bad++; continue; }
        const x = Math.round(qx), y = Math.round(qy); let best = Infinity;
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < W && Y < H && arr[Y * W + X]) best = Math.min(best, Math.hypot(qx - X, qy - Y)); }
        worst = Math.max(worst, best);
      }
      return { worst, bad };
    };
    window.__blank = () => new Uint8Array(S.W * S.H);
    window.__rect = (a, x0, y0, x1, y1) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) a[y * S.W + x] = 255; return a; };
  });
  const lim = await page.evaluate(() => 0.5 * pxPerMm()); // 0.5 mm in px
  const tol = lim + 0.75; // + pixel quantisation of the raster reference

  // ---- unit: corner handling
  const u = await page.evaluate(() => {
    const sq = [[0, 0], [100, 0], [100, 100], [0, 100]], q = chaikinHard(sq, 60);
    const oct = (r) => Array.from({ length: 8 }, (_, i) => [200 + r * Math.cos(i * Math.PI / 4), 200 + r * Math.sin(i * Math.PI / 4)]);
    const big = chaikinHard(oct(100), 60), same = (a, b) => a.length === b.length && a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1]);
    // 70 deg corner exact, 40 deg corner cut
    const mixed = chaikinHard([[0, 0], [100, 0], [100 + 100 * Math.cos(70 * Math.PI / 180), 100 * Math.sin(70 * Math.PI / 180)], [50, 140], [-40, 60]], 60);
    return { sqSame: same(sq, q), octPts: big.length, hasExact: mixed.some((p) => p[0] === 100 && p[1] === 0) };
  });
  check('chaikin: right-angle corners are kept exactly (square unchanged)', u.sqSame, u);
  check('chaikin: 45deg corners get cut (octagon -> more points)', u.octPts > 8, u);
  check('chaikin: a corner turning > 60deg stays an exact point', u.hasExact, u);

  // ---- fallback + smoothing on synthetic regions
  const syn = await page.evaluate(() => {
    const ppm = pxPerMm(), r = {};
    const plain = (fn) => { const keep = chaikinHard; window.chaikinHard = (P) => P; try { return fn(); } finally { window.chaikinHard = keep; } }; // plain approx polygons for comparison
    const disc = (cx, cy, rad) => { const a = __blank(); for (let y = 0; y < S.H; y++) for (let x = 0; x < S.W; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= rad * rad) a[y * S.W + x] = 255; return a; };
    // small round blob: smoothed (more points than the raw approx polygon) and stays inside
    const blob = disc(300, 300, 14), pb = cutPolys(blob, ppm), pr = plain(() => cutPolys(blob, ppm));
    r.blob = { smooth: pb[0].length, raw: pr[0].length, far: __far(blob, pb).worst };
    // big diamond: Chaikin would cut far more than 0.5 mm off its 90deg-free long-edge corners only if soft; use a 45deg octagon-like shape to hit the guard
    const oc = __blank(); for (let y = 0; y < S.H; y++) for (let x = 0; x < S.W; x++) { const dx = Math.abs(x - 600), dy = Math.abs(y - 400); if (dx <= 300 && dy <= 300 && dx + dy <= 420) oc[y * S.W + x] = 255; }
    const po = cutPolys(oc, ppm), por = plain(() => cutPolys(oc, ppm));
    r.octagon = { smooth: po[0].length, raw: por[0].length, far: __far(oc, po).worst };
    // very thin V notch cut into a block (sharp concave corner): hard point kept, nothing drawn outside the region
    const nt = __rect(__blank(), 100, 100, 500, 300); for (let y = 100; y < 250; y++) { const hw = Math.round(10 * (250 - y) / 150); for (let x = 300 - hw; x <= 300 + hw; x++) nt[y * S.W + x] = 0; }
    const pn = cutPolys(nt, ppm); r.notch = { n: pn.length, far: __far(nt, pn), tip: pn.some((p) => p.some(([x, y]) => Math.abs(x - 300) <= 1 && Math.abs(y - 250) <= 2)) };
    // wide concave corner (L shape, 90deg): exact corner + inside the region
    const L = __rect(__rect(__blank(), 200, 200, 600, 260), 200, 200, 260, 600); const pl = cutPolys(L, ppm); r.L = { n: pl.length, pts: pl[0].length, far: __far(L, pl).worst };
    return r;
  });
  res.synthetic = syn;
  check('blob: smoothed (more points than the plain polygon), within 0.5 mm of the region', syn.blob.smooth > syn.blob.raw && syn.blob.far <= tol, syn.blob);
  check('octagon with long edges: deviation guard falls back to the plain polygon', syn.octagon.smooth === syn.octagon.raw && syn.octagon.far <= tol, syn.octagon);
  check('sharp concave notch: tip kept, no point outside the region by more than 0.5 mm', syn.notch.n === 1 && syn.notch.tip && syn.notch.far.bad === 0 && syn.notch.far.worst <= tol, syn.notch);
  check('L shape: stays inside the region', syn.L.n === 1 && syn.L.far <= tol, syn.L);

  // ---- edge cases
  const edge = await page.evaluate(() => {
    const ppm = pxPerMm(), r = {}, W = S.W, H = S.H;
    try { r.empty = cutPolys(__blank(), ppm).length; } catch (e) { r.emptyErr = String(e); }
    const full = new Uint8Array(W * H).fill(255), pf = cutPolys(full, ppm); r.full = { n: pf.length, pts: pf[0] && pf[0].length };
    r.tiny = [3, 5, 6, 8].map((s) => { const a = __rect(__blank(), 400, 400, 400 + s, 400 + s); const p = cutPolys(a, ppm), f = p.length ? __far(a, p) : { worst: 0, bad: 0 }; return { s, n: p.length, far: f.worst, bad: f.bad }; });
    const border = __blank(); for (let y = 0; y < 120; y++) for (let x = 0; x < 120; x++) if (x * x + y * y <= 110 * 110) border[y * W + x] = 255; // quarter disc in the corner
    const pbd = cutPolys(border, ppm); r.border = { n: pbd.length, far: __far(border, pbd) };
    const edgeBar = __rect(__blank(), W - 40, 300, W, 360), pe = cutPolys(edgeBar, ppm); r.edgeBar = { n: pe.length, far: __far(edgeBar, pe) };
    const holes = __rect(__blank(), 100, 100, 400, 400); for (let y = 200; y < 300; y++) for (let x = 200; x < 300; x++) holes[y * W + x] = 0; __rect(holes, 600, 100, 640, 140);
    r.holes = cutPolys(holes, ppm).length; // outer + hole + second piece
    return r;
  });
  res.edge = edge;
  check('empty mask: no contours, no crash', edge.empty === 0 && !edge.emptyErr, edge);
  check('full mask: only the frame (one polygon, 4 corner points)', edge.full.n === 1 && edge.full.pts === 4, edge.full);
  check('tiny pieces: no crash, points finite and inside, < 20px area dropped', edge.tiny.every((t) => t.bad === 0 && t.far <= tol) && edge.tiny[0].n === 0 && edge.tiny[3].n === 1, edge.tiny);
  check('piece touching the image corner/edge: points stay inside the image and region', edge.border.n === 1 && edge.border.far.bad === 0 && edge.border.far.worst <= tol && edge.edgeBar.far.bad === 0 && edge.edgeBar.far.worst <= tol, { b: edge.border, e: edge.edgeBar });
  check('region with a hole + a second piece: 3 polygons', edge.holes === 3, edge.holes);

  // ---- built-in sample, every cut shape (layer 4 = rabbit meets grass)
  const sam = await page.evaluate(() => {
    document.getElementById('loadSample').click();
    const ppm = pxPerMm(), out = [];
    for (let i = 1; i < S.layers.length; i++) {
      const ca = cutArr(i, finalMask(i)), t0 = performance.now(), polys = cutPolys(ca, ppm), ms = performance.now() - t0;
      const keep = chaikinHard; window.chaikinHard = (P) => P; const raw = cutPolys(ca, ppm); window.chaikinHard = keep;
      const f = __far(ca, polys);
      out.push({ layer: i + 1, polys: polys.length, rawPolys: raw.length, pts: polys.reduce((s, p) => s + p.length, 0), rawPts: raw.reduce((s, p) => s + p.length, 0), worstPx: +f.worst.toFixed(2), bad: f.bad, ms: Math.round(ms) });
    }
    return out;
  });
  res.sample = sam;
  check('sample: every layer has the same polygon count as the plain outline', sam.every((s) => s.polys === s.rawPolys), sam);
  check('sample: no smoothed point outside the region by more than 0.5 mm (incl. rabbit/grass layer 4)', sam.every((s) => s.bad === 0 && s.worstPx <= tol), { tol, sam });
  check('sample: smoothing adds points on the curvy layers', sam.some((s) => s.pts > s.rawPts), sam);
  check('sample: contour+smooth stays fast (< 1.5 s per layer)', sam.every((s) => s.ms < 1500), sam);

  // ---- preview == PDF geometry
  const pv = await page.evaluate(async () => {
    document.getElementById('showCut').checked = true; S.active = 3; renderLayers();
    const i = S.active, ppm = pxPerMm(); computeCut();
    const ca = cutArr(i, finalMask(i)), polys = cutPolys(ca, ppm), mm = contoursMm(ca, ppm, 10, 20);
    // PDF geometry (mm) mapped back to px must equal the polygons the preview was filled with
    let maxd = 0, same = mm.length === polys.length;
    if (same) mm.forEach((p, k) => { same = same && p.length === polys[k].length; p.forEach(([x, y], j) => { if (polys[k][j]) maxd = Math.max(maxd, Math.abs((x - 10) * ppm - polys[k][j][0]), Math.abs((y - 20) * ppm - polys[k][j][1])); }); });
    // the preview canvas vs an independent even-odd fill of the PDF polygons
    const ref = mk(S.W, S.H), g = ref.getContext('2d'); g.fillStyle = '#000'; g.beginPath(); mm.forEach((p) => { p.forEach(([x, y], k) => { const px = (x - 10) * ppm, py = (y - 20) * ppm; k ? g.lineTo(px, py) : g.moveTo(px, py); }); g.closePath(); }); g.fill('evenodd');
    const a = S.cutPrev.shape.getContext('2d').getImageData(0, 0, S.W, S.H).data, b = g.getImageData(0, 0, S.W, S.H).data;
    let diff = 0, on = 0, inter = 0, uni = 0;
    for (let p = 3; p < a.length; p += 4) { if (Math.abs(a[p] - b[p]) > 8) diff++; if (a[p] > 127) on++; const q = p >> 2, ra = a[p] > 127, rb = ca[q] > 0; if (ra && rb) inter++; if (ra || rb) uni++; }
    return { cached: S.cutPrev.L === cur(), same, maxd, diff, on, iou: inter / uni };
  });
  res.preview = pv;
  check('preview: PDF polygons (mm -> px) are exactly the preview polygons', pv.same && pv.maxd < 1e-6, pv);
  check('preview: red-line shape equals an independent fill of the PDF polygons', pv.cached && pv.on > 1000 && pv.diff === 0, pv);
  check('preview: still matches the raster cut shape (IoU > 0.97)', pv.iou > 0.97, pv);
  const deb = await page.evaluate(async () => { const before = S.cutPrev; S.cutDirty = true; scheduleCut(); await new Promise((r) => setTimeout(r, 700)); return { replaced: S.cutPrev !== before && S.cutPrev.L === cur(), dirty: S.cutDirty }; });
  check('preview: debounced recompute still works', deb.replaced && !deb.dirty, deb);

  // ---- PDF: still generates, same pages, similar size as the plain outline
  const pdf = async (smooth) => {
    await page.evaluate((smooth) => { if (!window.__keep) window.__keep = chaikinHard; window.chaikinHard = smooth ? window.__keep : (P) => P; }, smooth);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.evaluate(() => { document.getElementById('exportPdf').click(); })]);
    const fs = require('fs'), f = path.join(OUT, smooth ? 'smooth-cut.pdf' : 'plain-cut.pdf'); await dl.saveAs(f);
    const buf = fs.readFileSync(f), txt = buf.toString('latin1');
    return { bytes: buf.length, pages: (txt.match(/\/Type\s*\/Page\b/g) || []).length };
  };
  const pBase = await pdf(false), pSm = await pdf(true);
  await page.evaluate(() => { window.chaikinHard = window.__keep; });
  res.pdf = { plain: pBase, smooth: pSm };
  const n = await page.evaluate(() => S.layers.length);
  check('pdf: page count same as the plain outline and >= layers + 1', pSm.pages === pBase.pages && pSm.pages >= n + 1, { n, pBase, pSm });
  check('pdf: size sane (within 25% of the plain outline, < 5 MB)', Math.abs(pSm.bytes - pBase.bytes) / pBase.bytes < 0.25 && pSm.bytes < 5e6, { pBase, pSm });

  check('no page errors', errors.length === 0, errors);
  res.errors = errors;
  console.log(JSON.stringify(res, null, 1));
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
