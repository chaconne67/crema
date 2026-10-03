# Builds the Thock that Crema's 9,900원 plan builds in, into src-tauri/thock: the pinned chaconne67/thock commit,
# built the way Thock's own installer builds it (its .github/workflows/windows-installer.yml "Build app": PyInstaller
# with its own Python). Every installer build runs it (Tauri's beforeBuildCommand); it does nothing when the pinned
# Thock is already there. Needs git and uv.
$ErrorActionPreference = "Stop"
$thockCommit = "1a913e6d9e2019089eccc9edb71a59a111a16083"

$root = Split-Path $PSScriptRoot
$out = Join-Path $root "src-tauri\thock"
$stamp = Join-Path $out "thock.commit"
if ((Test-Path $stamp) -and ((Get-Content $stamp -Raw).Trim() -eq $thockCommit)) { return }

function Run {
  & $args[0] $args[1..($args.Length - 1)]
  if ($LASTEXITCODE) { throw "failed ($LASTEXITCODE): $args" }
}

if (Test-Path $out) { Remove-Item $out -Recurse -Force }
$repo = Join-Path ([System.IO.Path]::GetTempPath()) "thock-$([guid]::NewGuid())"
$src = "$repo-src"
Run git init -q --bare $repo
Run git -C $repo fetch -q --depth 1 https://github.com/chaconne67/thock.git $thockCommit
New-Item -ItemType Directory $src | Out-Null
Run git -C $repo archive -o "$repo.tar" $thockCommit
Run "$env:SystemRoot\System32\tar.exe" -xf "$repo.tar" -C $src
Push-Location $src
try {
  Run uv run --with pyinstaller pyinstaller --noconfirm --windowed --name Thock --add-data "thock/settings.html;thock" `
    --add-data "thock/welcome.html;thock" --add-data "thock/recovery.html;thock" --add-data "thock/sounds;thock/sounds" `
    --add-data "thock/fonts;thock/fonts" voicetype.py
} finally { Pop-Location }
Copy-Item "$src\dist\Thock" $out -Recurse
Set-Content -Path $stamp -Value $thockCommit -Encoding ascii
Remove-Item $src, $repo, "$repo.tar" -Recurse -Force
