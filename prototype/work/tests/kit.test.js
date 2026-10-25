// 키트 스타일 테스트 (sample1 필요): node kit.test.js [url]   OUT_DIR=이미지 저장 폴더
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const path = require('path');
const url = process.argv[2] || 'http://127.0.0.1:8765/prototype/paper-theater-studio.html';
const OUT = process.env.OUT_DIR || path.resolve(__dirname, '..');
const res = {}, errors = []; let fail = 0;
const check = (k, v, info) => { res[k] = v ? 'PASS' : { FAIL: info === undefined ? v : info }; if (!v) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openSample(page) {
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => { try { return !!S.cv && !!S.W; } catch (e) { return false; } }, null, { timeout: 90000 });
  const ok = await page.evaluate(async () => {
    const r = await fetch('/samples/sample1.webp'); if (!r.ok) return false;
    const img = new Image(); img.src = URL.createObjectURL(await r.blob()); await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0);
    hideAsk(); setupImage(c, [['뒤판(배경)', 0], ['먼 풍경', 5], ['중간', 10], ['앞 대상', 16], ['맨 앞 틀', 22]]); return true;
  });
  if (!ok) return false;
  await page.waitForFunction(() => !!S.kit && !KIT.job, null, { timeout: 30000 });
  return true;
}
// distinct colours of a canvas, brown line colour excluded
const colours = (page, expr) => page.evaluate((e) => { const c = eval(e), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, s = new Set(); let line = 0;
  for (let i = 0; i < d.length; i += 4) { if (d[i] === 70 && d[i + 1] === 48 && d[i + 2] === 32) { line++; continue; } s.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]); } return { n: s.size, line }; }, expr);
