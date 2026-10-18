param([string]$Mode = '')
$ErrorActionPreference = 'Stop'
$env:PATH = 'C:\Users\11585\AppData\Local\Qianwen\User Data\qwen-agent\resources\bins;' + $env:PATH
$root = 'D:\Documents\qwen-agent\ajBjhW5orS\default\SC6113\D-integration'
$scripts = Join-Path $root 'scripts'

function Port-Up([int]$port) {
  [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}
function Stop-Port([int]$port) {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if ($conns) {
    $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($p in $pids) {
      Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
  }
}

Write-Host '===== Step 1/5: local chain on port 8546 ====='
if (-not (Port-Up 8546)) {
  Write-Host 'Chain NOT running. Opening its window...'
  Start-Process powershell.exe -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $scripts 'chain-window.ps1'),'auto'
  $ok = $false
  for ($i = 0; $i -lt 40; $i++) {
    if (Port-Up 8546) { $ok = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ok) { Write-Host 'FAILED: chain did not start in 40s. Screenshot the chain window.'; exit 1 }
} else {
  Write-Host 'Chain already running.'
}

Write-Host '===== Step 2/5: deploy contracts and seed roles ====='
Set-Location (Join-Path $root 'contracts')
$env:SEED_DEMO = 'true'
& node node_modules\hardhat\internal\cli\cli.js run scripts\deploy.js --network localhost
if ($LASTEXITCODE -ne 0) { Write-Host 'FAILED: deploy. Screenshot this window.'; exit 1 }

Write-Host '===== Step 3/5: sync new contract addresses into configs ====='
$dep = Get-Content (Join-Path $root 'contracts\deployments\localhost.json') -Raw | ConvertFrom-Json
$rm = $dep.contracts.RoleManager.address
$pe = $dep.contracts.ProjectEscrow.address
$dm = $dep.contracts.DisputeManager.address
Write-Host "RoleManager    $rm"
Write-Host "ProjectEscrow  $pe"
Write-Host "DisputeManager $dm"
$envPath = Join-Path $root 'backend\.env'
$lines = Get-Content $envPath
$out = foreach ($ln in $lines) {
  if ($ln -match '^ROLE_MANAGER_ADDRESS=')    { "ROLE_MANAGER_ADDRESS=$rm" }
  elseif ($ln -match '^PROJECT_ESCROW_ADDRESS=') { "PROJECT_ESCROW_ADDRESS=$pe" }
  elseif ($ln -match '^DISPUTE_MANAGER_ADDRESS=') { "DISPUTE_MANAGER_ADDRESS=$dm" }
  else { $ln }
}
Set-Content -Path $envPath -Value $out -Encoding UTF8
$fePath = Join-Path $root 'frontend\src\contracts\localhost.json'
$fe = Get-Content $fePath -Raw | ConvertFrom-Json
$fe.contracts.RoleManager.address = $rm
$fe.contracts.ProjectEscrow.address = $pe
$fe.contracts.DisputeManager.address = $dm
$fe | ConvertTo-Json -Depth 5 | Set-Content -Path $fePath -Encoding UTF8
Write-Host 'Backend .env and frontend localhost.json updated with the new addresses.'

Write-Host '===== Step 4/5: restart backend (3001) and frontend (5173) cleanly ====='
Stop-Port 3001
Stop-Port 5173
$data = Join-Path $root 'backend\data'
if (Test-Path $data) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $dst = "D:\Documents\qwen-agent\ajBjhW5orS\default\backup-D-smoke-db\reset-$stamp"
  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  Move-Item -LiteralPath $data -Destination $dst -Force
  Write-Host "Old demo database moved to backup: $dst"
} else {
  Write-Host 'No old database; a clean one is created on backend start.'
}
Start-Process powershell.exe -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $scripts 'backend-window.ps1'),'auto'
Start-Process powershell.exe -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $scripts 'frontend-window.ps1'),'auto'
$ok = $false
for ($i = 0; $i -lt 60; $i++) {
  try {
    $h = Invoke-RestMethod -Uri http://localhost:3001/health -TimeoutSec 2
    if ($h.status -eq 'ok') { $ok = $true; break }
  } catch { }
  Start-Sleep -Seconds 1
}
if (-not $ok) { Write-Host 'FAILED: backend not healthy in 60s. Screenshot the backend window.'; exit 1 }
Write-Host 'Backend healthy, frontend window started.'

Write-Host '===== Step 5/5: prepare the two demo projects (1-2 minutes) ====='
Set-Location (Join-Path $root 'backend')
& node e2e\prepare-demo-state.mjs
if ($LASTEXITCODE -ne 0) { Write-Host 'FAILED: demo data. Screenshot this window.'; exit 1 }

Write-Host '============================================================'
Write-Host ' ALL READY! Open http://localhost:5173 in your browser.'
Write-Host ' Keep the chain / backend / frontend windows OPEN.'
Write-Host ' You may close THIS window now.'
Write-Host '============================================================'
exit 0
