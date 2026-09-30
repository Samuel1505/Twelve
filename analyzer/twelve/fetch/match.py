"""Compiled runtime vs on-chain runtime (ANALYZER §8.4, invariant I5)."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

_LINK_PLACEHOLDER = re.compile(r"__\$[0-9a-fA-F]{34}\$__")


class MatchFailed(Exception):
    def __init__(self, reason: str, first_diff: int | None, compiled_len: int, onchain_len: int) -> None:
        super().__init__(f"{reason} (first differing byte {first_diff}, compiled {compiled_len} B, "
                         f"on-chain {onchain_len} B)")
        self.first_diff = first_diff


@dataclass(frozen=True)
class Match:
    status: str  # exact | masked
    masked_ranges: list[list[int]]
    immutables: dict[int, list[bytes]] = field(default_factory=dict)  # astId -> on-chain words
    libraries: dict[str, str] = field(default_factory=dict)  # "file:Lib" -> on-chain address

    def as_json(self) -> dict[str, Any]:
        return {"status": self.status, "maskedRanges": self.masked_ranges}


def _cbor_len(code: bytes) -> int:
    """Length of the trailing CBOR metadata incl. its 2-byte length suffix, or 0."""
    if len(code) < 2:
        return 0
    n = int.from_bytes(code[-2:], "big")
    return n + 2 if 0 < n + 2 <= len(code) and code[-n - 2] in (0xA1, 0xA2, 0xA3, 0xA4) else 0


def _first_diff(a: bytes, b: bytes) -> int | None:
    for i, (x, y) in enumerate(zip(a, b, strict=False)):
        if x != y:
            return i
    return None if len(a) == len(b) else min(len(a), len(b))


def match_runtime(deployed: dict[str, Any], onchain: bytes) -> Match:
    """`deployed` is solc's `evm.deployedBytecode` for the target contract."""
    obj = _LINK_PLACEHOLDER.sub("0" * 40, deployed["object"])
    compiled = bytearray(bytes.fromhex(obj))
    chain = bytearray(onchain)
    if not chain:
        raise MatchFailed("no code on chain", 0, len(compiled), 0)
    if len(compiled) != len(chain):
        raise MatchFailed("length differs", _first_diff(bytes(compiled), bytes(chain)), len(compiled), len(chain))

    immutables: dict[int, list[bytes]] = {}
    imm_ranges: list[tuple[int, int]] = []
    for ast_id, refs in sorted((deployed.get("immutableReferences") or {}).items(), key=lambda kv: int(kv[0])):
        for r in refs:
            s, n = int(r["start"]), int(r["length"])
            immutables.setdefault(int(ast_id), []).append(bytes(chain[s:s + n]))
            imm_ranges.append((s, n))
    libraries: dict[str, str] = {}
    lib_ranges: list[tuple[int, int]] = []
    for file, libs in sorted((deployed.get("linkReferences") or {}).items()):
        for lib, refs in sorted(libs.items()):
            for r in refs:
                s, n = int(r["start"]), int(r["length"])
                libraries[f"{file}:{lib}"] = "0x" + bytes(chain[s:s + n]).hex()
                lib_ranges.append((s, n))

    for s, n in imm_ranges + lib_ranges:
        compiled[s:s + n] = b"\x00" * n
        chain[s:s + n] = b"\x00" * n
    masked = sorted([s, n] for s, n in imm_ranges + lib_ranges)
    if compiled == chain:
        return Match("exact" if not lib_ranges else "masked", masked, immutables, libraries)

    cc, oc = _cbor_len(bytes(compiled)), _cbor_len(bytes(chain))
    if cc and cc == oc and compiled[:-cc] == chain[:-oc]:
        masked.append([len(chain) - oc, oc])
        return Match("masked", sorted(masked), immutables, libraries)
    raise MatchFailed("code differs", _first_diff(bytes(compiled), bytes(chain)), len(compiled), len(chain))
