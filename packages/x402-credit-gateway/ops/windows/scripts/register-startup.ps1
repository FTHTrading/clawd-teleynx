param(
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$taskNameBoot = "JEFE-Bootstrap"
$taskNameWatchdog = "JEFE-Watchdog"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

$bootstrapCmd = "powershell.exe -ExecutionPolicy Bypass -File `"" + (Join-Path $scriptRoot "start-services.ps1") + "`""
$watchdogCmd = "powershell.exe -ExecutionPolicy Bypass -File `"" + (Join-Path $scriptRoot "watchdog.ps1") + "`""

if ($Force) {
  Unregister-ScheduledTask -TaskName $taskNameBoot -Confirm:$false -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskNameWatchdog -Confirm:$false -ErrorAction SilentlyContinue
}

$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest

$actionBoot = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ("-ExecutionPolicy Bypass -File `"" + (Join-Path $scriptRoot "start-services.ps1") + "`"")
$actionWatchdog = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ("-ExecutionPolicy Bypass -File `"" + (Join-Path $scriptRoot "watchdog.ps1") + "`"")

$errors = @()
try {
  Register-ScheduledTask -TaskName $taskNameBoot -Trigger $trigger -Action $actionBoot -Principal $principal -Description "JEFE service bootstrap" -ErrorAction Stop | Out-Null
} catch {
  $errors += "Failed to register " + $taskNameBoot + ": " + $_.Exception.Message
}

try {
  Register-ScheduledTask -TaskName $taskNameWatchdog -Trigger $trigger -Action $actionWatchdog -Principal $principal -Description "JEFE watchdog" -ErrorAction Stop | Out-Null
} catch {
  $errors += "Failed to register " + $taskNameWatchdog + ": " + $_.Exception.Message
}

if ($errors.Count -gt 0) {
  $errors | ForEach-Object { Write-Error $_ }
  Write-Error "Run this script from an elevated PowerShell session to register startup tasks."
  exit 1
}

Write-Host "Scheduled startup tasks registered."
