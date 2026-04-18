. (Join-Path $PSScriptRoot "common.ps1")
$services = Get-ServiceRegistry
$status = @()

foreach ($svc in $services) {
  $status += Test-ServiceHealth $svc
}

$status | Sort-Object name | Format-Table -AutoSize

$summary = [PSCustomObject]@{
  timestamp = (Get-Date).ToString("o")
  total = $status.Count
  running = @($status | Where-Object { $_.running }).Count
  healthy = @($status | Where-Object { $_.healthy }).Count
  degraded = @($status | Where-Object { $_.running -and -not $_.healthy }).Count
  down = @($status | Where-Object { -not $_.running }).Count
}

Write-Host ""
$summary | ConvertTo-Json -Depth 4
