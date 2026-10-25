// "이 레이어로 모으기" test: fake split of the built-in rabbit over layers, GrabCut it on layer 4, gather. node move.test.js [url]
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const url = process.argv[2] || 'http://127.0.0.1:8765/prototype/paper-theater-studio.html';
const res = {}, errors = []; let fail = 0;
const check = (k, v, info) => { res[k] = v ? 'PASS' : { FAIL: info === undefined ? v : info }; if (!v) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ready = (p) => p.waitForFunction(() => { try { return !!S.cv && S.layers.length === 5 && !!S.W; } catch (e) { return false; } }, null, { timeout: 90000 });

// the sample's rabbit sits at about x600..770, y485..710 (image px); clear layers 2..5 so the test controls everything
const prep = (p) => p.evaluate(() => {
  hideAsk(); S.active = 3;
  [1, 2, 3, 4].forEach((i) => S.layers[i].mask.getContext('2d').clearRect(0, 0, S.W, S.H));
  S.undo = []; S.redo = []; renderLayers(); render();
  return { x: 600, y: 485, w: 170, h: 225 };
});
// after GrabCut: object into layer 5, object + big rect around it into layer 3 (enclosed), object + half rect into layer 2 (sticks out)
const fake = (p, bb) => p.evaluate((bb) => {
  const W = S.W, H = S.H, cx = (i) => S.layers[i].mask.getContext('2d');
  const o = cx(3).getImageData(0, 0, W, H); const obj = new Uint8Array(W * H); for (let i = 0; i < obj.length; i++) obj[i] = o.data[i * 4 + 3] > 127 ? 1 : 0;
  const put = (i, f) => { const g = cx(i), id = g.createImageData(W, H); for (let k = 0; k < W * H; k++) if (f(k % W, (k / W) | 0, obj[k])) { id.data[k * 4] = id.data[k * 4 + 1] = id.data[k * 4 + 2] = id.data[k * 4 + 3] = 255; } g.putImageData(id, 0, 0); };
  const m = 40, inR = (x, y, r) => x >= r[0] && x < r[2] && y >= r[1] && y < r[3];
  const big = [bb.x - m, bb.y - m, bb.x + bb.w + m, bb.y + bb.h + m], half = [bb.x - m, bb.y - m, bb.x + bb.w / 2, bb.y + bb.h + m];
  put(4, (x, y, o) => o); put(2, (x, y, o) => o || inR(x, y, big)); put(1, (x, y, o) => o || inR(x, y, half));
  let outBefore = 0; for (let k = 0; k < obj.length; k++) if (obj[k] && !inR(k % W, (k / W) | 0, half)) outBefore++;
  return { obj: obj.reduce((a, b) => a + b, 0), big, half, outBefore };
}, bb);
// per-layer [alpha count, hash]
const sums = (p) => p.evaluate(() => S.layers.map((L) => { const d = L.mask.getContext('2d').getImageData(0, 0, S.W, S.H).data; let n = 0, h = 0; for (let i = 0; i < S.W * S.H; i++) if (d[i * 4 + 3] > 127) { n++; h = (h * 31 + i) | 0; } return [n, h]; }));
// pixels in both layers a and b, ignoring those inside rect
const inter = (p, a, b, rect) => p.evaluate(([a, b, rect]) => {
  const da = S.layers[a].mask.getContext('2d').getImageData(0, 0, S.W, S.H).data, db = S.layers[b].mask.getContext('2d').getImageData(0, 0, S.W, S.H).data; let n = 0;
  for (let i = 0; i < S.W * S.H; i++) { if (rect) { const x = i % S.W, y = (i / S.W) | 0; if (x >= rect[0] && x < rect[2] && y >= rect[1] && y < rect[3]) continue; } if (da[i * 4 + 3] > 127 && db[i * 4 + 3] > 127) n++; }
  return n;
}, [a, b, rect]);
// rabbit pixels on layer 2 outside the half rect: ears (top 30% of the box) and body, now vs before (before = whole object there)
const thinStay = (p, bb, half) => p.evaluate(([bb, half]) => {
  const d1 = S.layers[1].mask.getContext('2d').getImageData(0, 0, S.W, S.H).data, d3 = S.layers[3].mask.getContext('2d').getImageData(0, 0, S.W, S.H).data;
  const r = { ears: 0, earsBefore: 0, body: 0, bodyBefore: 0 };
  for (let i = 0; i < S.W * S.H; i++) { const x = i % S.W, y = (i / S.W) | 0; if (d3[i * 4 + 3] <= 127 || (x >= half[0] && x < half[2] && y >= half[1] && y < half[3])) continue;
    const e = y < bb.y + bb.h * 0.3; r[e ? 'earsBefore' : 'bodyBefore']++; if (d1[i * 4 + 3] > 127) r[e ? 'ears' : 'body']++; }
  return r;
}, [bb, half]);
const waitGc = (p) => p.waitForFunction(() => { try { return !!cur().gcBase && !document.querySelector('.busy'); } catch (e) { return false; } }, null, { timeout: 60000 });

async function scenario(page, name, phone) {
  const bb = await prep(page);
  if (phone) {
    await page.evaluate((bb) => { document.querySelector('#tools [data-tool="rect"]').click(); cur().rect = { x: bb.x - 10, y: bb.y - 10, w: bb.w + 20, h: bb.h + 20 }; }, bb);
    await page.evaluate(() => runGrabCut());
  } else {
    await page.evaluate(() => document.querySelector('#tools [data-tool="rect"]').click());
    const [a, b] = await page.evaluate((bb) => { const r = view.getBoundingClientRect(), f = (x, y) => [r.left + x / S.W * r.width, r.top + y / S.H * r.height]; return [f(bb.x - 10, bb.y - 10), f(bb.x + bb.w + 10, bb.y + bb.h + 10)]; }, bb);
    await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.move((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, { steps: 4 }); await page.mouse.move(b[0], b[1], { steps: 4 }); await page.mouse.up();
  }
  await waitGc(page);
  check(name + ': button enabled after GrabCut', await page.evaluate((ph) => !document.getElementById(ph ? 'mGather' : 'gatherR').disabled, phone));
  const f = await fake(page, bb); check(name + ': GrabCut found the rabbit', f.obj > 2000, f.obj);
  const before = await sums(page);
  const o0 = [await inter(page, 1, 3), await inter(page, 2, 3), await inter(page, 4, 3)];
  check(name + ': fake split has rabbit in layers 2,3,5', o0.every((n) => n > 1000), o0);
  if (phone) {
    const box = await page.evaluate(() => { const b = document.getElementById('mGather').getBoundingClientRect(); return [b.width, b.height, b.top, innerHeight]; });
    check(name + ': bar button visible', box[0] > 20 && box[1] > 20 && box[2] < box[3], box);
  }
  // click inside the page and read the dirty flags at once (autosave clears them 1.5s later)
  const dirty = await page.evaluate((ph) => { document.getElementById(ph ? 'mGather' : 'gatherR').click(); return [1, 3, 4].every((i) => S.layers[i].__d === true); }, phone);
  check(name + ': touched layers marked dirty for autosave', dirty);
  await sleep(300);
  const after = await sums(page);
  const objAfter = [await inter(page, 1, 3), await inter(page, 2, 3), await inter(page, 4, 3)];
  check(name + ': layer 5 has no rabbit pixels', objAfter[2] === 0, objAfter[2]);
  check(name + ': layer 4 has the rabbit', (await inter(page, 3, 3)) >= f.obj && after[3][0] >= f.obj, after[3]);
  check(name + ': layer 3 keeps enclosed rabbit, outline is still the big rect', objAfter[1] === f.obj && after[2][0] === before[2][0] && after[2][1] === before[2][1], [objAfter[1], after[2][0], before[2][0]]);
  const outside = await inter(page, 1, 3, f.half);
  // bulk of the part sticking out is removed; only a thin rim (thin parts such as the ear tips) stays on the back layer
  const out0 = f.outBefore, thin = await thinStay(page, bb, f.half);
  check(name + ': layer 2 rabbit bulk sticking out removed', outside < out0 * 0.3, [outside, out0]);
  check(name + ': layer 2 thin protruding parts (ears) stay', thin.ears > 0 && thin.ears >= thin.earsBefore * 0.8 && thin.body < thin.bodyBefore * 0.3, thin);
  check(name + ': layer 2 changed, layer 1 untouched', after[1][1] !== before[1][1] && after[0][1] === before[0][1] && after[0][0] === before[0][0]);
  check(name + ': session ended', await page.evaluate(() => !cur().gcBase && document.getElementById('gatherR').disabled && document.getElementById('mGather').disabled));
  const tt = await page.evaluate(() => document.getElementById('toast').textContent);
  check(name + ': toast shown', /4번 레이어로 모았어요/.test(tt), tt);
  await page.evaluate(() => { undo(); }); await sleep(200);
  const undone = await sums(page);
  check(name + ': one undo restores layers 2,3,4,5', [1, 2, 3, 4].every((i) => undone[i][1] === before[i][1] && undone[i][0] === before[i][0]), undone.map((u, i) => u[0] - before[i][0]));
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  let ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  let page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url); await ready(page);
  check('markup: buttons exist', await page.evaluate(() => ['gather', 'gatherR', 'mGather'].every((id) => !!document.getElementById(id))));
  check('disabled without a selection', await page.evaluate(() => { document.querySelector('#tools [data-tool="rect"]').click(); return document.getElementById('gatherR').disabled; }));
  await scenario(page, 'desktop', false);
  await ctx.close();
  ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
  page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url); await ready(page);
  await scenario(page, 'phone', true);
  await browser.close();
  check('no page errors', errors.length === 0, errors);
  console.log(JSON.stringify(res, null, 1)); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
