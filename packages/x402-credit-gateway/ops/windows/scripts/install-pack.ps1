$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$windowsRoot = Split-Path -Parent $scriptRoot
$envDir = Join-Path $windowsRoot "env"

Get-ChildItem -Path $envDir -Filter "*.example" | ForEach-Object {
  $target = Join-Path $envDir ($_.BaseName)
  if (!(Test-Path $target)) {
    Copy-Item -Path $_.FullName -Destination $target
    Write-Host ("Created " + $target)
  }
}

& (Join-Path $scriptRoot "validate-env.ps1")
& (Join-Path $scriptRoot "start-services.ps1")
$startupRegistered = $true
try {
  & (Join-Path $scriptRoot "register-startup.ps1") -Force
} catch {
  $startupRegistered = $false
  Write-Warning ("Startup task registration skipped: " + $_.Exception.Message)
  Write-Warning "Run: powershell -ExecutionPolicy Bypass -File ops/windows/scripts/ensure-startup-tasks.ps1 -Force"
}
& (Join-Path $scriptRoot "watchdog.ps1") -Once

if ($startupRegistered) {
  Write-Host "JEFE Windows deployment pack installed."
} else {
  Write-Host "JEFE Windows deployment pack installed with warnings (startup tasks not registered)."
}
