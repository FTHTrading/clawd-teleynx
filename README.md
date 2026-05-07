# UnyKorn Clawd System

Unified Clawd/ClawHub runtime for AI execution, voice, routing, and x402 settlement across NEED AI, FIFA, LAW, and x402 protocol surfaces.

## What Is Here

- `packages/clawdbot/`: NVIDIA-first autonomous executor (FastAPI, port 8089)
- `packages/clawdhub/`: operator dashboard and backend health surface (FastAPI, port 8099)
- `packages/inference-router/`: model routing (Triton/NIM/Ollama)
- `packages/speech-router/`: speech routing (Riva/Whisper/Piper)
- `packages/x402-credit-gateway/`: x402 receipt + settlement gateway (Express, port 8402)
- `docker-compose.nvidia.yml`: RTX 5090 stack composition

## Integration Goal

Incorporate the Telnyx Toolkit in a controlled way to power phone and messaging workflows for:

- NEED AI routing directory and number operations
- FIFA fan support text/call flows
- LAW intake hotlines and triage routing
- x402-powered paid AI-to-AI service execution

See:

- `docs/TELNYX_TOOLKIT_SECURITY_REVIEW.md`
- `docs/INTEGRATION_REVIEW.md`
- `configs/telnyx/skill-allowlist.json`

## Quick Start (Local)

```powershell
# from repo root
python -m pip install -r packages/clawdbot/requirements.txt
python -m pip install -r packages/clawdhub/requirements.txt

# run operator hub
python packages/clawdhub/hub.py

# run executor
python packages/clawdbot/runner.py

# run x402 gateway (for paid execution paths)
cd packages/x402-credit-gateway
npm install
npm run dev
```

## Docker Stack

```powershell
docker compose -f docker-compose.nvidia.yml up -d
```

## GitHub Setup

```powershell
# initialize repo once
git init -b main

# first commit
git add .
git commit -m "chore: initialize clawd monorepo docs and security gates"

# add remote and push
git remote add origin https://github.com/<ORG_OR_USER>/<REPO>.git
git push -u origin main
```

## Notes

- Do not commit secrets (`.env`, private keys, API tokens).
- Use the allowlist and review docs before importing third-party skills.
- Set `X402_GATEWAY_URL` for ClawdBot if the gateway is not on `http://localhost:8402`.
