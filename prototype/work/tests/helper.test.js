// 생성형 AI 도우미 카드·그림 난이도 진단 테스트 (sample1 필요): node helper.test.js [url]
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('fs');
const url = process.argv[2] || 'http://127.0.0.1:8765/prototype/paper-theater-studio.html';
const res = {}, errors = []; let fail = 0;
const check = (k, v, info) => { res[k] = v ? 'PASS' : { FAIL: info === undefined ? v : info }; if (!v) fail++; };
const ready = (p) => p.waitForFunction(() => { try { return !!S.cv && !!S.W; } catch (e) { return false; } }, null, { timeout: 90000 });
const SAMPLE1 = `async()=>{const r=await fetch('/samples/sample1.webp');if(!r.ok)return null;const i=new Image();i.src=URL.createObjectURL(await r.blob());await i.decode();const c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;c.getContext('2d').drawImage(i,0,0);return c}`;
const NOISE = (w, h) => `()=>{const n=mk(${w},${h}),g=n.getContext('2d'),d=g.createImageData(${w},${h});for(let i=0;i<d.data.length;i+=4){d.data[i]=Math.random()*255;d.data[i+1]=Math.random()*255;d.data[i+2]=Math.random()*255;d.data[i+3]=255}g.putImageData(d,0,0);return n}`;
// load a canvas built by an expression into the app, return the diagnosis
const load = (page, build) => page.evaluate(async (b) => { const c = await eval('(' + b + ')')(); if (!c) return null; hideAsk(); setupImage(c, [['뒤판', 0], ['중간', 8], ['앞', 16]]); return { lv: DX.lv, name: document.getElementById('dxBadge').textContent, m: DX.m, ms: DX.ms }; }, build);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url); await ready(page);

  // card position and text
  const card = await page.evaluate(() => { const c = document.getElementById('aiHelper'), k = [...document.querySelectorAll('.card h2')].find((h) => h.textContent === '키트 스타일').parentElement; return { title: c.querySelector('h2').textContent, adj: c.nextElementSibling === k, steps: c.querySelectorAll('ol li').length, txt: c.textContent }; });
  check('card: title, immediately before 키트 스타일, 3 steps', card.title === '생성형 AI 도우미' && card.adj && card.steps === 3, card);
  check('card: guide names the 경계 찾기용 그림 card', card.txt.includes('경계 찾기용 그림'));

  // 1) built-in sample diagnosis
  const b0 = await page.evaluate(() => ({ lv: DX.lv, name: document.getElementById('dxBadge').textContent, msg: document.getElementById('dxMsg').textContent, ms: DX.ms }));
  check('diag: built-in sample = 쉬움', b0.lv === 0 && b0.name === '쉬움' && b0.msg.length > 5, b0);

  // 2) copy puts the prompt on the clipboard
  await page.click('#dxCopy');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  const wh = await page.evaluate(() => ({ W: S.W, H: S.H }));
  check('copy: clipboard has W×H and 구도', clip.includes(`${wh.W}×${wh.H}`) && clip.includes('구도') && clip.includes('비율') && clip.includes('단색') && clip.includes('윤곽선'), clip.slice(0, 200));
  check('copy: toast shown', await page.evaluate(() => document.getElementById('toast').textContent === '요청 문구를 복사했어요'));
  const prev = await page.evaluate(() => ({ t: document.getElementById('dxTxt').textContent, det: document.getElementById('dxDet').tagName }));
  check('preview: <details> text equals copied text', prev.t === clip.split('\r\n').join('\n') && prev.det === 'DETAILS');

  // 3) English toggle
  await page.click('#dxEn');
  const en = await page.evaluate(() => ({ t: document.getElementById('dxTxt').textContent, b: document.getElementById('dxEn').textContent, p: document.getElementById('dxEn').getAttribute('aria-pressed') }));
  check('english: preview switches, button pressed', /composition/.test(en.t) && en.t.includes(`${wh.W} x ${wh.H}`) && en.p === 'true' && !/구도/.test(en.t), en);
  await page.click('#dxCopy');
  check('english: clipboard has English text', (await page.evaluate(() => navigator.clipboard.readText())).includes('composition'));
  await page.click('#dxEn');
  check('english: toggles back to Korean', (await page.evaluate(() => document.getElementById('dxTxt').textContent)).includes('구도'));

  // 4) original download
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dxSave')]);
  const buf = fs.readFileSync(await dl.path());
  const png = buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a', w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  check('download: PNG of W×H', png && w === wh.W && h === wh.H && /\.png$/.test(dl.suggestedFilename()), { png, w, h, name: dl.suggestedFilename() });
  await page.close();

  // 5) fallback: no navigator.clipboard -> execCommand; both fail -> manual box
  const p2 = await ctx.newPage(); p2.on('pageerror', (e) => errors.push(e.message));
  await p2.goto(url); await ready(p2);
  await p2.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }); window.__cp = null; document.execCommand = (c) => { window.__cp = { c, v: document.activeElement && document.activeElement.value }; return true; }; });
  await p2.click('#dxCopy');
  const fb = await p2.evaluate(() => ({ cp: window.__cp, toast: document.getElementById('toast').textContent, box: document.getElementById('dxManual').hidden, left: document.querySelectorAll('textarea[style*="-9999px"]').length }));
  check('fallback: execCommand copy of the prompt, textarea removed', fb.cp && fb.cp.c === 'copy' && fb.cp.v.includes('구도') && fb.toast === '요청 문구를 복사했어요' && fb.box && fb.left === 0, fb);
  await p2.evaluate(() => { document.execCommand = () => false; });
  await p2.click('#dxCopy');
  const man = await p2.evaluate(() => { const b = document.getElementById('dxManual'); return { hidden: b.hidden, v: b.value.includes('구도'), sel: b.selectionEnd - b.selectionStart > 100, ro: b.readOnly, note: !document.getElementById('dxManualNote').hidden }; });
  check('fallback: both fail -> selectable box with text', !man.hidden && man.v && man.sel && man.note, man);

  // 6) diagnosis on other pictures
  const s1 = await load(p2, SAMPLE1);
  if (!s1) console.log('sample1 없음: 난이도 일부 건너뜀');
  else {
    check('diag: sample1 = 어려움/매우 어려움', s1.lv >= 2, s1);
    check('diag: toast shown for hard picture', await p2.evaluate(() => document.getElementById('toast').textContent.includes('AI 도우미')));
    const flat = await p2.evaluate(async () => { const c = mk(1000, 672), g = c.getContext('2d'); g.filter = 'blur(4px)'; g.drawImage(S.src, 0, 0); g.filter = 'none'; const d = g.getImageData(0, 0, 1000, 672); for (let i = 0; i < d.data.length; i += 4) for (let k = 0; k < 3; k++) d.data[i + k] = Math.round(d.data[i + k] / 85) * 85; g.putImageData(d, 0, 0); hideAsk(); setupImage(c, [['뒤판', 0], ['중간', 8], ['앞', 16]]); return { lv: DX.lv, m: DX.m, ms: DX.ms }; });
    check('diag: heavily quantised sample1 = 쉬움/보통', flat.lv <= 1, flat);
    check('diag: no toast for easy picture', await p2.evaluate(() => { toast(''); hideAsk(); const c = mk(600, 400), g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 600, 400); g.fillStyle = '#c33'; g.fillRect(100, 100, 200, 150); setupImage(c, [['뒤판', 0], ['앞', 10]]); return DX.lv === 0 && !document.getElementById('toast').textContent.includes('AI 도우미'); }));
  }
  const noise = await load(p2, NOISE(1000, 672));
  check('diag: random noise = 매우 어려움', noise.lv === 3 && noise.name === '매우 어려움', noise);
  const big = await load(p2, NOISE(1400, 933));
  check('diag: time < 150 ms (1400px picture)', big.ms < 150 && noise.ms < 150, { big: big.ms, noise: noise.ms });
  await p2.close();

  // 7) phone layout
  const pctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const ph = await pctx.newPage(); ph.on('pageerror', (e) => errors.push('phone: ' + e.message));
  await ph.goto(url); await ready(ph);
  const lay = await ph.evaluate(() => { const c = document.getElementById('aiHelper'), r = c.getBoundingClientRect(); const bad = [...c.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).map((e) => e.id || e.tagName); return { sw: document.documentElement.scrollWidth, iw: innerWidth, right: Math.round(r.right), w: Math.round(r.width), bad }; });
  check('phone: no horizontal scroll, card inside the viewport', lay.sw <= lay.iw && lay.right <= lay.iw && lay.bad.length === 0, lay);
  await ph.evaluate(() => { document.getElementById('dxDet').open = true; });
  const lay2 = await ph.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, fits: document.getElementById('dxTxt').getBoundingClientRect().right <= innerWidth }));
  check('phone: opened preview fits', lay2.sw <= lay2.iw && lay2.fits, lay2);
  await ph.click('#dxCopy');
  check('phone: copy button works (toast)', await ph.evaluate(() => /복사/.test(document.getElementById('toast').textContent)));
  await pctx.close();

  check('no page errors', errors.length === 0, errors);
  console.log(JSON.stringify(res, null, 1));
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
