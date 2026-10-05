"""Slither 0.11.6 loops forever when a parent contract never becomes 'analyzed' (UniversalRouter: `Dispatcher is Lock`,
with a library also named `Lock`). The guard must raise instead of hanging, and behave like the original otherwise."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pytest

from twelve.compile import SlitherInheritanceStall, _guard_slither_using_for


@dataclass(eq=False)
class _Underlying:
    name: str
    contract_kind: str = "contract"
    inheritance: list[Any] = field(default_factory=list)


@dataclass(eq=False)
class _Parser:
    underlying_contract: _Underlying
    is_analyzed: bool = False
    using_for_calls: int = 0

    def analyze_using_for(self) -> None:
        self.using_for_calls += 1

    def set_is_analyzed(self, v: bool) -> None:
        self.is_analyzed = v


def _unit(parsers: list[_Parser]) -> Any:
    from slither.solc_parsing.slither_compilation_unit_solc import SlitherCompilationUnitSolc

    _guard_slither_using_for()
    unit = object.__new__(SlitherCompilationUnitSolc)
    unit._underlying_contract_to_parser = {p.underlying_contract: p for p in parsers}
    unit._analyze_top_level_using_for = lambda: None
    return unit


def test_parent_first_order_is_kept() -> None:
    base = _Parser(_Underlying("Base"))
    child = _Parser(_Underlying("Child", inheritance=[base.underlying_contract]))
    unit = _unit([base, child])
    unit._analyze_using_for([child, base], [])
    assert base.is_analyzed and child.is_analyzed
    assert base.using_for_calls == child.using_for_calls == 1


def test_parent_that_is_never_analyzed_raises_instead_of_looping() -> None:
    lock = _Parser(_Underlying("Lock", contract_kind="library"))
    dispatcher = _Parser(_Underlying("Dispatcher", inheritance=[lock.underlying_contract]))
    router = _Parser(_Underlying("UniversalRouter", inheritance=[dispatcher.underlying_contract]))
    unit = _unit([lock, dispatcher, router])
    with pytest.raises(SlitherInheritanceStall, match="Dispatcher inherits 'Lock' \\(library\\)"):
        unit._analyze_using_for([router, dispatcher], [lock])
