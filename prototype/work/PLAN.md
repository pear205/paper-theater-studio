# 작업 계획 — 효과 큰 개선 4가지 (2026-10-25)

대상 파일: `prototype/paper-theater-studio.html` (단일 HTML, 이하 "본 파일").
병합 기준본: `prototype/work/base.html` (본 파일의 지금 상태 사본. 절대 고치지 말 것).
로컬 서버: `http://127.0.0.1:8765/` = 프로젝트 루트(`G:\내 드라이브\workspace\paper_cinema`). 예: `http://127.0.0.1:8765/prototype/work/fill.html`, 테스트 그림 `http://127.0.0.1:8765/samples/sample1.webp`(1000×672 게임 화면, 저작권 있음 — 외부에 올리지 말 것).
프로젝트 설명은 `CLAUDE.md`(루트)를 먼저 읽을 것.

## 고른 항목과 이유

| # | 항목 | 효과 | 이유 |
|---|---|---|---|
| F1 | 가려진 부분 채우기 개선 (다운로드 없음) | 도안 품질 ↑↑ | 지금은 420px로 줄여 Telea로 메워서 뿌옇고, 앞 물체 모양 얼룩(흐릿한 토끼)이 남는다 |
| F2 | 휴대폰 편집 모드 | 휴대폰 사용성 ↑↑ | 375px에서 캔버스 303×202, 확대 불가, 도구는 캔버스보다 726px 아래, AI "뺄 점"은 Shift 전용 |
| F3 | 작업 저장/불러오기 (자동 저장 + 파일) | 작업 손실 방지 ↑↑ | 새로고침하면 다 사라진다. 휴대폰에서는 탭이 자주 다시 로드된다 |
| F4 | 그림 넣으면 깊이로 레이어 자동 나누기 (선택 AI) | 시작 시간 ↓↓ | 지금은 빈 레이어 4장으로 시작한다 |

미룬 것: MI-GAN AI 채우기(F1 결과를 보고 결정), 레이어로 옮기기(로드맵 4), Vite 분리.

## 진행 방식

1. **각자 사본에서 작업**: 기능마다 `work/base.html`을 `work/<이름>.html`로 복사해 그 파일만 고친다. 본 파일과 다른 기능 사본은 건드리지 않는다.
2. **병합**: 통합 담당이 `git merge-file`로 3-way 병합(본 파일 ← base ← 각 기능)한다. 충돌을 줄이려면 아래 규칙을 지킨다.
   - 새 코드는 가능하면 **새 `/* ---------- 이름 ---------- */` 구역**에 몰아 넣는다.
   - 기존 함수 수정은 꼭 필요한 곳만, 한 줄에 다른 것까지 섞지 않는다. 기존 긴 한 줄을 다시 포맷하지 않는다.
   - 기존 함수에 연결이 필요하면 한 줄짜리 호출(`if(typeof fooHook==='function')fooHook()` 같은)만 추가한다.
3. **테스트**: Playwright(Node)로 헤드리스 확인. 준비된 위치는 `work/tests/README.md`(준비 담당이 작성). 기능마다 `work/tests/<이름>.test.js`를 남겨 통합 후 다시 돌릴 수 있게 한다.
4. **리뷰** → 수정 → GitHub Pages 재배포(`pear205/paper-theater-studio`, `index.html`만) → CLAUDE.md 갱신.

## 공통 규칙

- UI 문구는 한국어 존댓말, 짧고 쉬운 문장. 기존 코드 스타일(촘촘한 한 줄, 짧은 영어 주석)을 따른다.
- OpenCV `Mat`은 반드시 `delete()`.
- AI 기능은 선택 사항. AI 없이 다른 기능이 모두 돌아가야 한다. 모델은 사용자가 그 기능을 고를 때만 받는다(동의 창: 기존 `ask()` 사용). claude.ai Artifact 안(`window.claude.use` 존재)에서는 비활성화.
- 라이브러리는 이미 쓰는 `@huggingface/transformers@3.8.1`(jsDelivr ESM, `AI.T`에 캐시됨)만 쓴다. 새 CDN 라이브러리를 넣지 않는다.
- 되돌리기: 마스크를 바꾸는 작업은 `pushUndo(i, grp, parts, endSession)`를 거친다(여러 레이어면 같은 `grp`).
- 데스크톱 화면과 기존 동작은 바뀌면 안 된다.
- 외부에 게시·푸시하지 않는다(배포는 마지막 단계에서 따로).

## 검토 반영 규칙 (필수, 아래 기능별 범위보다 우선)

