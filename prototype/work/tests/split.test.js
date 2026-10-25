// F4 depth split test: node split.test.js [url]
// downloads the model (~27MB, wasm q8) each run: a fresh browser has no cache
const { chromium } = require(process.env.PLAYWRIGHT_PATH||'playwright');
const fs = require('fs'), path = require('path');
const URL = process.argv.slice(2).find(a => a.startsWith('http')) || 'http://127.0.0.1:8765/prototype/work/split.html';
const OUT = process.env.OUT_DIR || path.resolve(__dirname, '..');

(async () => {
  const ctx = await chromium.launch({ headless: true });
  const page = await ctx.newPage({ viewport: { width: 1360, height: 900 } });
  const errors = [], asks = [];let dl = 0;
  page.on('pageerror', e => errors.push(String(e)));
  page.on('response', async r => { if (/huggingface|hf\.co|xethub/.test(r.url()) && r.status() === 200) { const l = +(r.headers()['content-length'] || 0); dl += l; } });
  await page.goto(URL);
  await page.waitForFunction(() => { try { return !!S.cv; } catch (e) { return false; } }, null, { timeout: 120000 });

  // click the button, answer every ask() with its first (primary) choice until the split is done
  async function runSplit(tag) {
    await page.evaluate(() => { DEPTH.totalMs = null; });
    const t0 = Date.now();
    await page.click('#depthSplit');
    while (true) {
      const st = await page.evaluate(() => ({ ask: !$('ask').hidden ? $('askMsg').textContent : null, done: DEPTH.totalMs != null && !DEPTH.busy, err: DEPTH.state === 'error' }));
      if (st.ask) { asks.push(tag + ': ' + st.ask); await page.click('#askBtns button.primary'); }
      if (st.done || st.err) break;
      if (Date.now() - t0 > 600000) throw new Error('timeout');
      await page.waitForTimeout(300);
    }
    return Date.now() - t0;
  }
  const masks = () => page.evaluate(() => S.layers.map(L => { const a = alphaArr(L.mask); let n = 0, h = 0; for (let i = 0; i < a.length; i++) if (a[i]) { n++; h = (h * 31 + i) >>> 0; } return { n, h }; }));
  const nested = () => page.evaluate(() => { const A = S.layers.map(L => alphaArr(L.mask)), r = [];
    for (let k = 2; k < A.length; k++) { let out = 0, n = 0; for (let i = 0; i < A[k].length; i++) if (A[k][i]) { n++; if (!A[k - 1][i]) out++; } r.push(n ? +(out / n).toFixed(4) : 0); } return r; });
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

  const res = {};
  // 1) built-in sample (has masks -> overwrite confirm), then one undo restores all layers
  const before = await masks();
  const ms1 = await runSplit('sample');
  const after = await masks();
  res.sample = { wallMs: ms1, info: await page.evaluate(() => ({ ...DEPTH.info, gpu: DEPTH.gpu, loadMs: DEPTH.loadMs, runMs: DEPTH.runMs, maskMs: DEPTH.maskMs, totalMs: DEPTH.totalMs })), counts: after.map(m => m.n), nestedOut: await nested() };
  await viz(path.join(OUT, 'split-sample.png'));
  await page.evaluate(() => undo());
  const undone = await masks();
  res.sample.undoRestoresAll = undone.every((m, i) => m.h === before[i].h && m.n === before[i].n);
  res.sample.changed = after.some((m, i) => m.h !== before[i].h);

  // 2) sample1.webp (empty layers -> no confirm)
  await page.evaluate(async () => { const blob = await (await fetch('/samples/sample1.webp')).blob(); const img = new Image(); img.src = URL.createObjectURL(blob); await img.decode();
    const c = mk(img.naturalWidth, img.naturalHeight); c.getContext('2d').drawImage(img, 0, 0);
    setupImage(c, [['뒤판(배경)', 0], ['먼 풍경', 5], ['중간', 10], ['앞 대상', 16], ['맨 앞 틀', 22]]); });
  const ms2 = await runSplit('sample1');
  res.sample1 = { wallMs: ms2, info: await page.evaluate(() => ({ ...DEPTH.info, runMs: DEPTH.runMs, maskMs: DEPTH.maskMs, totalMs: DEPTH.totalMs })), counts: (await masks()).map(m => m.n), nestedOut: await nested() };
  await viz(path.join(OUT, 'split-sample1.png'));
  await page.evaluate(() => undo());
  res.sample1.undoEmpties = (await masks()).slice(1).every(m => m.n === 0);

  res.modelFilesMB = await page.evaluate(() => +(Object.values(DEPTH.files).reduce((s, [l, t]) => s + t, 0) / 1e6).toFixed(1));
  res.canCache = await page.evaluate(() => aiCanCache());
  res.asks = asks; res.downloadMB = +(dl / 1e6).toFixed(1); res.errors = errors;
  const nonEmpty = [res.sample, res.sample1].every(r => r.counts.slice(1).every(n => n > 0));
  const nest = [res.sample, res.sample1].every(r => r.nestedOut.every(f => f < 0.05));
  res.pass = nonEmpty && nest && res.sample.undoRestoresAll && res.sample.changed && res.sample1.undoEmpties && !errors.length;
  console.log(JSON.stringify(res, null, 1));
  await ctx.close();
  process.exit(res.pass ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
