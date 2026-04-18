. (Join-Path $PSScriptRoot "common.ps1")

$services = Get-ServiceRegistry
$rows = @()
foreach ($svc in $services) {
  $rows += Test-ServiceHealth $svc
}

$degraded = @($rows | Where-Object { -not $_.healthy }).Count -gt 0
$criticalDown = @($rows | Where-Object { $_.criticality -eq "critical" -and -not $_.healthy }).Count

$result = [PSCustomObject]@{
  timestamp = (Get-Date).ToString("o")
  status = if ($criticalDown -gt 0) { "red" } elseif ($degraded) { "yellow" } else { "green" }
  total = $rows.Count
  healthy = @($rows | Where-Object { $_.healthy }).Count
  degraded = @($rows | Where-Object { -not $_.healthy }).Count
  services = $rows
}

$result | ConvertTo-Json -Depth 8