**훅과 앵커** — base.html에 이미 들어가 있다.
- `hook(name, fn)`으로 등록하고 `fire(name, ...)`로 부른다. 이벤트 종류:
  - `setup`: `setupImage` 끝
  - `layers`: `renderLayers` 끝
  - `buttons`: `refreshButtons` 끝
  - `render`: `render` 끝
  - `view`: `setView` 끝, 인자 v
  - `opened`: 파일을 열고 난 뒤
- 공용 함수 본문은 고치지 말고 훅에 등록한다.
- 새 코드는 각자 앵커 바로 아래에 넣는다.
  - JS: `/* @F1 js … */` … `/* @F4 js … */`
  - CSS: `/* @Fn css */`
  - HTML: `<!-- @F2 html (bottom bar) -->`, `<!-- @F3 html (card) -->`
- 앵커 사이의 `/* ---- */` 구분 줄은 지우지 않는다.

**한 곳은 한 기능만 고친다**

| 위치 | 담당 |
|---|---|
| 마지막 시작 줄 `sample();refreshButtons();loadCV();` | F3 |
| `saveFile()` | F3 |
| `aiClick` 라벨 처리, `refreshAi()`, `#aiRow` HTML, `#ask`/`#toast` 위치 CSS | F2 |
| `fillHidden()` 시그니처와 그 호출부 | F1 |
| 레이어 카드 `.row`(레이어 추가 줄) | F4 |
| 포인터 핸들러(`view.addEventListener('pointerdown'…)` 등) | F2 |

이 밖의 기존 줄을 꼭 고쳐야 하면 최소한으로 하고, 결과 보고에 정확히 적는다.

**F1**
- 먼저 구멍 전체를 구멍 밖 픽셀만으로 push-pull(다중 해상도) 채운다.
- 그다음 보이는 띠만 Telea 등으로 다듬는다. 구멍 안 원래 픽셀(앞 물체 색)은 어떤 단계의 입력에도 쓰지 않는다.
- 띠 폭은 앞 레이어 j마다 `(z_j−z_i)·tan40°+1mm`이고, 거리는 `cv.distanceTransform`으로 잰다.
- 데스크톱 기준 레이어당 1초 안쪽, 휴대폰은 3~5배 느리다고 본다.
- 새 설정을 추가하지 않는다.

**F2**
- 두 손가락은 `#editWrap`에 capture 단계 리스너를 달아 처리한다. 두 번째 포인터가 오면 `stopPropagation()` 한다.
- 휴대폰 폭에서는 AI 클릭과 다각형 점 추가를 pointerup(탭)에서 실행한다. 이동 거리가 작을 때만 탭으로 본다.
- 첫 손가락으로 시작한 붓 획은 `S.undo.pop()`+`restoreSnap()`으로 취소하고, 다각형은 마지막 점만 지운다.
- transform은 `#view`에만 걸고(`transform-origin:0 0`), `#editWrap`은 `overflow:hidden`.
- 휴대폰에서는 `#ask`와 `#toast`를 막대 높이만큼 위로 올린다.
- 막대에는 상황별 줄을 둔다: 다각형이면 닫기·취소, AI면 새 대상·크기·뺄 점, 붓이면 붓 크기.
- 핀치 테스트는 CDP `Input.dispatchTouchEvent`로 한다.

**F3**
- 복원 여부를 정하기 전에는 자동 저장을 꺼 둔다(`autosaveArmed=false`). 시작 시 `sample()`이 저장본을 덮어쓰지 않게 하기 위해서다.
- 원본 그림은 `setup` 때 한 번만 PNG Blob으로 만든다.
- `drag` 중에는 저장을 미루고, 바뀐 레이어만 다시 인코딩한다.
- 저장 형식에 `version:1`을 넣는다.
- 저장할 값: 레이어 name, z, grow, mask / 설정 widthMm, borderMm, frontMm, smooth, fillHidden, showOthers, showCut.

**F4**
- 모델 후보: `onnx-community/depth-anything-v2-small`, `pipeline('depth-estimation')`.
- 실제 파일 크기를 확인해서 동의 창에 쓴다.
- WebGPU는 `adapter.features.has('shader-f16')`일 때만 fp16, 아니면 wasm q8.
- 상태는 `AI`와 따로 둔다(예: `DEPTH`). 캐시 확인 문자열은 `'depth-anything'`.
- 나누는 방식: `mask_k = band_k ∪ (각 열에서 band_k의 맨 윗점보다 아래 전부)`. 아래 테두리까지 이어져 연결 다리가 필요 없고, 앞 인물 실루엣이 모든 뒤 레이어 윤곽에 들어가지 않는다.
- z는 바꾸지 않는다(되돌리기가 z를 저장하지 않음). 깊이 중앙값 기반 z를 제안 문구로만 보여 줘도 된다.

