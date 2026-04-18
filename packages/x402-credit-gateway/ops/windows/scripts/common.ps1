Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$WindowsRoot = Split-Path -Parent $ScriptRoot
$RepoRoot = Split-Path -Parent (Split-Path -Parent $WindowsRoot)
$RegistryPath = Join-Path $WindowsRoot "service-registry.json"
$StateDir = Join-Path $WindowsRoot "state"
$LogsDir = Join-Path $WindowsRoot "logs"

function Ensure-Dirs {
  New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
  New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null
}

function Get-ServiceRegistry {
  $json = Get-Content -Raw -Path $RegistryPath | ConvertFrom-Json
  return $json.services
}

function Resolve-PathLocal([string]$PathValue) {
  if ([System.IO.Path]::IsPathRooted($PathValue)) {
    return $PathValue
  }
  return (Join-Path $RepoRoot $PathValue)
}

function Get-PidFile([string]$Name) {
  return Join-Path $StateDir ("service-" + $Name + ".pid")
}

function Get-CountFile([string]$Name) {
  return Join-Path $StateDir ("restart-" + $Name + ".count")
}

function Import-EnvFile([string]$EnvFile) {
  if ([string]::IsNullOrWhiteSpace($EnvFile)) { return }
  $resolved = Resolve-PathLocal $EnvFile
  if (!(Test-Path $resolved)) { return }
  foreach ($line in Get-Content -Path $resolved) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    if ($line.Trim().StartsWith("#")) { continue }
    $parts = $line -split "=", 2
    if ($parts.Length -eq 2) {
      [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim())
    }
  }
}

function Get-RunningPid([string]$Name) {
  $pidFile = Get-PidFile $Name
  if (!(Test-Path $pidFile)) { return $null }
  $raw = (Get-Content -Raw -Path $pidFile).Trim()
  if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
  $resolvedPid = [int]$raw
  $proc = Get-Process -Id $resolvedPid -ErrorAction SilentlyContinue
  if ($null -eq $proc) { return $null }
  return $resolvedPid
}

function Start-ManagedService($svc) {
  Ensure-Dirs
  $existing = Get-RunningPid $svc.name
  if ($null -ne $existing) {
    Write-Host ("[skip] " + $svc.name + " already running pid=" + $existing)
    return
  }

  $workdir = Resolve-PathLocal $svc.workdir
  if (!(Test-Path $workdir)) {
    throw ("Workdir not found for " + $svc.name + ": " + $workdir)
  }

  Import-EnvFile $svc.envFile

  $commandAvailable = $false
  if ([System.IO.Path]::IsPathRooted([string]$svc.command)) {
    $commandAvailable = Test-Path ([string]$svc.command)
  } else {
    $cmd = Get-Command ([string]$svc.command) -ErrorAction SilentlyContinue
    $commandAvailable = ($null -ne $cmd)
  }

  if (-not $commandAvailable) {
    Write-Warning ("[skip] " + $svc.name + " command not found: " + $svc.command)
    return
  }

  $logPath = Join-Path $LogsDir ($svc.name + ".log")
  $errPath = Join-Path $LogsDir ($svc.name + ".err.log")

  $argList = @()
  if ($null -ne $svc.args) {
    foreach ($a in $svc.args) {
      if ($null -ne $a -and -not [string]::IsNullOrWhiteSpace([string]$a)) {
        $argList += [string]$a
      }
    }
  }

  try {
    if ($argList.Count -gt 0) {
      $proc = Start-Process -FilePath $svc.command -ArgumentList $argList -WorkingDirectory $workdir -RedirectStandardOutput $logPath -RedirectStandardError $errPath -PassThru
    } else {
      $proc = Start-Process -FilePath $svc.command -WorkingDirectory $workdir -RedirectStandardOutput $logPath -RedirectStandardError $errPath -PassThru
    }
    Set-Content -Path (Get-PidFile $svc.name) -Value $proc.Id
    Write-Host ("[start] " + $svc.name + " pid=" + $proc.Id)
  } catch {
    Write-Warning ("[skip] " + $svc.name + " failed to start: " + $_.Exception.Message)
    return
  }
}

function Stop-ManagedService($svc) {
  $pid = Get-RunningPid $svc.name
  if ($null -eq $pid) {
    Write-Host ("[skip] " + $svc.name + " not running")
    return
  }
  Stop-Process -Id $pid -Force
  Remove-Item -Path (Get-PidFile $svc.name) -Force -ErrorAction SilentlyContinue
  Write-Host ("[stop] " + $svc.name + " pid=" + $pid)
}

function Test-ServiceHealth($svc) {
  $healthy = $false
  $detail = "no_probe"
  $servicePid = Get-RunningPid $svc.name
  $running = ($null -ne $servicePid)
  try {
    if (![string]::IsNullOrWhiteSpace($svc.healthProbe)) {
      $resp = Invoke-WebRequest -Uri $svc.healthProbe -TimeoutSec 3 -UseBasicParsing
      $healthy = ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 300)
      $detail = "http_" + $resp.StatusCode
      if ($healthy) {
        # Allow externally managed processes to still be reported as running.
        $running = $true
      }
    }
  } catch {
    $healthy = $false
    $detail = "probe_failed"
  }

  [PSCustomObject]@{
    name = $svc.name
    pid = $servicePid
    running = $running
    healthy = $healthy
    detail = $detail
    criticality = $svc.criticality
  }
}

function Increment-RestartCount([string]$Name) {
  $file = Get-CountFile $Name
  $count = 0
  if (Test-Path $file) {
    $count = [int](Get-Content -Raw -Path $file)
  }
  $count++
  Set-Content -Path $file -Value $count
  return $count
}
