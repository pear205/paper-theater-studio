# 페이퍼시어터 공방

그림 한 장을 레이어로 나눠서, 손으로 오려 쌓는 입체 종이극장(페이퍼시어터) 도안을 만드는 브라우저 툴이에요.

## 바로 써보기

**https://pear205.github.io/paper-theater-studio/** 에서 바로 쓸 수 있어요(휴대폰도 돼요).

내려받아 쓰려면 `prototype/paper-theater-studio.html` 파일을 크롬에서 열면 돼요. 인터넷 연결이 필요해요(OpenCV.js, jsPDF, AI 모델을 CDN에서 불러와요). AI 모델을 브라우저에 저장해 두려면 파일을 바로 열지 말고 폴더에서 `python -m http.server`로 열어 주세요.

1. **이미지 열기**로 그림을 불러와요. 기본으로 레이어 5장이 만들어져요.
2. 오른쪽에서 레이어를 고르고, **범위 지정**으로 대상을 드래그하면 경계를 자동으로 찾아요.
   - 빠진 부분은 **남길 곳**(초록), 같이 잡힌 배경은 **뺄 곳**(빨강)으로 칠하면 다시 계산해요.
   - 땅이나 언덕처럼 넓은 면은 **다각형**이 편해요.
3. **3D 미리보기**에서 결과를 확인하고, 레이어 거리(mm)와 단순화 정도를 조정해요.
4. **도안 PDF 저장**을 눌러요.

## 출력과 조립

- 160~200g 매트지에 **실제 크기(100%)**로 출력해요. 각 쪽 아래의 50mm 눈금으로 배율을 확인하세요.
- 안쪽 구멍부터 파내고 바깥 빨간 선은 나중에 잘라요.
- 클립 4개를 오려 홈을 파고, 레이어 1(뒤판)부터 순서대로 끼워요.

## 폴더

| 경로 | 내용 |
|---|---|
| `index.html` | GitHub Pages 첫 화면 (`prototype/paper-theater-studio.html`로 이동) |
| `prototype/` | 현재 동작하는 단일 파일 MVP와 예시 도안 PDF |
| `prototype/work/` | 작업 계획(`PLAN.md`)과 Playwright 테스트(`tests/`) |
| `reference/python/` | 처음 Python으로 만든 레이어 분리·예상도 스크립트 |
| `reference/e2e/` | Playwright 동작 확인 스크립트 |
| `CLAUDE.md` | Claude Code용 개발 문서 (기능, 알려진 버그, 로드맵, 추천 구조) |

## 라이선스

[MIT](LICENSE) 라이선스예요. 누구나 무료로 쓰고, 고치고, 다시 배포하고, 상업적으로도 쓸 수 있어요. 저작권 표시와 라이선스 문구만 남겨 주세요.

앱이 실행할 때 CDN에서 불러오는 라이브러리와 AI 모델은 이 저장소에 들어 있지 않고, 각자의 라이선스를 따라요. 모두 무료로 쓸 수 있는 라이선스예요.

| 이름 | 용도 | 라이선스 |
|---|---|---|
| [OpenCV.js](https://www.npmjs.com/package/@techstark/opencv-js) (`@techstark/opencv-js`) | 경계 찾기, 단순화, 채우기 | Apache-2.0 |
| [jsPDF](https://github.com/parallax/jsPDF) | PDF 도안 | MIT |
| [Transformers.js](https://github.com/huggingface/transformers.js) (`@huggingface/transformers`) | AI 모델 실행 | Apache-2.0 |
| [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) (Transformers.js가 함께 불러옴) | AI 모델 계산 | MIT |
| [SlimSAM](https://huggingface.co/Xenova/slimsam-77-uniform) (`Xenova/slimsam-77-uniform`) | AI 클릭 선택 | Apache-2.0 |
| [Depth Anything V2 Small](https://huggingface.co/onnx-community/depth-anything-v2-small) | 깊이 자동 나누기 | Apache-2.0 |
| [Do Hyeon](https://fonts.google.com/specimen/Do+Hyeon), [IBM Plex Sans KR](https://fonts.google.com/specimen/IBM+Plex+Sans+KR), [IBM Plex Mono](https://fonts.google.com/specimen/IBM+Plex+Mono) (Google Fonts) | 화면·도안 글꼴 | SIL OFL 1.1 |

이 저장소는 위 라이브러리·모델·글꼴의 파일을 직접 담거나 고쳐서 배포하지 않아요. 사용자의 브라우저가 각 CDN(jsDelivr, cdnjs, Hugging Face, Google Fonts)에서 원래 파일을 그대로 받아요. 나중에 이 파일들을 저장소에 직접 넣어 배포하게 되면, 각 라이선스 원문(Apache-2.0은 NOTICE 파일 포함)을 함께 넣어야 해요.

## 다음 단계

알려진 버그와 로드맵은 `CLAUDE.md`에 정리돼 있어요. Claude Code에서 이 폴더를 열고 "CLAUDE.md 읽고 로드맵 1번부터 진행해줘"라고 시작하면 돼요.
