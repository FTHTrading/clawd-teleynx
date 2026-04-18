$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

& (Join-Path $scriptRoot "unregister-startup.ps1")
& (Join-Path $scriptRoot "stop-services.ps1")

Write-Host "JEFE Windows deployment pack uninstalled."
