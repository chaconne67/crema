# Crema

AI 에이전트와 대화하는 Windows 데스크톱 앱입니다. 폴더(프로젝트)마다 대화를 나눠 두고, 에이전트가 그 폴더에서 일하게 할 수 있습니다.

에이전트 엔진이 앱 안에 들어 있어 따로 설치할 것이 없습니다. 엔진은 [Hermes Agent](https://github.com/NousResearch/hermes-agent)(MIT)를 Crema에 필요한 부분만 남겨 고친 [crema-engine](https://github.com/chaconne67/crema-engine/tree/crema)입니다.

## 다운로드

**[Windows 설치 파일 받기 (Crema-setup-x64.exe)](https://github.com/chaconne67/crema/releases/latest/download/Crema-setup-x64.exe)**

- 모든 버전과 변경 내용: [Releases](https://github.com/chaconne67/crema/releases)
- 지원: Windows 10·11 64비트

## 설치

1. 받은 `Crema-setup-x64.exe`를 실행합니다.
2. "Windows의 PC 보호" 창이 뜨면 **추가 정보 → 실행**을 누릅니다. 설치 파일에 아직 코드 서명이 없어서 나오는 경고입니다.
3. 설치에 인터넷이나 다른 프로그램(git, Python, Hermes)이 필요 없습니다.

PC에 따로 설치한 Hermes가 있어도 Crema는 그것을 읽거나 바꾸지 않습니다. Crema 엔진의 데이터(대화 세션, Provider 로그인, API 키)는 `%LOCALAPPDATA%\local.agentclient.prototype\engine`에 따로 둡니다.

이전 이름인 **Agent Client**(0.1.0)를 설치했다면, Crema를 설치한 뒤 Windows 설정 → 앱에서 Agent Client를 제거하세요. 대화 기록과 설정은 Crema에서 그대로 이어집니다.

## 처음 실행할 때

1. 구글 계정으로 Crema에 로그인합니다(처음 한 번).
2. 대화에 쓸 AI를 연결합니다. 오른쪽 위 설정 버튼 → 고급 → **Provider** → **Provider 추가**에서 AI를 고릅니다.
   - Gemini·Groq·OpenRouter(무료 키), ChatGPT 구독, Claude 구독은 **Crema가 안내하며 연결**을 누르면 됩니다. Crema가 가입·로그인 화면을 대화창 안에 열고, 지금 몇 단계인지와 누를 곳을 짚어 주며, 만든 키나 코드를 Crema에 넣고 실제로 되는지 확인하기까지 안내합니다. 막히면 **막혔어요**를 누르세요.
   - 그 밖의 AI는 같은 곳에서 로그인하거나 API 키를 넣습니다. 많이 쓰는 AI(ChatGPT, Claude, Gemini, Grok, GitHub Copilot, Meta AI)가 먼저 보이고, 나머지 40여 개는 "여러 AI를 한 곳에서", "오픈소스 모델 서비스", "중국 AI" 등으로 접혀 있습니다. 이름으로 찾을 수도 있습니다.
   - Crema는 PC에 있는 다른 프로그램(Claude Code, GitHub CLI 등)의 로그인을 가져다 쓰지 않습니다. Crema에서 직접 추가한 것만 쓰입니다.
3. 이미지 생성·동영상 생성·웹 검색은 설정 → **서비스 연동**에서 연결합니다. OpenRouter로 연결하면 이미지·동영상 모델을 고를 수 있고, 웹 검색은 연결하지 않아도 무료 기본 검색으로 쓸 수 있고, Brave로 바꿀 수도 있습니다.
4. 모델과 추론 강도는 설정 → 고급 → **AI**에서 고릅니다.

받아쓰기(음성 입력)는 OpenAI·Groq·xAI 키 중 하나가 연결되면 켜집니다.

입력창에서 `- `, `1. `로 시작한 줄은 Shift+Enter를 누르면 다음 항목이 이어지고, 빈 항목에서 누르면 목록이 끝납니다.

## 주요 기능

- **프로젝트**: 폴더를 추가하면 그 폴더에서 일하는 대화를 따로 모아 둡니다. 폴더 색을 고를 수 있습니다.
- **고정**: 자주 보는 대화를 사이드바 맨 위에 붙여 둡니다.
- **보관**: 대화를 지우지 않고 목록에서 치워 둡니다. 보관함에서 누르면 꺼내져서 열리고, 영구 삭제도 보관함에서만 합니다.
- **답변 표시**: 답변을 쓰는 중에는 대화 옆에 스피너가, 다른 대화를 보는 동안 끝난 답변에는 파란 점이 표시됩니다.
- **첨부**: 파일과 이미지를 끌어다 놓아 함께 보낼 수 있습니다.
- **기억**: 대화에서 배운 것(나에 대해·에이전트 메모·배운 방법)과 일하며 배운 지식(겪은 문제와 해결·고쳐 준 점·결정과 이유·하는 일·찾아 둔 자료)을 이 PC에 남겨 다음 대화에서 찾아 씁니다. 적힌 말과 다르게 물어도 뜻이 같으면 찾습니다. 설정 → **기억**에서 보고 고치고 지울 수 있습니다. 지운 지식은 같은 화면의 **지운 지식**에서 사흘 안에 되돌릴 수 있고, 에이전트가 다시 살려 내지 않습니다. 지난 대화 찾기와 백업도 여기서 합니다.
- **일하는 방식**: 에이전트는 모르는 것을 지어내지 않고, 바꾸기 전 상태를 지키며, 오류를 고칠 때는 증상과 원인을 나눠 따진 뒤 해결합니다. 페르소나(말투)와 따로 늘 적용됩니다.
- **대화끼리 차례 지키기**: 두 대화가 같은 파일을 고치려 하면 한쪽이 기다리고 사이드바에 **대기**로 보입니다. 먼저 한 대화가 커밋하거나 일을 마치면 기다리던 대화가 저절로 이어서 일합니다. 기다리지 않게 하려면 카드의 **기다리지 않기**를 누릅니다.
- **모양**: 밝게·어둡게 테마, 글꼴·글자 크기·행간, 글자색·배경색을 바꿀 수 있습니다.

## 제거

Windows 설정 → 앱에서 **Crema**를 제거합니다.

## 개발

필요한 것: Node.js, Rust(stable), git, [uv](https://docs.astral.sh/uv/), Windows에서 빌드하려면 Microsoft C++ Build Tools

엔진은 빌드할 때 [scripts/build-engine.ps1](scripts/build-engine.ps1)이 고정된 crema-engine 커밋과 전용 Python으로 `src-tauri/engine`에 만듭니다(개발 모드와 설치 파일 빌드가 같은 스크립트를 씁니다).

```bash
npm install
```

개발 모드로 실행합니다.

```bash
npm run tauri dev
```

테스트를 실행합니다.

```bash
npm test
```

설치 파일을 만듭니다. 결과는 `src-tauri/target/release/bundle/nsis/`에 생깁니다.

```bash
npm run tauri build -- --bundles nsis
```

## 라이선스 안내

사용한 아이콘·글꼴의 라이선스는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)와 [public/licenses](public/licenses)에 있습니다. 엔진(Hermes Agent, MIT)의 라이선스는 설치 폴더의 `engine\src\LICENSE`에 함께 들어갑니다.
