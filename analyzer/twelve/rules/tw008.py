"""TW-008 EXP_DRIFT — an amount at a non-view exponent reaches a sink or a view comparison."""

from twelve.rules import Rule

RULE = Rule(
    id="TW-008",
    name="EXP_DRIFT",
    severity="LOW",
    messages={
        "default": "Amount has a decimal exponent that matches neither view (6 or 18) where a view is "
        "expected; usually a missing or extra divisor in fee or price math.",
    },
    fix="Check the scaling: the result should be exactly 6 (ERC-20) or 18 (native) decimals.",
)
