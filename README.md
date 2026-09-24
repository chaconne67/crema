# Agent Client

Hermes 에이전트와 대화하는 Windows 데스크톱 앱입니다. 폴더(프로젝트)마다 대화를 나눠 두고, 에이전트가 그 폴더에서 일하게 할 수 있습니다.

## 다운로드

**[Windows 설치 파일 받기 (AgentClient-setup-x64.exe)](https://github.com/chaconne67/crema/releases/latest/download/AgentClient-setup-x64.exe)**

- 모든 버전과 변경 내용: [Releases](https://github.com/chaconne67/crema/releases)
- 지원: Windows 10·11 64비트

## 설치

1. 받은 `AgentClient-setup-x64.exe`를 실행합니다.
2. "Windows의 PC 보호" 창이 뜨면 **추가 정보 → 실행**을 누릅니다. 설치 파일에 아직 코드 서명이 없어서 나오는 경고입니다.
3. 설치가 끝나면 PC에 Hermes가 있는지 확인합니다.
   - **있으면** 그대로 씁니다. 기존 Hermes와 설정은 건드리지 않습니다.
   - **없으면** Hermes 공식 Windows 설치 스크립트가 바로 이어서 실행됩니다. PowerShell 창에 진행 상황이 보이며, 인터넷 연결이 필요하고 몇 분 걸립니다.
   - Hermes를 찾는 곳: `HERMES_HOME`이 설정되어 있으면 그 폴더, 아니면 `%LOCALAPPDATA%\hermes`
4. Hermes 설치가 실패하면 안내 창이 뜹니다. PowerShell에서 아래 명령으로 직접 설치할 수 있습니다.

```powershell
iex (irm https://hermes-agent.nousresearch.com/install.ps1)
```

함께 설치되는 Hermes는 이 앱과 함께 검증한 버전(`a25cf4d`)으로 고정되어 있습니다.

## 처음 실행할 때

오른쪽 위 설정 버튼을 눌러 연결과 Provider를 정합니다.

1. **연결**
   - **이 PC**: 이 PC의 Hermes를 씁니다. **Hermes 연결 켜기**를 누르면 앱이 Hermes에 연결 설정을 더하고 다시 시작합니다.
   - **메인서버**: 다른 서버의 Hermes를 SSH 터널로 씁니다. 그 서버에 SSH로 접속할 수 있어야 하며, 메인서버 Hermes API 키를 입력합니다. 키는 Windows 자격 증명 관리자에만 저장됩니다.
2. **Provider**: 쓸 AI 서비스에 로그인하거나 API 키를 넣습니다.
3. **AI**: 모델과 추론 강도를 고릅니다.

## 주요 기능

- **프로젝트**: 폴더를 추가하면 그 폴더에서 일하는 대화를 따로 모아 둡니다. 폴더 색을 고를 수 있습니다.
- **고정**: 자주 보는 대화를 사이드바 맨 위에 붙여 둡니다.
- **보관**: 대화를 지우지 않고 목록에서 치워 둡니다. 보관함에서 누르면 꺼내져서 열리고, 영구 삭제도 보관함에서만 합니다.
- **답변 표시**: 답변을 쓰는 중에는 대화 옆에 스피너가, 다른 대화를 보는 동안 끝난 답변에는 파란 점이 표시됩니다.
- **첨부**: 파일과 이미지를 끌어다 놓아 함께 보낼 수 있습니다.
- **모양**: 밝게·어둡게 테마, 글꼴·글자 크기·행간, 글자색·배경색을 바꿀 수 있습니다.

## 제거

Windows 설정 → 앱에서 **Agent Client**를 제거합니다. Hermes는 따로 설치된 프로그램이라 함께 지워지지 않습니다.

## 개발

필요한 것: Node.js, Rust(stable), Windows에서 빌드하려면 Microsoft C++ Build Tools

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

Hermes 함께 설치 단계는 [src-tauri/windows/hooks.nsh](src-tauri/windows/hooks.nsh)에 있습니다.

## 라이선스 안내

사용한 아이콘·글꼴의 라이선스는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)와 [public/licenses](public/licenses)에 있습니다.