## 기능별 범위

### F1 가려진 부분 채우기 (`work/fill.html`)
- 손댈 곳: `fillHidden()`, `buildTextures()`의 채우기 부분만.
- 해상도: 420px 축소 대신 원본에 가깝게(예: 긴 변 1000~1400px). 시간 측정해서 레이어당 1초 안쪽 목표.
- 보이는 띠만 정교하게: 레이어 i의 구멍(앞 레이어 합집합) 안에서, 앞 레이어 가장자리로부터 거리 ≤ 띠 폭(= 앞 레이어와의 z 차이 × tan(약 40°) + 1mm, mm→px는 `pxPerMm()`)인 곳은 Telea(또는 더 나은 방법)로, 그보다 안쪽은 주변 색을 매끄럽게 편 채우기(다중 해상도 push-pull 등)로. 앞 물체 실루엣이 얼룩으로 남지 않게.
- 레이어 i에서 실제 쓰이는 영역(`a ∪ edge`) 밖은 계산하지 않아도 된다(속도).
- 결과물: 전후 비교 PNG(예시 그림 + sample1에서 사슴/소녀를 앞 레이어로 잡은 경우)와 시간 측정. `work/fill-compare-*.png`.

### F2 휴대폰 편집 모드 (`work/mobile.html`)
- 화면 폭 767px 이하에서만 바뀐다. 데스크톱은 그대로.
- 화면 아래 고정 도구 막대: 도구(범위/남길/뺄/칠하기/지우개/다각형/AI), 더하기·빼기, 되돌리기·다시 하기, 레이어 고르기(이전/다음 또는 드롭다운), 맞춤(확대 원위치). 기존 버튼의 click을 호출해서 로직을 중복하지 않는다. 상태 반영은 `refreshButtons()` 끝에 한 줄 연결.
- 두 손가락 확대(1~6배)·이동: `#view`에 CSS transform(`pt()`가 getBoundingClientRect를 쓰므로 좌표는 자동으로 맞는다). 두 번째 손가락이 닿으면 첫 손가락으로 시작한 획/드래그는 취소하고 원래대로 돌린다.
- AI "뺄 점" 토글: `#aiRow`에 버튼 추가(모든 화면). 켜면 다음 클릭이 label 0. 휴대폰 막대에도 노출.
- 캔버스를 화면 폭에 가깝게(여백 축소). 막대가 내용을 가리지 않게 아래 여백.

### F3 작업 저장/불러오기 (`work/save.html`)
- 자동 저장: IndexedDB. 원본 그림(PNG/WebP Blob), 레이어(name, z, grow, 마스크 알파 PNG Blob), 설정(widthMm, borderMm, frontMm, smooth, fillHidden, showOthers, showCut). 편집 후 1~2초 디바운스. 힌트·되돌리기 기록은 저장하지 않는다.
- 다시 열 때 저장본이 있으면 `ask()`로 "지난 작업을 이어서 할까요?" [이어서 하기][새로 시작].
- 파일로 저장/불러오기: 새 카드 "작업 저장"에 "파일로 저장"(`.ptheater.json`, 그림·마스크는 dataURL), "파일 불러오기". 저장은 기존 `saveFile()` 경로(Artifact면 downloads)를 쓰되 토스트 문구를 인자로 받게 일반화.
- 모든 저장소 접근은 try/catch. 실패해도 앱은 정상.

### F4 깊이로 레이어 자동 나누기 (`work/split.html`)
- 모델: transformers.js에서 되는 Depth Anything(v2 small 우선) 후보의 파일 크기를 확인하고 가장 작은 쓸 만한 dtype 선택. WebGPU 있으면 사용, 실패 시 wasm.
- 레이어 카드에 "깊이로 자동 나누기 (AI)" 버튼. 처음엔 동의 창. 결과는 되돌리기 한 번에 취소(같은 grp).
- 나누는 방식: **겹쳐 쌓는 방식**(뒤 레이어는 자기보다 앞의 것까지 포함, 예시 그림과 같은 구조). 레이어 k(2..N) 마스크 = 깊이(가까움 값) ≥ 임계값_k. 임계값은 깊이 분포에서 자동(분위수 또는 히스토그램 골짜기). 1번 뒤판은 그대로. 결과는 손으로 자르기 쉽게 정리(작은 조각 제거, 구멍 메우기).
- 기존 마스크가 있으면 덮어쓰기 전에 `ask()`로 확인.
- 결과물: 예시 그림과 sample1에서 나눈 결과 PNG(`work/split-*.png`), 모델 크기·시간.
