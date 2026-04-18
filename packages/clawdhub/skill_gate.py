"""
Skill import gate for third-party toolkit content.

This validator enforces a local allow/deny policy before files are admitted into
Clawd-controlled runtime environments.
"""
from __future__ import annotations

import fnmatch
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


@dataclass
class GateResult:
    allowed: list[str]
    blocked: list[str]


def _matches_any(path: str, patterns: Iterable[str]) -> bool:
    return any(fnmatch.fnmatch(path, pattern) for pattern in patterns)


def evaluate_paths(paths: Iterable[str], policy_path: str | Path) -> GateResult:
    policy_file = Path(policy_path)
    policy = json.loads(policy_file.read_text(encoding="utf-8"))

    allow_patterns = policy.get("allow", [])
    deny_patterns = policy.get("deny", [])

    allowed: list[str] = []
    blocked: list[str] = []

    for raw in paths:
        path = raw.replace("\\", "/")

        if _matches_any(path, deny_patterns):
            blocked.append(path)
            continue

        if _matches_any(path, allow_patterns):
            allowed.append(path)
            continue

        # Default-deny for files outside explicit policy.
        blocked.append(path)

    return GateResult(allowed=allowed, blocked=blocked)


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Evaluate skill file paths against allowlist policy.")
    parser.add_argument("paths", nargs="+", help="Relative paths to validate")
    parser.add_argument(
        "--policy",
        default="configs/telnyx/skill-allowlist.json",
        help="Path to policy JSON file",
    )

    args = parser.parse_args()
    result = evaluate_paths(args.paths, args.policy)

    print("ALLOWED:")
    for item in result.allowed:
        print(f"  {item}")

    print("BLOCKED:")
    for item in result.blocked:
        print(f"  {item}")

    return 0 if not result.blocked else 2


if __name__ == "__main__":
    raise SystemExit(main())
