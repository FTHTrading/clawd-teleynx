# Telnyx Toolkit Security Review (ClawHub Flagged Skill)

## Summary

The Telnyx Toolkit package appears functionally useful but includes behavior that exceeds declared scope in places (credential handling, privileged operations, and payment-driving instructions). It should not be imported as-is into production control planes.

## Risk Findings

1. High: Mixed trust boundary across scripts and docs.
The toolkit combines safe API examples with scripts that can trigger privileged network/system actions and payment side effects.

2. High: Hidden side-effect risk in setup and helper scripts.
Privilege/network tooling and account workflow automation can be executed by operators without explicit gating.

3. Medium: Credential exposure surface.
`TELNYX_API_KEY` is central and could leak via shell history, logs, or unsafe wrappers if copied verbatim into scripts.

4. Medium: Upgrade/payment flow coupling.
Payment and plan-upgrade guidance can trigger financially impactful operations when integrated into autonomous chains.

## Required Controls Before Use

1. Enforce allowlist import only (see `configs/telnyx/skill-allowlist.json`).
2. Block all shell scripts from automatic execution (`*.sh`, `*.ps1`, `*.bat`) unless explicitly approved by human operator.
3. Require human confirmation on balance top-up and account upgrade operations.
4. Run imported scripts in non-privileged sandbox/container with egress restrictions.
5. Store API keys in env/secret manager only; redact in logs.
6. Add command audit trail into ClawHub control plane.

## Approved First-Phase Scope

Safe first-phase adoption should be read-only and deterministic:

- SDK docs (`api/*/SKILL.md`)
- STT/TTS utility patterns (code review required)
- Non-privileged retrieval and routing helpers

Deferred to later phase:

- Networking mesh scripts
- Payment top-up automation
- Any script requiring sudo/admin/privileged system calls

## Integration Decision

Proceed with curated import only, not direct install.
