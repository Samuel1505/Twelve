"""twelve.lattice — abstract values, join, ⊗/⊘ transfer and collision classification (docs/ANALYZER.md §1).

Pure functions over frozen values; no Slither imports. The dataflow engine attaches locations and turns
`Collision`s into findings.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from enum import Enum, IntEnum

from twelve.units import (
    DIMENSIONLESS,
    ERC20,
    NATIVE,
    NATIVE_EXP,
    SCALE_EXPONENTS,
    Unit,
    is_other_view_magnitude,
    literal_unit,
    pow10_exponent,
    view_of,
)


class Conf(IntEnum):
    """Ordered so that `min` gives the weakest link (§1.2)."""

    HEURISTIC = 0
    INFERRED = 1
    DEFINITE = 2


class Kind(Enum):
    BOT = "bot"  # not yet computed
    TOP = "top"  # Unknown — never produces a finding
    UNIT = "unit"  # concrete (dim, exp)
    LIT = "lit"  # integer literal: adopts the unit of its context; `lit` holds the folded value if known
    TOKEN = "token"  # amount of an unresolved token variable: its own dimension (§3.4)


@dataclass(frozen=True, order=True, slots=True)
class TraceStep:
    step: str  # source | store | load | call | return | sink | merge
    expr: str
    loc: str  # "file:line"
    unit: tuple[int, int] | None = None
    expects: tuple[int, int] | None = None

    def as_json(self) -> dict[str, object]:
        d: dict[str, object] = {"step": self.step, "expr": self.expr, "loc": self.loc}
        if self.unit is not None:
            d["unit"] = list(self.unit)
        if self.expects is not None:
            d["expects"] = list(self.expects)
        return d


Trace = tuple[TraceStep, ...]


@dataclass(frozen=True, slots=True)
class Value:
    kind: Kind
    unit: Unit | None = None
    lit: int | None = None
    token: str | None = None
    conf: Conf = Conf.DEFINITE
    trace: Trace = ()
    # TW-007: set on (1,6) values produced by `(1,18) ⊘ (0,12)`; holds a key naming the dividend.
    trunc: str | None = None

    # ---- constructors
    @staticmethod
    def of(unit: Unit, conf: Conf = Conf.DEFINITE, trace: Trace = ()) -> Value:
        return Value(Kind.UNIT, unit=unit, conf=conf, trace=trace)

    @staticmethod
    def literal(v: int | None, trace: Trace = ()) -> Value:
        return Value(Kind.LIT, lit=v, trace=trace)

    @staticmethod
    def of_token(token_id: str, conf: Conf = Conf.DEFINITE, trace: Trace = ()) -> Value:
        return Value(Kind.TOKEN, token=token_id, conf=conf, trace=trace)

    # ---- queries
    @property
    def is_known(self) -> bool:
        return self.kind in (Kind.UNIT, Kind.LIT, Kind.TOKEN)

    @property
    def amount_unit(self) -> Unit | None:
        """The unit if this is a concrete amount (dim == 1)."""
        if self.kind is Kind.UNIT and self.unit is not None and self.unit.is_amount:
            return self.unit
        return None

    def mul_unit(self) -> Unit | None:
        """Unit used in multiplicative position (literals become scales per §5.3)."""
        if self.kind is Kind.UNIT:
            return self.unit
        if self.kind is Kind.LIT:
            return literal_unit(self.lit)
        return None

    def with_step(self, step: TraceStep) -> Value:
        return replace(self, trace=self.trace + (step,))

    def with_conf(self, conf: Conf) -> Value:
        return replace(self, conf=min(self.conf, conf))


BOT = Value(Kind.BOT)
TOP = Value(Kind.TOP)


def _trace_key(t: Trace) -> tuple[int, Trace]:
    return (len(t), t)


def shorter(a: Trace, b: Trace) -> Trace:
    """Deterministic choice: shortest trace, ties broken by step order (§1.1)."""
    return a if _trace_key(a) <= _trace_key(b) else b


@dataclass(frozen=True, slots=True)
class Merge:
    """A join of two different concrete amount units (candidate TW-005 at storage cells)."""

    left: Value
    right: Value


def join(a: Value, b: Value) -> tuple[Value, Merge | None]:
    """Least upper bound. Returns the joined value and a `Merge` event when two different amounts meet."""
    if a.kind is Kind.BOT:
        return b, None
    if b.kind is Kind.BOT:
        return a, None
    if a.kind is Kind.TOP or b.kind is Kind.TOP:
        return TOP, None
    # literals adopt the other side's unit (a `0` initialiser does not conflict with an amount)
    if a.kind is Kind.LIT and b.kind is Kind.LIT:
        if a.lit == b.lit:
            return replace(a, trace=shorter(a.trace, b.trace)), None
        return Value.literal(None, trace=shorter(a.trace, b.trace)), None
    if a.kind is Kind.LIT:
        return b, None
    if b.kind is Kind.LIT:
        return a, None
    if a.kind is Kind.TOKEN and b.kind is Kind.TOKEN and a.token == b.token:
        return replace(a, conf=min(a.conf, b.conf), trace=shorter(a.trace, b.trace)), None
    if a.kind is Kind.UNIT and b.kind is Kind.UNIT and a.unit == b.unit:
        trunc = a.trunc if a.trunc == b.trunc else None
        return replace(a, conf=min(a.conf, b.conf), trace=shorter(a.trace, b.trace), trunc=trunc), None
    merge = None
    if a.amount_unit is not None and b.amount_unit is not None:
        merge = Merge(a, b)
    return TOP, merge


# ---------------------------------------------------------------- multiplicative transfer (never collides)


def _fold(op: str, x: int, y: int) -> int | None:
    if op == "*":
        return x * y
    if op == "/":
        return x // y if y != 0 else None
    if op == "**":
        return x**y if 0 <= y <= 77 else None
    if op == "+":
        return x + y
    if op == "-":
        return x - y if x >= y else None
    if op == "%":
        return x % y if y != 0 else None
    return None


def fold_literals(op: str, a: Value, b: Value) -> Value | None:
    """Constant-fold two literals (powers of ten, `10**decimals()`), else None."""
    if a.kind is Kind.LIT and b.kind is Kind.LIT:
        v = _fold(op, a.lit, b.lit) if a.lit is not None and b.lit is not None else None
        return Value.literal(v, trace=shorter(a.trace, b.trace))
    return None


def mul(a: Value, b: Value) -> Value:
    return _muldiv("*", a, b)


def div(a: Value, b: Value) -> Value:
    return _muldiv("/", a, b)


def _muldiv(op: str, a: Value, b: Value) -> Value:
    folded = fold_literals(op, a, b)
    if folded is not None:
        return folded
    if a.kind in (Kind.BOT, Kind.TOP) or b.kind in (Kind.BOT, Kind.TOP):
        return TOP if Kind.TOP in (a.kind, b.kind) else BOT
    conf = min(a.conf, b.conf)
    # Token(x) keeps its own dimension through dimensionless scaling; anything else is Unknown.
    if a.kind is Kind.TOKEN or b.kind is Kind.TOKEN:
        tok, other = (a, b) if a.kind is Kind.TOKEN else (b, a)
        ou = other.mul_unit()
        if ou is not None and ou.is_dimensionless and not (op == "/" and tok is b):
            return replace(tok, conf=conf)
        return TOP
    ua, ub = a.mul_unit(), b.mul_unit()
    assert ua is not None and ub is not None
    res = ua * ub if op == "*" else ua / ub
    trace = a.trace if a.kind is Kind.UNIT else b.trace
    trunc = None
    if op == "/" and ua == NATIVE and res == ERC20:
        trunc = _trunc_key(a)
    elif a.trunc is not None and ub == DIMENSIONLESS:
        trunc = a.trunc
    return Value(Kind.UNIT, unit=res, conf=conf, trace=trace, trunc=trunc)


def _trunc_key(dividend: Value) -> str:
    return dividend.trace[0].expr if dividend.trace else "?"


def power(a: Value, b: Value) -> Value:
    """`10**k` with literal k → literal 10**k (a scale when k ∈ {6,12,18}); else dimensionless."""
    folded = fold_literals("**", a, b)
    if folded is not None:
        return folded
    if Kind.TOP in (a.kind, b.kind):
        return TOP
    if Kind.BOT in (a.kind, b.kind):
        return BOT
    return Value.of(DIMENSIONLESS, conf=min(a.conf, b.conf))


def modulo(a: Value, b: Value) -> Value:
    folded = fold_literals("%", a, b)
    if folded is not None:
        return folded
    return replace(a, trunc=None) if a.kind is Kind.UNIT else a


# ---------------------------------------------------------------- additive / comparison checks


class CollisionKind(Enum):
    MIXED_VIEWS = "mixed_views"  # (1,18) vs (1,6) → TW-001 / TW-002
    EXP_DRIFT = "exp_drift"  # amount with exp ∉ {6,18} vs a view → TW-008
    LITERAL_OTHER_VIEW = "literal_other_view"  # 10**k literal whose magnitude matches the other view → TW-006
    TOKEN_MIX = "token_mix"  # Token(x) vs a view → TW-900


@dataclass(frozen=True, slots=True)
class Collision:
    kind: CollisionKind
    left: Value
    right: Value

    @property
    def conf(self) -> Conf:
        c = min(self.left.conf, self.right.conf)
        return Conf.HEURISTIC if self.kind is CollisionKind.LITERAL_OTHER_VIEW else c


def check_equal(a: Value, b: Value) -> tuple[Value, Collision | None]:
    """`+ - == < …` and sink-vs-expected checks. Returns (result unit value, collision?).

    After a collision the result is TOP (cascade suppression, §6).
    """
    if a.kind is Kind.TOP or b.kind is Kind.TOP:
        return TOP, None
    if a.kind is Kind.BOT:
        return b, None
    if b.kind is Kind.BOT:
        return a, None
    # literal vs amount: adopt, but flag a power-of-ten magnitude that matches the other view (§4.3)
    if a.kind is Kind.LIT or b.kind is Kind.LIT:
        lit, other = (a, b) if a.kind is Kind.LIT else (b, a)
        if other.kind is Kind.LIT:
            return join(a, b)[0], None
        amt = other.amount_unit
        if amt is not None and view_of(amt) is not None and lit.lit is not None:
            k = pow10_exponent(lit.lit)
            if k is not None and is_other_view_magnitude(k, amt.exp):
                return TOP, Collision(CollisionKind.LITERAL_OTHER_VIEW, a, b)
        return other, None
    if a.kind is Kind.TOKEN or b.kind is Kind.TOKEN:
        if a.kind is Kind.TOKEN and b.kind is Kind.TOKEN:
            return (a, None) if a.token == b.token else (TOP, None)
        other = b if a.kind is Kind.TOKEN else a
        if other.amount_unit is not None and view_of(other.amount_unit) == "native":
            return TOP, Collision(CollisionKind.TOKEN_MIX, a, b)
        return TOP, None
    ua, ub = a.unit, b.unit
    assert ua is not None and ub is not None
    if ua == ub:
        return join(a, b)[0], None
    if ua.dim == 0 or ub.dim == 0:
        # dimensionless vs anything: no unit claim (counts, bps, …); keep the dimensioned side
        return (b if ua.dim == 0 else a), None
    if ua.dim == 1 and ub.dim == 1:
        va, vb = view_of(ua), view_of(ub)
        if va is not None and vb is not None:
            return TOP, Collision(CollisionKind.MIXED_VIEWS, a, b)
        drift = ua if va is None else ub
        if (va is None) != (vb is None) and not 0 <= drift.exp <= NATIVE_EXP:
            # One side is a view, the other an amount outside [0, 18]: only a conversion applied in the wrong
            # direction (a18 * scale, a6 / scale) gets there. In-range exponents are indistinguishable from
            # fixed-point math (WAD and ppm divisors) and stay silent (ADR-019).
            return TOP, Collision(CollisionKind.EXP_DRIFT, a, b)
    return TOP, None


def expect(value: Value, expected: Unit) -> Collision | None:
    """Sink check: `value` must carry `expected` (a view). Returns the collision, if any."""
    _, c = check_equal(value, Value.of(expected))
    if c is None:
        return None
    if c.kind is CollisionKind.LITERAL_OTHER_VIEW:
        return None  # a literal amount passed to a sink is not a TW-006 site
    return c


def is_scale_literal(v: Value) -> bool:
    return v.kind is Kind.LIT and v.lit is not None and pow10_exponent(v.lit) in SCALE_EXPONENTS
