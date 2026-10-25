// 보기 모드(기본/흰 바탕/검은 바탕), 범례, 확대 컨트롤 위치 테스트: node view.test.js [url]
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const url = process.argv[2] || 'http://127.0.0.1:8765/prototype/paper-theater-studio.html';
const OUT = process.env.OUT_DIR || path.resolve(__dirname, '..');
const results = [], errors = [];
const check = (name, ok, info) => { results.push({ name, ok: !!ok, info }); };
const ready = (p) => p.waitForFunction(() => { try { return !!S.cv && S.layers.length > 0 && typeof PT === 'object'; } catch (e) { return false; } }, null, { timeout: 90000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const setCut = (p, v) => p.evaluate((v) => { $('showCut').checked = v; $('showCut').dispatchEvent(new Event('change', { bubbles: true })); }, v);
const maskN = (p) => p.evaluate(() => { const d = S.layers[1].mask.getContext('2d').getImageData(0, 0, S.W, S.H).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 127) n++; return n; });

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptview-'));
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, viewport: { width: 1360, height: 900 } });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(url); await ready(page); await sleep(600);
  // layer 2 (index 1): one rectangle so inside / outside are known
  const R = await page.evaluate(() => {
    S.active = 1; const g = S.layers[1].mask.getContext('2d'); g.clearRect(0, 0, S.W, S.H); g.fillStyle = '#fff';
    const r = { x: Math.round(S.W * .3), y: Math.round(S.H * .3), w: Math.round(S.W * .3), h: Math.round(S.H * .3) }; g.fillRect(r.x, r.y, r.w, r.h);
    renderLayers(); render(); return r; });
  await setCut(page, false);
  const px = (x, y) => page.evaluate(([x, y]) => Array.from(vctx.getImageData(x, y, 1, 1).data), [Math.round(x), Math.round(y)]);
  const srcPx = (x, y) => page.evaluate(([x, y]) => Array.from(S.src.getContext('2d').getImageData(x, y, 1, 1).data), [Math.round(x), Math.round(y)]);
  const sig = () => page.evaluate(() => { const d = vctx.getImageData(0, 0, S.W, S.H).data; let h = 0; for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) | 0; return h; });

  // 1. zoom control placement
  const geo = await page.evaluate(() => { const z = zctl.getBoundingClientRect(), c = view.getBoundingClientRect(); return { inBox: viewBox.contains(zctl), inTabs: !!zctl.closest('.tabs'), sep: z.bottom <= c.top || z.top >= c.bottom || z.right <= c.left || z.left >= c.right, hidden: zctl.hidden, label: !!document.querySelector('.tabs #sizeLabel') }; });
  check('#zctl is in the tabs row, not inside #viewBox', !geo.inBox && geo.inTabs && !geo.hidden && geo.label, geo);
  check('#zctl does not overlap the canvas', geo.sep, geo);
  await page.click('#zIn'); const z1 = await page.evaluate(() => Z.z);
  await page.click('#zPct'); const z2 = await page.evaluate(() => Z.z);
  check('+ zooms, % resets', z1 > 1 && z2 === 1, [z1, z2]);

  // 2. legend
  check('legend visible on layer 2, AI item hidden', await page.evaluate(() => !legend.hidden && lgAi.hidden));
  await setCut(page, true); await sleep(800);
  check('legend cut toggle mirrors checkbox', await page.evaluate(() => lgCut.getAttribute('aria-pressed') === 'true'));
  const sOn = await sig();
  await page.click('#lgCut'); await sleep(500);
  const sOff = await sig();
  check('legend 자를 선 flips showCut and canvas changes', await page.evaluate(() => !$('showCut').checked && lgCut.getAttribute('aria-pressed') === 'false') && sOn !== sOff);
  await page.click('#lgCut'); await sleep(300);
  check('legend 자를 선 toggles back', await page.evaluate(() => $('showCut').checked));
  await page.evaluate(() => { const g = S.layers[3].mask.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(10, 10, S.W * .2, S.H * .2); render(); });
  const o1 = await sig();
  await page.click('#lgOth'); await sleep(200);
  const o2 = await sig();
  check('legend 다른 레이어 flips showOthers and canvas changes', await page.evaluate(() => !$('showOthers').checked && lgOth.getAttribute('aria-pressed') === 'false') && o1 !== o2);
  await page.check('#showOthers');
  check('checkbox change syncs legend', await page.evaluate(() => lgOth.getAttribute('aria-pressed') === 'true' && $('showOthers').checked));
  await page.evaluate(() => { S.tool = 'ai'; refreshButtons(); });
  check('AI legend item shown with AI tool', await page.evaluate(() => !lgAi.hidden));
  await page.evaluate(() => { S.tool = 'rect'; refreshButtons(); });
  check('AI legend item hidden again', await page.evaluate(() => lgAi.hidden));

  // 3. view modes
  await setCut(page, false); await sleep(200);
  await page.screenshot({ path: path.join(OUT, 'view-default.png') });
  for (const [mode, btn, bg] of [[1, '흰 바탕', 255], [2, '검은 바탕', 0]]) {
    await page.click(`#vmSeg [data-vm="${mode}"]`); await sleep(300);
    check(`${btn}: mode stored + button pressed`, await page.evaluate((m) => +$('viewMode').value === m && document.querySelector(`#vmSeg [data-vm="${m}"]`).getAttribute('aria-pressed') === 'true', mode));
    const outs = [[5, 5], [R.x - 20, R.y + 20], [R.x + R.w + 20, R.y + R.h / 2], [R.x + R.w / 2, R.y + R.h + 25], [R.x + R.w / 2, 5]];
    let allBg = true; for (const [x, y] of outs) { const p = await px(x, y); if (!(p[0] === bg && p[1] === bg && p[2] === bg && p[3] === 255)) allBg = false; }
    check(`${btn}: outside the mask is pure ${bg ? 'white' : 'black'}`, allBg);
    const ins = [[R.x + 8, R.y + 8], [R.x + R.w / 2, R.y + R.h / 2], [R.x + R.w - 9, R.y + R.h - 9], [R.x + R.w * .3, R.y + R.h * .7]];
    let same = true; for (const [x, y] of ins) { const a = await px(x, y), b = await srcPx(x, y); if (a.some((v, i) => Math.abs(v - b[i]) > 1)) same = false; }
    check(`${btn}: inside the mask equals the source image`, same);
    await page.screenshot({ path: path.join(OUT, mode === 1 ? 'view-white.png' : 'view-black.png') });
  }
  // red cut line shown (and only it) when showCut is on
  await page.click('#vmSeg [data-vm="1"]'); await setCut(page, true); await sleep(900);
  check('white mode + showCut: red cut line present, no yellow outline', await page.evaluate(() => {
    const d = vctx.getImageData(0, 0, S.W, S.H).data; let red = 0, yellow = 0;
    for (let i = 0; i < d.length; i += 4) { const r = d[i], g = d[i + 1], b = d[i + 2]; if (r > 220 && g < 110 && b > 70 && b < 160) red++; if (r > 240 && g > 200 && g < 240 && b < 120) yellow++; }
    return red > 100 && yellow === 0; }));
  await setCut(page, false); await sleep(200);
  // painting still edits the mask in 흰 바탕 and the view follows
  const before = await maskN(page);
  await page.evaluate(() => { S.tool = 'paint'; refreshButtons(); });
  const vb = await page.evaluate(() => { const r = view.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, W: S.W, H: S.H }; });
  const cx = vb.x + vb.w * .8, cy = vb.y + vb.h * .75;
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 40, cy + 10, { steps: 5 }); await page.mouse.up(); await sleep(300);
  const after = await maskN(page);
  const vx = (cx - vb.x) * vb.W / vb.w, vy = (cy - vb.y) * vb.H / vb.h;
  const pp = await px(vx, vy), sp = await srcPx(vx, vy);
  check('white mode: painting edits the mask and the view shows the new pixels', after > before && pp.every((v, i) => Math.abs(v - sp[i]) <= 1), { before, after, pp, sp });
  await page.evaluate(() => document.activeElement && document.activeElement.blur()); await page.keyboard.press('Control+z'); await sleep(200);
  check('undo works in white mode', await maskN(page) === before);
  // layer 1 shows the full image
  await page.evaluate(() => { S.tool = 'rect'; S.active = 0; renderLayers(); refreshButtons(); render(); });
  check('layer 1 in white mode: full image, legend hidden', await page.evaluate(() => { const a = vctx.getImageData(3, 3, 1, 1).data, b = S.src.getContext('2d').getImageData(3, 3, 1, 1).data; return legend.hidden && a[0] === b[0] && a[1] === b[1] && a[2] === b[2]; }));
  await page.evaluate(() => { S.active = 1; renderLayers(); refreshButtons(); render(); });
  // overview overrides
  await page.click('#tabOv'); await sleep(200);
  check('overview overrides the view mode', await page.evaluate(() => LP.on && legend.hidden && vctx.getImageData(5, 5, 1, 1).data[0] !== 255));
  await page.click('#tabOv'); await sleep(200);
  check('leaving overview returns to white mode', await page.evaluate(() => !LP.on && +$('viewMode').value === 1 && vctx.getImageData(5, 5, 1, 1).data[0] === 255));
  await page.click('#tab3d'); await sleep(300);
  check('3D tab hides view mode + zoom controls', await page.evaluate(() => getComputedStyle(vmSeg).display === 'none' && getComputedStyle(zctl).display === 'none'));
  await page.click('#tabEdit'); await sleep(200);

  // 4. autosave restores the mode
  await page.click('#vmSeg [data-vm="2"]'); await sleep(3500);
  const saved = await page.evaluate(() => PT.saves);
  await page.reload(); await ready(page); await sleep(500);
  const ask = await page.evaluate(() => $('ask').hidden ? null : $('askMsg').textContent);
  if (ask) { await page.evaluate(() => [...$('askBtns').querySelectorAll('button')][0].click()); await sleep(2500); }
  check('autosave restores view mode', await page.evaluate(() => +$('viewMode').value === 2 && document.querySelector('#vmSeg [data-vm="2"]').getAttribute('aria-pressed') === 'true'), { saved, ask });
  await page.click('#vmSeg [data-vm="0"]'); await sleep(2500);

  // 5. phone bar cycles the mode
  const ph = await ctx.newPage();
  ph.on('pageerror', (e) => errors.push('phone pageerror: ' + e.message));
  await ph.setViewportSize({ width: 390, height: 780 });
  await ph.goto(url); await ready(ph); await sleep(500);
  if (await ph.evaluate(() => !$('ask').hidden)) { await ph.evaluate(() => [...$('askBtns').querySelectorAll('button')][1].click()); await sleep(300); }
  await ph.evaluate(() => { S.active = 1; renderLayers(); refreshButtons(); render(); vmSet(0); });
  const seq = []; for (let i = 0; i < 4; i++) { await ph.click('#mVm'); seq.push(await ph.evaluate(() => [+$('viewMode').value, mVm.textContent])); }
  check('phone bar cycles 기본>흰>검정>기본', JSON.stringify(seq.map((s) => s[0])) === '[1,2,0,1]' && seq[0][1] === '흰색' && seq[1][1] === '검정', seq);
  check('phone: tabs-row controls hidden, no horizontal scroll', await ph.evaluate(() => getComputedStyle(vmSeg).display === 'none' && getComputedStyle(zctl).display === 'none' && document.documentElement.scrollWidth <= innerWidth + 1));
  await ph.screenshot({ path: path.join(OUT, 'view-phone.png') });
  check('no page errors', errors.length === 0, errors);
  await ctx.close();
  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, failures: failed, errors }, null, 1));
  process.exit(failed.length || errors.length ? 1 : 0);
})();
