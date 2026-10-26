// F3 save/load test. usage: node save.test.js [url]
const { chromium } = require(process.env.PLAYWRIGHT_PATH||'playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const URL_ = process.argv[2] || 'http://127.0.0.1:8765/prototype/work/save.html';
const res = {}; const errors = [];
const ok = (k, v) => { res[k] = v; };
const counts = () => {
  const out = [];
  for (const L of S.layers) {
    const d = L.mask.getContext('2d').getImageData(0, 0, S.W, S.H).data; let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 127) n++;
    out.push(n);
  }
  return { n: out, names: S.layers.map(l => l.name), z: S.layers.map(l => l.z), grow: S.layers.map(l => l.grow || 0),
    st: ptSettings(), W: S.W, H: S.H };
};
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptsave-'));
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, viewport: { width: 1360, height: 900 }, acceptDownloads: true });
  const open = async () => {
    const page = ctx.pages()[0] || await ctx.newPage();
    page.removeAllListeners('pageerror');
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(URL_); await page.waitForFunction(() => { try { return S.W > 0 && typeof PT === 'object'; } catch (e) { return false; } });
    await page.waitForTimeout(600);
    await page.evaluate(() => { document.getElementById('saveCard').open = true; }); // 작업 저장 card starts collapsed; its buttons are only clickable when open
    return page;
  };
  const askText = p => p.evaluate(() => $('ask').hidden ? null : $('askMsg').textContent);
  const waitSave = (p, n) => p.waitForFunction(k => PT.saves >= k, n, { timeout: 15000 });

  let page = await open();
  ok('first_load_prompt', await askText(page));            // expect null
  // edit: mask on layer 2 (index 2), grow, name, z, setting
  await page.evaluate(() => {
    pushUndo(2); const g = S.layers[2].mask.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(100, 100, 200, 150); render();
    S.layers[3].grow = 2; $('lname3').value; S.layers[3].name = '바뀐 이름'; S.layers[3].z = 13;
    $('borderMm').value = 7; $('smooth').value = 6; $('fillHidden').checked = false; $('showCut').checked = !$('showCut').checked;
    renderLayers(); render(); updateSize();
    $('borderMm').dispatchEvent(new Event('change', { bubbles: true }));
  });
  const before = await page.evaluate(counts);
  await waitSave(page, 1);
  ok('saved_count', await page.evaluate(() => PT.saves));
  ok('stored_bytes', await page.evaluate(async () => {
    const r = await ptIdb('readonly', s => s.get('project')); let n = r.src.size; r.layers.forEach(l => n += l.mask.size);
    return { total: n, src: r.src.size, masks: r.layers.map(l => l.mask.size) };
  }));
  // reload -> prompt -> continue
  page = await open();
  ok('reload_prompt', await askText(page));
  ok('not_overwritten_before_choice', await page.evaluate(() => PT.armed));
  await page.click('#askBtns button:has-text("이어서 하기")');
  await page.waitForFunction(() => PT.armed && !PT.busy);
  const after = await page.evaluate(counts);
  ok('restore_identical', JSON.stringify(before) === JSON.stringify(after));
  if (!res.restore_identical) { ok('before', before); ok('after', after); }
  ok('armed_after_restore', await page.evaluate(() => PT.armed));
  // reload with no edits -> still prompts (store kept); choose new -> store cleared
  page = await open();
  await page.click('#askBtns button:has-text("새로 시작")');
  await page.waitForTimeout(500);
  ok('store_cleared', await page.evaluate(async () => (await ptIdb('readonly', s => s.get('project'))) === undefined));
  ok('sample_kept', await page.evaluate(() => S.layers[1].name));
  page = await open();
  ok('reload_after_new_no_prompt', await askText(page));    // expect null
  await page.waitForTimeout(2200);
  ok('no_edit_no_save', await page.evaluate(() => PT.saves));  // expect 0

  // file save -> JSON -> load back
  await page.evaluate(() => { pushUndo(2); const g = S.layers[2].mask.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(50, 60, 123, 77); S.layers[2].grow = 3; S.layers[2].name = '파일'; $('widthMm').value = 180; renderLayers(); render(); updateSize(); });
  const b2 = await page.evaluate(counts);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#ptSave')]);
  const fp = path.join(dir, 'out.ptheater.json'); await dl.saveAs(fp);
  const json = JSON.parse(fs.readFileSync(fp, 'utf8'));
  ok('file', { name: dl.suggestedFilename(), version: json.version, layers: json.layers.length, srcIsDataUrl: /^data:image\/png/.test(json.src), maskIsDataUrl: json.layers.every(l => /^data:image\/png/.test(l.mask)), kb: Math.round(fs.statSync(fp).size / 1024) });
  // new start then load the file
  await page.evaluate(() => { sample(); });
  await page.setInputFiles('#ptFile', fp); await page.waitForFunction(() => S.layers[2].name === '파일' && !PT.busy);
  const a2 = await page.evaluate(counts);
  ok('file_roundtrip', JSON.stringify(b2) === JSON.stringify(a2));
  // bad file
  fs.writeFileSync(path.join(dir, 'bad.json'), '{"version":9}');
  await page.setInputFiles('#ptFile', path.join(dir, 'bad.json')); await page.waitForTimeout(400);
  ok('bad_file_toast', await page.evaluate(() => $('toast').textContent));
  ok('state_after_bad_file', JSON.stringify(await page.evaluate(counts)) === JSON.stringify(a2));

  // sample1 roundtrip via IndexedDB
  await page.evaluate(async () => {
    const blob = await (await fetch('/samples/sample1.webp')).blob(); const img = new Image(); img.src = URL.createObjectURL(blob); await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0);
    setupImage(c, [['뒤판(배경)', 0], ['먼 풍경', 5], ['중간', 10], ['앞 대상', 16], ['맨 앞 틀', 22]]);
    pushUndo(3); const g = S.layers[3].mask.getContext('2d'); g.fillStyle = '#fff'; g.beginPath(); g.arc(500, 300, 120, 0, 7); g.fill(); render();
  });
  const b3 = await page.evaluate(counts);
  const n0 = await page.evaluate(() => PT.saves); await waitSave(page, n0 + 1);
  ok('sample1_stored', await page.evaluate(async () => { const r = await ptIdb('readonly', s => s.get('project')); let n = r.src.size; r.layers.forEach(l => n += l.mask.size); return { W: r.W, H: r.H, total: n, src: r.src.size }; }));
  page = await open();
  await page.click('#askBtns button:has-text("이어서 하기")'); await page.waitForFunction(() => PT.armed && !PT.busy);
  ok('sample1_roundtrip', JSON.stringify(b3) === JSON.stringify(await page.evaluate(counts)));
  // review fixes 1-4
  // (2) silent dismissal of the restore prompt must not overwrite the stored project
  const savedAt0 = await page.evaluate(async () => (await ptIdb('readonly', s => s.get('project'))).savedAt);
  page = await open();
  ok('fix2_prompt_up', (await askText(page)) === '지난 작업을 이어서 할까요?');
  await page.evaluate(() => { pushUndo(2); const g = S.layers[2].mask.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(10, 10, 80, 80); hideAsk(); render(); });
  await page.waitForFunction(() => PT.armed, null, { timeout: 5000 });
  await page.waitForFunction(() => PT.saves >= 1, null, { timeout: 15000 });
  const f2 = await page.evaluate(async () => ({ prev: (await ptIdb('readonly', s => s.get('prev'))), proj: (await ptIdb('readonly', s => s.get('project'))) }));
  ok('fix2_prev_backup_kept', !!f2.prev && f2.prev.savedAt === savedAt0);
  ok('fix2_project_now_edited', f2.proj.savedAt > savedAt0);
  // (1) aiApply marks the layer dirty and schedules a save
  await page.waitForFunction(() => !PT.saving && !PT.t || true);
  const n1 = await page.evaluate(() => PT.saves);
  await page.evaluate(() => {
    const L = S.layers[3]; L.__d = false; L.gcMode = 'add'; L.gcBase = L.mask.getContext('2d').getImageData(0, 0, S.W, S.H);
    const sel = new Uint8Array(S.W * S.H); for (let y = 200; y < 260; y++) for (let x = 200; x < 300; x++) sel[y * S.W + x] = 1;
    S.aiLast = { L, masks: [{ sel, area: 6000 }] }; L.aiLevel = 0; aiApply(L); window.__aiDirty = L.__d;
  });
  ok('fix1_dirty_after_aiApply', await page.evaluate(() => window.__aiDirty));
  await waitSave(page, n1 + 1);
  ok('fix1_stored_has_ai_mask', await page.evaluate(async () => {
    const r = await ptIdb('readonly', s => s.get('project')); const im = await ptImg(r.layers[3].mask);
    const c = mk(im.naturalWidth, im.naturalHeight); const g = c.getContext('2d'); g.drawImage(im, 0, 0);
    return g.getImageData(250, 230, 1, 1).data[3] > 127;
  }));
  // (3) pointercancel mid-stroke: drag ends null and the stroke is undone (mouse + touch)
  const cancelTest = await page.evaluate(async () => {
    const out = {}; const v = $('view'); v.setPointerCapture = () => {}; v.releasePointerCapture = () => {};
    S.active = 2; S.tool = 'paint'; const cnt = () => { const d = S.layers[2].mask.getContext('2d').getImageData(0, 0, S.W, S.H).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 127) n++; return n; };
    const r = v.getBoundingClientRect(), x = r.left + r.width * .5, y = r.top + r.height * .5;
    const ev = (t, type, id, o = {}) => t.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: id, clientX: x, clientY: y, ...o }));
    S.layers[2].mask.getContext('2d').clearRect(0, 0, S.W, S.H);
    const c0 = cnt();
    ev(v, 'pointerdown', 5, { pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 }); ev(v, 'pointermove', 5, { pointerType: 'mouse', isPrimary: true, buttons: 1, clientX: x + 30 });
    out.mouse_drag_set = !!drag; out.mouse_painted = cnt() > c0;
    ev(v, 'pointercancel', 5, { pointerType: 'mouse', isPrimary: true });
    out.mouse_drag_null = drag === null; out.mouse_restored = cnt() === c0;
    ev(v, 'pointerdown', 7, { pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 }); ev(v, 'pointermove', 7, { pointerType: 'touch', isPrimary: true, buttons: 1, clientX: x + 30 });
    out.touch_drag_set = !!drag;
    ev(v, 'pointercancel', 7, { pointerType: 'touch', isPrimary: true });
    out.touch_drag_null = drag === null; out.touch_restored = cnt() === c0; out.touch_map_empty = tp.size === 0;
    // (4) stale touch pointer + gesture flag are dropped on a new primary pointerdown
    tp.set(99, { x: 1, y: 1 }); gest = true;
    ev(v, 'pointerdown', 8, { pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 });
    out.stale_cleared = !gest && tp.size === 1 && drag !== null;
    ev(v, 'pointerup', 8, { pointerType: 'touch', isPrimary: true });
    drag = null; tp.clear(); gest = false; S.tool = 'rect';
    return out;
  });
  ok('fix3_4_cancel', cancelTest);
  // unavailable storage: app still works
  const p2 = await ctx.newPage(); p2.on('pageerror', e => errors.push('p2 ' + String(e)));
  await p2.addInitScript(() => { Object.defineProperty(window, 'indexedDB', { get() { throw new Error('denied'); } }); });
  await p2.goto(URL_); await p2.waitForFunction(() => { try { return S.W > 0 && PT.armed; } catch (e) { return false; } });
  await p2.evaluate(() => { pushUndo(2); render(); }); await p2.waitForTimeout(2200);
  ok('no_storage', await p2.evaluate(() => ({ off: PT.off, note: $('ptNote').textContent, layers: S.layers.length })));
  ok('page_errors', errors);
  console.log(JSON.stringify(res, null, 1));
  await ctx.close();
  const cf = res.fix3_4_cancel || {};
  const fixOk = res.fix2_prompt_up && res.fix2_prev_backup_kept && res.fix2_project_now_edited && res.fix1_dirty_after_aiApply && res.fix1_stored_has_ai_mask && Object.keys(cf).length === 9 && Object.values(cf).every(Boolean);
  ok('review_fixes_ok', !!fixOk);
  process.exit(errors.length || !fixOk || !res.restore_identical || res.reload_prompt !== '지난 작업을 이어서 할까요?' ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
