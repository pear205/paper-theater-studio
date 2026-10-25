// brush-size cursor test: node brush.test.js [url]
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const url = process.argv[2] || 'http://127.0.0.1:8765/prototype/paper-theater-studio.html';
const results = [], errors = [];
const check = (name, ok, info) => { results.push({ name, ok: !!ok, info }); };
const ready = (p) => p.waitForFunction(() => { try { return !!S.cv && S.layers.length > 0; } catch (e) { return false; } }, null, { timeout: 90000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptbrush-'));
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, viewport: { width: 1360, height: 900 } });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(url); await ready(page); await sleep(600);
  await page.evaluate(() => { S.active = 1; renderLayers(); render(); });
  await page.click('[data-tool="paint"]');
  const info = () => page.evaluate(() => { const c = brushCur.getBoundingClientRect(), v = view.getBoundingClientRect(); return { vis: getComputedStyle(brushCur).display !== 'none', d: c.width, h: c.height, scale: v.width / S.W, brush: S.brush, cx: c.left + c.width / 2, cy: c.top + c.height / 2, cur: getComputedStyle(view).cursor, v: { l: v.left, t: v.top, w: v.width, h: v.height } }; });
  const mid = async () => { const i = await info(); const x = i.v.l + i.v.w * .5, y = i.v.t + i.v.h * .5; await page.mouse.move(x - 5, y - 5); await page.mouse.move(x, y); await sleep(100); return [x, y]; };
  const [x, y] = await mid();
  let i = await info();
  const wantD = i.brush * (await page.evaluate(() => S.W)) / 1000 * i.scale;
  check('paint: circle visible', i.vis, i);
  check('diameter = brush width x display scale (+-2px)', Math.abs(i.d - wantD) <= 2 && Math.abs(i.h - i.d) < .5, [i.d, wantD]);
  check('circle centred on pointer, cursor none', Math.abs(i.cx - x) <= 1.5 && Math.abs(i.cy - y) <= 1.5 && i.cur === 'none', [i.cx, i.cy, x, y, i.cur]);
  for (const t of ['erase', 'fg', 'bg']) { await page.click(`[data-tool="${t}"]`); await page.mouse.move(x + 3, y + 3); await sleep(50); check(t + ': visible', (await info()).vis); }
  await page.click('[data-tool="paint"]'); await page.mouse.move(x, y); await sleep(50);
  // zoom 3x
  await page.evaluate(([x, y]) => zAt(3, x, y), [x, y]); await sleep(100);
  await page.mouse.move(x + 4, y + 4); await page.mouse.move(x, y); await sleep(100);
  let z = await info(); const wantZ = z.brush * (await page.evaluate(() => S.W)) / 1000 * z.scale;
  check('3x zoom: diameter triples', z.vis && Math.abs(z.d - wantD * 3) <= 3 && Math.abs(z.d - wantZ) <= 2, [z.d, wantD * 3]);
  await page.evaluate(() => zReset()); await sleep(100); await page.mouse.move(x + 4, y + 4); await page.mouse.move(x, y); await sleep(50);
  // slider
  await page.evaluate(() => { const b = $('brush'); b.value = 60; b.dispatchEvent(new Event('input', { bubbles: true })); }); await sleep(50);
  i = await info();
  check('slider updates diameter', Math.abs(i.d - 60 * (await page.evaluate(() => S.W)) / 1000 * i.scale) <= 2, [i.d]);
  // slider with pointer away: centred preview, then hides
  await sleep(1000); await page.mouse.move(5, 5); await sleep(50);
  check('pointer off canvas: hidden', !(await info()).vis);
  await page.evaluate(() => { const b = $('brush'); b.value = 30; b.dispatchEvent(new Event('input', { bubbles: true })); }); await sleep(50);
  i = await info(); const vc = [i.v.l + i.v.w / 2, i.v.t + i.v.h / 2];
  check('slider preview centred', i.vis && Math.abs(i.cx - vc[0]) <= 2 && Math.abs(i.cy - vc[1]) <= 2 && i.cur !== 'none', [i.cx, i.cy, vc]);
  await sleep(1000);
  check('slider preview hides after ~0.8s', !(await info()).vis);
  // space pan
  await page.mouse.move(x, y); await sleep(50); check('visible again', (await info()).vis);
  await page.keyboard.down('Space'); await sleep(80);
  check('Space held: hidden', !(await info()).vis);
  await page.keyboard.up('Space'); await sleep(80);
  check('Space released: visible', (await info()).vis);
  // middle-button pan
  await page.mouse.down({ button: 'middle' }); await page.mouse.move(x + 20, y + 20); await sleep(50);
  check('middle-drag: hidden', !(await info()).vis);
  await page.mouse.up({ button: 'middle' });
  // rect tool
  await page.click('[data-tool="rect"]'); await page.mouse.move(x + 2, y + 2); await sleep(50);
  check('rect tool: hidden', !(await info()).vis && (await info()).cur !== 'none');
  // overview
  await page.click('[data-tool="paint"]'); await page.mouse.move(x, y); await sleep(50);
  await page.evaluate(() => lpSet(true)); await sleep(100); await page.mouse.move(x + 3, y + 3); await sleep(50);
  check('overview: hidden', !(await info()).vis);
  await page.evaluate(() => lpSet(false)); await sleep(100);
  // layer 1 (back board)
  await page.evaluate(() => { S.active = 0; renderLayers(); render(); }); await page.mouse.move(x, y); await sleep(50);
  check('layer 1: hidden', !(await info()).vis);
  await page.evaluate(() => { S.active = 1; renderLayers(); render(); });
  // touch pointer
  await page.mouse.move(x, y); await sleep(50);
  await page.evaluate(() => view.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'touch', clientX: 200, clientY: 200, bubbles: true }))); await sleep(50);
  check('touch input: hidden', !(await info()).vis);
  await page.mouse.move(x, y); await sleep(50);
  check('mouse again: visible', (await info()).vis);
  check('no page errors', errors.length === 0, errors);
  console.log(JSON.stringify(results, null, 1));
  await ctx.close();
  process.exit(results.every((r) => r.ok) && !errors.length ? 0 : 1);
})();
