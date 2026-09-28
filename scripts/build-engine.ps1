# Builds the engine Crema bundles into src-tauri/engine: the pinned crema-engine source (without its
# tests), a private Python with the engine's packages, and the engine's Korean/CJK search tokenizer as
# lib\fts5_cjk.dll. Every installer build runs it (Tauri's beforeBuildCommand); it does nothing when the
# pinned engine is already there. Needs git, uv and the Visual Studio C++ build tools.
$ErrorActionPreference = "Stop"
$engineCommit = "67296f4b9cbb6b19455f1a8c18b670169c6546d3"
$pythonVersion = "3.12.13"

$root = Split-Path $PSScriptRoot
$out = Join-Path $root "src-tauri\engine"
$stamp = Join-Path $out "engine.commit"
$pinned = "$engineCommit python-$pythonVersion"
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

Set-Content $stamp $pinned
