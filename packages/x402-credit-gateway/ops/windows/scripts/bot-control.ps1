param(
  [Parameter(Mandatory=$true)][string]$BotId,
  [ValidateSet("status","dispatch")][string]$Action = "status",
  [string]$Payload = "{}"
)

$windowsRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$botRegistry = Get-Content -Raw -Path (Join-Path $windowsRoot "bot-registry.json") | ConvertFrom-Json
$bot = $botRegistry.bots | Where-Object { $_.id -eq $BotId }

if (-not $bot) {
  Write-Error ("Bot not found: " + $BotId)
  exit 1
}

if ($Action -eq "status") {
  try {
    $res = Invoke-WebRequest -Uri $bot.endpoint -TimeoutSec 3 -UseBasicParsing
    Write-Host ("Bot " + $BotId + " reachable: HTTP " + $res.StatusCode)
  } catch {
    Write-Error ("Bot " + $BotId + " unavailable")
    exit 1
  }
  exit 0
}

$body = $Payload
$res = Invoke-RestMethod -Uri $bot.endpoint -Method Post -ContentType "application/json" -Body $body
$res | ConvertTo-Json -Depth 8
