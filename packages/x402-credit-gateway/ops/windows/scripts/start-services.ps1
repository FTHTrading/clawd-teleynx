param(
  [string]$Name = "all"
)

. (Join-Path $PSScriptRoot "common.ps1")
$services = Get-ServiceRegistry

if ($Name -ne "all") {
  $services = @($services | Where-Object { $_.name -eq $Name })
}

# Start dependencies first.
foreach ($svc in $services) {
  if ($svc.dependsOn) {
    foreach ($depName in $svc.dependsOn) {
      $dep = $services | Where-Object { $_.name -eq $depName }
      if ($dep) { Start-ManagedService $dep }
    }
  }
  Start-ManagedService $svc
}
