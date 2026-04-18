param(
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = Join-Path $scriptRoot "register-startup.ps1"
$forceArg = if ($Force) { "-Force" } else { "" }

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if ($isAdmin) {
  & powershell.exe -ExecutionPolicy Bypass -File $target $forceArg
  Write-Host "Startup task registration completed in elevated session."
  exit 0
}

Write-Host "Elevation required. Requesting Administrator privileges..."
try {
  $argString = "-ExecutionPolicy Bypass -File `"$target`" $forceArg"
  $proc = Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $argString -PassThru -Wait
  if ($null -ne $proc -and $proc.ExitCode -ne 0) {
    throw ("Elevated registration failed with exit code " + $proc.ExitCode)
  }
  Write-Host "Startup task registration completed via elevated relaunch."
} catch {
  $msg = $_.Exception.Message
  if ($msg -match "canceled by the user") {
    Write-Warning "Startup registration was canceled at the UAC prompt. Rerun and accept elevation to complete boot automation."
    exit 2
  }
  Write-Error ("Unable to complete startup registration: " + $msg)
  exit 1
}
