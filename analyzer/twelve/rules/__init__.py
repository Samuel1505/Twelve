"""Rule registry (docs/ANALYZER.md §5). One module per rule id; each exports RULE."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from twelve.lattice import Conf
from twelve.report import SEVERITY_ORDER, hex_keccak_jcs


@dataclass(frozen=True)
class Rule:
    id: str
    name: str
    severity: str  # default severity
    messages: dict[str, str]  # direction -> templated message
    fix: str

    def as_json(self) -> dict[str, object]:
        return {"id": self.id, "name": self.name, "severity": self.severity,
                "messages": self.messages, "fix": self.fix}


def cap(severity: str, conf: Conf) -> str:
    """HEURISTIC caps severity at MEDIUM (§5)."""
    if conf is Conf.HEURISTIC and SEVERITY_ORDER[severity] < SEVERITY_ORDER["MEDIUM"]:
        return "MEDIUM"
    return severity


def _load() -> dict[str, Rule]:
    from twelve.rules import (
        tw001,
        tw002,
        tw003,
        tw004,
        tw005,
        tw006,
        tw007,
        tw008,
        tw900,
    )

    mods = (tw001, tw002, tw003, tw004, tw005, tw006, tw007, tw008, tw900)
    return {m.RULE.id: m.RULE for m in mods}


RULES: Final[dict[str, Rule]] = _load()


def rules_hash() -> str:
    return hex_keccak_jcs([RULES[k].as_json() for k in sorted(RULES)])
