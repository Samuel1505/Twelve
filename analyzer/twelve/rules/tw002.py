"""TW-002 MIXED_COMPARE — comparison or min/max between the two views."""

from twelve.rules import Rule

RULE = Rule(
    id="TW-002",
    name="MIXED_COMPARE",
    severity="HIGH",
    messages={
        "default": "Compares a native amount (18 decimals) with a USDC ERC-20 amount (6 decimals): "
        "the check is off by 10^12 and always or never passes.",
    },
    fix="Compare in one view: scale the ERC-20 side with Usdc.toNative(...) or keep both as Usdc6/Usdc18.",
)
