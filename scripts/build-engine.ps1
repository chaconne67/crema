# Builds the engine Crema bundles into src-tauri/engine: the pinned crema-engine source (without its
# tests) and a private Python with the engine's packages. Every installer build runs it (Tauri's
# beforeBuildCommand); it does nothing when the pinned engine is already there. Needs git and uv.
$ErrorActionPreference = "Stop"
$engineCommit = "458f677c97e509f42a007824963520136188259a"
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

Set-Content $stamp $pinned
