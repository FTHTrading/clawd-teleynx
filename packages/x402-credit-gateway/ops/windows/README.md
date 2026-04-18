# JEFE Windows Deployment Pack

This pack configures local-first 24/7 operations for JEFE services and ClawdBot orchestration.

## Files
- `service-registry.json`: Canonical service definitions.
- `bot-registry.json`: Canonical bot endpoints.
- `scripts/*.ps1`: Lifecycle, watchdog, status, and verification scripts.
- `env/*.example`: Environment templates.
- `logs/`: Service logs.
- `state/`: Pid and watchdog state.

## Quick Start
1. Copy env templates and edit values:
   - `ops/windows/env/jefe-kernel.env`
   - `ops/windows/env/ollama.env`
   - `ops/windows/env/apostle.env`
   - `ops/windows/env/clawdbot.env`
2. Install pack:
   - `powershell -ExecutionPolicy Bypass -File ops/windows/scripts/install-pack.ps1`
3. Verify:
   - `powershell -ExecutionPolicy Bypass -File ops/windows/scripts/verify-deployment.ps1`

## Operations
- Start all: `powershell -ExecutionPolicy Bypass -File ops/windows/scripts/start-services.ps1`
- Stop all: `powershell -ExecutionPolicy Bypass -File ops/windows/scripts/stop-services.ps1`
- Restart all: `powershell -ExecutionPolicy Bypass -File ops/windows/scripts/restart-services.ps1`
- Status table: `powershell -ExecutionPolicy Bypass -File ops/windows/scripts/status-services.ps1`
- Health JSON: `powershell -ExecutionPolicy Bypass -File ops/windows/scripts/health-summary.ps1`
- Watchdog once: `powershell -ExecutionPolicy Bypass -File ops/windows/scripts/watchdog.ps1 -Once`
- Watchdog loop: `powershell -ExecutionPolicy Bypass -File ops/windows/scripts/watchdog.ps1`
- Bot status: `powershell -ExecutionPolicy Bypass -File ops/windows/scripts/bot-control.ps1 -BotId clawdbot-runner -Action status`

## Startup Automation
- One-command startup registration with auto-elevation: `powershell -ExecutionPolicy Bypass -File ops/windows/scripts/ensure-startup-tasks.ps1 -Force`
- Register startup tasks directly (requires elevated shell): `powershell -ExecutionPolicy Bypass -File ops/windows/scripts/register-startup.ps1 -Force`
- Remove startup tasks: `powershell -ExecutionPolicy Bypass -File ops/windows/scripts/unregister-startup.ps1`

## Safety
- Action tiers are defined in `config/jefe_policy.yaml`.
- Wallet controls are defined in `config/wallet_policy.yaml` and `config/x402_policy.yaml`.
- All critical restarts and failures should be logged through watchdog state and service logs.
