. (Join-Path $PSScriptRoot "common.ps1")

$requiredByService = @{
  "jefe-kernel" = @("X402_SIGN_REAL")
  "ollama-local" = @()
  "apostle-chain" = @()
  "clawdbot-runner" = @()
}

$services = Get-ServiceRegistry
$errors = @()

foreach ($svc in $services) {
  $envFile = Resolve-PathLocal $svc.envFile
  if (!(Test-Path $envFile)) {
    $errors += "Missing env file for " + $svc.name + ": " + $envFile
    continue
  }

  $lines = Get-Content -Path $envFile
  $map = @{}
  foreach ($line in $lines) {
    if ([string]::IsNullOrWhiteSpace($line) -or $line.Trim().StartsWith("#")) { continue }
    $parts = $line -split "=", 2
    if ($parts.Length -eq 2) { $map[$parts[0].Trim()] = $parts[1].Trim() }
  }

  foreach ($req in $requiredByService[$svc.name]) {
    if (-not $map.ContainsKey($req)) {
      $errors += "Missing required env var " + $req + " in " + $envFile
    }
  }
}

if ($errors.Count -gt 0) {
  $errors | ForEach-Object { Write-Error $_ }
  exit 1
}

Write-Host "Environment validation passed."
