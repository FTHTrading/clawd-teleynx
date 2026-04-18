param(
  [string]$Name = "all"
)

. (Join-Path $PSScriptRoot "common.ps1")
$services = Get-ServiceRegistry
if ($Name -ne "all") {
  $services = @($services | Where-Object { $_.name -eq $Name })
}

# Stop in reverse order to reduce dependency breakage.
[array]::Reverse($services)
foreach ($svc in $services) {
  Stop-ManagedService $svc
}
