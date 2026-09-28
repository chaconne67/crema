# Builds the engine Crema bundles into src-tauri/engine: the pinned crema-engine source (without its
# tests), a private Python with the engine's packages, the engine's Korean/CJK search tokenizer as
# lib\fts5_cjk.dll and its meaning search model in model\. Every installer build runs it (Tauri's
# beforeBuildCommand); it does nothing when the pinned engine is already there. Needs git, uv and the
# Visual Studio C++ build tools.
$ErrorActionPreference = "Stop"
$engineCommit = "f927da680a85f13a0934cbc575dbfbcb4b068eea"
$pythonVersion = "3.12.13"
# Built by scripts/embedding-model/build.py and kept as assets of this release, checked by SHA-256.
$modelRelease = "models-koen-e5-tiny-int8"
$modelFiles = @{
  "model.onnx" = "984bebe2ffd3ad4b8ac331742000ef425dd0093cb42da23ed33522f2f8329901"
  "tokenizer.json" = "a6dd38d692ac1caa6d5dbc195d92f1f978b5c74ec60e02ed15fdf04404742fe3"
  "NOTICE.txt" = "28063ad388cf2f0a578f9c9a3485f71d00646fe9898fa2a9df5b6efdb4ab56ae"
}

$root = Split-Path $PSScriptRoot
$out = Join-Path $root "src-tauri\engine"
$stamp = Join-Path $out "engine.commit"
$pinned = "$engineCommit python-$pythonVersion $modelRelease"
if ((Test-Path $stamp) -and ((Get-Content $stamp -Raw).Trim() -eq $pinned)) { return }

function Run {
  & $args[0] $args[1..($args.Length - 1)]
  if ($LASTEXITCODE) { throw "failed ($LASTEXITCODE): $args" }
}

if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory "$out\src" | Out-Null

# Only the pinned commit, into a fresh temporary repository: nothing is reused from an earlier build
# (a copy kept under target/ was left broken by the CI build cache).
$repo = Join-Path ([System.IO.Path]::GetTempPath()) "crema-engine-$([guid]::NewGuid())"
Run git init -q --bare $repo
Run git -C $repo fetch -q --depth 1 https://github.com/chaconne67/crema-engine.git $engineCommit
$tar = "$repo.tar"
Run git -C $repo archive -o $tar $engineCommit
Run "$env:SystemRoot\System32\tar.exe" -xf $tar -C "$out\src" --exclude=tests --exclude=.github
Remove-Item $tar, $repo -Recurse -Force

Run uv python install $pythonVersion
$python = Split-Path (& uv python find $pythonVersion --managed-python)
Copy-Item $python "$out\python" -Recurse
Run uv pip install --python "$out\python\python.exe" --break-system-packages -r "$out\src\pyproject.toml" --extra crema

# The engine loads it from HERMES_FTS5_CJK_SO (src-tauri/src/lib.rs); without it short Korean searches
# of past chats scan every message.
$vs = & "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * `
  -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) { throw "the Visual Studio C++ build tools are needed for fts5_cjk.dll" }
$cjk = "$out\src\native\fts5_cjk"
New-Item -ItemType Directory "$out\lib" | Out-Null
$build = Join-Path ([System.IO.Path]::GetTempPath()) "fts5-cjk-$([guid]::NewGuid())"
New-Item -ItemType Directory $build | Out-Null
Set-Content "$build\build.cmd" -Encoding ascii @(
  "@call `"$vs\VC\Auxiliary\Build\vcvars64.bat`" >nul || exit /b 1",
  "cl /nologo /O2 /LD /I`"$cjk\vendor`" `"$cjk\fts5_cjk.c`" /Fe`"$out\lib\fts5_cjk.dll`""
)
Push-Location $build
try { Run cmd /c "$build\build.cmd" } finally { Pop-Location; Remove-Item $build -Recurse -Force }

# The engine loads it from CREMA_EMBED_MODEL (src-tauri/src/lib.rs); without it the knowledge notebook
# finds pages by words only.
New-Item -ItemType Directory "$out\model" | Out-Null
foreach ($name in $modelFiles.Keys) {
  Invoke-WebRequest "https://github.com/chaconne67/crema/releases/download/$modelRelease/$name" -OutFile "$out\model\$name"
  # .NET directly: Get-FileHash is not found when this Windows PowerShell runs under the CI's pwsh.
  $bytes = [System.Security.Cryptography.SHA256]::Create().ComputeHash([System.IO.File]::ReadAllBytes("$out\model\$name"))
  $hash = -join ($bytes | ForEach-Object { $_.ToString("x2") })
  if ($hash -ne $modelFiles[$name]) { throw "model file $name has SHA-256 $hash, not $($modelFiles[$name])" }
}

Set-Content $stamp $pinned
