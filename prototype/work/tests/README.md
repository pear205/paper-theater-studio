# Playwright 테스트 환경

## Playwright 위치
- 테스트는 일반 모듈 경로의 `playwright`를 씁니다 (`npm i playwright`).
- 다른 폴더에 설치했다면 환경변수 `PLAYWRIGHT_PATH`에 그 폴더(playwright 패키지 경로)를 지정합니다.
- 프로젝트 폴더(구글 드라이브)에는 node_modules를 두지 않습니다.
- 예시 (프로젝트 밖 `D:/pw` 폴더에 `npm i playwright@1.48.2` 하고 `npx playwright install chromium` 한 경우):
```bash
PLAYWRIGHT_PATH="D:/pw/node_modules/playwright" node smoke.test.js <url>
```

## require 경로
```js
const { chromium } = require(process.env.PLAYWRIGHT_PATH||'playwright');
```

## 실행 방법
```bash
node smoke.test.js
node smoke.test.js http://127.0.0.1:8765/prototype/work/base.html
```
- sample1 테스트는 `samples/sample1.webp`가 필요한데, 저작권 때문에 git 저장소에 없습니다. 해당 부분은 로컬에서만 실행됩니다.
- 결과는 JSON으로 출력됩니다. 페이지 에러가 있으면 종료 코드 1입니다.

## 서버
- URL: `http://127.0.0.1:8765` (루트: 프로젝트 최상위 폴더)
- 꺼져 있으면 `python -m http.server 8765 --bind 127.0.0.1`

## 주의
- `S`는 최상위 `const`라 `window.S`가 아닙니다. `page.evaluate` 안에서는 `S`를 그대로 식별자로 씁니다 (`window.S`는 undefined).

## 예제 테스트 템플릿
예시 그림을 앱과 같은 방식으로 불러오는 코드입니다.
```js
const { chromium } = require(process.env.PLAYWRIGHT_PATH||'playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  await page.goto('http://127.0.0.1:8765/prototype/work/base.html');
  await page.waitForFunction(() => { try { return !!S.cv; } catch (e) { return false; } }, null, { timeout: 90000 });
  await page.evaluate(async () => {
    const blob = await (await fetch('/samples/sample1.webp')).blob();
    const img = new Image();
    img.src = URL.createObjectURL(blob);
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    setupImage(canvas, [['뒤판(배경)',0],['먼 풍경',5],['중간',10],['앞 대상',16],['맨 앞 틀',22]]);
  });
  console.log(await page.evaluate(() => S.layers.length));
  await browser.close();
})();
```
