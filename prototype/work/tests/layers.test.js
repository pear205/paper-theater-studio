// 레이어 고르기(전체 보기, Alt+클릭, 썸네일) 테스트: node layers.test.js [URL]
const { chromium } = require(process.env.PLAYWRIGHT_PATH||'playwright');
const path = require('path');
const url = process.argv[2] || 'http://127.0.0.1:8765/prototype/paper-theater-studio.html';
const OUT = process.env.OUT_DIR || path.resolve(__dirname, '..');
const results = [], errors = [];
const check = (name, ok, info) => { results.push({ name, ok: !!ok, info }); };
const ready = (p) => p.waitForFunction(() => { try { return !!S.cv && S.layers.length === 5; } catch (e) { return false; } }, null, { timeout: 90000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// a pixel whose front-most layer is j (checked against the raw masks), as client coordinates
const spot = (p, j) => p.evaluate((j) => {
  const al = S.layers.map((L) => L.mask.getContext('2d').getImageData(0, 0, S.W, S.H).data);
  let sx = 0, sy = 0, n = 0, pts = [];
  for (let y = 0; y < S.H; y += 4) for (let x = 0; x < S.W; x += 4) {
    const i = (y * S.W + x) * 4;
    let top = 0; for (let k = 1; k < al.length; k++) if (al[k][i + 3] > 127) top = k;
    const tp = (xx, yy) => { if (xx < 0 || yy < 0 || xx >= S.W || yy >= S.H) return -1; const q = (yy * S.W + xx) * 4; let t = 0; for (let k = 1; k < al.length; k++) if (al[k][q + 3] > 127) t = k; return t; };
    if (top === j && [[-9, 0], [9, 0], [0, -9], [0, 9]].every(([dx, dy]) => tp(x + dx, y + dy) === j)) { pts.push([x, y]); sx += x; sy += y; n++; } // inside, away from outlines
  }
  if (!n) return null;
  const cx = sx / n, cy = sy / n; pts.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
  // prefer a point a few px inside the region
  const [x, y] = pts.find((q) => Math.hypot(q[0] - pts[0][0], q[1] - pts[0][1]) >= 30) || pts[0], r = view.getBoundingClientRect(); // keep clear of the number badge at the centroid
  return { x: r.left + (x + 0.5) * r.width / S.W, y: r.top + (y + 0.5) * r.height / S.H, px: x, py: y, n };
}, j);
const px = (p, x, y) => p.evaluate(([x, y]) => { const d = vctx.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]]; }, [x, y]);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(url); await ready(page);

  // ---- thumbnails
  await sleep(700);
  const th = await page.evaluate(() => [...document.querySelectorAll('#layers .lrow canvas.th')].map((c) => ({ w: c.getBoundingClientRect().width, h: c.getBoundingClientRect().height, url: c.toDataURL() })));
  check('thumbnails: one per layer, ~44x30', th.length === 5 && th.every((t) => Math.abs(t.w - 44) < 1.5 && Math.abs(t.h - 30) < 1.5), th.map((t) => [t.w, t.h]));
  check('thumbnails: not blank and differ per layer', new Set(th.map((t) => t.url)).size === 5 && th.every((t) => t.url.length > 500));
  check('row controls still there', await page.evaluate(() => { const r = document.querySelectorAll('#layers .lrow')[2]; return !!r.querySelector('input[type=text]') && !!r.querySelector('input[type=number]') && !!r.querySelector('.del'); }));
  check('row compact (<=44px)', await page.evaluate(() => [...document.querySelectorAll('#layers .lrow')].every((r) => r.getBoundingClientRect().height <= 44)));

  // thumbnail updates after a mask edit (only the edited layer changes)
  await page.evaluate(() => { S.active = 2; renderLayers(); render(); });
  await sleep(700);
  const before = await page.evaluate(() => [...document.querySelectorAll('#layers canvas.th')].map((c) => c.toDataURL()));
  await page.evaluate(() => { pushUndo(2); const c = S.layers[2].mask.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(S.W * .1, S.H * .05, S.W * .5, S.H * .25); render(); });
  await sleep(900);
  const after = await page.evaluate(() => [...document.querySelectorAll('#layers canvas.th')].map((c) => c.toDataURL()));
  check('thumbnail of edited layer changed', before[2] !== after[2]);
  check('thumbnail of other layers unchanged', [0, 1, 3, 4].every((i) => before[i] === after[i]));
  await page.evaluate(() => { undo(); });
  await sleep(700);
  const back = await page.evaluate(() => document.querySelectorAll('#layers canvas.th')[2].toDataURL());
  check('thumbnail changes back after undo', back !== after[2]);

  // ---- overview: colours, hover label, click to switch
  await page.evaluate(() => { S.active = 1; renderLayers(); render(); });
  const sp = []; for (let j = 0; j < 5; j++) sp.push(await spot(page, j));
  check('sample has a visible region for every layer', sp.every(Boolean), sp.map((s) => s && s.n));
  await page.click('#tabOv');
  check('overview toggle on', await page.evaluate(() => LP.on) && (await page.getAttribute('#tabOv', 'aria-pressed')) === 'true');
  const cols = []; for (let j = 0; j < 5; j++) cols.push((await px(page, sp[j].px, sp[j].py)).join(','));
  check('regions tinted with distinct colours', new Set(cols).size === 5, cols);
  const near = await page.evaluate(([sp]) => sp.map((s, j) => { const h = layerColor(j), c = [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16)), d = vctx.getImageData(s.px, s.py, 1, 1).data; return Math.max(...c.map((v, k) => Math.abs(v - d[k]))); }), [sp]);
  check('tint is close to layerColor (>= base pixel mix)', near.every((v) => v < 140), near);
  await page.mouse.move(sp[3].x, sp[3].y); await sleep(100);
  const tip = await page.evaluate(() => { const t = $('lpTip'); return { hidden: t.hidden, text: t.textContent }; });
  check('hover label shows "4번 · 풀밭과 토끼"', !tip.hidden && tip.text === '4번 · 풀밭과 토끼', tip);
  await page.screenshot({ path: path.join(OUT, 'layers-desktop-overview.png') });
  await page.mouse.move(sp[4].x, sp[4].y); await sleep(100);
  check('hover label follows cursor to 5번', (await page.evaluate(() => $('lpTip').textContent)).startsWith('5번'));

  // overview blocks editing
  const ed = await page.evaluate(() => { S.tool = 'paint'; return { u: S.undo.length, a: S.layers[S.active].mask.toDataURL() }; });
  await page.mouse.move(sp[1].x - 20, sp[1].y); await page.mouse.down(); await page.mouse.move(sp[1].x + 30, sp[1].y + 20, { steps: 4 });
  const mid = await page.evaluate(() => ({ drag: typeof drag !== 'undefined' && !!drag, u: S.undo.length }));
  await page.mouse.up(); await sleep(150);
  // the click above may have selected a layer; that's fine, but nothing may be painted or pushed
  const ed2 = await page.evaluate(() => ({ u: S.undo.length, a: S.layers[1].mask.toDataURL() }));
  check('overview: no stroke / undo entry', !mid.drag && mid.u === ed.u && ed2.u === ed.u);
  check('overview: mask untouched', ed2.a === ed.a);

  // click rabbit -> layer 4, leaves overview
  await page.evaluate(() => { S.tool = 'rect'; lpSet(true); });
  await page.mouse.click(sp[3].x, sp[3].y); await sleep(100);
  check('click rabbit area -> layer 4, overview off', await page.evaluate(() => S.active === 3 && !LP.on));
  check('overview toggle shows off', (await page.getAttribute('#tabOv', 'aria-pressed')) === 'false');
  await page.click('#tabOv'); await page.mouse.click(sp[4].x, sp[4].y); await sleep(100);
  check('click trees frame -> layer 5', await page.evaluate(() => S.active === 4 && !LP.on));
  await page.click('#tabOv'); await page.mouse.click(sp[1].x, sp[1].y); await sleep(100);
  check('click mountains -> layer 2', await page.evaluate(() => S.active === 1 && !LP.on));
  await page.click('#tabOv'); await page.keyboard.press('Escape'); await sleep(80);
  check('Esc leaves overview', await page.evaluate(() => !LP.on));
  await page.click('#tabOv'); await page.click('#layers .lrow:nth-child(3)', { position: { x: 30, y: 5 } }); await sleep(80);
  check('clicking a layer row leaves overview', await page.evaluate(() => !LP.on && S.active === 2));

  // overview follows mask changes (cache invalidated)
  await page.evaluate(() => { S.active = 4; pushUndo(4); const c = S.layers[4].mask.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(S.W * .4, S.H * .4, 60, 60); render(); });
  const inv = await page.evaluate(() => { lpSet(true); const r = view.getBoundingClientRect(); return lpAt({ x: S.W * .4 + 30, y: S.H * .4 + 30 }); });
  check('overview map follows new edits', inv === 4, inv);
  await page.evaluate(() => { undo(); });
  check('overview map follows undo', await page.evaluate(() => { const j = lpAt({ x: S.W * .4 + 30, y: S.H * .4 + 30 }); return j !== 4; }));
  await page.evaluate(() => lpSet(false));

  // ---- Alt+click
  await page.evaluate(() => { S.active = 1; S.tool = 'paint'; renderLayers(); render(); });
  const au = await page.evaluate(() => S.undo.length);
  await page.keyboard.down('Alt'); await page.mouse.click(sp[3].x, sp[3].y); await page.keyboard.up('Alt'); await sleep(100);
  const alt = await page.evaluate(() => ({ a: S.active, on: LP.on, u: S.undo.length }));
  check('Alt+click jumps to layer 4 without overview, no painting', alt.a === 3 && !alt.on && alt.u === au, alt);
  await page.keyboard.down('Alt'); await page.mouse.click(sp[4].x, sp[4].y); await page.keyboard.up('Alt'); await sleep(100);
  check('Alt+click on trees -> layer 5', await page.evaluate(() => S.active === 4));
  check('hint mentions Alt+click', (await page.textContent('#hint')).includes('Alt+클릭'));
  // normal click still works with a tool
  await page.evaluate(() => { S.active = 1; S.tool = 'paint'; renderLayers(); render(); });
  await page.mouse.move(sp[1].x, sp[1].y); await page.mouse.down(); await page.mouse.move(sp[1].x + 10, sp[1].y + 5); await page.mouse.up();
  check('normal editing still works after leaving overview', await page.evaluate(() => S.undo.length) > au);

  // 3D tab: overview button switches back to edit
  await page.click('#tab3d'); await page.click('#tabOv');
  check('overview from 3D tab returns to edit view', await page.evaluate(() => S.view === 'edit' && LP.on));
  await page.evaluate(() => lpSet(false));

  // ---- phone
  const pctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const ph = await pctx.newPage();
  ph.on('pageerror', (e) => errors.push('phone pageerror: ' + e.message));
  await ph.goto(url); await ready(ph); await sleep(500);
  check('phone: no horizontal scroll', await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  check('phone: 전체 button in bar fits and >=40px', await ph.evaluate(() => { const r = $('mOv').getBoundingClientRect(); return r.width >= 39.5 && r.height >= 39.5 && r.right <= innerWidth && r.left >= 0; }));
  check('phone: layer rows fit', await ph.evaluate(() => [...document.querySelectorAll('#layers .lrow')].every((r) => r.scrollWidth <= r.clientWidth + 1)));
  await ph.tap('#mOv');
  check('phone: bar toggle turns overview on', await ph.evaluate(() => LP.on && $('mOv').getAttribute('aria-pressed') === 'true'));
  await ph.evaluate(() => $('editWrap').scrollIntoView({ block: 'start' }));
  await sleep(100);
  await ph.screenshot({ path: path.join(OUT, 'layers-375-overview.png') });
  const ps = await spot(ph, 3);
  await ph.touchscreen.tap(ps.x, ps.y); await sleep(150);
  check('phone: tapping rabbit -> layer 4, overview off', await ph.evaluate(() => S.active === 3 && !LP.on));
  await ph.tap('#mOv'); await ph.tap('#mOv');
  check('phone: toggle twice -> off', await ph.evaluate(() => !LP.on && $('mOv').getAttribute('aria-pressed') === 'false'));
  // fixes: AI tool + overview on phone, Esc keeps AI points, aborted drag, hint refresh, no per-render rebuild
  await ph.evaluate(() => { S.active = 1; S.tool = 'ai'; renderLayers(); refreshButtons(); render(); window.__ac = 0; const o = aiClick; aiClick = function (...a) { window.__ac++; return o.apply(this, a); }; window.__lb = 0; const b = lpBuild; lpBuild = function (...a) { window.__lb++; return b.apply(this, a); }; });
  const m0 = await ph.evaluate(() => S.layers[1].mask.toDataURL());
  await ph.tap('#mOv'); await ph.evaluate(() => $('editWrap').scrollIntoView({ block: 'start' })); await sleep(100);
  const ps3 = await spot(ph, 3);
  await ph.touchscreen.tap(ps3.x, ps3.y); await sleep(250);
  const r1 = await ph.evaluate((m) => ({ a: S.active, on: LP.on, ac: window.__ac, same: S.layers[1].mask.toDataURL() === m, tool: S.tool }), m0);
  check('phone+AI tool: overview tap picks layer, no aiClick, mask unchanged', r1.a === 3 && !r1.on && r1.ac === 0 && r1.same, r1);
  check('hint shows tool hint after picking (not overview text)', await ph.evaluate(() => !$('hint').textContent.includes('전체 보기예요')));
  // Esc in overview keeps AI points
  await ph.evaluate(() => { S.active = 1; cur().aiPts = [[10, 10, 1]]; renderLayers(); refreshButtons(); render(); lpSet(true); });
  await ph.keyboard.press('Escape'); await sleep(80);
  check('Esc in overview keeps L.aiPts', await ph.evaluate(() => !LP.on && cur().aiPts && cur().aiPts.length === 1));
  await ph.evaluate(() => { cur().aiPts = []; });
  // aborted drag then two consecutive clicks
  await ph.evaluate(() => { S.active = 1; renderLayers(); render(); lpSet(true); LP.dn = { id: 99, x: 0, y: 0 }; }); // stale down left over
  await ph.touchscreen.tap(ps3.x, ps3.y); await sleep(150);
  const c1 = await ph.evaluate(() => S.active === 3 && !LP.on);
  await ph.evaluate(() => { lpSet(true); LP.dn = { id: 98, x: 0, y: 0 }; });
  const ps4 = await spot(ph, 4);
  await ph.touchscreen.tap(ps4.x, ps4.y); await sleep(150);
  check('stale pointerdown does not swallow the next two taps', c1 && await ph.evaluate(() => S.active === 4 && !LP.on));
  // render() x5 in overview: no rebuild
  await ph.evaluate(() => { lpSet(true); window.__lb = 0; for (let i = 0; i < 5; i++) render(); });
  check('overview: 5 renders do not rebuild the map', await ph.evaluate(() => window.__lb === 0), await ph.evaluate(() => window.__lb));
  await ph.evaluate(() => lpSet(false));
  check('phone: no horizontal scroll after',await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await ph.evaluate(() => document.getElementById('layers').scrollIntoView({ block: 'center' }));
  await ph.screenshot({ path: path.join(OUT, 'layers-375-list.png') });

  check('no page errors', errors.length === 0, errors);
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, failures: failed, errors }, null, 1));
  process.exit(failed.length || errors.length ? 1 : 0);
})();
