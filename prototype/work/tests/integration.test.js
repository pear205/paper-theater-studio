// cross-feature checks for the merged file (F2 phone + F3 save + F4 depth). usage: node integration.test.js [url]
const { chromium } = require(process.env.PLAYWRIGHT_PATH||'playwright');
const url = process.argv[2] || 'http://127.0.0.1:8765/prototype/work/merged.html';
const res = {}, errors = [];let fail = 0;
const check = (k, v, info) => { res[k] = v ? 'PASS' : { FAIL: info === undefined ? v : info }; if (!v) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => { try { return !!S.cv && PT.armed; } catch (e) { return false; } }, null, { timeout: 90000 });

  // phone: F3 card buttons and F4 button can be scrolled above the bottom bar
  for (const id of ['ptSave', 'ptLoad', 'depthSplit', 'addLayer']) {
    const r = await page.evaluate((id) => { const e = document.getElementById(id); e.scrollIntoView({ block: 'end' }); window.scrollBy(0, 0);
      const bar = document.getElementById('mbar').getBoundingClientRect(), b = e.getBoundingClientRect();
      // scroll so the element sits just above the bar, then confirm nothing covers it
      window.scrollBy(0, b.bottom - bar.top + 8); const c = e.getBoundingClientRect();
      const hit = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
      return { above: c.bottom <= bar.top + 0.5, hit: hit === e || e.contains(hit), y: Math.round(c.bottom), bar: Math.round(bar.top) }; }, id);
    check('phone: #' + id + ' not hidden by bar', r.above && r.hit, r);
  }
  check('phone: page bottom padding >= bar height', await page.evaluate(() => parseFloat(getComputedStyle(document.body).paddingBottom) >= document.getElementById('mbar').offsetHeight));

  // F2 two-finger cancel of a brush stroke with F3's pushUndo wrapper
  await page.evaluate(() => { window.scrollTo(0, 0); S.active = 1; renderLayers(); document.querySelector('#tools [data-tool="paint"]').click(); });
  await sleep(100);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) });
  const vr = await page.evaluate(() => { const r = view.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const alpha = () => page.evaluate(() => { const d = S.layers[1].mask.getContext('2d').getImageData(0, 0, S.W, S.H).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 127) n++; return n; });
  const a0 = await alpha(), u0 = await page.evaluate(() => S.undo.length);
  const cx = vr.x + vr.w * 0.5, cy = vr.y + vr.h * 0.5;
  await touch('touchStart', [[cx, cy]]); await touch('touchMove', [[cx + 20, cy + 5]]); await touch('touchMove', [[cx + 40, cy + 10]]);
  await sleep(50);
  const mid = await page.evaluate(() => ({ dirty: S.layers[1].__d === true, undo: S.undo.length, drag: !!drag }));
  await touch('touchStart', [[cx + 40, cy + 10], [cx + 120, cy + 60]]); await touch('touchMove', [[cx + 30, cy], [cx + 140, cy + 80]]); await touch('touchEnd', []);
  await sleep(100);
  const a1 = await alpha(), after = await page.evaluate(() => ({ undo: S.undo.length, drag: !!drag, z: Z.z }));
  check('F2+F3: stroke started (dirty via wrapper)', mid.dirty && mid.undo === u0 + 1, mid);
  check('F2+F3: two-finger cancel restores mask and undo stack', a1 === a0 && after.undo === u0 && !after.drag, { a0, a1, u0, after });
  // the autosave that follows saves the restored mask, not the cancelled stroke
  await page.waitForFunction((n) => PT.saves > n && !PT.saving, await page.evaluate(() => PT.saves), { timeout: 15000 }).catch(() => {});
  const stored = await page.evaluate(async () => { const r = await ptIdb('readonly', (s) => s.get('project')); const im = await ptImg(r.layers[1].mask); const c = mk(S.W, S.H), g = c.getContext('2d'); g.drawImage(im, 0, 0); const d = g.getImageData(0, 0, S.W, S.H).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 127) n++; return { n, dirty: S.layers[1].__d }; });
  check('F2+F3: autosave after cancel holds restored mask', stored.n === a0 && stored.dirty === false, { stored, a0 });

  // F4-style grouped pushUndo marks every touched layer dirty; grouped undo marks all dirty
  const grp = await page.evaluate(() => { S.layers.forEach((L) => { L.__d = false; }); const g = newGrp(); for (let i = 1; i < S.layers.length; i++) pushUndo(i, g);
    const d1 = S.layers.slice(1).every((L) => L.__d); S.layers.forEach((L) => { L.__d = false; }); $('undo').click(); return { d1, d2: S.layers.every((L) => L.__d) }; });
  check('F4+F3: grouped pushUndo marks all layers dirty', grp.d1, grp);
  check('F4+F3: grouped undo marks all layers dirty', grp.d2, grp);

  // F3 restore -> setupImage -> F2 zoom reset + F4 depth cache dropped
  const rs = await page.evaluate(async () => {
    Z.z = 3; zApply(); DEPTH.src = S.src; DEPTH.d = new Float32Array(4);
    const rec = await ptCollect(true); await ptRestore(JSON.parse(JSON.stringify(rec)));
    return { z: Z.z, tf: view.style.transform, dsrc: DEPTH.src, dd: DEPTH.d, layers: S.layers.length, armed: PT.armed, busy: PT.busy };
  });
  check('F3+F2: restore resets zoom', rs.z === 1 && rs.tf === '', rs);
  check('F3+F4: restore drops depth cache', rs.dsrc === null && rs.dd === null, rs);
  check('F3: restore keeps autosave usable', rs.armed && !rs.busy, rs);
  check('phone: bar synced after restore', await page.evaluate(() => document.getElementById('mName').textContent.startsWith((S.active + 1) + '번')));
  check('no duplicate ids', await page.evaluate(() => { const s = new Set(), d = []; document.querySelectorAll('[id]').forEach((e) => { if (s.has(e.id)) d.push(e.id); s.add(e.id); }); return d.length === 0; }));
  check('page errors', errors.length === 0, errors);
  await browser.close();
  console.log(JSON.stringify(res, null, 1));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
