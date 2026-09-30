"""twelve.units — the ONLY Python module where the 10**12 USDC scale appears (I1).

Unit algebra (docs/ANALYZER.md §1) and the power-of-ten scale table (§5.3). A `Unit` is `(dim, exp)`:
`dim` is the power of the USDC-amount dimension, `exp` the decimal exponent of the raw integer.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal

SCALE: Final[int] = 10**12
"""Raw-integer ratio between the native (18-dec) and ERC-20 (6-dec) views."""

SCALE_EXPONENTS: Final[frozenset[int]] = frozenset({6, 12, 18})
"""A power-of-ten literal is a *scale* only for these exponents (§5.3). `1e4` (bps) is not."""

NATIVE_EXP: Final[int] = 18
ERC20_EXP: Final[int] = 6


@dataclass(frozen=True, order=True, slots=True)
class Unit:
    dim: int
    exp: int

    def __mul__(self, other: Unit) -> Unit:  # ⊗
        return Unit(self.dim + other.dim, self.exp + other.exp)

    def __truediv__(self, other: Unit) -> Unit:  # ⊘
        return Unit(self.dim - other.dim, self.exp - other.exp)

    @property
    def is_amount(self) -> bool:
        return self.dim == 1

    @property
    def is_dimensionless(self) -> bool:
        return self.dim == 0

    def as_json(self) -> list[int]:
        return [self.dim, self.exp]

    def __str__(self) -> str:
        return f"({self.dim},{self.exp})"


NATIVE: Final[Unit] = Unit(1, NATIVE_EXP)
ERC20: Final[Unit] = Unit(1, ERC20_EXP)
DIMENSIONLESS: Final[Unit] = Unit(0, 0)

View = Literal["native", "erc20"]


def view_of(u: Unit) -> View | None:
    if u == NATIVE:
        return "native"
    if u == ERC20:
        return "erc20"
    return None


def pow10_exponent(v: int) -> int | None:
    """k if v == 10**k (k >= 1), else None."""
    if v < 10:
        return None
    k = 0
    while v % 10 == 0:
        v //= 10
        k += 1
    return k if v == 1 else None


def literal_unit(v: int | None) -> Unit:
    """Unit of an integer literal in multiplicative position (§2, §5.3)."""
    if v is None:
        return DIMENSIONLESS
    k = pow10_exponent(v)
    return Unit(0, k) if k is not None and k in SCALE_EXPONENTS else DIMENSIONLESS


SUBDENOMINATION_UNITS: Final[dict[str, Unit]] = {
    # On Arc the native coin *is* USDC, so ether-suffixed literals are native amounts (§2, HEURISTIC).
    "ether": Unit(1, 18),
    "gwei": Unit(1, 9),
    "wei": Unit(1, 0),
}


def is_other_view_magnitude(k: int, amount_exp: int) -> bool:
    """TW-006: a 10**k literal compared against an amount of exponent `amount_exp` (§4.3)."""
    return abs(amount_exp - k) == NATIVE_EXP - ERC20_EXP


def is_view_conversion_scale(u: Unit) -> bool:
    """True for the (0,12) scale that converts between the two views."""
    return u == Unit(0, NATIVE_EXP - ERC20_EXP)
