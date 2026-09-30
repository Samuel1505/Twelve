from twelve.units import (
    DIMENSIONLESS,
    ERC20,
    NATIVE,
    SCALE,
    SUBDENOMINATION_UNITS,
    Unit,
    is_other_view_magnitude,
    literal_unit,
    pow10_exponent,
    view_of,
)


def test_scale_is_ten_to_twelve() -> None:
    assert SCALE == pow(10, 12)
    assert pow10_exponent(SCALE) == 12


def test_pow10_exponent() -> None:
    assert pow10_exponent(10) == 1
    assert pow10_exponent(pow(10, 18)) == 18
    assert pow10_exponent(1) is None  # 10**0 is not a scale
    assert pow10_exponent(0) is None
    assert pow10_exponent(20) is None
    assert pow10_exponent(10_001) is None


def test_scale_table_only_6_12_18() -> None:
    # §5.3: bps denominators and other powers of ten are dimensionless
    assert literal_unit(pow(10, 6)) == Unit(0, 6)
    assert literal_unit(pow(10, 12)) == Unit(0, 12)
    assert literal_unit(pow(10, 18)) == Unit(0, 18)
    for k in (1, 2, 3, 4, 5, 8, 9, 24):
        assert literal_unit(pow(10, k)) == DIMENSIONLESS, k
    assert literal_unit(10_000) == DIMENSIONLESS
    assert literal_unit(7) == DIMENSIONLESS
    assert literal_unit(None) == DIMENSIONLESS


def test_conversion_arithmetic() -> None:
    assert ERC20 * Unit(0, 12) == NATIVE
    assert NATIVE / Unit(0, 12) == ERC20
    assert NATIVE * DIMENSIONLESS / DIMENSIONLESS == NATIVE  # bps fee math stays native


def test_ether_suffixes() -> None:
    assert SUBDENOMINATION_UNITS["ether"] == NATIVE
    assert SUBDENOMINATION_UNITS["gwei"] == Unit(1, 9)
    assert SUBDENOMINATION_UNITS["wei"] == Unit(1, 0)


def test_views_and_other_view_magnitude() -> None:
    assert view_of(NATIVE) == "native" and view_of(ERC20) == "erc20" and view_of(Unit(1, 14)) is None
    assert is_other_view_magnitude(6, 18) and is_other_view_magnitude(18, 6)
    assert not is_other_view_magnitude(18, 18) and not is_other_view_magnitude(4, 18)
