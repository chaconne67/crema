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
2. 오른쪽 위 설정 버튼 → **Provider**에서 쓸 AI 서비스에 로그인하거나 API 키를 넣습니다.
   - ChatGPT 구독, Claude 구독·API 키, OpenAI·Gemini·OpenRouter API 키
   - Claude 구독 로그인에는 [Claude Code](https://claude.com/claude-code)가 필요합니다.
3. **AI**에서 모델과 추론 강도를 고릅니다.

음성 입력은 OpenAI API 키가 있으면 그 키로 받아씁니다.

## 주요 기능

- **프로젝트**: 폴더를 추가하면 그 폴더에서 일하는 대화를 따로 모아 둡니다. 폴더 색을 고를 수 있습니다.
- **고정**: 자주 보는 대화를 사이드바 맨 위에 붙여 둡니다.
- **보관**: 대화를 지우지 않고 목록에서 치워 둡니다. 보관함에서 누르면 꺼내져서 열리고, 영구 삭제도 보관함에서만 합니다.
- **답변 표시**: 답변을 쓰는 중에는 대화 옆에 스피너가, 다른 대화를 보는 동안 끝난 답변에는 파란 점이 표시됩니다.
- **첨부**: 파일과 이미지를 끌어다 놓아 함께 보낼 수 있습니다.
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
