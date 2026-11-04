$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodeExe) {
    $bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    if (Test-Path -LiteralPath $bundledNode) { $nodeExe = $bundledNode }
}
if (-not $nodeExe) { throw 'Please install Node.js 24 LTS from https://nodejs.org and run again.' }
$major = [int]((& $nodeExe -p 'process.versions.node.split(".")[0]') | Select-Object -Last 1)
if ($major -lt 22) { throw 'Node.js 22.13+ is required. Node.js 24 LTS is recommended.' }
if (-not (Test-Path -LiteralPath 'node_modules\express') -or -not (Test-Path -LiteralPath 'node_modules\@tabler\core\dist\css\tabler.min.css')) {
    $npmCli = Join-Path (Split-Path $nodeExe) 'node_modules\npm\bin\npm-cli.js'
    $bundledPnpm = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd'
    if (Test-Path -LiteralPath $npmCli) { & $nodeExe $npmCli install --ignore-scripts --no-audit --no-fund }
    elseif (Get-Command npm -ErrorAction SilentlyContinue) { npm install --ignore-scripts --no-audit --no-fund }
    elseif (Test-Path -LiteralPath $bundledPnpm) { & $bundledPnpm install --frozen-lockfile }
    else { throw 'npm or pnpm is required for the first dependency installation.' }
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
try { $health = Invoke-RestMethod 'http://localhost:3210/api/health' -TimeoutSec 2 } catch { $health = $null }
if ($health.status -eq 'ok') { Start-Process 'http://localhost:3210'; Write-Host 'WareFlow is already running.'; exit }
Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+(Join-Path $PSScriptRoot 'tools\open_when_ready.ps1')+'"'))
& $nodeExe src/server.js
