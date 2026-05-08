# Release Notes — v0.1.0

**Date:** 2026-05-08
**Milestone:** Operational Readiness
**Status:** Local / dev operational. Not a production release.

---

## Summary

This milestone brings the Clawd Teleynx monorepo to a point where:

- The x402 credit gateway implements the full 402 Payment Required handshake
- All Node packages type-check cleanly
- GitHub Actions CI validates Node, Python, and no-secrets scan on every push
- Developer documentation covers the payment flow, environment, and audit

---

## What's New

### x402 Credit Gateway — Full 402 Handshake (PHASE 1–5 + Protocol Endpoints)

**New endpoints:**

- `GET /v1/x402/probe` — lightweight connectivity probe for external agents
- `POST /v1/x402/request-payment` — standard 402 Payment Required flow:
  - Without `X-Payment-Receipt` header → responds `402` with payment descriptor (`asset`, `amount`, `chain_id`, `payTo`, `nonce`, `deadline`)
  - With `X-Payment-Receipt: base64(receipt)` → verifies stored receipt and responds `200`
- `POST /v1/x402/verify-receipt` — standalone receipt verification against Apostle chain correlation data

**Payment descriptor fields** per x402 specification:

```json
{
  "asset": "ATP",
  "amount": "<string u128>",
  "chain_id": 7332,
  "payTo": "<apostle-agent-uuid>",
  "nonce": "<uuid-v4>",
  "deadline": "<ISO 8601, 5 min from request>"
}
```

**Signing:** Ed25519 via `tweetnacl`. Chain: Apostle (chain_id 7332). ATP amounts serialised as strings.

**Root index:** `GET /` now lists all endpoints including the new `/v1/x402/*` routes.

---

### CI — GitHub Actions

Three workflow files added:

| Workflow | File | Checks |
|---|---|---|
| Node.js CI | `.github/workflows/ci-node.yml` | `npm ci` + `tsc --noEmit` for x402-gateway, inference-router, speech-router |
| Python CI | `.github/workflows/ci-python.yml` | `ruff` lint + import check for clawdbot, clawdhub |
| Secrets Scan | `.github/workflows/secrets-scan.yml` | `gitleaks` — fails if real secrets detected |

Triggers: all pushes to `main` and PRs targeting `main`.

---

### Documentation

- `docs/CLAWD_TELEYNX_REPO_AUDIT.md` — Full package inventory, endpoint audit, flow diagram, environment reference, audit findings
- `docs/RELEASE_NOTES_v0.1.0.md` — This file

---

## Included from Prior PRs

**PR #1 — feat: wire clawdbot to x402 credit gateway (merged)**

- x402 credit gateway PHASE 1–5: persistent JSON storage, idempotency, ledger correlation, staged/real signing modes, operator observability
- ClawdBot executor integration with x402 payment gating
- Apostle chain client (`apostle-client.ts`) with Ed25519 transfer signing
- Operator wallet registry (5 operators: chairman, treasury, operator, credit-pool, reserve)

---

## Known Limitations (Dev Operational)

- **Staged mode only by default.** `X402_SIGN_REAL=false`. No ATP is moved on chain in default config.
- **No live Telnyx credentials.** Phone/messaging flows are config-only; no active DIDs.
- **No Triton/Riva inference.** GPU model serving requires RTX hardware + model files not in repo.
- **Apostle chain must be running locally.** `http://localhost:7332` — see apostle-chain repo.
- **Not production-ready.** No TLS, no authentication on gateway routes, no rate limiting.

---

## Upgrade Path to v0.2.0

- [ ] TLS termination on gateway (nginx or caddy sidecar)
- [ ] Route-level auth (`X-Operator-Token` or mTLS)
- [ ] Live Telnyx SIP/SMS integration against dev DID
- [ ] Apostle chain live node connectivity in CI (testnet or local)
- [ ] Real-mode ATP settlement smoke test in CI
