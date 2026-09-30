"""twelve.report — report schema v1, RFC 8785 canonicalization and hashing (docs/ANALYZER.md §7, I4, I6)."""

from __future__ import annotations

from typing import Any

import rfc8785
from Crypto.Hash import keccak

SCHEMA_VERSION = 1

SEVERITY_ORDER = {"HIGH": 0, "MEDIUM": 1, "LOW": 2, "INFO": 3}


def jcs(obj: Any) -> bytes:
    """RFC 8785 canonical JSON bytes."""
    return rfc8785.dumps(obj)


def hex_keccak(data: bytes) -> str:
    return "0x" + keccak.new(digest_bits=256, data=data).hexdigest()


def hex_keccak_jcs(obj: Any) -> str:
    return hex_keccak(jcs(obj))


def report_hash(core: dict[str, Any]) -> str:
    """reportHash = keccak256(JCS(reportCore)) (I6). `meta` is never part of the core."""
    if "meta" in core:
        raise ValueError("meta must not be inside reportCore")
    return hex_keccak_jcs(core)


def sort_findings(findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """(severity desc, file, startLine, rule, id) — §7."""
    return sorted(
        findings,
        key=lambda f: (
            SEVERITY_ORDER[f["severity"]],
            f["location"]["file"],
            f["location"]["startLine"],
            f["rule"],
            f["id"],
        ),
    )


def verdict(findings: list[dict[str, Any]], unsupported: list[dict[str, str]]) -> str:
    if any(f["severity"] in ("HIGH", "MEDIUM") for f in findings):
        return "FINDINGS"
    if unsupported:
        return "INCOMPLETE"
    return "CLEAN"


def build_core(
    *,
    tool: dict[str, str],
    target: dict[str, Any],
    input_: dict[str, Any],
    bindings: list[dict[str, Any]],
    findings: list[dict[str, Any]],
    functions_analyzed: int,
    unsupported: list[dict[str, str]],
) -> dict[str, Any]:
    fs = sort_findings(findings)
    unsup = sorted(unsupported, key=lambda u: (u["function"], u["reason"]))
    return {
        "schemaVersion": SCHEMA_VERSION,
        "tool": tool,
        "target": target,
        "input": input_,
        "bindings": sorted(bindings, key=lambda b: (b["var"], b["method"])),
        "findings": fs,
        "coverage": {"functionsAnalyzed": functions_analyzed, "unsupported": unsup},
        "verdict": verdict(fs, unsup),
    }
