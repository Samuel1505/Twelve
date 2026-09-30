"""TW-900 UNRESOLVED_TOKEN_MIX — an unresolved token's amounts meet native amounts."""

from twelve.rules import Rule

RULE = Rule(
    id="TW-900",
    name="UNRESOLVED_TOKEN_MIX",
    severity="INFO",
    messages={
        "default": "Amount of an unresolved token is mixed with a native amount (18 decimals). "
        "If this token is USDC on Arc (6 decimals), this is a 10^12 bug.",
    },
    fix="If the token can be USDC, convert explicitly; declare the binding in twelve.toml to get a definite result.",
)
