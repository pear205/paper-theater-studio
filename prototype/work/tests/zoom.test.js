// 데스크톱 확대/이동 테스트: node zoom.test.js [url]
const { chromium } = require(process.env.PLAYWRIGHT_PATH||'playwright');
const path = require('path');
const url = process.argv[2] || 'http://127.0.0.1:8765/prototype/paper-theater-studio.html';
const OUT = process.env.OUT_DIR || path.resolve(__dirname, '..');
const results = [], errors = [];
const check = (name, ok, info) => { results.push({ name, ok: !!ok, info }); };
const ready = (p) => p.waitForFunction(() => { try { return !!S.cv && S.layers.length > 0; } catch (e) { return false; } }, null, { timeout: 90000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(url); await ready(page);
  const st = () => page.evaluate(() => ({ z: Z.z, tx: Z.tx, ty: Z.ty, css: view.style.transform, pct: document.getElementById('zPct').textContent, n: S.undo.length, zm: document.getElementById('viewBox').classList.contains('zm') }));
  const vr = () => page.evaluate(() => { const r = document.getElementById('viewBox').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const imgAt = (cx, cy) => page.evaluate(([x, y]) => pt({ clientX: x, clientY: y }), [cx, cy]);
  const maskSum = () => page.evaluate(() => { const L = S.layers[1], d = L.mask.getContext('2d').getImageData(0, 0, S.W, S.H).data; let s = 0; for (let i = 3; i < d.length; i += 4) s += d[i]; return s; });
  await page.evaluate(() => { S.active = 1; renderLayers(); render(); });
  const box = await vr();
  const cx = box.x + box.w * 0.7, cy = box.y + box.h * 0.4;

  check('control visible, 100%', await page.evaluate(() => !document.getElementById('zctl').hidden && document.getElementById('zPct').textContent === '100%'));
  check('control inside viewBox bottom-right, away from layer tag', await page.evaluate(() => { const c = zctl.getBoundingClientRect(), v = viewBox.getBoundingClientRect(), t = layerTag.getBoundingClientRect(); return c.right <= v.right && c.bottom <= v.bottom && c.left > v.left + v.width / 2 && (c.left >= t.right || c.top >= t.bottom || t.width === 0); }));
  const hint0 = await page.textContent('#hint');
  check('hint mentions wheel/space', /휠로 확대/.test(hint0) && /스페이스/.test(hint0), hint0);

  // wheel zoom around cursor
  const before = await imgAt(cx, cy);
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -100); await sleep(30); }
  const s1 = await st(), after = await imgAt(cx, cy);
  const pxScale = box.w / (await page.evaluate(() => S.W));
  check('wheel zoom in ~1.15^6', Math.abs(s1.z - Math.pow(1.15, 6)) < 0.05 && s1.zm && s1.pct === Math.round(s1.z * 100) + '%', s1);
  check('image pixel under cursor stays (+-2px)', Math.abs(after.x - before.x) * pxScale * s1.z <= 2 && Math.abs(after.y - before.y) * pxScale * s1.z <= 2, { before, after });
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, -100);
  check('zoom capped at 8x', Math.abs((await st()).z - 8) < 1e-6);
  for (let i = 0; i < 80; i++) await page.mouse.wheel(0, 100);
  const s0 = await st();
  check('wheel out returns to 1x, transform cleared', s0.z === 1 && s0.css === '' && !s0.zm, s0);
  // ctrl+wheel (trackpad pinch)
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -20); await page.keyboard.up('Control');
  check('ctrl+wheel zooms', (await st()).z > 1.1);
  await page.click('#zPct');
  check('% button resets', (await st()).z === 1);

  // wheel outside the canvas does not zoom
  await page.mouse.move(5, 450);
  const outBefore = await st();
  await page.mouse.wheel(0, -300);
  check('wheel outside canvas: no zoom', (await st()).z === outBefore.z);

  // zoom, then pan with Space+drag
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -100);
  const z3 = await st(), n0 = z3.n, m0 = await maskSum();
  await page.keyboard.down('Space');
  check('Space shows grab cursor', await page.evaluate(() => getComputedStyle(view).cursor === 'grab'));
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 60, cy + 40, { steps: 5 });
  check('while dragging: grabbing cursor', await page.evaluate(() => getComputedStyle(view).cursor === 'grabbing'));
  await page.mouse.up(); await page.keyboard.up('Space');
  const p1 = await st();
  check('Space+drag pans by the drag distance', Math.abs((p1.tx - z3.tx) - 60) < 1.5 && Math.abs((p1.ty - z3.ty) - 40) < 1.5, { z3, p1 });
  check('Space+drag: no undo entry / mask change / draft', p1.n === n0 && await maskSum() === m0 && await page.evaluate(() => !S.draft && S.poly.length === 0));
  // clamp
  await page.keyboard.down('Space'); await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 3000, cy + 3000, { steps: 4 }); await page.mouse.up(); await page.keyboard.up('Space');
  check('pan clamped', await page.evaluate(() => Z.tx <= 0 && Z.ty <= 0 && Z.tx >= view.offsetWidth * (1 - Z.z) && Z.ty >= view.offsetHeight * (1 - Z.z)));
  // middle drag (move to the image center first so there is room both ways)
  await page.mouse.move(cx, cy); await page.mouse.down({ button: 'middle' }); await page.mouse.move(cx - 50, cy - 30, { steps: 5 }); await page.mouse.up({ button: 'middle' });
  const m2 = await st();
  check('middle-drag pans (from clamped corner)', m2.tx < 0 && m2.ty < 0 || Math.abs(m2.tx) > 0, m2);
  const m3a = await st();
  await page.mouse.move(cx, cy); await page.mouse.down({ button: 'middle' }); await page.mouse.move(cx + 20, cy + 15, { steps: 5 }); await page.mouse.up({ button: 'middle' });
  const m3 = await st();
  check('middle-drag moves by the drag distance', Math.abs((m3.tx - m3a.tx) - 20) < 1.5 && Math.abs((m3.ty - m3a.ty) - 15) < 1.5, { m3a, m3 });
  check('middle-drag: no undo / mask change', m3.n === n0 && await maskSum() === m0);

  // brush stroke maps to the right pixel when zoomed
  await page.click('[data-tool="paint"]');
  const sx = box.x + box.w * 0.5, sy = box.y + box.h * 0.5, want = await imgAt(sx, sy);
  await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx + 30, sy + 10, { steps: 4 }); await page.mouse.up();
  const hit = await page.evaluate(([x, y]) => S.layers[1].mask.getContext('2d').getImageData(Math.round(x), Math.round(y), 1, 1).data[3], [want.x, want.y]);
  check('zoomed brush paints at the right pixel', hit > 200, { want, hit });
  check('brush made one undo entry', (await st()).n === n0 + 1);
  await page.evaluate(() => undo());
  // polygon point
  await page.click('[data-tool="poly"]');
  const q = await imgAt(sx + 20, sy + 20);
  await page.mouse.click(sx + 20, sy + 20);
  const pp = await page.evaluate(() => S.poly[0]);
  check('zoomed polygon point maps correctly', pp && Math.abs(pp.x - q.x) < 1 && Math.abs(pp.y - q.y) < 1, { pp, q });
  const np = await page.evaluate(() => S.poly.length);
  await page.keyboard.down('Space'); await page.mouse.click(sx + 80, sy + 60); await page.keyboard.up('Space');
  check('Space+click adds no polygon point', await page.evaluate(() => S.poly.length) === np);
  await page.evaluate(() => { S.poly = []; render(); });
  check('canvas bitmap unchanged by zoom', await page.evaluate(() => view.width === S.W && view.height === S.H));
  await page.screenshot({ path: path.join(OUT, 'zoom-desktop.png') });

  // keyboard
  await page.mouse.move(cx, cy);
  await page.keyboard.press('Control+0');
  check('Ctrl+0 resets', (await st()).z === 1);
  await page.keyboard.press('Control+Equal');
  const k1 = (await st()).z; await page.keyboard.press('Control+Minus');
  check('Ctrl+= zooms in, Ctrl+- out', k1 > 1.2 && (await st()).z < k1);
  await page.click('#zIn'); await page.click('#zOut'); await page.click('#zPct');
  check('+ / - / % buttons', (await st()).z === 1);
  await page.mouse.move(cx, cy); for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -100);
  await page.focus('#widthMm'); await page.keyboard.press('Control+0');
  check('Ctrl+0 ignored in text field', (await st()).z > 1);
  await page.click('#zPct');

  check('no page errors (desktop)', errors.length === 0, errors);
  await ctx.close();

  // ---- phone: pinch still works, no desktop control
  const pctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const ph = await pctx.newPage();
  ph.on('pageerror', (e) => errors.push('phone pageerror: ' + e.message));
  await ph.goto(url); await ready(ph);
  const cdp = await pctx.newCDPSession(ph);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) });
  await ph.evaluate(() => window.scrollBy(0, -4)); await sleep(200);
  const b = await ph.evaluate(() => { const r = view.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; });
  const px = b.l + b.w / 2, py = b.t + b.h / 2;
  await touch('touchStart', [[px - 20, py], [px + 20, py]]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [[px - 20 - i * 12, py], [px + 20 + i * 12, py]]);
  await touch('touchEnd', []); await sleep(100);
  check('phone: pinch zooms', await ph.evaluate(() => Z.z > 1.5 && /scale/.test(view.style.transform)));
  check('phone: desktop control hidden, 맞춤 resets', await ph.evaluate(() => { const hid = getComputedStyle(zctl).display === 'none'; document.getElementById('mFit').click(); return hid && Z.z === 1; }));
  check('no page errors (phone)', errors.length === 0, errors);
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, failures: failed, errors }, null, 1));
  process.exit(failed.length || errors.length ? 1 : 0);
})();
