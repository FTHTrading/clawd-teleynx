# Clawd Teleynx — Repository Audit

**Date:** 2026-05-08
**Scope:** Full repository structural and operational review prior to v0.1.0
**Status:** Local / dev operational language only. No production claims.

---

## Package Inventory

| Package | Language | Port | Status |
|---|---|---|---|
| `clawdbot` | Python / FastAPI | 8089 | Runnable locally with `python runner.py` |
| `clawdhub` | Python / FastAPI | 8099 | Runnable locally with `uvicorn hub:app` |
| `inference-router` | TypeScript / Express | — | Builds with `npm run build` |
| `speech-router` | TypeScript / Express | — | Builds with `npm run build` |
| `x402-credit-gateway` | TypeScript / Express | 4020 (default) | Full PHASE 1–5 implementation |

---

## x402 Credit Gateway — Endpoint Audit

All endpoints verified against source `packages/x402-credit-gateway/src/index.ts`.

### Existing Endpoints (PR #1, merged)

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Full system health (chain + persistence + signing mode) |
| POST | `/v1/request-payment` | Create a pending receipt (idempotent) |
| POST | `/v1/execute-charge` | Settle a receipt (staged or real Ed25519 signing) |
| GET | `/v1/receipt/:id` | Fetch a single receipt with correlation data |
| GET | `/v1/receipts` | List all receipts |
| GET | `/v1/receipts/user/:user_id` | User receipt history + confirmed ATP total |
| GET | `/v1/operator-status` | Red/yellow/green operator dashboard |

### New Endpoints (this PR)

| Method | Path | Description |
|---|---|---|
| GET | `/v1/x402/probe` | Lightweight x402 connectivity probe |
| POST | `/v1/x402/request-payment` | Full 402 Payment Required flow with descriptor |
| POST | `/v1/x402/verify-receipt` | Standalone receipt verification against Apostle chain |

---

## x402 Payment Flow (5-Step Handshake)

```
Client                          x402-credit-gateway          Apostle Chain (7332)
  │                                    │                              │
  │ POST /v1/x402/request-payment      │                              │
  │ { service, amount_atp, user_id }   │                              │
  │ ─────────────────────────────────► │                              │
  │ ◄─────────────────────────────── 402                              │
  │   payment_descriptor:              │                              │
  │   { asset, amount, chain_id,       │                              │
  │     payTo, nonce, deadline }       │                              │
  │                                    │                              │
  │ POST /v1/request-payment           │                              │
  │ ─────────────────────────────────► │                              │
  │ ◄────────────────── { receipt_id } │                              │
  │                                    │                              │
  │ POST /v1/execute-charge            │                              │
  │ { receipt_id }                     │                              │
  │ ─────────────────────────────────► │ POST /v1/tx (Ed25519 signed) │
  │                                    │ ───────────────────────────► │
  │                                    │ ◄─────────────── { tx_hash } │
  │ ◄─── { tx_hash, block_height }     │                              │
  │                                    │                              │
  │ POST /v1/x402/request-payment      │                              │
  │ X-Payment-Receipt: base64(receipt) │                              │
  │ ─────────────────────────────────► │                              │
  │ ◄─────────────────────── 200 ✓     │                              │
```

**Signing semantics:** Ed25519 via `tweetnacl`. `X402_SIGN_REAL=true` submits live ATP transfers to Apostle chain (chain_id 7332). Default is `staged` mode — receipt objects are created and tracked but no on-chain settlement occurs.

---

## Chain Configuration

- **Chain:** Apostle Chain
- **chain_id:** 7332
- **Native asset:** ATP (18 decimals, serialised as string in JSON)
- **Signing:** Ed25519 (`tweetnacl` `nacl.sign.detached`)
- **Bridge:** Axum API at `:7332` (local dev) or configured via `APOSTLE_API_URL`

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `4020` | Gateway listen port |
| `APOSTLE_API_URL` | No | `http://localhost:7332` | Apostle Chain endpoint |
| `X402_SIGN_REAL` | No | `false` | Enable live Ed25519 chain signing |
| `X402_OPERATOR_PRIVATE_KEY` | If `X402_SIGN_REAL=true` | — | 32-byte seed or 64-byte secret key (hex) |
| `X402_OPERATOR_AGENT_ID` | No | kevan-burns-chairman UUID | Sending agent for real-mode transfers |
| `X402_SETTLEMENT_TO_AGENT_ID` | No | x402-credit-pool UUID | Receiving agent for settlement |
| `X402_DB_PATH` | No | `data/x402-store.json` | Persistence file path |

**Security:** Do not commit real `X402_OPERATOR_PRIVATE_KEY` values. Use `.env.template` as the reference. The `.env` file is gitignored.

---

## Persistence

- **Format:** JSON file (`data/x402-store.json`)
- **Idempotency:** 24-hour TTL keyed on `idempotency_key`
- **Ledger correlation:** Each confirmed receipt stores `apostle_tx_hash`, `apostle_block_height`, `correlation_id`

---

## Docker

- `docker-compose.nvidia.yml` — RTX 5090 NVIDIA stack
- `docker/compose.nvidia-stack.yml` — GPU inference stack (Triton + Riva)
- Docker validation CI checks `docker compose config` syntax

---

## Vendor

- `vendor/telnyx-toolkit-1.5.0/` — Local copy of Telnyx toolkit, not installed via npm. See `docs/TELNYX_TOOLKIT_SECURITY_REVIEW.md`.

---

## Audit Findings

| Area | Finding | Severity | Resolution |
|---|---|---|---|
| x402 flow | No `/v1/x402/*` routes for standard 402 handshake | Medium | Added in this PR |
| CI | No GitHub Actions workflows | Medium | Added in this PR |
| Docs | No release notes or repo audit doc | Low | Added in this PR |
| Signing | Real-mode key not validated at startup | Low | Runtime validation in `/v1/execute-charge` |
| Secrets | No automated secrets scan in CI | Medium | `gitleaks` action added in this PR |

---

## Not Audited / Out of Scope

- Live Telnyx credential validation (no production keys present)
- On-chain ATP balance verification against live Apostle node
- Triton/Riva model serving (requires GPU hardware)
- Production deployment readiness

This is a **local/dev operational readiness** audit only.
