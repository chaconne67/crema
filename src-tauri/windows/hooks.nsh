; Installs Hermes after Crema when this PC has none, where the app looks for it
; (HERMES_HOME, else %LOCALAPPDATA%\hermes). Uses Hermes' official Windows installer,
; pinned to the Hermes version this app was tested with.
!define HERMES_COMMIT "a25cf4d77d46733767b91d5a410e701f4596541e"

!macro NSIS_HOOK_POSTINSTALL
  Push $0
  Push $1
  ReadEnvStr $0 HERMES_HOME
  StrCmp $0 "" 0 +2
  StrCpy $0 "$LOCALAPPDATA\hermes"
  IfFileExists "$0\bin\hermes.cmd" hermes_done

  DetailPrint "Hermes 설치 중 (인터넷 연결 필요, 몇 분 걸립니다)"
  ; Everything Hermes' installer prints goes to a log, so a failure on someone else's PC can be read.
  ; PSModulePath is reset first: started from PowerShell 7 (a terminal, VS Code), Windows PowerShell
  ; inherits 7's module path and its own modules fail to load (Hermes' uv step then fails).
  ExecWait `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "$$env:PSModulePath = [Environment]::GetEnvironmentVariable('PSModulePath', 'Machine'); Start-Transcript -Path '$TEMP\crema-hermes-install.log' -Force | Out-Null; try { & ([scriptblock]::Create((Invoke-RestMethod 'https://raw.githubusercontent.com/NousResearch/hermes-agent/${HERMES_COMMIT}/scripts/install.ps1'))) -NonInteractive -SkipSetup -Commit ${HERMES_COMMIT} } catch { Write-Host ('FAILED: ' + $$_) }; Stop-Transcript | Out-Null"` $1
  ; Installed means present where the app looks, whatever the script's exit code says.
  IfFileExists "$0\bin\hermes.cmd" hermes_done
  MessageBox MB_ICONEXCLAMATION "Hermes 설치를 마치지 못했습니다.$\r$\n기록: $TEMP\crema-hermes-install.log$\r$\n$\r$\nPowerShell에서 아래 명령으로 직접 설치해 주세요.$\r$\niex (irm https://hermes-agent.nousresearch.com/install.ps1)" /SD IDOK
  SetErrorLevel 2
  hermes_done:
  Pop $1
  Pop $0
!macroend
