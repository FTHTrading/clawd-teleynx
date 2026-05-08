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

---

## x402 Payment Flow (Operational)

The x402-credit-gateway implements the full 402 Payment Required handshake against **Apostle Chain (chain_id 7332)** using ATP/Ed25519 semantics.

### Quick test (staged mode — no real ATP moved)

```bash
# 1. Start gateway
cd packages/x402-credit-gateway && npm run dev

# 2. Probe
curl http://localhost:4020/v1/x402/probe

# 3. Request payment (returns 402 + descriptor)
curl -X POST http://localhost:4020/v1/x402/request-payment \
  -H "Content-Type: application/json" \
  -d '{"service":"clawdbot.execute","amount_atp":"1000000000000000000","user_id":"test-user"}'

# 4. Create a receipt
curl -X POST http://localhost:4020/v1/request-payment \
  -H "Content-Type: application/json" \
  -d '{"service":"clawdbot.execute","amount_atp":"1000000000000000000","user_id":"test-user"}'

# 5. Execute charge (staged — returns tx_hash without chain submission)
curl -X POST http://localhost:4020/v1/execute-charge \
  -H "Content-Type: application/json" \
  -d '{"receipt_id":"<receipt_id from step 4>"}'

# 6. Verify receipt
curl -X POST http://localhost:4020/v1/x402/verify-receipt \
  -H "Content-Type: application/json" \
  -d '{"receipt_id":"<receipt_id>"}'

# 7. Retry with X-Payment-Receipt (access granted)
RECEIPT_B64=$(echo '{"receipt_id":"<receipt_id>"}' | base64)
curl -X POST http://localhost:4020/v1/x402/request-payment \
  -H "Content-Type: application/json" \
  -H "X-Payment-Receipt: $RECEIPT_B64" \
  -d '{"service":"clawdbot.execute","amount_atp":"1000000000000000000","user_id":"test-user"}'
```

### Real-mode (live Apostle chain)

Set in `.env`:

```env
X402_SIGN_REAL=true
X402_OPERATOR_PRIVATE_KEY=<32-byte seed hex — DO NOT COMMIT>
APOSTLE_API_URL=http://localhost:7332
```

### Documentation

- `docs/CLAWD_TELEYNX_REPO_AUDIT.md` — full endpoint audit, flow diagram, env reference
- `docs/RELEASE_NOTES_v0.1.0.md` — v0.1.0 milestone notes
- `docs/TELNYX_TOOLKIT_SECURITY_REVIEW.md` — Telnyx integration security review
- `docs/INTEGRATION_REVIEW.md` — integration architecture review
