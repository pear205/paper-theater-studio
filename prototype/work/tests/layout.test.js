// 페이지 배치 테스트(고정 작업대, 접는 카드, 머리글 PDF 버튼, 휴대폰): node layout.test.js [url]  (sample1 있으면 난이도 줄도 확인)
const { chromium } = require(process.env.PLAYWRIGHT_PATH||'playwright');
const path = require('path');
const url = process.argv[2] || 'http://127.0.0.1:8765/prototype/paper-theater-studio.html';
const OUT = process.env.OUT_DIR || path.resolve(__dirname, '..');
const results = [], errors = [];
const check = (name, ok, info) => { results.push({ name, ok: !!ok, info }); };
const ready = (p) => p.waitForFunction(() => { try { return !!S.cv && S.layers.length > 0; } catch (e) { return false; } }, null, { timeout: 90000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SAMPLE1 = `async()=>{const r=await fetch('/samples/sample1.webp');if(!r.ok)return null;const i=new Image();i.src=URL.createObjectURL(await r.blob());await i.decode();const c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;c.getContext('2d').drawImage(i,0,0);return c}`;
const FOLDS = ['aiHelper', 'guideCard', 'sizeCard', 'saveCard'];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(url); await ready(page); await sleep(400);
  const box = (sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom, r: r.right }; }, sel);
  const vh = 900;

  // ---- fit and sticky
  let bn = await box('.bench');
  check('top: whole bench inside the viewport', bn.y >= 0 && bn.b <= vh, bn);
  const ar = await page.evaluate(() => S.W / S.H), vw = await box('#view');
  check('canvas keeps its aspect ratio', Math.abs(vw.w / vw.h - ar) < 0.01, { vw, ar });
  await page.screenshot({ path: path.join(OUT, 'layout-desktop-top.png') });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await sleep(300);
  const sy = await page.evaluate(() => scrollY);
  bn = await box('.bench'); const vw2 = await box('#view');
  check('page is long enough to scroll', sy > 200, sy);
  check('bottom: canvas fully inside the viewport', vw2.y >= 0 && vw2.b <= vh && vw2.x >= 0, vw2);
  check('bottom: bench fully inside the viewport (sticky)', bn.y >= 0 && bn.b <= vh + 0.5, bn);
  await page.screenshot({ path: path.join(OUT, 'layout-desktop-bottom.png') });
  const railH = await page.evaluate(() => document.querySelector('.rail').offsetHeight);
  check('rail shorter than before (< 2000px with default folds)', railH < 2000, railH);
  await page.evaluate(() => window.scrollTo(0, 0));

  // ---- bench fits in other viewport heights, and after changing tabs
  await page.setViewportSize({ width: 1360, height: 700 }); await sleep(400);
  bn = await box('.bench'); check('700px tall viewport: bench is no taller than the viewport minus the sticky gap', bn.h <= 700 - 24 + 0.5, bn);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await sleep(300);
  bn = await box('.bench'); check('700px tall viewport, scrolled: bench fits', bn.y >= 0 && bn.b <= 700, bn);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.setViewportSize({ width: 1360, height: 900 }); await sleep(400);
  await page.click('#tab3d'); await sleep(600);
  bn = await box('.bench'); check('3D tab: bench fits', bn.b <= vh, bn);
  await page.click('#tabEdit'); await sleep(400);
  bn = await box('.bench'); check('back to edit: bench fits', bn.b <= vh, bn);
  await page.click('#tabOv'); await sleep(400);
  bn = await box('.bench'); check('overview: bench fits', bn.b <= vh, bn);
  await page.click('#tabEdit'); await sleep(300);

  // ---- folds
  const fstate = () => page.evaluate((ids) => ids.map((i) => document.getElementById(i).open), FOLDS);
  check('four folding cards start collapsed', (await fstate()).every((o) => o === false), await fstate());
  check('other cards are not folds and stay open', await page.evaluate(() => document.querySelectorAll('.rail > .card:not(.fold)').length === 4 && [...document.querySelectorAll('.rail > .card:not(.fold)')].every((c) => c.offsetHeight > 60)));
  check('collapsed body is not shown', await page.evaluate(() => !document.getElementById('dxCopy').checkVisibility()));
  await page.click('#guideCard > summary');
  check('summary click opens', (await fstate())[1] === true && await page.evaluate(() => document.getElementById('guideAdd').checkVisibility()));
  await page.click('#guideCard > summary');
  check('summary click closes', (await fstate())[1] === false);
  await page.focus('#sizeCard > summary'); await page.keyboard.press('Enter');
  check('Enter opens', (await fstate())[2] === true);
  await page.keyboard.press('Enter');
  check('Enter closes', (await fstate())[2] === false);
  await page.keyboard.press('Space');
  check('Space opens', (await fstate())[2] === true);
  await page.keyboard.press('Space');
  check('Space closes', (await fstate())[2] === false);
  check('summary has a pointer cursor', await page.evaluate(() => getComputedStyle(document.querySelector('#sizeCard > summary')).cursor === 'pointer'));
  // persistence
  await page.click('#aiHelper > summary'); await page.click('#saveCard > summary');
  await sleep(200);
  await page.reload(); await ready(page); await sleep(300);
  check('open state persists across reload', JSON.stringify(await fstate()) === JSON.stringify([true, false, false, true]), await fstate());
  await page.click('#aiHelper > summary'); await page.click('#saveCard > summary'); await sleep(100);
  await page.reload(); await ready(page); await sleep(300);
  check('closed state persists too', (await fstate()).every((o) => o === false), await fstate());

  // ---- header PDF button
  await page.evaluate(() => { window.__saved = null; saveFile = async (n, b) => { await new Promise((r) => setTimeout(r, 700)); window.__saved = { n, size: b.size }; }; });
  check('header button exists, ids unique', await page.evaluate(() => document.querySelectorAll('#exportPdf2').length === 1 && document.querySelectorAll('#exportPdf').length === 1 && !!document.querySelector('.hdr-actions #exportPdf2')));
  await page.click('#exportPdf2'); await sleep(150);
  check('both buttons disabled while exporting', await page.evaluate(() => document.getElementById('exportPdf').disabled && exportPdf2.disabled && /만드는/.test(exportPdf2.textContent)), await page.evaluate(() => [document.getElementById('exportPdf').disabled, exportPdf2.disabled, exportPdf2.textContent]));
  await page.waitForFunction(() => window.__saved, null, { timeout: 60000 });
  await sleep(200);
  check('header button made a PDF', await page.evaluate(() => /\.pdf$/.test(__saved.n) && __saved.size > 20000), await page.evaluate(() => __saved));
  check('both buttons enabled again', await page.evaluate(() => !document.getElementById('exportPdf').disabled && !exportPdf2.disabled && exportPdf2.textContent === '도안 PDF 저장'));
  await page.evaluate(() => { window.__saved = null; }); await page.click('#exportPdf'); await page.waitForFunction(() => window.__saved, null, { timeout: 60000 });
  check('card button still makes a PDF', await page.evaluate(() => __saved.size > 20000));
  await sleep(200);

  // ---- summary hints
  const sfx = (id) => page.evaluate((i) => document.querySelector('#' + i + ' .sfx').textContent, id);
  const s1 = await page.evaluate(async (b) => { const c = await eval('(' + b + ')')(); if (!c) return null; hideAsk(); setupImage(c, [['뒤판', 0], ['중간', 8], ['앞', 16]]); return DX.lv; }, SAMPLE1);
  if (s1 == null) console.log('sample1 없음: 난이도 줄 건너뜀');
  else { await sleep(300); const t = await sfx('aiHelper'); check('summary shows the difficulty (sample1)', /^ · /.test(t) && t.includes(await page.textContent('#dxBadge')), t); }
  check('guide summary empty when none', (await sfx('guideCard')) === '');
  await page.evaluate(() => { const c = mk(S.W, S.H); c.getContext('2d').drawImage(S.src, 0, 0); return new Promise((res) => c.toBlob((b) => { const f = new File([b], 'g.png', { type: 'image/png' }); const dt = new DataTransfer(); dt.items.add(f); guideFile.files = dt.files; guideFile.dispatchEvent(new Event('change')); res(); })); });
  await page.waitForFunction(() => !!S.guideRaw, null, { timeout: 30000 }); await sleep(300);
  check('guide summary shows 넣음', (await sfx('guideCard')) === ' · 넣음', await sfx('guideCard'));
  await page.click('#guideCard > summary'); await page.click('#guideDel'); await sleep(200);
  check('guide summary clears after 빼기', (await sfx('guideCard')) === '');
  await page.click('#guideCard > summary');

  // ---- pointer mapping after scrolling the rail
  await page.evaluate(() => { S.active = 1; renderLayers(); render(); });
  await page.click('[data-tool="paint"]');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await sleep(300);
  const vb = await box('#viewBox');
  const cx = vb.x + vb.w * 0.3, cy = vb.y + vb.h * 0.6;
  const exp = await page.evaluate(([x, y]) => { const r = viewBox.getBoundingClientRect(); return { x: (x - r.left) * S.W / r.width, y: (y - r.top) * S.H / r.height }; }, [cx, cy]);
  await page.evaluate(() => { const L = S.layers[1], g = L.mask.getContext('2d'); g.clearRect(0, 0, S.W, S.H); });
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 1, cy + 1); await page.mouse.up(); await sleep(200);
  const bb = await page.evaluate(() => { const d = S.layers[1].mask.getContext('2d').getImageData(0, 0, S.W, S.H).data; let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1; for (let y = 0; y < S.H; y++) for (let x = 0; x < S.W; x++) if (d[(y * S.W + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return x1 < 0 ? null : { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }; });
  // the stroke is 1 screen px long, so its bbox centre may sit up to ~1 screen px (scaled to image px) off the start point
  const sc = (await page.evaluate(() => S.W)) / vb.w;
  check('paint after scroll lands on the right pixel (+-2px)', bb && Math.abs(bb.x - exp.x) <= 2 + sc && Math.abs(bb.y - exp.y) <= 2 + sc, { bb, exp, sc });
  // wheel zoom after scroll
  const sy2 = await page.evaluate(() => scrollY);
  const before = await page.evaluate(([x, y]) => pt({ clientX: x, clientY: y }), [cx, cy]);
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, -100); await sleep(30); }
  const after = await page.evaluate(([x, y]) => ({ p: pt({ clientX: x, clientY: y }), z: Z.z, sy: scrollY }), [cx, cy]);
  const k = vb.w / (await page.evaluate(() => S.W));
  check('wheel zoom after scroll: zoomed, page did not scroll', after.z > 1.5 && after.sy === sy2, after);
  check('wheel zoom keeps the pixel under cursor (+-2px)', Math.abs(after.p.x - before.x) * k * after.z <= 2 && Math.abs(after.p.y - before.y) * k * after.z <= 2, { before, after });
  const bc = await page.evaluate(() => { const r = view.getBoundingClientRect(), b = viewBox.getBoundingClientRect(); return { ok: Math.abs(r.width - b.width * Z.z) < 1.5 || r.width > b.width, rw: r.width, bw: b.width, z: Z.z }; });
  check('zoomed canvas is larger than its clipping box', bc.ok, bc);
  await page.evaluate(() => zReset());
  // brush cursor size follows the displayed canvas
  await page.mouse.move(cx, cy); await sleep(100);
  check('brush cursor diameter = brush x shown width / 1000', await page.evaluate(() => { const r = view.getBoundingClientRect(), d = parseFloat(brushCur.style.width); return brushCur.style.display !== 'none' && Math.abs(d - Math.max(3, S.brush * r.width / 1000)) < 1.5; }), await page.evaluate(() => [brushCur.style.display, brushCur.style.width]));
  check('no page errors (desktop)', errors.length === 0, errors);

  // ---- phone
  const ph = await (await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true })).newPage();
  ph.on('pageerror', (e) => errors.push('phone pageerror: ' + e.message));
  await ph.goto(url); await ready(ph); await sleep(500);
  check('phone: no horizontal scroll', await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth), await ph.evaluate(() => [document.documentElement.scrollWidth, innerWidth]));
  check('phone: cards collapsed, bench not sticky', await ph.evaluate((ids) => ids.every((i) => !document.getElementById(i).open) && getComputedStyle(document.querySelector('.bench')).position !== 'sticky', FOLDS));
  check('phone: canvas not width-capped', await ph.evaluate(() => !viewBox.classList.contains('fit') && !viewBox.style.width));
  check('phone: header PDF button visible, within the screen', await ph.evaluate(() => { const r = exportPdf2.getBoundingClientRect(); return r.width > 0 && r.right <= innerWidth && r.left >= 0; }));
  await ph.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await sleep(300);
  const lastGap = await ph.evaluate(() => { const c = [...document.querySelectorAll('.rail > .card')].pop().getBoundingClientRect(), b = mbar.getBoundingClientRect(); return [c.bottom, b.top]; });
  check('phone: last card sits above the bottom bar', lastGap[0] <= lastGap[1] + 0.5, lastGap);
  await ph.evaluate(() => { document.getElementById('sizeCard').open = true; }); await sleep(200);
  check('phone: no horizontal scroll with a card open', await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await ph.evaluate(() => { document.getElementById('sizeCard').open = false; window.scrollTo(0, 0); }); await sleep(200);
  await ph.screenshot({ path: path.join(OUT, 'layout-phone.png') });
  console.log('phone page height', await ph.evaluate(() => document.documentElement.scrollHeight));
  check('no page errors (phone)', errors.length === 0, errors);
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, failures: failed, errors }, null, 1));
  process.exit(failed.length || errors.length ? 1 : 0);
})();
