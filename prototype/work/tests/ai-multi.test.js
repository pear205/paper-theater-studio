// AI click select, several objects in a row (sample1 + AI model needed): click = new object, click inside = cycle, Ctrl+click = extend, Shift+click = remove, phone taps + "점 더하기".
// usage: node ai-multi.test.js [url]   OUT_DIR=이미지 저장 폴더
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const path = require('path');
const url = process.argv[2] || 'http://127.0.0.1:8765/prototype/paper-theater-studio.html';
const OUT = process.env.OUT_DIR || path.resolve(__dirname, '..');
const res = {}, errors = []; let fail = 0;
const check = (k, v, info) => { res[k] = v ? 'PASS' : { FAIL: info === undefined ? v : info }; if (!v) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEER = [776, 453], GIRL = [270, 390], BODY = [265, 580];

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
  if (!s1) return false;
  await page.evaluate(() => { hideAsk(); S.active = 3; renderLayers(); const L = cur(); L.mask.getContext('2d').clearRect(0, 0, S.W, S.H); render(); });
  await page.evaluate(() => document.querySelector('#tools [data-tool="ai"]').click());
  await sleep(300);
  await page.evaluate(() => { if (!document.getElementById('ask').hidden) document.querySelector('#askBtns button').click(); });
  await page.waitForFunction(() => AI.state === 'error' || (AI.state === 'ready' && AI.emb && !AI.encoding && AI.src === S.src), null, { timeout: 300000 });
  return true;
}
// mask area and number of components (>1500px) of the layer mask
const info = (page) => page.evaluate(() => {
  const W = S.W, H = S.H, d = cur().mask.getContext('2d').getImageData(0, 0, W, H).data, a = new Uint8Array(W * H); let n = 0;
  for (let i = 0; i < a.length; i++) if (d[i * 4 + 3] > 127) { a[i] = 255; n++; }
  const cv = S.cv, m = cv.matFromArray(H, W, cv.CV_8UC1, a), l = new cv.Mat(), s = new cv.Mat(), c = new cv.Mat();
  cv.connectedComponentsWithStats(m, l, s, c, 8); let comps = 0; for (let j = 1; j < s.rows; j++) if (s.data32S[j * 5 + 4] > 1500) comps++;
  [m, l, s, c].forEach((x) => x.delete());
  return { n, comps };
});
const has = (page, x, y) => page.evaluate(([x, y]) => cur().mask.getContext('2d').getImageData(x | 0, y | 0, 1, 1).data[3] > 127, [x, y]);
const toScreen = (page, x, y) => page.evaluate(([x, y]) => { const r = view.getBoundingClientRect(); return [r.left + x / S.W * r.width, r.top + y / S.H * r.height]; }, [x, y]);
const settle = (page) => page.waitForFunction(() => !S.aiBusy && !AI.pvJob, null, { timeout: 40000 });
async function click(page, pt, mod) {
  const [x, y] = await toScreen(page, ...pt);
  await page.mouse.move(x - 8, y - 8); await page.mouse.move(x, y);
  if (mod) await page.keyboard.down(mod);
  await page.mouse.down(); await page.mouse.up();
  if (mod) await page.keyboard.up(mod);
  await sleep(150); await settle(page);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  if (!(await open(page))) { console.log(JSON.stringify({ skipped: 'samples/sample1.webp missing' })); await browser.close(); return; }
  check('model ready', await page.evaluate(() => AI.state === 'ready'));
  const u0 = await page.evaluate(() => S.undo.length);

  // 1) deer, then girl: two objects
  await click(page, DEER);
  const a1 = await info(page);
  check('deer face selected', a1.n > 500 && a1.comps === 1 && await has(page, ...DEER), a1);
  // hover on the girl previews a NEW object (not a refinement of the deer)
  const [gx, gy] = await toScreen(page, ...GIRL);
  await page.mouse.move(gx - 10, gy - 10); await page.mouse.move(gx, gy, { steps: 3 });
  await page.waitForFunction(() => AI.pv && !AI.pvJob, null, { timeout: 20000 });
  const pvOn = await page.evaluate(([dx, dy, gx, gy]) => { const g = AI.pc.getContext('2d'); return [g.getImageData(dx, dy, 1, 1).data[3] > 127, g.getImageData(gx, gy, 1, 1).data[3] > 127]; }, [...DEER, ...GIRL]);
  check('hover outside the object previews the new object only', pvOn[1] && !pvOn[0], pvOn);
  await page.mouse.down(); await page.mouse.up(); await sleep(150); await settle(page);
  const a2 = await info(page);
  const st2 = await page.evaluate(() => ({ undo: S.undo.length, pts: cur().aiPts.length }));
  check('girl added as a second object, deer kept', a2.comps === 2 && a2.n > a1.n + 500 && await has(page, ...DEER) && await has(page, ...GIRL), { a1, a2 });
  check('each object is one undo step; new object has its own points', st2.undo === u0 + 2 && st2.pts === 1, { u0, st2 });
  await page.screenshot({ path: path.join(OUT, 'ai-multi-two.png') });

  // 2) click inside the girl: next candidate, no new object
  const g0 = await page.evaluate(() => ({ lv: cur().aiLevel, pts: cur().aiPts.length }));
  await click(page, [GIRL[0] + 2, GIRL[1] + 2]);
  const g1 = await page.evaluate(() => ({ lv: cur().aiLevel, pts: cur().aiPts.length }));
  check('click inside the object cycles the candidate (no new point)', g1.pts === g0.pts && g1.lv === (g0.lv + 1) % 3, { g0, g1 });
  check('deer still there after cycling', await has(page, ...DEER));

  // 3) Ctrl+click on the body extends the girl (one object)
  await page.evaluate((lv) => { const b = document.querySelector(`#aiCands [data-lv="${lv}"]`); b.click(); }, g0.lv);
  const b0 = await info(page);
  await click(page, BODY, 'Control');
  const b1 = await info(page), pts1 = await page.evaluate(() => cur().aiPts.map((p) => p[2]));
  check('Ctrl+click adds a positive point to the same object', pts1.length === g0.pts + 1 && pts1[pts1.length - 1] === 1, pts1);
  check('Ctrl+click grows the girl, still two objects', b1.n > b0.n && b1.comps === 2 && await has(page, ...DEER) && await has(page, ...BODY), { b0, b1 });

  // 4) Shift+click inside her removes a part
  const [mx, my] = await page.evaluate(() => { const d = cur().mask.getContext('2d').getImageData(0, 0, S.W, S.H).data; let best = [0, 0];
    for (let y = 500; y < 640; y += 4) for (let x = 200; x < 340; x += 4) if (d[(y * S.W + x) * 4 + 3] > 127) best = [x, y]; return best; });
  await click(page, [mx, my], 'Shift');
  const b2 = await info(page), pts2 = await page.evaluate(() => cur().aiPts.map((p) => p[2]));
  check('Shift+click adds a negative point and removes area', pts2[pts2.length - 1] === 0 && b2.n < b1.n && await has(page, ...DEER), { b1, b2, pts2 });

  // 5) undo: refinements first, then the girl goes alone
  await page.evaluate(() => $('undo').click()); await page.evaluate(() => $('undo').click());
  check('undo reverts Shift and Ctrl refinements', (await info(page)).n === b0.n, { b0 });
  while (await page.evaluate((u) => S.undo.length > u + 2, u0)) await page.evaluate(() => $('undo').click());
  await page.evaluate(() => $('undo').click());
  const u1 = await info(page);
  check('undo once more removes only the girl', u1.comps === 1 && await has(page, ...DEER) && !(await has(page, ...GIRL)), u1);
  // after undo a plain click starts a fresh object (no stale points)
  await click(page, GIRL);
  const f1 = await page.evaluate(() => cur().aiPts.length);
  check('after undo a click starts a new object', f1 === 1 && (await info(page)).comps === 2, f1);
  await page.evaluate(() => $('aiNew').click());
  check('새 대상 ends the session', await page.evaluate(() => !cur().aiPts.length && !S.aiLast));
  // 6) gather: two objects picked in one session both move to the active layer and leave the front layer
  await page.evaluate(() => { const L = cur(); L.mask.getContext('2d').clearRect(0, 0, S.W, S.H); const f = S.layers[4].mask.getContext('2d'); f.fillStyle = '#fff'; f.fillRect(0, 0, S.W, S.H); render(); });
  await click(page, DEER); await click(page, GIRL);
  const gOk = await page.evaluate(() => !$('gather').disabled);
  await page.evaluate(() => $('gather').click()); await sleep(500);
  const gat = await page.evaluate(([d, g]) => { const px = (L, p) => L.mask.getContext('2d').getImageData(p[0], p[1], 1, 1).data[3] > 127; return { dA: px(S.layers[3], d), gA: px(S.layers[3], g), dF: px(S.layers[4], d), gF: px(S.layers[4], g) }; }, [DEER, GIRL]);
  check('gather with two AI objects: both in the active layer, both removed from the front layer', gOk && gat.dA && gat.gA && !gat.dF && !gat.gF, { gOk, gat });
  // 7) small candidate chosen, click on the larger body of the same object: cycles instead of a new object
  await page.evaluate(() => { $('aiNew').click(); const L = cur(); L.mask.getContext('2d').clearRect(0, 0, S.W, S.H); render(); });
  await click(page, GIRL);
  await page.evaluate(() => document.querySelector('#aiCands [data-lv="2"]').click());
  const c0 = await page.evaluate(() => ({ lv: cur().aiLevel, pts: cur().aiPts.length, u: S.undo.length }));
  await click(page, BODY);
  const c1 = await page.evaluate(() => ({ lv: cur().aiLevel, pts: cur().aiPts.length }));
  check('with 작게 chosen, clicking the larger body cycles (same object)', c0.lv === 2 && c1.pts === c0.pts && c1.lv === 0, { c0, c1 });
  // 8) Ctrl+Z right after a Ctrl keydown leaves no preview
  const [hx, hy] = await toScreen(page, ...DEER);
  await page.mouse.move(hx - 8, hy - 8); await page.mouse.move(hx, hy, { steps: 3 });
  await page.keyboard.down('Control'); await sleep(100);
  await page.keyboard.press('z'); await sleep(1500);
  await page.keyboard.up('Control'); await sleep(1500);
  check('Ctrl+Z after Ctrl keydown: no stale preview', await page.evaluate(() => !AI.pv && !AI.hv), await page.evaluate(() => ({ pv: !!AI.pv, hv: !!AI.hv })));
  check('no page errors (desktop)', errors.length === 0, errors.slice());
  await page.close();

  // ---- phone: tap deer, tap girl; 점 더하기 makes a tap refine
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const mp = await ctx.newPage();
  await open(mp);
  const cdp = await ctx.newCDPSession(mp);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) });
  const tap = async (pt) => { const [x, y] = await toScreen(mp, ...pt); await touch('touchStart', [[x, y]]); await sleep(60); await touch('touchEnd', []); await sleep(150); await settle(mp); };
  await mp.evaluate(() => window.scrollTo(0, 0));
  await tap(DEER); await tap(GIRL);
  const m1 = await info(mp);
  check('phone: tap deer then tap girl adds both', m1.comps === 2 && await has(mp, ...DEER) && await has(mp, ...GIRL) && await mp.evaluate(() => cur().aiPts.length === 1), m1);
  check('phone: 점 더하기 button in the bar and in the panel', await mp.evaluate(() => !!document.getElementById('mPos') && !!document.getElementById('aiPos') && !document.getElementById('mPos').disabled));
  await mp.evaluate(() => document.getElementById('mPos').click());
  check('phone: toggle pressed', await mp.evaluate(() => document.getElementById('mPos').getAttribute('aria-pressed') === 'true' && document.getElementById('aiPos').getAttribute('aria-pressed') === 'true'));
  await tap(BODY);
  const m2 = await info(mp), pp = await mp.evaluate(() => ({ p: cur().aiPts.map((p) => p[2]), on: document.getElementById('mPos').getAttribute('aria-pressed') }));
  check('phone: tap with 점 더하기 refines the girl (extra point, bigger, toggle reset)', pp.p.length === 2 && pp.p[1] === 1 && m2.n > m1.n && m2.comps === 2 && pp.on === 'false', { pp, m1, m2 });
  await mp.screenshot({ path: path.join(OUT, 'ai-multi-phone.png') });
  check('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log(JSON.stringify({ fail, res }, null, 1));
  process.exit(fail || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
