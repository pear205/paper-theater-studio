// 스모크 테스트: 페이지 로드 → OpenCV 준비 대기 → 상태 출력
// 사용법: node smoke.test.js [URL]
const { chromium } = require(process.env.PLAYWRIGHT_PATH||'playwright');

const url = process.argv[2] || 'http://127.0.0.1:8765/prototype/work/base.html';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message ? err.message : err)));

  const result = { url, cv: false, layers: null, W: null, H: null, errors: [] };
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => { try { return !!S.cv; } catch (e) { return false; } }, null, { timeout: 90000 });
    const state = await page.evaluate(() => ({
      cv: !!S.cv,
      layers: S.layers.length,
      W: S.W,
      H: S.H,
    }));
    Object.assign(result, state);
  } catch (e) {
    result.errors.push('wait/eval 실패: ' + e.message.split('\n')[0]);
  }
  result.errors.push(...pageErrors.map((m) => 'pageerror: ' + m));
  result.errors.push(...consoleErrors.map((m) => 'console: ' + m));

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(pageErrors.length > 0 ? 1 : 0);
})();
