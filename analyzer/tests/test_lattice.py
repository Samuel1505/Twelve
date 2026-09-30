from hypothesis import given
from hypothesis import strategies as st

from twelve.lattice import (
    BOT,
    TOP,
    CollisionKind,
    Conf,
    Kind,
    Value,
    check_equal,
    div,
    expect,
    join,
    mul,
    power,
)
from twelve.units import ERC20, NATIVE, Unit

units = st.builds(Unit, st.integers(-2, 2), st.integers(-24, 36))
values = st.one_of(
    st.just(BOT), st.just(TOP),
    st.builds(Value.of, units, st.sampled_from(list(Conf))),
    st.builds(Value.literal, st.one_of(st.none(), st.integers(0, pow(10, 20)))),
    st.builds(Value.of_token, st.sampled_from(["t1", "t2"])),
)


def core(v: Value) -> tuple[object, ...]:
    # compare lattice position, ignoring trace/conf metadata
    return (v.kind, v.unit, v.lit if v.kind is Kind.LIT else None, v.token)


@given(values, values)
def test_join_commutative(a: Value, b: Value) -> None:
    assert core(join(a, b)[0]) == core(join(b, a)[0])


@given(values, values, values)
def test_join_associative(a: Value, b: Value, c: Value) -> None:
    left = join(join(a, b)[0], c)[0]
    right = join(a, join(b, c)[0])[0]
    assert core(left) == core(right)


@given(values)
def test_join_identity_and_idempotence(a: Value) -> None:
    assert core(join(BOT, a)[0]) == core(a)
    assert core(join(a, a)[0]) == core(a)
    assert join(TOP, a)[0].kind is Kind.TOP


@given(units, units)
def test_div_inverts_mul(u: Unit, s: Unit) -> None:
    a = Value.of(u)
    assert div(mul(a, Value.of(s)), Value.of(s)).unit == u


@given(values)
def test_unknown_absorbs(a: Value) -> None:
    if a.kind is Kind.BOT:
        return
    assert mul(TOP, a).kind is Kind.TOP
    assert div(a, TOP).kind is Kind.TOP
    assert check_equal(TOP, a) == (TOP, None)


def test_merge_event_only_for_two_amounts() -> None:
    _, m = join(Value.of(NATIVE), Value.of(ERC20))
    assert m is not None
    v, m = join(Value.literal(0), Value.of(NATIVE))  # `x = 0` then `x += msg.value`
    assert m is None and v.unit == NATIVE
    _, m = join(Value.of(Unit(0, 0)), Value.of(NATIVE))
    assert m is None


def test_conversions_are_clean() -> None:
    scale = Value.literal(pow(10, 12))
    a6 = Value.of(ERC20)
    assert mul(a6, scale).unit == NATIVE
    to6 = div(Value.of(NATIVE), scale)
    assert to6.unit == ERC20 and to6.trunc is not None
    # a6 * SCALE + msg.value is correct (h04)
    assert check_equal(mul(a6, scale), Value.of(NATIVE))[1] is None
    # the power form (10 ** k with k = 12) folds to the same scale
    assert power(Value.literal(10), Value.literal(12)).lit == pow(10, 12)


def test_bps_math_stays_native() -> None:
    fee = div(mul(Value.of(NATIVE), Value.literal(250)), Value.literal(10_000))
    assert fee.unit == NATIVE


def test_collisions() -> None:
    _, c = check_equal(Value.of(NATIVE), Value.of(ERC20))
    assert c is not None and c.kind is CollisionKind.MIXED_VIEWS
    _, c = check_equal(Value.of(NATIVE), Value.literal(pow(10, 6)))
    assert c is not None and c.kind is CollisionKind.LITERAL_OTHER_VIEW and c.conf is Conf.HEURISTIC
    _, c = check_equal(Value.of(NATIVE), Value.literal(pow(10, 18)))
    assert c is None
    _, c = check_equal(Value.of(Unit(1, 14)), Value.of(NATIVE))
    assert c is not None and c.kind is CollisionKind.EXP_DRIFT
    _, c = check_equal(Value.of_token("t"), Value.of(NATIVE))
    assert c is not None and c.kind is CollisionKind.TOKEN_MIX
    # dimensionless vs amount: no claim
    assert check_equal(Value.of(Unit(0, 0)), Value.of(NATIVE))[1] is None


def test_sink_expectations() -> None:
    assert expect(Value.of(NATIVE), ERC20) is not None
    assert expect(Value.of(ERC20), ERC20) is None
    assert expect(TOP, ERC20) is None
    assert expect(Value.literal(pow(10, 6)), NATIVE) is None  # literal to a sink is not TW-006


def test_confidence_is_weakest_link() -> None:
    _, c = check_equal(Value.of(NATIVE, Conf.DEFINITE), Value.of(ERC20, Conf.INFERRED))
    assert c is not None and c.conf is Conf.INFERRED
