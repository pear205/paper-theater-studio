// F4 depth split test: node split.test.js [url]
// downloads the depth model (~27MB, wasm q8) and the AI select model (~14MB) each run: a fresh browser has no cache
// 1) built-in sample, 물체 단위로 맞추기 on (one consent for both models, then the overwrite confirm), one undo restores
// 2) sample1 pixel bands, 3) sample1 object mode: no back layer follows the girl's silhouette, the girl lands in one layer
const { chromium } = require(process.env.PLAYWRIGHT_PATH||'playwright');
const fs = require('fs'), path = require('path');
const URL = process.argv.slice(2).find(a => a.startsWith('http')) || 'http://127.0.0.1:8765/prototype/paper-theater-studio.html';
const OUT = process.env.OUT_DIR || path.resolve(__dirname, '..');

(async () => {
  const ctx = await chromium.launch({ headless: true });
  const page = await ctx.newPage({ viewport: { width: 1360, height: 900 } });
  const errors = [], asks = [], says = [];let dl = 0;
  page.on('pageerror', e => errors.push(String(e)));
  page.on('response', async r => { if (/huggingface|hf\.co|xethub/.test(r.url()) && r.status() === 200) { const l = +(r.headers()['content-length'] || 0); dl += l; } });
  await page.goto(URL);
  await page.waitForFunction(() => { try { return !!S.cv; } catch (e) { return false; } }, null, { timeout: 120000 });
  await page.evaluate(() => hideAsk());

  // click the button, answer every ask() with its first (primary) choice until the split is done
  async function runSplit(tag, obj) {
    await page.evaluate((o) => { $('depthObj').checked = o; DEPTH.totalMs = null; }, obj);
    const t0 = Date.now();
    await page.click('#depthSplit');
    while (true) {
      const st = await page.evaluate(() => ({ ask: !$('ask').hidden ? $('askMsg').textContent : null, done: DEPTH.totalMs != null && !DEPTH.busy, err: DEPTH.state === 'error', say: $('depthState').textContent }));
      if (st.say && /물체 찾는 중/.test(st.say) && !says.includes(tag)) says.push(tag);
      if (st.ask) { asks.push(tag + ': ' + st.ask); await page.click('#askBtns button.primary'); }
      if (st.done || st.err) break;
      if (Date.now() - t0 > 600000) throw new Error('timeout');
      await page.waitForTimeout(300);
    }
    return Date.now() - t0;
  }
  const info = () => page.evaluate(() => ({ ...DEPTH.info, gpu: DEPTH.gpu, runMs: DEPTH.runMs, objMs: DEPTH.objMs, maskMs: DEPTH.maskMs, totalMs: DEPTH.totalMs }));
  const masks = () => page.evaluate(() => S.layers.map(L => { const a = alphaArr(L.mask); let n = 0, h = 0; for (let i = 0; i < a.length; i++) if (a[i]) { n++; h = (h * 31 + i) >>> 0; } return { n, h }; }));
  // pixels of a layer band (DEPTH.lab >= 1) that sit on no layer: cleanup must hand them to the layer behind (band 0 may stay on the back plate)
  const orphans = () => page.evaluate(() => { const A = S.layers.slice(1).map(L => alphaArr(L.mask)), lab = DEPTH.lab; let o = 0;
    for (let i = 0; i < lab.length; i++) if (lab[i] >= 1) { let h = false; for (const a of A) if (a[i]) { h = true; break; } if (!h) o++; } return o; });
  // the girl (SAM click at her face) against the layers:
  //  ghost: for each layer behind the one she is shown on, her pixels above that layer's band top line (topmost pixel
  //  of its own depth band in each column) that it still holds. A back layer whose outline followed her silhouette
  //  (the old d >= t rule) would hold all of them
  //  single: share of her pixels shown (frontmost layer) on the one layer that shows most of her
  //  face: one click at her face, default candidate. whole: clicks at face, body and the forward arm, biggest candidate
  //  the top line is taken over +-3mm of columns: the 3mm cleanup may round a band's end by that much (hidden behind her)
  const girlOne = (pts, whole) => page.evaluate(async ([pts, whole]) => {
    const c = await aiDecode(pts), g = c[whole ? 0 : aiPick(c)].sel, W = S.W, H = S.H, n = S.layers.length, A = S.layers.map(L => alphaArr(L.mask)), r = Math.ceil(pxPerMm() * 3);
    const cnt = new Array(n).fill(0);let N = 0;
    for (let i = 0; i < g.length; i++) if (g[i]) { N++; let v = 0; for (let k = n - 1; k >= 1; k--) if (A[k][i]) { v = k; break; } cnt[v]++; }
    const top = cnt.indexOf(Math.max(...cnt)), ghost = {};
    // band top line as depthMasks sees it: the band after the small cleanup (open/close 1.5mm, pieces under 0.2%),
    // topmost pixel per column, pieces hanging from the top edge not counted
    const bandTop = (b) => { const cv = S.cv, ppm = pxPerMm(), o = Math.max(3, Math.round(ppm * 1.5) | 1), a = new Uint8Array(W * H);
      for (let i = 0; i < a.length; i++) a[i] = DEPTH.lab[i] === b ? 255 : 0;
      const m = cv.matFromArray(H, W, cv.CV_8UC1, a), k = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(o, o)), lab = new cv.Mat(), st = new cv.Mat(), ce = new cv.Mat(), t = new Int32Array(W);
      try { cv.morphologyEx(m, m, cv.MORPH_OPEN, k); cv.morphologyEx(m, m, cv.MORPH_CLOSE, k);
        const nl = cv.connectedComponentsWithStats(m, lab, st, ce, 8, cv.CV_32S), ld = lab.data32S, md = m.data, bad = new Uint8Array(nl);
        for (let j = 1; j < nl; j++) bad[j] = st.intAt(j, cv.CC_STAT_AREA) < W * H * .002 ? 1 : 0;
        for (let x = 0; x < W; x++) if (ld[x]) bad[ld[x]] = 1;
        for (let x = 0; x < W; x++) { let y = 0; while (y < H && (!md[y * W + x] || bad[ld[y * W + x]])) y++; t[x] = y; } }
      finally { m.delete(); k.delete(); lab.delete(); st.delete(); ce.delete(); }
      return t; };
    for (let k = 1; k < top; k++) { let above = 0, held = 0, old = 0;
      const t0 = bandTop(k - 1);
      for (let x = 0; x < W; x++) { let y = H;for (let q = Math.max(0, x - r); q <= Math.min(W - 1, x + r); q++) y = Math.min(y, t0[q]);
        for (let yy = 0; yy < y; yy++) { const i = yy * W + x;if (g[i]) { above++;if (A[k][i]) held++;if (DEPTH.lab[i] >= k - 1) old++; } } }
      // old: what the old rule (this band or nearer) would have put there, for comparison
      ghost['layer' + (k + 1)] = { above, held, ofGirl: +(held / N).toFixed(4), oldRule: +(old / N).toFixed(4) }; }
    return { px: N, shownOn: 'layer' + (top + 1), single: +(cnt[top] / N).toFixed(4), perLayer: cnt, ghost };
  }, [pts, whole]);
  const girl = async () => ({ face: await girlOne([[270, 390, 1]], false), whole: await girlOne([[270, 390, 1], [265, 580, 1], [415, 455, 1]], true) });
  // grid: image, depth, then each layer (outside dimmed, red outline)
  const viz = (file) => page.evaluate(() => {
    const tw = 560, th = Math.round(tw * S.H / S.W), n = S.layers.length, tiles = n + 1, cols = 3, rows = Math.ceil(tiles / cols);
    const c = mk(cols * tw, rows * (th + 22)), g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.font = '15px sans-serif';
    const put = (k, cv, label) => { const x = (k % cols) * tw, y = Math.floor(k / cols) * (th + 22); g.drawImage(cv, x, y + 22, tw, th); g.fillStyle = '#000'; g.fillText(label, x + 6, y + 16); };
    put(0, S.src, 'image');
    const d = DEPTH.d, dc = mk(S.W, S.H), dg = dc.getContext('2d'), id = dg.createImageData(S.W, S.H); let mn = Infinity, mx = -Infinity; for (const v of d) { if (v < mn) mn = v; if (v > mx) mx = v; }
    for (let i = 0; i < d.length; i++) { const v = (d[i] - mn) / (mx - mn) * 255; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; } dg.putImageData(id, 0, 0);
    put(1, dc, 'depth (white = near) th=' + JSON.stringify(DEPTH.info.th));
    for (let k = 1; k < n; k++) { const a = alphaArr(S.layers[k].mask), lc = mk(S.W, S.H), lg = lc.getContext('2d'); lg.drawImage(S.src, 0, 0);
      const im = lg.getImageData(0, 0, S.W, S.H), p = im.data, W = S.W;
      for (let i = 0; i < a.length; i++) { const e = a[i] && (i % W === 0 || !a[i - 1] || !a[i + 1] || !a[i - W] || !a[i + W]);
        if (e) { for (let o of [0, 1, -1, W, -W]) { const j = (i + o) * 4; if (j >= 0 && j < p.length) { p[j] = 230; p[j + 1] = 20; p[j + 2] = 20; } } }
        else if (!a[i]) { p[i * 4] *= .25; p[i * 4 + 1] *= .25; p[i * 4 + 2] *= .25; } }
      lg.putImageData(im, 0, 0); put(k + 1, lc, `layer ${k + 1} "${S.layers[k].name}"`); }
    return c.toDataURL('image/png');
  }).then(u => fs.writeFileSync(file, Buffer.from(u.split(',')[1], 'base64')));
  const shot3d = async (file) => {
    await page.click('#tab3d'); await page.click('[data-v="angle"]');
    await page.waitForFunction(() => !document.querySelector('#stage3d .busy'), null, { timeout: 120000 }); await page.waitForTimeout(800);
    await page.screenshot({ path: file }); await page.click('#tabEdit');
  };

  const res = {};
  // 1) built-in sample (has masks -> overwrite confirm), then one undo restores all layers
  const before = await masks();
  const ms1 = await runSplit('sample', true);
  const after = await masks();
  res.sample = { wallMs: ms1, info: await info(), counts: after.map(m => m.n), orphans: await orphans() };
  await viz(path.join(OUT, 'split-sample.png'));
  await page.evaluate(() => undo());
  const undone = await masks();
  res.sample.undoRestoresAll = undone.every((m, i) => m.h === before[i].h && m.n === before[i].n);
  res.sample.changed = after.some((m, i) => m.h !== before[i].h);

  // 2) sample1.webp (empty layers -> no confirm): pixel bands, then object mode
  const s1 = await page.evaluate(async () => { const r = await fetch('/samples/sample1.webp'); if (!r.ok) return false;
    const img = new Image(); img.src = URL.createObjectURL(await r.blob()); await img.decode();
    const c = mk(img.naturalWidth, img.naturalHeight); c.getContext('2d').drawImage(img, 0, 0);
    // set up after this evaluate returns: the AI select model starts encoding right away and blocks the page for a while
    window.__s1 = S.src; setTimeout(() => setupImage(c, [['뒤판(배경)', 0], ['먼 풍경', 5], ['중간', 10], ['앞 대상', 16], ['맨 앞 틀', 22]]), 0); return true; });
  if (s1) {
    await page.waitForFunction(() => S.src !== window.__s1 && AI.src === S.src && AI.emb && !AI.encoding, null, { timeout: 120000, polling: 500 });
    const msP = await runSplit('sample1-pixel', false);
    res.pixel = { wallMs: msP, info: await info(), counts: (await masks()).map(m => m.n), orphans: await orphans(), girl: await girl() };
    await viz(path.join(OUT, 'split-sample1-pixel.png'));
    await shot3d(path.join(OUT, 'split-3d-pixel.png'));
    await page.evaluate(() => undo());
    const msO = await runSplit('sample1-object', true);
    res.object = { wallMs: msO, info: await info(), counts: (await masks()).map(m => m.n), orphans: await orphans(), girl: await girl() };
    await viz(path.join(OUT, 'split-sample1-object.png'));
    await shot3d(path.join(OUT, 'split-3d-object.png'));
    await page.evaluate(() => undo());
    res.object.undoEmpties = (await masks()).slice(1).every(m => m.n === 0);
  }

  res.canCache = await page.evaluate(() => aiCanCache());
  res.asks = asks; res.progressShown = says; res.downloadMB = +(dl / 1e6).toFixed(1); res.errors = errors;
  const runs = [res.sample, res.pixel, res.object].filter(Boolean);
  const nonEmpty = runs.every(r => r.counts.slice(1).every(n => n > 0));
  const noGhost = r => [r.girl.face, r.girl.whole].every(m => Object.values(m.ghost).every(g => g.ofGirl < 0.01));
  const checks = {
    noOrphans: runs.every(r => r.orphans === 0), nonEmpty, sampleUndo: res.sample.undoRestoresAll && res.sample.changed, oneConsent: asks.filter(a => /받아요/.test(a)).length === 1,
    sampleUsedObjects: res.sample.info.objects > 0,
  };
  if (s1) Object.assign(checks, {
    noGhostPixel: noGhost(res.pixel), noGhostObject: noGhost(res.object), girlSingleLayer: res.object.girl.face.single >= 0.9 && res.object.girl.whole.single >= 0.9,
    objectsFound: res.object.info.objects > 0, progress: says.includes('sample1-object'), undoEmpties: res.object.undoEmpties,
  });
  res.checks = checks;
  res.pass = Object.values(checks).every(Boolean) && !errors.length;
  console.log(JSON.stringify(res, null, 1));
  await ctx.close();
  process.exit(res.pass ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
