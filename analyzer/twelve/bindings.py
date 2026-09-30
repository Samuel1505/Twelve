"""twelve.bindings — which state variables are the USDC ERC-20 (docs/ANALYZER.md §3).

Literal bindings (`IERC20 constant USDC = IERC20(0x3600…)`, immutables set to that literal) are resolved by the
dataflow itself: address literals flow through the lattice. This module adds the static pre-deploy sources:
twelve.toml, NatSpec `@custom:twelve usdc`, and the name heuristic.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from twelve.lattice import Conf
from twelve.sources_sinks import USDC_NAME_HEURISTIC

USDC_BINDING_VALUE = "USDC_ERC20"

_DOC_TAG = re.compile(r"@custom:twelve\s+usdc\b")
_UNIT_TAG = re.compile(r"@custom:twelve-unit\s+(\w+)\s+(usdc6|usdc18)\b")


@dataclass(frozen=True, order=True)
class Binding:
    var: str  # "Contract.var"
    method: str  # constant | immutable | storage | config | nameHeuristic
    conf: Conf
    mutable: bool

    def as_json(self) -> dict[str, Any]:
        return {"var": self.var, "value": "0x3600000000000000000000000000000000000000",
                "method": self.method, "mutable": self.mutable}


def doc_comment_above(source: str, start_byte: int) -> str:
    """The contiguous `///` or `/** */` comment block immediately above a declaration."""
    head = source.encode("utf-8")[:start_byte].decode("utf-8", errors="replace")
    lines = head.splitlines()
    if lines and lines[-1].strip() == "":
        lines = lines[:-1]
    elif lines:
        # declaration starts mid-line (after indentation); the line itself is not a comment
        lines = lines[:-1] if lines[-1].strip() else lines
    block: list[str] = []
    for line in reversed(lines):
        s = line.strip()
        if s.startswith(("///", "*", "/**")) or s.endswith("*/"):
            block.append(s)
            continue
        break
    return "\n".join(reversed(block))


def param_unit_annotations(doc: str) -> dict[str, str]:
    """`/// @custom:twelve-unit amount usdc6` -> {"amount": "usdc6"}."""
    return {m.group(1): m.group(2) for m in _UNIT_TAG.finditer(doc)}


class StaticBindings:
    def __init__(self, sources: dict[str, str], config: dict[str, str]) -> None:
        self._sources = sources
        self._config = config  # "file.sol:Contract.var" -> "USDC_ERC20"

    def lookup(self, sv: Any) -> Binding | None:
        """Static binding for a Slither StateVariable, or None."""
        contract = sv.contract.name if getattr(sv, "contract", None) is not None else ""
        name = f"{contract}.{sv.name}"
        sm = sv.source_mapping
        file = sm.filename.used
        mutable = not (sv.is_constant or sv.is_immutable)
        if self._config.get(f"{file}:{name}") == USDC_BINDING_VALUE:
            return Binding(name, "config", Conf.DEFINITE, mutable)
        src = self._sources.get(file)
        if src is not None and _DOC_TAG.search(doc_comment_above(src, sm.start)):
            return Binding(name, "config", Conf.DEFINITE, mutable)
        if sv.name in USDC_NAME_HEURISTIC and _is_contract_typed(sv):
            return Binding(name, "nameHeuristic", Conf.HEURISTIC, mutable)
        return None


def _is_contract_typed(v: Any) -> bool:
    t = getattr(v, "type", None)
    return type(t).__name__ == "UserDefinedType" and type(getattr(t, "type", None)).__name__.startswith("Contract")
