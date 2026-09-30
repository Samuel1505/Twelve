"""Blockscout verified-source response → solc standard-JSON input (ANALYZER §8.2)."""

from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Any

from twelve.compile import OUTPUT_SELECTION
from twelve.fetch.solc_bin import normalize


class Unsupported(Exception):
    """Vyper, Yul-only or otherwise out of v1 scope (CLAUDE.md §11)."""


@dataclass(frozen=True)
class Rebuilt:
    standard_json: dict[str, Any]
    compiler: str  # long version, e.g. 0.8.24+commit.e11b9ed9
    file: str  # source unit of the target contract
    name: str  # contract name


def rebuild(sc: dict[str, Any]) -> Rebuilt:
    lang = str(sc.get("language") or "").lower()
    if lang != "solidity":
        raise Unsupported(f"language={lang or 'unknown'}")
    name = sc["name"]
    main = sc.get("file_path") or f"{name}.sol"
    sources = {main: sc["source_code"]}
    for extra in sc.get("additional_sources") or []:
        sources[extra["file_path"]] = extra["source_code"]

    settings: dict[str, Any] = copy.deepcopy(sc.get("compiler_settings") or {})
    if not settings:  # older verifications: reconstruct from the flat fields
        settings = {"optimizer": {"enabled": bool(sc.get("optimization_enabled")),
                                  "runs": int(sc.get("optimization_runs") or 200)}}
        evm = sc.get("evm_version")
        if evm and evm != "default":
            settings["evmVersion"] = evm
    if settings.get("evmVersion") in (None, "default"):
        settings.pop("evmVersion", None)
    # outputSelection never changes bytecode; ours asks for what matching and binding need.
    settings["outputSelection"] = OUTPUT_SELECTION
    std = {
        "language": "Solidity",
        "sources": {k: {"content": v} for k, v in sorted(sources.items())},
        "settings": settings,
    }
    return Rebuilt(std, normalize(sc["compiler_version"]), main, name)
