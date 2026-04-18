param(
  [string]$Name = "all"
)

& (Join-Path $PSScriptRoot "stop-services.ps1") -Name $Name
Start-Sleep -Seconds 2
& (Join-Path $PSScriptRoot "start-services.ps1") -Name $Name
