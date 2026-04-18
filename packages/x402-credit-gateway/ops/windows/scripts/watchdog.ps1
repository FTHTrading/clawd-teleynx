param(
  [switch]$Once
)

. (Join-Path $PSScriptRoot "common.ps1")
$services = Get-ServiceRegistry
$stateFile = Join-Path $WindowsRoot "state/watchdog-state.json"

function Run-Check {
  $report = @()
  foreach ($svc in $services) {
    $s = Test-ServiceHealth $svc
    if (-not $s.running -or -not $s.healthy) {
      Write-Warning ("Watchdog detected unhealthy service: " + $svc.name)
      try {
        Start-ManagedService $svc
        $restartCount = Increment-RestartCount $svc.name
        Write-Host ("Restarted " + $svc.name + " count=" + $restartCount)
      } catch {
        Write-Error ("Failed to restart " + $svc.name + ": " + $_)
      }
      $s = Test-ServiceHealth $svc
    }
    $report += $s
  }

  $degraded = @($report | Where-Object { -not $_.healthy }).Count -gt 0
  $output = [PSCustomObject]@{
    timestamp = (Get-Date).ToString("o")
    degraded = $degraded
    services = $report
  }
  $output | ConvertTo-Json -Depth 8 | Set-Content -Path $stateFile
}

if ($Once) {
  Run-Check
  exit 0
}

while ($true) {
  Run-Check
  Start-Sleep -Seconds 15
}
