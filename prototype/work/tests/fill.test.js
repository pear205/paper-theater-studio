// F1 test: hidden-area fill. Runs buildTextures on the built-in sample and on sample1 (deer in layer 4),
// times fillHidden per layer, compares base.html vs fill.html and writes work/fill-compare-*.png
// usage: node fill.test.js [fillUrl] [baseUrl]
const { chromium } = require(process.env.PLAYWRIGHT_PATH||'playwright');
const fs = require('fs'), path = require('path');
const FILL = process.argv[2] || 'http://127.0.0.1:8765/prototype/work/fill.html';
const BASE = process.argv[3] || 'http://127.0.0.1:8765/prototype/work/base.html';
const OUT = process.env.OUT_DIR || path.resolve(__dirname, '..');

// scenario setup + capture, run inside the page
async function run(page, url, scen) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url);
  await page.waitForFunction(() => { try { return !!S.cv; } catch (e) { return false; } }, null, { timeout: 120000 });
  const res = await page.evaluate(async (scen) => {
    if (scen.name === 'sample1') {
      const blob = await (await fetch('/samples/sample1.webp')).blob();
      const img = new Image(); img.src = URL.createObjectURL(blob); await img.decode();
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      setupImage(c, [['뒤판(배경)', 0], ['먼 풍경', 5], ['중간', 10], ['앞 대상', 16], ['맨 앞 틀', 22]]);
      S.layers[3].rect = { x: 615, y: 285, w: 310, h: 387 }; S.active = 3; await runGrabCut();
      const a = alphaArr(S.layers[3].mask); let n = 0; for (const v of a) if (v) n++;
      if (n < 5000) { // fallback: ellipse
        const g = S.layers[3].mask.getContext('2d'); g.fillStyle = '#fff'; g.beginPath(); g.ellipse(770, 478, 150, 190, 0, 0, 7); g.fill();
      }
    }
    // time every fillHidden call
    // base.html's fillHidden(hole) gets no index: layers that have something in front, back to front order
    const nz = S.layers.map(L => alphaArr(L.mask).some(v => v)); const order = [];
    for (let i = S.layers.length - 2; i >= 0; i--) if (nz.slice(i + 1).some(v => v)) order.push(i);
    const times = []; const orig = window.fillHidden; let k = 0;
    window.fillHidden = function (...args) {
      const t0 = performance.now(); const r = orig.apply(this, args);
      times.push({ layer: (args.length > 1 ? args[1] : order[k]) + 1, ms: Math.round(performance.now() - t0) }); k++; return r;
    };
    const t0 = performance.now();
    const { tex } = await buildTextures();
    const total = Math.round(performance.now() - t0);
    window.fillHidden = orig;
    // crop of the chosen layer's texture over a checkerboard
    const { li, x, y, w, h } = scen.crop;
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
    for (let yy = 0; yy < h; yy += 12) for (let xx = 0; xx < w; xx += 12) { g.fillStyle = ((xx + yy) / 12) % 2 ? '#ddd' : '#fff'; g.fillRect(xx, yy, 12, 12); }
    g.drawImage(tex[li], x, y, w, h, 0, 0, w, h);
    const s = document.createElement('canvas'); s.width = w; s.height = h; s.getContext('2d').drawImage(S.src, x, y, w, h, 0, 0, w, h);
    return { times, total, crop: c.toDataURL('image/png'), src: s.toDataURL('image/png'), W: S.W, H: S.H };
  }, scen);
  return { ...res, errors };
}

async function compose(page, items, labels) {
  return page.evaluate(async ({ items, labels }) => {
    const imgs = await Promise.all(items.map(async u => { const i = new Image(); i.src = u; await i.decode(); return i; }));
    const w = imgs[0].width, h = imgs[0].height, gap = 8, top = 26;
    const c = document.createElement('canvas'); c.width = w * imgs.length + gap * (imgs.length - 1); c.height = h + top;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#222'; g.font = 'bold 16px sans-serif';
    imgs.forEach((im, i) => { g.drawImage(im, i * (w + gap), top); g.fillText(labels[i], i * (w + gap) + 6, 18); });
    return c.toDataURL('image/png');
  }, { items, labels });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const scens = [
    // layer 3 (언덕과 집) behind the rabbit
    { name: 'sample', crop: { li: 2, x: 500, y: 450, w: 340, h: 300 } },
    // layer 1 (뒤판) behind the deer
    { name: 'sample1', crop: { li: 0, x: 570, y: 250, w: 400, h: 422 } },
  ];
  const report = {}; let fail = false;
  for (const scen of scens) {
    const r = {};
    for (const [tag, url] of [['base', BASE], ['fill', FILL]]) {
      const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
      r[tag] = await run(page, url, scen);
      await page.close();
      if (r[tag].errors.length) fail = true;
    }
    const page = await browser.newPage();
    const png = await compose(page, [r.base.src, r.base.crop, r.fill.crop], ['원본', '이전 (base)', '개선 (fill)']);
    await page.close();
    const file = path.join(OUT, `fill-compare-${scen.name}.png`);
    fs.writeFileSync(file, Buffer.from(png.split(',')[1], 'base64'));
    report[scen.name] = {
      size: `${r.fill.W}x${r.fill.H}`,
      base: { fillMs: r.base.times.map(t => `L${t.layer}:${t.ms}ms`).join(" "), buildTexturesMs: r.base.total, errors: r.base.errors },
      fill: { fillMs: r.fill.times.map(t => `L${t.layer}:${t.ms}ms`).join(" "), buildTexturesMs: r.fill.total, errors: r.fill.errors },
      png: file,
    };
    if (r.fill.times.some(t => t.ms > 1500)) { fail = true; report[scen.name].slow = true; }
  }
  console.log(JSON.stringify(report, null, 1));
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
