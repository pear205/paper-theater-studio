// AI click select: hover preview, candidate thumbnails, click cycling (inside the object), touch hold. Multi-object cases: ai-multi.test.js. Downloads SlimSAM (~14MB) on first run.
// usage: node ai.test.js [url]   (sample1 is used when samples/sample1.webp exists, otherwise the built-in rabbit)
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const path = require('path');
const url = process.argv[2] || 'http://127.0.0.1:8765/prototype/paper-theater-studio.html';
const OUT = process.env.OUT_DIR || path.resolve(__dirname, '..');
const res = {}, errors = []; let fail = 0;
const check = (k, v, info) => { res[k] = v ? 'PASS' : { FAIL: info === undefined ? v : info }; if (!v) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(page) {
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => { try { return !!S.cv && !!S.W; } catch (e) { return false; } }, null, { timeout: 90000 });
  const s1 = await page.evaluate(async () => {
    const r = await fetch('/samples/sample1.webp'); if (!r.ok) return false;
    const img = new Image(); img.src = URL.createObjectURL(await r.blob()); await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0);
    setupImage(c, [['뒤판(배경)', 0], ['먼 풍경', 5], ['중간', 10], ['앞 대상', 16], ['맨 앞 틀', 22]]); return true;
  });
  await page.evaluate(() => { hideAsk(); S.active = 3; renderLayers(); const L = cur(); L.mask.getContext('2d').clearRect(0, 0, S.W, S.H); render(); });
  await page.evaluate(() => document.querySelector('#tools [data-tool="ai"]').click());
  // consent dialog on a fresh browser: press 받기
  await sleep(300);
  await page.evaluate(() => { if (!document.getElementById('ask').hidden) document.querySelector('#askBtns button').click(); });
  await page.waitForFunction(() => AI.state === 'error' || (AI.state === 'ready' && AI.emb && !AI.encoding && AI.src === S.src), null, { timeout: 300000 });
  return s1;
}
const maskCount = (page) => page.evaluate(() => { const d = cur().mask.getContext('2d').getImageData(0, 0, S.W, S.H).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 127) n++; return n; });
// IoU of the hover preview (AI.pc) with the committed mask
const iouPreview = (page, pc) => page.evaluate((pc) => {
  const m = cur().mask.getContext('2d').getImageData(0, 0, S.W, S.H).data; let a = 0, b = 0, both = 0;
  for (let i = 0; i < pc.length; i++) { const x = pc[i], y = m[i * 4 + 3] > 127; if (x) a++; if (y) b++; if (x && y) both++; }
  return both / (a + b - both || 1);
}, pc);
const toScreen = (page, x, y) => page.evaluate(([x, y]) => { const r = view.getBoundingClientRect(); return [r.left + x / S.W * r.width, r.top + y / S.H * r.height]; }, [x, y]);

