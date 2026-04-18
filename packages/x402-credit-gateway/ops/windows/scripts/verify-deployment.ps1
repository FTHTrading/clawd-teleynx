$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

& (Join-Path $scriptRoot "validate-env.ps1")
& (Join-Path $scriptRoot "status-services.ps1")
& (Join-Path $scriptRoot "watchdog.ps1") -Once

Write-Host "Deployment verification completed."
