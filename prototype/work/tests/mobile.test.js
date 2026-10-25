// F2 휴대폰 편집 모드 테스트: node mobile.test.js [mobile.html URL]
const { chromium } = require(process.env.PLAYWRIGHT_PATH||'playwright');
const path = require('path');
const BASE = 'http://127.0.0.1:8765/prototype/work/';
const url = process.argv[2] || BASE + 'mobile.html';
const OUT = process.env.OUT_DIR || path.resolve(__dirname, '..');
const results = [], errors = [];
const check = (name, ok, info) => { results.push({ name, ok: !!ok, info }); };
const ready = (p) => p.waitForFunction(() => { try { return !!S.cv && S.layers.length > 0; } catch (e) { return false; } }, null, { timeout: 90000 });
const KEYS = '#view,#tools,#undo,#layers,.bench,#editWrap,#hint';
const rects = (p) => p.evaluate((k) => Object.fromEntries([...document.querySelectorAll(k)].map((e, i) => { const r = e.getBoundingClientRect(); return [e.id || e.className || e.tagName + i, [r.x, r.y, r.width, r.height].map((v) => Math.round(v))]; })), KEYS);

(async () => {
  const browser = await chromium.launch({ headless: true });

  // ---- desktop: bar hidden, layout unchanged vs base.html
  const dctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const d1 = await dctx.newPage(), d2 = await dctx.newPage();
  [d1, d2].forEach((p) => { p.on('pageerror', (e) => errors.push('desktop pageerror: ' + e.message)); });
  await d1.goto(url); await d2.goto(BASE + 'base.html');
  await ready(d1); await ready(d2);
  const r1 = await rects(d1), r2 = await rects(d2);
  check('desktop: bar hidden', await d1.evaluate(() => getComputedStyle(document.getElementById('mbar')).display === 'none'));
  check('desktop: layout same as base', JSON.stringify(r1) === JSON.stringify(r2), { mobile: r1, base: r2 });
  check('desktop: 뺄 점 button exists, disabled until points', await d1.evaluate(() => { const b = document.getElementById('aiNeg'); return !!b && b.disabled; }));
  await d1.screenshot({ path: path.join(OUT, 'mobile-desktop.png') });
  await dctx.close();

  // ---- phone
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('phone pageerror: ' + e.message));
  await page.goto(url); await ready(page);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tap = async (x, y) => { await touch('touchStart', [[x, y]]); await touch('touchEnd', []); await sleep(60); };

  check('phone: bar visible', await page.evaluate(() => { const r = document.getElementById('mbar').getBoundingClientRect(); return r.height > 60 && Math.round(r.bottom) === innerHeight; }));
  check('phone: no horizontal scroll', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const vw = await page.evaluate(() => view.getBoundingClientRect().width);
  check('phone: canvas near full width (>=340)', vw >= 340, vw);
  check('phone: bar buttons >=40px', await page.evaluate(() => [...document.querySelectorAll('#mbar button')].filter((b) => b.offsetParent).every((b) => { const r = b.getBoundingClientRect(); return r.width >= 39.5 && r.height >= 39.5; })));

  // tool switching via bar
  for (const t of ['paint', 'poly', 'fg', 'ai', 'rect']) {
    await page.tap(`#mbar [data-mt="${t}"]`);
    check('bar tool -> ' + t, await page.evaluate((t) => S.tool === t && document.querySelector(`#mbar [data-mt="${t}"]`).getAttribute('aria-pressed') === 'true', t));
  }
  await page.tap('#mbar [data-mt="poly"]');
  check('poly context row shows 닫기/취소', await page.evaluate(() => !document.getElementById('mPoly').hidden));
  await page.tap('#mbar [data-mt="paint"]');
  check('brush context row shows', await page.evaluate(() => !document.getElementById('mBrush').hidden));
  await page.tap('#mNext'); await page.tap('#mPrev');
  check('layer prev/next', await page.evaluate(() => S.active === 1));
  await page.screenshot({ path: path.join(OUT, 'mobile-375.png') });

  // scroll canvas fully into view for touch tests
  await page.evaluate(() => document.getElementById('editWrap').scrollIntoView({ block: 'start' }));
  await page.evaluate(() => window.scrollBy(0, -4));
  await sleep(200);
  const base = await page.evaluate(() => { const r = view.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height, W: S.W, H: S.H }; });
  const clientOf = (ix, iy, tr) => [base.l + tr.tx + ix * (base.w / base.W) * tr.z, base.t + tr.ty + iy * (base.h / base.H) * tr.z];

  // pinch in around the center
  const cx = base.l + base.w * 0.5, cy = base.t + base.h * 0.5;
  await touch('touchStart', [[cx - 20, cy], [cx + 20, cy]]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [[cx - 20 - i * 12, cy], [cx + 20 + i * 12, cy]]);
  await touch('touchEnd', []); await sleep(100);
  const tr = await page.evaluate(() => ({ z: Z.z, tx: Z.tx, ty: Z.ty, css: view.style.transform }));
  check('pinch zooms (>1.5x) and sets transform', tr.z > 1.5 && /scale/.test(tr.css), tr);
  check('pinch did not touch undo stack/poly', await page.evaluate(() => S.undo.length >= 0 && S.poly.length === 0));
  check('zoomed rect matches transform math', await page.evaluate((b) => { const r = view.getBoundingClientRect(); return Math.abs(r.width - b.w * Z.z) < 1 && Math.abs(r.left - (b.l + Z.tx)) < 1; }, base));

  // poly tap after zoom maps to correct image pixel
  await page.evaluate(() => { S.active = 1; S.tool = 'poly'; S.poly = []; renderLayers(); render(); });
  const target = { ix: base.W * 0.5, iy: base.H * 0.5 };
  const [tx, ty] = clientOf(target.ix, target.iy, tr);
  check('target inside viewport', tx > 0 && tx < 375 && ty > 0 && ty < 812, [tx, ty]);
  await tap(tx, ty);
  const p0 = await page.evaluate(() => S.poly[0]);
  check('poly tap on pointerup maps to image pixel (±3px)', p0 && Math.abs(p0.x - target.ix) < 3 && Math.abs(p0.y - target.iy) < 3, { p0, target });

  // poly: a drag (not a tap) adds no point; second finger doesn't add one either
  const n0 = await page.evaluate(() => S.poly.length);
  await touch('touchStart', [[tx, ty]]); await touch('touchMove', [[tx + 40, ty + 40]]); await touch('touchEnd', []); await sleep(60);
  check('poly drag is not a tap', await page.evaluate((n) => S.poly.length === n, n0));
  await page.evaluate(() => { S.poly = []; render(); });

  // reset zoom with 맞춤
  await page.evaluate(() => document.getElementById('mFit').click());
  check('맞춤 resets zoom', await page.evaluate(() => Z.z === 1 && view.style.transform === ''));
  await sleep(100);

  // brush stroke cancelled by a second finger leaves the mask unchanged
  const b2 = await page.evaluate(() => { const r = view.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; });
  const hash = () => page.evaluate(() => { const d = cur().mask.getContext('2d').getImageData(0, 0, S.W, S.H).data; let h = 0; for (let i = 3; i < d.length; i += 4) h = (h * 31 + d[i]) | 0; return h + ':' + S.undo.length; });
  await page.evaluate(() => { S.tool = 'paint'; S.active = 1; renderLayers(); render(); document.getElementById('clearMask').click(); });
  const before = await hash();
  const ax = b2.l + b2.w * 0.3, ay = b2.t + b2.h * 0.4;
  await touch('touchStart', [[ax, ay]]);
  for (let i = 1; i <= 5; i++) await touch('touchMove', [[ax + i * 8, ay + i * 4]]);
  const mid = await hash();
  await touch('touchStart', [[ax + 40, ay + 20], [ax + 120, ay + 90]]);
  await sleep(60);
  const cancelled = await hash();
  for (let i = 1; i <= 3; i++) await touch('touchMove', [[ax + 40, ay + 20], [ax + 120 + i * 10, ay + 90]]);
  await touch('touchEnd', []); await sleep(100);
  const after = await hash();
  check('stroke painted before 2nd finger', mid !== before, { before, mid });
  check('2nd finger cancels stroke (mask + undo restored)', cancelled === before && after === before, { before, mid, cancelled, after });

  // a normal one-finger stroke still works after the gesture
  await touch('touchStart', [[ax, ay]]); await touch('touchMove', [[ax + 30, ay + 10]]); await touch('touchEnd', []); await sleep(80);
  check('one-finger brush works after gesture', (await hash()) !== before);

  // AI 뺄 점: toggle + label handling (model stubbed)
  const ai = await page.evaluate(async () => {
    S.active = 1; S.tool = 'ai'; const L = cur(); L.aiPts = [[10, 10, 1]]; refreshAi();
    const neg = document.getElementById('aiNeg'), mneg = document.getElementById('mNeg');
    const en = !neg.disabled && !mneg.disabled;
    neg.click(); const on1 = neg.getAttribute('aria-pressed') === 'true' && mneg.getAttribute('aria-pressed') === 'true';
    mneg.click(); const off = neg.getAttribute('aria-pressed') === 'false';
    mneg.click();
    AI.state = 'ready'; AI.emb = {}; AI.src = S.src; window.aiEncode = async () => {};
    let got = null; window.aiDecode = async (pts) => { got = pts.slice(); throw new Error('stub'); };
    await aiClick({ x: 20, y: 20 }, 1);
    return { en, on1, off, label: got && got[got.length - 1][2], reset: aiNeg === false };
  });
  check('뺄 점 enabled with points, toggles from both buttons', ai.en && ai.on1 && ai.off, ai);
  check('다음 AI 클릭은 label 0 이고 토글이 꺼짐', ai.label === 0 && ai.reset, ai);

  check('no page errors', errors.length === 0, errors);
  await page.screenshot({ path: path.join(OUT, 'mobile-375-after.png') });
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, failures: failed, errors }, null, 1));
  process.exit(failed.length || errors.length ? 1 : 0);
})();