(async () => {
  const browser = await chromium.launch({ headless: true });
  // ---- desktop (mouse)
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const s1 = await open(page);
  res.image = s1 ? 'sample1 (deer face)' : 'built-in sample (rabbit)';
  check('model ready', await page.evaluate(() => AI.state === 'ready'));
  const P = s1 ? [776, 453] : [700, 650];
  const [sx, sy] = await toScreen(page, ...P);
  // box prompt: this export's decoder has no input_boxes, so the AI tool has no box drag
  res.decoderInputs = await page.evaluate(() => AI.model.sessions.prompt_encoder_mask_decoder.inputNames);
  res.boxPrompt = res.decoderInputs.includes('input_boxes') ? 'decoder accepts input_boxes (not wired)' : 'unsupported by this model (skipped)';

  // 1) hover preview
  await page.mouse.move(sx - 30, sy - 20); await page.mouse.move(sx, sy, { steps: 4 });
  await page.waitForFunction(() => AI.pv && !AI.pvJob && AI.hv, null, { timeout: 20000 });
  const pv = await page.evaluate(() => { const d = AI.pc.getContext('2d').getImageData(0, 0, S.W, S.H).data; const a = new Uint8Array(S.W * S.H); let n = 0; for (let i = 0; i < a.length; i++) if (d[i * 4 + 3] > 127) { a[i] = 1; n++; } return { a: Array.from(a), n, hv: AI.hv }; });
  check('hover preview appears', pv.n > 500, { n: pv.n });
  check('mask unchanged while hovering', (await maskCount(page)) === 0);
  await page.screenshot({ path: path.join(OUT, 'ai-hover.png') });
  // preview throttle: many moves, never more than one decode in flight, preview follows the last spot
  const t0 = Date.now();
  for (let i = 0; i < 15; i++) await page.mouse.move(sx + (i % 5) * 3, sy + (i % 3) * 3);
  await page.mouse.move(sx, sy);
  await page.waitForFunction(() => !AI.pvJob, null, { timeout: 20000 });
  res.hoverBurstMs = Date.now() - t0;

  // 2) click commits; matches the preview
  const u0 = await page.evaluate(() => S.undo.length);
  await page.mouse.down(); await page.mouse.up();
  // read the autosave flag the moment the result lands: the 1.5 s autosave may run (and clear it) during the slow checks below
  await page.waitForFunction(() => { if (S.aiBusy || !S.aiLast) return false; window.__dirtyAtCommit = cur().__d === true; return true; }, null, { timeout: 30000 });
  const n1 = await maskCount(page);
  const iou = await iouPreview(page, pv.a);
  res.previewIoU = +iou.toFixed(3);
  check('click commits a mask', n1 > 500, { n1 });
  check('committed mask matches hover preview (IoU > 0.85)', iou > 0.85, iou);
  const st = await page.evaluate(() => ({ lv: cur().aiLevel, c: S.aiLast.masks.map((m) => ({ area: m.area, iou: +m.iou.toFixed(3) })), pick: aiPick(S.aiLast.masks), undo: S.undo.length, dirty: window.__dirtyAtCommit }));
  res.candidates = st.c; res.defaultLevel = st.lv;
  check('default = aiPick (best IoU, not a sliver)', st.lv === st.pick, st);
  check('click is one undo step + autosave sees it', st.undo === u0 + 1 && st.dirty, st);

  // 3) thumbnails
  const th = await page.evaluate(() => [...document.querySelectorAll('#aiCands [data-lv]')].map((b) => {
    const c = b.querySelector('canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
    return { dis: b.disabled, pressed: b.getAttribute('aria-pressed'), label: b.getAttribute('aria-label'), px: n };
  }));
  check('three thumbnails drawn and enabled', th.length === 3 && th.every((t) => !t.dis && t.px > 100 && /후보 \d/.test(t.label)), th);
  check('default thumbnail pressed', th[st.lv].pressed === 'true', th);
  const other = (st.lv + 1) % 3;
  const before = await maskCount(page);
  await page.evaluate((o) => document.querySelector(`#aiCands [data-lv="${o}"]`).click(), other); // keyboard/AT path, no scroll
  const after = await maskCount(page);
  check('thumbnail pick changes mask', after !== before && await page.evaluate((o) => cur().aiLevel === o, other), { before, after });
  await page.evaluate(() => $('undo').click());
  check('thumbnail pick is undoable', (await maskCount(page)) === before, { before, now: await maskCount(page) });
  // after undo the candidates are gone (same as before); commit again for the cycle test
  await page.mouse.move(sx + 40, sy + 40); await page.mouse.move(sx, sy);
  await page.waitForFunction(() => !AI.pvJob, null, { timeout: 20000 });

  // 4) click again on (almost) the same spot cycles without a new point
  await page.evaluate(() => { aiEnd(); cur().mask.getContext('2d').clearRect(0, 0, S.W, S.H); render(); });
  await page.mouse.move(sx + 1, sy); await page.mouse.down(); await page.mouse.up();
  await page.waitForFunction(() => !S.aiBusy && S.aiLast, null, { timeout: 30000 });
  const c0 = await page.evaluate(() => ({ lv: cur().aiLevel, pts: cur().aiPts.length }));
  await page.mouse.move(sx + 2, sy + 1);
  await sleep(200);
  check('no preview on the spot where a click only cycles', await page.evaluate(() => !AI.pv));
  await page.mouse.down(); await page.mouse.up(); await sleep(100);
  const c1 = await page.evaluate(() => ({ lv: cur().aiLevel, pts: cur().aiPts.length }));
  check('same-spot click cycles to next candidate', c1.pts === c0.pts && c1.lv === (c0.lv + 1) % 3, { c0, c1 });
  // Shift+click away from the object adds a "not here" point
  const [nx, ny] = await toScreen(page, P[0] + (s1 ? 0 : -40), P[1] - (s1 ? 140 : 90));
  await page.keyboard.down('Shift'); await page.mouse.move(nx, ny); await page.mouse.down(); await page.mouse.up(); await page.keyboard.up('Shift');
  await page.waitForFunction(() => !S.aiBusy, null, { timeout: 30000 });
  check('Shift+click adds a label-0 point', await page.evaluate(() => { const p = cur().aiPts; return p.length === 2 && p[1][2] === 0; }));
  // leaving the view hides the preview
  await page.mouse.move(5, 5); await sleep(100);
  check('preview hidden after leaving the image', await page.evaluate(() => !AI.pv && !AI.hv));
  check('no page errors (desktop)', errors.length === 0, errors.slice());
  await page.close();

  // ---- phone (touch): press-and-hold shows the preview, release commits
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const mp = await ctx.newPage();
  await open(mp);
  const cdp = await ctx.newCDPSession(mp);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) });
  await mp.evaluate(() => window.scrollTo(0, 0));
  const [tx, ty] = await toScreen(mp, ...P);
  check('phone: bar shows AI thumbnails', await mp.evaluate(() => !document.getElementById('mAi').hidden && document.querySelectorAll('#mAi [data-mlv] canvas').length === 3));
  await touch('touchStart', [[tx, ty]]);
  await mp.waitForFunction(() => AI.pv && !AI.pvJob, null, { timeout: 20000 });
  check('phone: hold shows preview, mask untouched', (await maskCount(mp)) === 0);
  await touch('touchEnd', []);
  await mp.waitForFunction(() => !S.aiBusy && S.aiLast, null, { timeout: 30000 });
  check('phone: release commits', (await maskCount(mp)) > 500 && await mp.evaluate(() => !AI.pv));
  const mb = await mp.evaluate(() => [...document.querySelectorAll('#mAi [data-mlv]')].map((b) => ({ dis: b.disabled, pressed: b.getAttribute('aria-pressed'), label: b.getAttribute('aria-label') })));
  check('phone: bar thumbnails enabled with labels, one pressed', mb.every((b) => !b.dis && /후보/.test(b.label)) && mb.filter((b) => b.pressed === 'true').length === 1, mb);
  const pb = await maskCount(mp);
  const lvNow = await mp.evaluate(() => cur().aiLevel);
  await mp.evaluate((o) => document.querySelector(`#mAi [data-mlv="${o}"]`).click(), (lvNow + 1) % 3);
  check('phone: bar thumbnail switches candidate', (await maskCount(mp)) !== pb);
  // plain tap inside the object cycles the candidate; with the "점 더하기" toggle the tap refines
  const [qx, qy] = await toScreen(mp, P[0] + 15, P[1] + 10);
  const lv0 = await mp.evaluate(() => cur().aiLevel);
  await touch('touchStart', [[qx, qy]]); await sleep(60); await touch('touchEnd', []);
  await mp.waitForFunction(() => !S.aiBusy, null, { timeout: 30000 });
  check('phone: tap inside the object cycles, no new point', await mp.evaluate((l) => cur().aiPts.length === 1 && cur().aiLevel === (l + 1) % 3, lv0));
  await mp.evaluate(() => document.getElementById('mPos').click());
  await touch('touchStart', [[qx, qy]]); await sleep(60); await touch('touchEnd', []);
  await mp.waitForFunction(() => !S.aiBusy, null, { timeout: 30000 });
  check('phone: tap with 점 더하기 adds a point', await mp.evaluate(() => cur().aiPts.length === 2 && cur().aiPts[1][2] === 1));
  await mp.screenshot({ path: path.join(OUT, 'ai-phone.png') });
  check('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log(JSON.stringify({ fail, res }, null, 1));
  process.exit(fail || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
