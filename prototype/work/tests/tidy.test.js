// 작은 조각 정리: GrabCut / AI 클릭 결과를 정리 켬 vs 끔으로 비교 (sample1 필요, AI 모델은 처음에 ~14MB 받음)
// usage: node tidy.test.js [url]   OUT_DIR=이미지 저장 폴더
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const path = require('path');
const url = process.argv[2] || 'http://127.0.0.1:8765/prototype/paper-theater-studio.html';
const OUT = process.env.OUT_DIR || path.resolve(__dirname, '..');
const res = {}, errors = []; let fail = 0;
const check = (k, v, info) => { res[k] = v ? 'PASS' : { FAIL: info === undefined ? v : info }; if (!v) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// components (8-conn), specks < 9mm2, pinholes < 9mm2 (4-conn background pieces not touching the edge), area of the layer mask
const stats = (page) => page.evaluate(() => {
  const cv = S.cv, W = S.W, H = S.H, d = cur().mask.getContext('2d').getImageData(0, 0, W, H).data, a = new Uint8Array(W * H);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] > 127 ? 255 : 0;
  const lim = 9 * pxPerMm() ** 2, m = cv.matFromArray(H, W, cv.CV_8UC1, a), inv = new cv.Mat(), l = new cv.Mat(), s = new cv.Mat(), c = new cv.Mat();
  const cc = (src, conn) => { cv.connectedComponentsWithStats(src, l, s, c, conn); return s.data32S.slice(); };
  const A = cc(m, 8), comps = A.length / 5 - 1; let specks = 0, area = 0, big = 0;
  for (let j = 1; j <= comps; j++) { const ar = A[j * 5 + 4]; area += ar; big = Math.max(big, ar); if (ar < lim) specks++; }
  cv.bitwise_not(m, inv); const B = cc(inv, 4); let holes = 0;
  for (let j = 1; j < B.length / 5; j++) { const x = B[j * 5], y = B[j * 5 + 1]; if (x > 0 && y > 0 && x + B[j * 5 + 2] < W && y + B[j * 5 + 3] < H && B[j * 5 + 4] < lim) holes++; }
  [m, inv, l, s, c].forEach((x) => x.delete());
  return { comps, specks, holes, area, big };
});

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => { try { return !!S.cv && !!S.W; } catch (e) { return false; } }, null, { timeout: 90000 });
  const s1 = await page.evaluate(async () => {
    const r = await fetch('/samples/sample1.webp'); if (!r.ok) return false;
    const img = new Image(); img.src = URL.createObjectURL(await r.blob()); await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0);
    setupImage(c, [['뒤판(배경)', 0], ['먼 풍경', 5], ['중간', 10], ['앞 대상', 16], ['맨 앞 틀', 22]]); return true;
  });
  if (!s1) { console.log(JSON.stringify({ skipped: 'samples/sample1.webp missing' })); await browser.close(); return; }
  await page.evaluate(() => { hideAsk(); S.active = 3; renderLayers(); });
  const clear = () => page.evaluate(() => { const L = cur(); L.mask.getContext('2d').clearRect(0, 0, S.W, S.H); L.gcBase = null; L.aiPts = []; S.aiLast = null; S.undo.length = 0; S.redo.length = 0; });
  const setTidy = (v) => page.evaluate((v) => { document.getElementById('tidySel').checked = v; }, v);
  const grab = () => page.evaluate(async () => { const L = cur(); L.rect = { x: 615, y: 285, w: 310, h: 387 }; await runGrabCut(newGrp()); });
  check('checkbox exists, default on, inside #modeRow', await page.evaluate(() => { const e = document.getElementById('tidySel'); return !!e && e.checked && !!e.closest('#modeRow') && !!e.parentElement.title; }));

  // ---- GrabCut
  const gc = {};
  for (const on of [false, true]) {
    await clear(); await setTidy(on);
    await grab();
    gc[on ? 'on' : 'off'] = await stats(page);
    if (on) {
      check('grabcut: one undo step', (await page.evaluate(() => S.undo.length)) === 1);
      await page.evaluate(() => document.getElementById('undo').click());
      check('grabcut: undo empties', (await stats(page)).area === 0);
    }
  }
  res.grabcut = gc;
  check('grabcut: fewer pieces, specks+holes gone', gc.on.comps < gc.off.comps && gc.off.specks + gc.off.holes >= 3 && gc.on.specks + gc.on.holes === 0, gc);
  check('grabcut: no small specks/holes left', gc.on.specks <= 1 && gc.on.holes === 0, gc.on);
  check('grabcut: main area within 5%', Math.abs(gc.on.big - gc.off.big) / gc.off.big < 0.05, gc);

  // ---- 빼기: the removed shape is tidied too
  await clear(); await setTidy(true);
  await page.evaluate(async () => { const L = cur(), g = L.mask.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(600, 270, 340, 420); S.selMode = 'sub'; L.rect = { x: 615, y: 285, w: 310, h: 387 }; await runGrabCut(newGrp()); S.selMode = 'add'; });
  const sub = await stats(page); res.sub = sub;
  check('sub: result has no tiny pieces', sub.specks <= 2 && sub.holes <= 2, sub);

  // ---- AI click
  await clear(); await setTidy(true);
  await page.evaluate(() => document.querySelector('#tools [data-tool="ai"]').click());
  await sleep(300);
  await page.evaluate(() => { if (!document.getElementById('ask').hidden) document.querySelector('#askBtns button').click(); });
  await page.waitForFunction(() => AI.state === 'error' || (AI.state === 'ready' && AI.emb && !AI.encoding && AI.src === S.src), null, { timeout: 300000 });
  check('ai model ready', await page.evaluate(() => AI.state === 'ready'));
  const ai = {};
  for (const on of [false, true]) {
    await clear(); await setTidy(on);
    await page.evaluate(() => aiClick({ x: 760, y: 450 }, 1));
    await page.waitForFunction(() => !S.aiBusy && S.aiLast, null, { timeout: 60000 });
    ai[on ? 'on' : 'off'] = await stats(page);
    if (on) check('ai: one undo step', (await page.evaluate(() => S.undo.length)) === 1);
  }
  res.ai = ai;
  check('ai: no more specks/holes than raw', ai.on.specks + ai.on.holes <= ai.off.specks + ai.off.holes, ai);
  check('ai: no small specks/holes left', ai.on.specks <= 1 && ai.on.holes === 0, ai.on);
  check('ai: main area within 5%', Math.abs(ai.on.big - ai.off.big) / ai.off.big < 0.05, ai);

  // ---- a small piece touching the existing mask is kept (keep mask), a lone one is dropped
  const adj = await page.evaluate(() => {
    const W = S.W, H = S.H, sel = new Uint8Array(W * H), keep = new Uint8Array(W * H);
    for (let y = 100; y < 300; y++) for (let x = 100; x < 300; x++) sel[y * W + x] = 1;
    for (let y = 100; y < 103; y++) for (let x = 400; x < 403; x++) sel[y * W + x] = 1;   // speck next to the old mask
    for (let y = 100; y < 103; y++) for (let x = 403; x < 420; x++) keep[y * W + x] = 1;  // old mask touches it
    for (let y = 500; y < 503; y++) for (let x = 400; x < 403; x++) sel[y * W + x] = 1;   // lone speck
    const a = tidySel(sel, W, H), b = tidySel(sel, W, H, keep);
    return { plain: [a[101 * W + 401], a[501 * W + 401]], kept: [b[101 * W + 401], b[501 * W + 401]], big: b[200 * W + 200] };
  });
  check('tidySel: piece touching keep is kept, lone speck dropped', adj.plain[0] === 0 && adj.kept[0] === 1 && adj.kept[1] === 0 && adj.big === 1, adj);

  // ---- autosave keeps the toggle
  await setTidy(false);
  const kept = await page.evaluate(async () => {
    const rec = await ptCollect(false); const off = rec.settings.tidySel === false;
    document.getElementById('tidySel').checked = true; await ptRestore(rec);
    return { off, restoredOff: document.getElementById('tidySel').checked === false };
  });
  check('autosave: toggle saved and restored', kept.off && kept.restoredOff, kept);

  // ---- before/after picture of the deer (GrabCut, tidy off vs on)
  const png = {};
  await page.evaluate(() => { S.active = 3; S.tool = 'rect'; });
  // GrabCut is not bit-exact between runs, so ON is the OFF mask run through tidySel (same input)
  await clear(); await setTidy(false); await grab();
  for (const on of [false, true]) {
    png[on] = await page.evaluate((on) => { // selection cut out over a dimmed picture, cropped to the deer, 2x
      const W = S.W, H = S.H, L = cur(), d = L.mask.getContext('2d').getImageData(0, 0, W, H).data;
      const t = document.createElement('canvas'); t.width = W; t.height = H; const tg = t.getContext('2d');
      let m = d; if (on) { const a = new Uint8Array(W * H); for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] > 127 ? 1 : 0; const o = tidySel(a); m = new Uint8ClampedArray(W * H * 4); for (let i = 0; i < o.length; i++) m[i * 4 + 3] = o[i] * 255; }
      tg.putImageData(new ImageData(new Uint8ClampedArray(m), W, H), 0, 0);
      const c = document.createElement('canvas'); c.width = 660; c.height = 814; const g = c.getContext('2d');
      g.drawImage(S.src, 605, 275, 330, 407, 0, 0, 660, 814); g.fillStyle = 'rgba(40,40,40,.75)'; g.fillRect(0, 0, 660, 814);
      tg.globalCompositeOperation = 'source-in'; tg.drawImage(S.src, 0, 0); g.drawImage(t, 605, 275, 330, 407, 0, 0, 660, 814);
      return c.toDataURL('image/png');
    }, on);
  }
  const cmp = await browser.newPage({ viewport: { width: 1360, height: 880 } });
  await cmp.setContent(`<body style="margin:0;background:#fff;font:16px sans-serif"><div style="display:flex;gap:16px;padding:12px"><div>tidy OFF<br><img src="${png[false]}"></div><div>tidy ON<br><img src="${png[true]}"></div></div>`);
  await cmp.screenshot({ path: path.join(OUT, 'tidy-compare.png') });

  check('no page errors', errors.length === 0, errors);
  console.log(JSON.stringify(res, null, 1));
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
