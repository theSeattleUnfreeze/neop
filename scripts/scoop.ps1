# Start Scoop on this PC and open the dashboard.
# Also starts configured local services, and any remoteStart line in the stack file.
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Scoop = Join-Path $Root "scoop"
$Url = "http://127.0.0.1:3847"
$Port = 3847

function Test-TcpPort([int]$PortNumber) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $client.BeginConnect("127.0.0.1", $PortNumber, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(400, $false)
    if (-not $ok) { return $false }
    $client.EndConnect($iar)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Wait-TcpPort([int]$PortNumber, [int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-TcpPort $PortNumber) { return $true }
    Start-Sleep -Milliseconds 400
  }
  return $false
}

if (Test-TcpPort $Port) {
  Write-Host "Scoop is already running at $Url"
  Start-Process $Url
  exit 0
}

if (-not (Test-TcpPort 5432)) {
  $compose = Join-Path $Root "docker-compose.scoop.yml"
  if ((Get-Command docker -ErrorAction SilentlyContinue) -and (Test-Path $compose)) {
    Write-Host "Starting Scoop's Postgres on 127.0.0.1:5432"
    & docker compose -f $compose --profile scoop up -d postgres-scoop
    if (-not (Wait-TcpPort 5432 40)) {
      Write-Host "Postgres did not open 5432. Scoop will still start; the dashboard needs that database."
    }
  } else {
    Write-Host "Postgres is not listening on 127.0.0.1:5432. Scoop will still start."
  }
}

if (-not (Test-Path (Join-Path $Scoop "node_modules"))) {
  Write-Host "Installing Scoop dependencies."
  Push-Location $Scoop
  try {
    if (Get-Command pnpm -ErrorAction SilentlyContinue) { pnpm install } else { npm install }
  } finally {
    Pop-Location
  }
}

$runner = if (Get-Command pnpm -ErrorAction SilentlyContinue) { "pnpm" } else { "npm" }

Write-Host "Starting configured local services, and any remote start commands in the stack file"
Push-Location $Scoop
try {
  & $runner run stack:up
  if ($LASTEXITCODE -ne 0) {
    Write-Host "A stack service did not start. Scoop will still open."
  }
} finally {
  Pop-Location
}

$watcher = [powershell]::Create()
$null = $watcher.AddScript({
  param($Url, $Port)
  $deadline = (Get-Date).AddMinutes(3)
  while ((Get-Date) -lt $deadline) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
      $iar = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
      if ($iar.AsyncWaitHandle.WaitOne(400, $false)) {
        $client.EndConnect($iar)
        Start-Process $Url
        return
      }
    } catch {
    } finally {
      $client.Close()
    }
    Start-Sleep -Milliseconds 400
  }
}).AddArgument($Url).AddArgument($Port)
$handle = $watcher.BeginInvoke()

Write-Host "Starting Scoop at $Url"
Push-Location $Scoop
try {
  & $runner run dev
} finally {
  Pop-Location
  if (-not $handle.IsCompleted) { $watcher.Stop() }
  $watcher.Dispose()
}
