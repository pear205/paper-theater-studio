// 경계 찾기용 그림 테스트 (sample1 필요): node guide.test.js [url]   OUT_DIR=이미지 저장 폴더
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const url = process.argv[2] || 'http://127.0.0.1:8765/prototype/paper-theater-studio.html';
const OUT = process.env.OUT_DIR || path.resolve(__dirname, '..');
const res = {}, errors = []; let fail = 0;
const check = (k, v, info) => { res[k] = v ? 'PASS' : { FAIL: info === undefined ? v : info }; if (!v) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptguide-'));
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, viewport: { width: 1360, height: 900 }, acceptDownloads: true });
  const open = async () => {
    const page = ctx.pages()[0] || await ctx.newPage();
    page.removeAllListeners('pageerror'); page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(url);
    await page.waitForFunction(() => { try { return !!S.cv && !!S.W && typeof PT === 'object'; } catch (e) { return false; } }, null, { timeout: 90000 });
    await sleep(600);
    await page.evaluate(() => document.querySelectorAll('details.fold').forEach((d) => { d.open = true; })); // the folding cards start collapsed; tests of their contents open them first
    return page;
  };
  const loadSample = (page) => page.evaluate(async () => {
    const r = await fetch('/samples/sample1.webp'); if (!r.ok) return false;
    const img = new Image(); img.src = URL.createObjectURL(await r.blob()); await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0);
    hideAsk(); setupImage(c, [['뒤판(배경)', 0], ['먼 풍경', 5], ['중간', 10], ['앞 대상', 16], ['맨 앞 틀', 22]]); return true;
  });
  const settled = (page) => page.waitForFunction(() => !!S.guide && !/맞추는 중/.test(document.getElementById('guideState').textContent), null, { timeout: 30000 });
  // PNG buffer: sample1 drawn shifted by (dx,dy) and scaled by sc about the top-left corner
  const makeShifted = async (page, dx, dy, sc) => Buffer.from(await page.evaluate(([dx, dy, sc]) => {
    const c = document.createElement('canvas'); c.width = S.W; c.height = S.H; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.setTransform(sc, 0, 0, sc, dx, dy); g.drawImage(S.src, 0, 0); return c.toDataURL('image/png').split(',')[1];
  }, [dx, dy, sc]), 'base64');
  const upload = async (page, buffer, name = 'guide.png', mimeType = 'image/png') => { await page.setInputFiles('#guideFile', { name, mimeType, buffer }); };
  const px = (page, expr) => page.evaluate((e) => { const c = eval(e); return Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data); }, expr);
  const sameArr = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
  const state = (page) => page.evaluate(() => ({ has: !!S.guide, raw: !!S.guideRaw, T: S.guideT && { ...S.guideT }, how: S.guideHow, inl: S.guideInl, st: document.getElementById('guideState').textContent, show: document.getElementById('guideShow').checked }));

  let page = await open();
  if (!await loadSample(page)) { console.log('sample1 없음: 건너뜀'); await ctx.close(); return; }
  await page.waitForFunction(() => !!S.kit && !KIT.job, null, { timeout: 30000 });

  // 0) card position and initial state
  const init = await page.evaluate(() => { const c = document.getElementById('guideCard'), p = c.previousElementSibling; return { after: p && p.querySelector('h2').textContent, h: c.querySelector('h2').textContent, ctrlOff: [...document.querySelectorAll('#guideCard [data-gd],#guideDel,#guideAuto,#guideShow')].every((e) => e.disabled), seg: segSrc() === S.kit, g: S.guide }; });
  check('card: right after the 키트 스타일 card, titled 경계 찾기용 그림', init.after === '키트 스타일' && init.h === '경계 찾기용 그림', init);
  check('card: controls disabled without a guide; segSrc() is the kit image', init.ctrlOff && init.seg && !init.g, init);

  // 1) upload a shifted+scaled copy -> auto align
  const t0 = Date.now();
  await upload(page, await makeShifted(page, 12, 8, 0.98)); await settled(page);
  const ms = Date.now() - t0, st = await state(page);
  const err = await page.evaluate(() => { const M = gdMatrix(), pts = [[100, 100], [900, 100], [500, 330], [100, 600], [900, 600]], out = [];
    for (const [rx, ry] of pts) { const ex = (rx - 12) / 0.98, ey = (ry - 8) / 0.98, w = M[6] * rx + M[7] * ry + M[8], fx = (M[0] * rx + M[1] * ry + M[2]) / w, fy = (M[3] * rx + M[4] * ry + M[5]) / w; out.push(Math.hypot(fx - ex, fy - ey)); }
    return out; });
  check('align: ORB homography used (not just the aspect fit)', st.how === 'orb', st);
  check('align: recovers the +12,+8 / 98% transform within 2 px at 5 points', err.every((e) => e < 2), err);
  check('align: status "위치를 맞췄어요 (특징점 N개)"', /^위치를 맞췄어요 \(특징점 \d+개\)$/.test(st.st) && st.inl >= 25, st);
  check('align: done in < 5 s', ms < 5000, ms);
  const g1 = await page.evaluate(() => { const a = S.guide.getContext('2d').getImageData(100, 50, 800, 550).data, b = S.src.getContext('2d').getImageData(100, 50, 800, 550).data; let d = 0; for (let i = 0; i < a.length; i += 4) d += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); return { w: S.guide.width, h: S.guide.height, W: S.W, H: S.H, diff: d / (a.length / 4) / 3 }; });
  check('guide: S.guide is exactly W x H and matches the original (mean diff < 6)', g1.w === g1.W && g1.h === g1.H && g1.diff < 6, g1);
  check('guide: overlay switched on after loading, controls enabled', st.show && await page.evaluate(() => [...document.querySelectorAll('#guideCard [data-gd],#guideDel,#guideAuto,#guideShow')].every((e) => !e.disabled)));
  // overlay drawn in the editor (and off when unchecked)
  const ov = await page.evaluate(() => { const grab = () => view.getContext('2d').getImageData(0, 0, S.W, S.H).data.join(','), cb = document.getElementById('guideShow');
    S.active = 0; renderLayers(); cb.checked = false; render(); const off = grab(); cb.checked = true; render(); const on = grab();
    const sl = document.getElementById('guideAlpha'); sl.value = 90; sl.dispatchEvent(new Event('input', { bubbles: true })); const on90 = grab(); sl.value = 50; sl.dispatchEvent(new Event('input', { bubbles: true }));
    return { onDiffers: on !== off, alphaDiffers: on90 !== on }; });
  // (the overlay of an aligned guide on the original is nearly invisible, so compare against a deliberately shifted one below)
  check('overlay: toggle and opacity slider re-render the editor', ov.onDiffers || ov.alphaDiffers, ov);

  // 2) manual adjustment buttons
  const m0 = await page.evaluate(() => ({ M: gdMatrix(), g: S.guide.getContext('2d').getImageData(0, 0, S.W, S.H).data.slice(0, 4000 * 4).join(',') }));
  await page.click('#guideCard [data-gd="tx"][data-d="10"]');
  const m1 = await page.evaluate(() => ({ M: gdMatrix(), T: { ...S.guideT }, out: document.getElementById('guideTxOut').textContent, g: S.guide.getContext('2d').getImageData(0, 0, S.W, S.H).data.slice(0, 4000 * 4).join(',') }));
  check('adjust: +10 X moves the guide 10 px right (matrix, label, pixels)', Math.abs(m1.M[2] - m0.M[2] - 10) < 1e-6 && m1.T.tx === 10 && m1.out === '10' && m1.g !== m0.g, { m0: m0.M, m1: m1.M, T: m1.T });
  await page.click('#guideCard [data-gd="ty"][data-d="-1"]'); await page.click('#guideCard [data-gd="ty"][data-d="-10"]'); await page.click('#guideCard [data-gd="tx"][data-d="-1"]');
  const m2 = await page.evaluate(() => ({ T: { ...S.guideT }, out: [document.getElementById('guideTxOut').textContent, document.getElementById('guideTyOut').textContent] }));
  check('adjust: ±1 / ±10 buttons add up (tx 9, ty -11)', m2.T.tx === 9 && m2.T.ty === -11 && m2.out.join() === '9,-11', m2);
  await page.click('#guideCard [data-gd="s"][data-d="5"]'); await page.click('#guideCard [data-gd="s"][data-d="-1"]');
  const m3 = await page.evaluate(() => ({ s: S.guideT.s, out: document.getElementById('guideSOut').textContent, M: gdMatrix(), w: S.guide.width }));
  check('adjust: scale buttons change % (104) and the matrix scale', m3.out === '104' && Math.abs(m3.s - 1.04) < 1e-9 && Math.abs(m3.M[0] / m0.M[0] - 1.04) < 1e-4 && m3.w === 1000, m3);
  // the shifted guide is visibly different from the original in the overlay
  const ov2 = await page.evaluate(() => { const grab = () => view.getContext('2d').getImageData(0, 0, S.W, S.H).data.join(','), cb = document.getElementById('guideShow'); S.active = 0; cb.checked = false; render(); const off = grab(); cb.checked = true; render(); return grab() !== off; });
  check('overlay: a misaligned guide shows over the original', ov2);
  await page.click('#guideAuto');
  await page.waitForFunction(() => /위치를 맞췄어요/.test(document.getElementById('guideState').textContent) && !!S.guide, null, { timeout: 20000 });
  const st2 = await state(page);
  check('자동 맞추기: resets the hand adjustment and re-aligns', st2.T.tx === 0 && st2.T.ty === 0 && st2.T.s === 1 && st2.how === 'orb', st2);

  // 3) GrabCut reads the guide (deer), print stays the original
  const gc = await page.evaluate(async () => {
    const seen = new Set(), orig = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function (...a) { seen.add(this.canvas); return orig.apply(this, a); };
    S.active = 3; renderLayers(); const L = cur(); L.mask.getContext('2d').clearRect(0, 0, S.W, S.H);
    L.rect = { x: 615, y: 285, w: 310, h: 387 };
    const pick = segSrc() === S.guide;
    await runGrabCut(newGrp());
    CanvasRenderingContext2D.prototype.getImageData = orig;
    const d = L.mask.getContext('2d').getImageData(0, 0, S.W, S.H).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 127) n++;
    return { pick, usedGuide: seen.has(S.guide), usedSrc: seen.has(S.src), usedKit: seen.has(S.kit), n };
  });
  check('priority: segSrc() === S.guide while a guide exists', gc.pick, gc);
  check('grabcut: reads S.guide pixels, not S.src / S.kit', gc.usedGuide && !gc.usedSrc && !gc.usedKit, gc);
  check('grabcut: finds a deer-sized shape on the guide', gc.n > 8000, gc);
  const pr = await page.evaluate(async () => {
    const eq = (a, b) => { const x = a.getContext('2d').getImageData(0, 0, a.width, a.height).data, y = b.getContext('2d').getImageData(0, 0, b.width, b.height).data; for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false; return true; };
    document.getElementById('fillHidden').checked = false; const sel = document.getElementById('kitPrint'), r = {}; document.getElementById('guideShow').checked = false; S.active = 0; renderLayers();
    sel.value = '0'; sel.dispatchEvent(new Event('change', { bubbles: true })); r.src = printSrc() === S.src; r.view = eq(view, S.src);
    r.tex = eq((await buildTextures()).tex[0], S.src);
    sel.value = '1'; sel.dispatchEvent(new Event('change', { bubbles: true })); r.kit = printSrc() === S.kit; r.notGuide = printSrc() !== S.guide;
    sel.value = '0'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    r.ai = aiSrc() === S.src; const fs = depthRun.toString() + depthClick.toString(); r.depth = /S\.src/.test(fs) && !/guide|segSrc/.test(fs);
    document.getElementById('guideShow').checked = true; return r;
  });
  check('print: printSrc() is the original (or the kit when chosen), never the guide; editor + textures too', pr.src && pr.view && pr.tex && pr.kit && pr.notGuide, pr);
  check('ai + depth keep the original', pr.ai && pr.depth, pr);

  // 4) autosave: reload restores guide + transform + overlay settings
  await page.click('#guideCard [data-gd="tx"][data-d="10"]');
  await page.evaluate(() => { const sl = document.getElementById('guideAlpha'); sl.value = 70; sl.dispatchEvent(new Event('input', { bubbles: true })); });
  const n0 = await page.evaluate(() => PT.saves); await page.waitForFunction((k) => PT.saves > k, n0, { timeout: 15000 });
  await sleep(300); await page.waitForFunction(() => !PT.saving, null, { timeout: 15000 });
  const stored = await page.evaluate(async () => { const r = await ptIdb('readonly', (s) => s.get('project')); return r.guide && { blob: r.guide.raw instanceof Blob, H: r.guide.H.length, T: r.guide.T, alpha: r.guide.alpha, show: r.guide.show }; });
  check('autosave: stored record has the guide (PNG blob, 3x3 matrix, transform, overlay)', stored && stored.blob && stored.H === 9 && stored.T.tx === 10 && stored.alpha === 70 && stored.show === true, stored);
  const before = { g: await px(page, 'S.guide'), M: await page.evaluate(() => gdMatrix()), T: await page.evaluate(() => ({ ...S.guideT })) };
  page = await open();
  await page.click('#askBtns button:has-text("이어서 하기")'); await page.waitForFunction(() => PT.armed && !PT.busy && !!S.guide, null, { timeout: 20000 });
  const after = { g: await px(page, 'S.guide'), M: await page.evaluate(() => gdMatrix()), T: await page.evaluate(() => ({ ...S.guideT })), ui: await page.evaluate(() => ({ a: document.getElementById('guideAlpha').value, s: document.getElementById('guideShow').checked, seg: segSrc() === S.guide, off: [...document.querySelectorAll('#guideCard [data-gd]')].every((e) => !e.disabled), st: document.getElementById('guideState').textContent })) };
  check('restore (autosave): guide re-warped identically, transform + overlay settings back', sameArr(before.g, after.g) && JSON.stringify(before.T) === JSON.stringify(after.T) && before.M.every((v, i) => Math.abs(v - after.M[i]) < 1e-9) && after.ui.a === '70' && after.ui.s && after.ui.seg && after.ui.off, { T: after.T, ui: after.ui, same: sameArr(before.g, after.g) });

  // 5) file save -> remove -> load
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#ptSave')]);
  const fp = path.join(dir, 'out.ptheater.json'); await dl.saveAs(fp);
  const json = JSON.parse(fs.readFileSync(fp, 'utf8'));
  check('file: .ptheater.json holds the guide as a PNG dataURL with matrix + transform', json.guide && /^data:image\/png/.test(json.guide.raw) && json.guide.H.length === 9 && json.guide.T.tx === 10 && json.guide.alpha === 70, json.guide && { T: json.guide.T, alpha: json.guide.alpha });
  await page.click('#guideDel');
  const rm = await page.evaluate(() => ({ g: S.guide, raw: S.guideRaw, seg: segSrc() === S.kit, off: [...document.querySelectorAll('#guideCard [data-gd],#guideDel,#guideAuto,#guideShow')].every((e) => e.disabled), st: document.getElementById('guideState').hidden, show: document.getElementById('guideShow').checked }));
  check('remove: guide gone, segSrc() back to the kit, controls disabled, overlay off', !rm.g && !rm.raw && rm.seg && rm.off && rm.st && !rm.show, rm);
  const n1 = await page.evaluate(() => PT.saves); await page.waitForFunction((k) => PT.saves > k, n1, { timeout: 15000 });
  check('remove: autosave drops the guide', await page.evaluate(async () => (await ptIdb('readonly', (s) => s.get('project'))).guide === null));
  await page.setInputFiles('#ptFile', fp); await page.waitForFunction(() => !PT.busy && !!S.guide, null, { timeout: 20000 });
  const fl = { g: await px(page, 'S.guide'), T: await page.evaluate(() => ({ ...S.guideT })), a: await page.evaluate(() => document.getElementById('guideAlpha').value) };
  check('restore (file): guide + transform + opacity back, pixels identical to before', sameArr(before.g, fl.g) && JSON.stringify(fl.T) === JSON.stringify(before.T) && fl.a === '70', { T: fl.T, a: fl.a });

  // 6) a new picture clears the guide
  const tinyPng = Buffer.from(await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 300; c.height = 200; const g = c.getContext('2d'); g.fillStyle = '#7ab'; g.fillRect(0, 0, 300, 200); g.fillStyle = '#c63'; g.fillRect(60, 50, 120, 90); return c.toDataURL('image/png').split(',')[1]; }), 'base64');
  await page.setInputFiles('#file', { name: 'new.png', mimeType: 'image/png', buffer: tinyPng }); await page.waitForFunction(() => S.W === 300, null, { timeout: 10000 });
  const nw = await page.evaluate(() => ({ g: S.guide, raw: S.guideRaw, seg: segSrc() === (S.kit || S.src), off: document.getElementById('guideDel').disabled }));
  check('new picture: guide cleared', !nw.g && !nw.raw && nw.off, nw);
  await loadSample(page); await page.waitForFunction(() => !!S.kit && !KIT.job, null, { timeout: 30000 });

  // 7) unrelated content -> "못 맞췄어요", aspect fit kept
  const other = Buffer.from(await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 800; c.height = 530; const g = c.getContext('2d'); let s = 12345; const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    g.fillStyle = '#e8e0d0'; g.fillRect(0, 0, 800, 530); for (let i = 0; i < 40; i++) { g.fillStyle = `hsl(${rnd() * 360},60%,${30 + rnd() * 40}%)`; g.beginPath(); g.arc(rnd() * 800, rnd() * 530, 15 + rnd() * 60, 0, 7); g.fill(); }
    for (let i = 0; i < 25; i++) { g.strokeStyle = '#222'; g.lineWidth = 2 + rnd() * 4; g.beginPath(); g.moveTo(rnd() * 800, rnd() * 530); g.lineTo(rnd() * 800, rnd() * 530); g.stroke(); }
    return c.toDataURL('image/png').split(',')[1]; }), 'base64');
  await upload(page, other, 'other.png'); await settled(page);
  const bad = await state(page);
  const bm = await page.evaluate(() => gdMatrix());
  check('mismatch: status "자동으로 못 맞췄어요", aspect fit kept (scale to cover, centred)', /^자동으로 못 맞췄어요/.test(bad.st) && bad.how === 'fail' && bad.T.tx === 0 && Math.abs(bm[0] - Math.max(1000 / 800, 672 / 530)) < 1e-6 && Math.abs(bm[1]) < 1e-9 && bad.has, { bad, bm });
  check('mismatch: the guide is still used (user can fix by hand)', await page.evaluate(() => segSrc() === S.guide));

  // 8) bad / empty files: message, previous guide kept, no crash
  const keepG = await px(page, 'S.guide');
  await upload(page, Buffer.from('this is not a picture'), 'fake.png');
  await page.waitForFunction(() => /열 수 없어요/.test(document.getElementById('guideState').textContent), null, { timeout: 10000 });
  check('invalid file (text named .png): message, previous guide untouched', sameArr(keepG, await px(page, 'S.guide')) && (await state(page)).raw);
  await upload(page, Buffer.alloc(0), 'empty.png');
  await page.waitForFunction(() => /열 수 없어요/.test(document.getElementById('guideState').textContent), null, { timeout: 10000 });
  check('empty file: message, previous guide untouched', sameArr(keepG, await px(page, 'S.guide')));
  await page.click('#guideDel');
  await upload(page, Buffer.from('<html></html>'), 'x.html', 'text/html');
  await page.waitForFunction(() => /열 수 없어요/.test(document.getElementById('guideState').textContent), null, { timeout: 10000 });
  const none = await state(page);
  check('invalid file without a guide: message, no guide, controls off', !none.has && !none.raw && await page.evaluate(() => document.getElementById('guideDel').disabled), none);

  // 9) different aspect (portrait) + big file still fits to cover
  const port = Buffer.from(await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 300; c.height = 600; c.getContext('2d').fillRect(0, 0, 300, 600); return c.toDataURL('image/png').split(',')[1]; }), 'base64');
  await upload(page, port, 'port.png'); await settled(page);
  const pm = await page.evaluate(() => { const M = gdMatrix(); return { s: M[0], w: 300 * M[0], h: 600 * M[0], tx: M[2], ty: M[5], W: S.W, H: S.H }; });
  check('aspect fit: portrait upload covers the frame, centred', pm.w >= pm.W - 1e-6 && pm.h >= pm.H - 1e-6 && Math.abs(pm.tx + pm.w / 2 - pm.W / 2) < 1e-6, pm);

  // 10) phone width: card is in the rail, usable; nothing added to the bar
  await page.setViewportSize({ width: 390, height: 844 }); await sleep(400);
  await page.click('#guideDel');
  await upload(page, await makeShifted(page, 12, 8, 0.98)); await settled(page);
  const ph = await page.evaluate(() => { const c = document.getElementById('guideCard'); c.scrollIntoView(); const r = c.getBoundingClientRect(), bar = document.getElementById('mbar');
    return { w: Math.round(r.width), vis: r.width > 0 && getComputedStyle(c).display !== 'none', noHScroll: document.documentElement.scrollWidth <= innerWidth + 1, barHas: !!bar && /경계 찾기|guide/i.test(bar.innerHTML), ok: /위치를 맞췄어요/.test(document.getElementById('guideState').textContent) }; });
  check('phone: card visible and usable in the rail, nothing in the bar', ph.vis && ph.w <= 390 && ph.noHScroll && !ph.barHas && ph.ok, ph);
  await page.screenshot({ path: path.join(OUT, 'guide-phone.png') });
  await page.setViewportSize({ width: 1360, height: 900 }); await sleep(300);
  await page.evaluate(() => { document.getElementById('guideCard').scrollIntoView(); });
  await page.screenshot({ path: path.join(OUT, 'guide-desktop.png') });

  // 11) flat redraw stand-ins: ORB first, else edge-map search + ECC; an unrelated picture is rejected
  await page.click('#guideDel'); await page.waitForFunction(() => !!S.kit && !KIT.job, null, { timeout: 30000 });
  const standIn = (page, kind) => page.evaluate(async (kind) => {
    const wait = async (f) => { for (let i = 0; i < 200 && !f(); i++) await new Promise((r) => setTimeout(r, 100)); };
    const setStr = async (v) => { const e = document.getElementById('kitStr'); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 700)); await wait(() => !KIT.job && S.kit); };
    let base = S.src;
    if (kind === 'kit5') { await setStr(5); base = S.kit; } else if (kind === 'kit3') { await setStr(3); base = S.kit; }
    else if (kind === 'poster') { // heavy bilateral filtering + posterising
      const cv = S.cv, a = cv.matFromImageData(S.src.getContext('2d').getImageData(0, 0, S.W, S.H)), rgb = new cv.Mat(); cv.cvtColor(a, rgb, cv.COLOR_RGBA2RGB); let cur = rgb;
      for (let i = 0; i < 6; i++) { const o = new cv.Mat(); cv.bilateralFilter(cur, o, 9, 60, 9); if (cur !== rgb) cur.delete(); cur = o; }
      for (let i = 0; i < cur.data.length; i++) cur.data[i] = Math.round(cur.data[i] / 48) * 48;
      const rgba = new cv.Mat(); cv.cvtColor(cur, rgba, cv.COLOR_RGB2RGBA); base = document.createElement('canvas'); base.width = S.W; base.height = S.H;
      base.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.data), S.W, S.H), 0, 0); [a, rgb, cur, rgba].forEach((m) => m.delete());
    }
    const c = document.createElement('canvas'); c.width = base.width; c.height = base.height; c.getContext('2d').drawImage(base, 0, 0); return c.toDataURL('image/png').split(',')[1];
  }, kind);
  const drawn = (page, b64, dx, dy, sc) => page.evaluate(async ([b64, dx, dy, sc]) => {
    const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode();
    const c = document.createElement('canvas'); c.width = S.W; c.height = S.H; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.setTransform(sc, 0, 0, sc, dx, dy); g.drawImage(im, 0, 0);
    return c.toDataURL('image/png').split(',')[1];
  }, [b64, dx, dy, sc]);
  const cases = [['a: kit strength 5, +15,+10, 103%', 'kit5', 15, 10, 1.03, 'ecc'], ['b: kit strength 3, -20,+6, 97%', 'kit3', -20, 6, 0.97, 'ecc'], ['c: bilateral + posterised, +8,-12, 100%', 'poster', 8, -12, 1, null], ['d: original shifted, +12,+8, 98%', 'src', 12, 8, 0.98, 'orb']];
  const times = {};
  for (const [name, kind, dx, dy, sc, how] of cases) {
    const buf = Buffer.from(await drawn(page, await standIn(page, kind), dx, dy, sc), 'base64');
    await page.evaluate(() => gdClear()); const t1 = Date.now(); await upload(page, buf, 'guide.png'); await settled(page); const ms = Date.now() - t1;
    const st = await state(page);
    const errs = await page.evaluate(([dx, dy, sc]) => { const M = gdMatrix(); return [[500, 336], [20, 20], [980, 20], [20, 650], [980, 650]].map(([rx, ry]) => { const ex = (rx - dx) / sc, ey = (ry - dy) / sc, w = M[6] * rx + M[7] * ry + M[8]; return Math.hypot((M[0] * rx + M[1] * ry + M[2]) / w - ex, (M[3] * rx + M[4] * ry + M[5]) / w - ey); }); }, [dx, dy, sc]);
    times[name] = { ms, how: st.how, maxErr: +Math.max(...errs).toFixed(2) };
    check(`stand-in ${name}: aligned, error <= 3 px at the centre and the corners`, st.how !== 'fail' && st.how !== 'aspect' && errs.every((e) => e <= 3), { st, errs });
    if (how) check(`stand-in ${name}: method is ${how}`, st.how === how, st);
    else check(`stand-in ${name}: aligned by ORB or the fallback`, st.how === 'orb' || st.how === 'ecc', st);
    check(`stand-in ${name}: status text names the method`, st.how === 'ecc' ? st.st === '위치를 맞췄어요 (전체 비교)' : /^위치를 맞췄어요 \(특징점 \d+개\)$/.test(st.st), st);
    check(`stand-in ${name}: aligned in < 1.5 s`, ms < 1500, ms);
  }
  console.log('stand-in times', JSON.stringify(times));
  // e) an unrelated picture (the built-in scene) must be rejected, not forced into place
  const scene = Buffer.from(await page.evaluate(() => { sample(); return S.src.toDataURL('image/png').split(',')[1]; }), 'base64');
  await loadSample(page); await page.waitForFunction(() => !!S.kit && !KIT.job, null, { timeout: 30000 });
  await upload(page, scene, 'scene.png'); await settled(page);
  const un = await state(page), um = await page.evaluate(() => gdMatrix());
  check('stand-in e: unrelated picture -> "자동으로 못 맞췄어요", aspect fit kept', /^자동으로 못 맞췄어요/.test(un.st) && un.how === 'fail' && un.T.tx === 0 && Math.abs(um[1]) < 1e-9 && Math.abs(um[0] - Math.max(1000 / 1200, 672 / 800)) < 1e-6, { un, um });

  check('no page errors', errors.length === 0, errors);
  console.log(JSON.stringify(res, null, 1));
  await ctx.close();
  process.exit(fail || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
