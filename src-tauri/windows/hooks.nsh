; Installs Hermes after Agent Client when this PC has none, where the app looks for it
; (HERMES_HOME, else %LOCALAPPDATA%\hermes). Uses Hermes' official Windows installer,
; pinned to the Hermes version this app was tested with.
!define HERMES_COMMIT "a25cf4d77d46733767b91d5a410e701f4596541e"

!macro NSIS_HOOK_POSTINSTALL
  Push $0
  Push $1
  ReadEnvStr $0 HERMES_HOME
  StrCmp $0 "" +2
  IfFileExists "$0\bin\hermes.cmd" hermes_done
  IfFileExists "$LOCALAPPDATA\hermes\bin\hermes.cmd" hermes_done

  DetailPrint "Hermes 설치 중 (인터넷 연결 필요, 몇 분 걸립니다)"
  ExecWait `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create((Invoke-RestMethod 'https://raw.githubusercontent.com/NousResearch/hermes-agent/${HERMES_COMMIT}/scripts/install.ps1'))) -NonInteractive -SkipSetup -Commit ${HERMES_COMMIT}"` $1
  StrCmp $1 "0" hermes_done
  MessageBox MB_ICONEXCLAMATION "Hermes 설치를 마치지 못했습니다.$\r$\n$\r$\nPowerShell에서 아래 명령으로 직접 설치해 주세요.$\r$\niex (irm https://hermes-agent.nousresearch.com/install.ps1)" /SD IDOK
  hermes_done:
  Pop $1
  Pop $0
!macroend
