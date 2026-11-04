<#
  Claude Mind — setup bootstrap (Windows)

  Run once after downloading:
      powershell -ExecutionPolicy Bypass -File setup.ps1
  or just double-click setup.bat

  Windows parity for setup.sh, which is bash-only and therefore unusable on the
  platform this vault is most often installed on. Does the same deterministic pre-work:
    1. Preflight checks (Node, npm, claude CLI)
    2. npm install (compiles native deps for THIS machine)
  Then hands off to Claude Code, which runs the personalized part.
#>
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host ""
Write-Host "== Claude Mind setup ==" -ForegroundColor Cyan
Write-Host ""

# Node has to exist before preflight can run, and preflight is itself a node script,
# so this one check cannot be delegated to it.
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "Node.js is not installed or not on PATH." -ForegroundColor Red
  Write-Host "  Install the LTS build from https://nodejs.org, reopen this window, and run setup again."
  exit 1
}
$nodeMajor = [int]((node --version) -replace '^v(\d+)\..*$', '$1')
if ($nodeMajor -lt 20) {
  Write-Host "Node $(node --version) is too old; this needs Node 20 or newer." -ForegroundColor Red
  Write-Host "  Install the LTS build from https://nodejs.org, then run setup again."
  exit 1
}

Write-Host "[1/2] Preflight checks..."
node scripts/preflight.mjs
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "Preflight found problems. Fix the items above, then run setup again." -ForegroundColor Yellow
  exit 1
}

Write-Host ""
Write-Host "[2/2] Installing dependencies (compiles native modules; takes a few minutes)..."
npm install
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "npm install failed." -ForegroundColor Red
  Write-Host "  Most common cause on Windows: no C++ build tools for the native modules."
  Write-Host "  Install 'Desktop development with C++' from the Visual Studio Build Tools, then retry."
  exit 1
}

Write-Host ""
Write-Host "Fetching the embedding model if it is not already here..."
node scripts/fetch-model.mjs
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host ""
Write-Host "====================================================================" -ForegroundColor Green
Write-Host " Bootstrap complete."
Write-Host ""
Write-Host " Next: open Claude Code in this folder:"
Write-Host "     claude"
Write-Host ""
Write-Host " It will notice the vault isn't configured and start the setup"
Write-Host " interview on its own. You don't need to say anything special."
Write-Host " (If you want to trigger it explicitly, say: run setup)"
Write-Host "====================================================================" -ForegroundColor Green