const setStr = async (page, v) => { await page.evaluate((v) => { const e = document.getElementById('kitStr'); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, v); await sleep(500); await page.waitForFunction((v) => KIT.str === v && !KIT.job && !KIT.timer, v, { timeout: 30000 }); };

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  if (!await openSample(page)) { console.log('sample1 없음: 건너뜀'); await browser.close(); return; }

  // 1) kit exists, colour count <= k, fast, original untouched
  const base = await page.evaluate(() => ({ same: S.kit !== S.src && S.kit.width === S.W && S.kit.height === S.H, ms: Math.round(KIT.ms), k: KIT.k, srcPx: Array.from(S.src.getContext('2d').getImageData(500, 300, 1, 1).data) }));
  const c3 = await colours(page, 'S.kit');
  check('kit: S.kit same size, S.src is still the original', base.same);
  check('kit: <= 16 flat colours (strength 3) + brown lines', c3.n <= 16 && c3.n >= 8 && c3.line > 1000, { c3, k: base.k });
  check('kit: computed < 2 s', base.ms < 2000, base.ms);
  check('kit: status text hidden when done', await page.evaluate(() => document.getElementById('kitState').hidden));

  // 2) strength 1 vs 5, timings
  const timings = {}, counts = {};
  for (const s of [1, 2, 3, 4, 5]) { await setStr(page, s); timings[s] = await page.evaluate(() => Math.round(KIT.ms)); counts[s] = (await colours(page, 'S.kit')).n; }
  check('kit: strength 5 has fewer colours than 1', counts[5] < counts[1], counts);
  check('kit: all strengths < 2 s', Object.values(timings).every((t) => t < 2000), timings);
  check('kit: label follows slider', await page.evaluate(() => document.getElementById('kitStrOut').textContent === '5'));
  await setStr(page, 3);

  // 3) GrabCut reads the kit image
  const gc = await page.evaluate(async () => {
    const seen = new Set(), orig = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function (...a) { seen.add(this.canvas); return orig.apply(this, a); };
    S.active = 3; renderLayers(); const L = cur(); L.mask.getContext('2d').clearRect(0, 0, S.W, S.H);
    L.rect = { x: 615, y: 285, w: 310, h: 387 };
    // run with the kit
    await runGrabCut(newGrp());
    CanvasRenderingContext2D.prototype.getImageData = orig;
    const usedKit = seen.has(S.kit), usedSrc = seen.has(S.src);
    const a1 = L.mask.getContext('2d').getImageData(0, 0, S.W, S.H).data;
    // run on the original for comparison
    const kit = S.kit; S.kit = null; L.mask.getContext('2d').clearRect(0, 0, S.W, S.H); L.gcBase = null; L.rect = { x: 615, y: 285, w: 310, h: 387 };
    await runGrabCut(newGrp()); S.kit = kit;
    const a2 = L.mask.getContext('2d').getImageData(0, 0, S.W, S.H).data;
    let n1 = 0, n2 = 0, diff = 0; for (let i = 3; i < a1.length; i += 4) { if (a1[i] > 127) n1++; if (a2[i] > 127) n2++; if ((a1[i] > 127) !== (a2[i] > 127)) diff++; }
    // leave the kit result in place
    L.mask.getContext('2d').clearRect(0, 0, S.W, S.H); L.gcBase = null; L.rect = { x: 615, y: 285, w: 310, h: 387 }; await runGrabCut(newGrp());
    return { usedKit, usedSrc, n1, n2, diff };
  });
  check('grabcut: reads S.kit pixels, not S.src', gc.usedKit && !gc.usedSrc, gc);
  check('grabcut: finds a deer-sized shape on the kit image', gc.n1 > 8000, gc);
  check('grabcut: result differs from the original-image run (kit really used)', gc.diff > 0, gc);

  // 4) AI always encodes/compares the ORIGINAL (S.src); a kit change never touches the embedding (model stubbed)
  const ai = await page.evaluate(async () => {
    let enc = 0, lastPx = null;
    AI.state = 'ready'; AI.T = { RawImage: class { constructor(d, w, h) { this.data = d; } rgb() { return this; } } };
    AI.proc = async (raw) => { lastPx = Array.from(raw.data.slice(4 * (300 * S.W + 500), 4 * (300 * S.W + 500) + 3)); return { reshaped_input_sizes: [[S.H, S.W]], original_sizes: [[S.H, S.W]] }; };
    AI.model = { get_image_embeddings: async () => { enc++; return { e: enc }; } };
    AI.src = null; AI.emb = null; AI.encoding = null; AI.encSrc = null;
    const r = { kitOn: !!S.kit && S.kit !== S.src, same: aiSrc() === S.src };
    await aiEncode();
    const srcPx = Array.from(S.src.getContext('2d').getImageData(500, 300, 1, 1).data.slice(0, 3)), kitPx = Array.from(S.kit.getContext('2d').getImageData(500, 300, 1, 1).data.slice(0, 3));
    r.enc1 = enc; r.key1 = AI.src === S.src && AI.src !== S.kit; r.px = JSON.stringify(lastPx) === JSON.stringify(srcPx); r.pxDiffersFromKit = JSON.stringify(srcPx) !== JSON.stringify(kitPx);
    await aiEncode(); r.enc1b = enc; // cached
    // change kit via the slider (debounced) and wait for it
    const e = document.getElementById('kitStr'); e.value = 5; e.dispatchEvent(new Event('input', { bubbles: true }));
    const t0 = Date.now(); while (!(KIT.str === 5 && !KIT.job && !KIT.timer) && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 50));
    r.kitChanged = KIT.str === 5; r.enc2 = enc; r.key2 = AI.src === S.src && AI.emb && AI.emb.e === 1; // embedding kept
    await aiEncode(); r.enc3 = enc; r.key3 = AI.src === S.src && AI.src !== S.kit && AI.emb.e === 1;
    // no embedding at all: the kit-triggered encode must still make one of S.src
    AI.src = null; AI.emb = null; await aiEncode(); r.enc4 = enc; r.key4 = AI.src === S.src && AI.src !== S.kit;
    return r;
  });
  check('ai: kit is on and aiSrc() is S.src', ai.kitOn && ai.same, ai);
  check('ai: encoded the original (pixels match S.src, key = S.src, never S.kit)', ai.enc1 === 1 && ai.key1 && ai.px && ai.pxDiffersFromKit, ai);
  check('ai: second aiEncode is cached', ai.enc1b === 1, ai);
  check('ai: kit change keeps the embedding of S.src (no re-encode)', ai.kitChanged && ai.enc2 === 1 && ai.key2 && ai.enc3 === 1 && ai.key3, ai);
  check('ai: missing embedding is rebuilt from S.src, not S.kit', ai.enc4 === 2 && ai.key4, ai);
  await page.evaluate(() => { AI.state = 'off'; AI.emb = null; AI.src = null; });
  await setStr(page, 3);

  // 5) depth split keeps the original
  const dp = await page.evaluate(() => { const s = depthRun.toString() + depthClick.toString(); return { src: /S\.src/.test(s), seg: /segSrc|printSrc|S\.kit/.test(s) }; });
  check('depth: reads S.src, not the kit', dp.src && !dp.seg, dp);

  // 6) 인쇄할 그림: editor, overview thumbs, textures
  const pr = await page.evaluate(async () => {
    document.getElementById('fillHidden').checked = false;
    const eq = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
    const px = (c) => c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const sel = document.getElementById('kitPrint'), r = {};
    S.active = 0; renderLayers();
    for (const [k, v, ref] of [['orig', '0', S.src], ['kit', '1', S.kit]]) {
      sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true }));
      r['view_' + k] = eq(px(view), px(ref));
      const { tex } = await buildTextures(); r['tex_' + k] = eq(px(tex[0]), px(ref));
      r['other_' + k] = !eq(px(tex[0]), px(k === 'kit' ? S.src : S.kit));
      LP.ver++; lpDirtyAll(); await new Promise((q) => setTimeout(q, 400));
    }
    // hidden-area fill: base picture is printSrc (pixels outside the patch are copied from it, the patch is built from it)
    const fm = S.layers.map((_, i) => finalMask(i)), hole = new Uint8Array(S.W * S.H);
    for (let y = 300; y < 340; y++) for (let x = 400; x < 440; x++) hole[y * S.W + x] = 255;
    r.fill = {};
    for (const [k, v, ref] of [['orig', '0', S.src], ['kit', '1', S.kit]]) {
      sel.value = v; const f = await fillHidden(hole, 1, fm), fp = px(f), rp = px(ref), i = (50 * S.W + 50) * 4, j = (330 * S.W + 380) * 4;
      r.fill[k] = fp[i] === rp[i] && fp[i + 1] === rp[i + 1] && fp[i + 2] === rp[i + 2] && fp[j] === rp[j];
    }
    return r;
  });
  check('print: 원본 -> editor and texture equal S.src', pr.view_orig && pr.tex_orig && pr.other_orig, pr);
  check('print: 키트 스타일 -> editor and texture equal S.kit', pr.view_kit && pr.tex_kit && pr.other_kit, pr);
  check('print: hidden-area fill uses the printed picture (원본 / 키트)', pr.fill.orig && pr.fill.kit, pr.fill);
  // kit change while printing the kit updates the editor
  const upd = await page.evaluate(async () => { document.getElementById('kitPrint').value = '1'; S.active = 0; render(); const before = view.getContext('2d').getImageData(500, 300, 200, 200).data.join(',');
    const e = document.getElementById('kitStr'); e.value = 1; e.dispatchEvent(new Event('input', { bubbles: true })); const t0 = Date.now(); while (!(KIT.str === 1 && !KIT.job && !KIT.timer) && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 50));
    return view.getContext('2d').getImageData(500, 300, 200, 200).data.join(',') !== before; });
  check('print: kit change while printing kit redraws the editor', upd);

  // screenshot: 인쇄 = 키트 스타일, deer selected on layer 4
  await page.evaluate(() => { document.getElementById('kitStr').value = 3; document.getElementById('kitStr').dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(500); await page.waitForFunction(() => KIT.str === 3 && !KIT.job && !KIT.timer);
  await page.evaluate(() => { document.getElementById('kitPrint').value = '1'; S.active = 3; renderLayers(); document.getElementById('kitPrint').dispatchEvent(new Event('change', { bubbles: true })); });
  await sleep(600);
  await page.screenshot({ path: path.join(OUT, 'kit-print-edit.png') });
  await page.evaluate(() => { S.active = 0; renderLayers(); render(); }); await sleep(200);
  await page.screenshot({ path: path.join(OUT, 'kit-print-back.png') });
  await page.evaluate(() => { document.getElementById('kitPrint').value = '0'; document.getElementById('kitPrint').dispatchEvent(new Event('change', { bubbles: true })); });
  await ctx.close();

  // 7) settings persist through autosave reload (fresh context = empty IndexedDB)
  const ctx2 = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const p2 = await ctx2.newPage();
  if (!await openSample(p2)) { await browser.close(); return; }
  await p2.waitForFunction(() => PT.armed, null, { timeout: 30000 });
  await p2.evaluate(() => { const e = document.getElementById('kitStr'); e.value = 5; e.dispatchEvent(new Event('input', { bubbles: true })); const s = document.getElementById('kitPrint'); s.value = '1'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await p2.waitForFunction(() => KIT.str === 5 && !KIT.job && !KIT.timer, null, { timeout: 30000 });
  await p2.waitForFunction(() => PT.saves > 0 && !PT.saving, null, { timeout: 15000 });
  await sleep(2500); await p2.waitForFunction(() => !PT.saving && !PT.t || true);
  const saved = await p2.evaluate(() => PT.saves);
  await p2.reload();
  await p2.waitForFunction(() => { try { return !!S.cv && !document.getElementById('ask').hidden; } catch (e) { return false; } }, null, { timeout: 90000 });
  await p2.click('#askBtns button:has-text("이어서 하기")');
  await p2.waitForFunction(() => S.kit && KIT.str === 5 && !KIT.job, null, { timeout: 30000 });
  const rs = await p2.evaluate(() => ({ str: document.getElementById('kitStr').value, out: document.getElementById('kitStrOut').textContent, pr: document.getElementById('kitPrint').value, c: ptSettings(), srcIsOrig: S.kit !== S.src }));
  check('save: kitStr/kitPrint stored and restored, kit recomputed', rs.str === '5' && rs.out === '5' && rs.pr === '1' && rs.c.kitStr === 5 && rs.c.kitPrint === 1, { rs, saved });
  // file save keeps the ORIGINAL image
  const fileRec = await p2.evaluate(async () => { const rec = await ptCollect(true); const im = await ptImg(rec.src); const c = mk(im.naturalWidth, im.naturalHeight); c.getContext('2d').drawImage(im, 0, 0);
    const a = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, b = S.src.getContext('2d').getImageData(0, 0, c.width, c.height).data, k = S.kit.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let dsrc = 0, dkit = 0; for (let i = 0; i < a.length; i += 4 * 97) { dsrc += Math.abs(a[i] - b[i]); dkit += Math.abs(a[i] - k[i]); } return { dsrc, dkit, hasSettings: rec.settings.kitStr === 5 }; });
  check('save: saved image is the original, not the kit', fileRec.dsrc < fileRec.dkit && fileRec.hasSettings, fileRec);
  await ctx2.close();

  check('no page errors', errors.length === 0, errors);
  console.log(JSON.stringify({ res, timings, counts, errors }, null, 1));
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
