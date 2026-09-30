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


# CBOR metadata maps solc appends: {"ipfs"|"bzzr0"|"bzzr1"|"experimental", "solc"} (1-4 entries).
_CBOR_HEADS = (bytes.fromhex("a264697066735822"), bytes.fromhex("a165627a7a72305820"),
               bytes.fromhex("a265627a7a72315820"), bytes.fromhex("a264736f6c63"), bytes.fromhex("a36469706673"),
               bytes.fromhex("a1646970667358"))


def cbor_blobs(code: bytes) -> list[tuple[int, int]]:
    """Every metadata blob (start, length incl. 2-byte length suffix). A factory's runtime embeds its children's
    creation code, each with its own metadata, so blobs occur mid-code, not only at the end."""
    out: list[tuple[int, int]] = []
    for head in _CBOR_HEADS:
        i = code.find(head)
        while i != -1:
            for j in range(i + len(head), min(len(code) - 1, i + 256)):
                if int.from_bytes(code[j:j + 2], "big") == j - i:
                    out.append((i, j + 2 - i))
                    break
            i = code.find(head, i + 1)
    return sorted(set(out))


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

    # metadata may differ (partial verification: same code, different comments/paths). Mask a blob only where
    # both sides carry one of the same length at the same offset — metadata is never executed (I5 holds).
    common = sorted(set(cbor_blobs(bytes(compiled))) & set(cbor_blobs(bytes(chain))))
    for s, n in common:
        compiled[s:s + n] = b"\x00" * n
        chain[s:s + n] = b"\x00" * n
    if common and compiled == chain:
        return Match("masked", sorted(masked + [[s, n] for s, n in common]), immutables, libraries)
    raise MatchFailed("code differs", _first_diff(bytes(compiled), bytes(chain)), len(compiled), len(chain))
