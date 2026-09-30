"""TW-001 MIXED_ARITH — `+`/`-` between the native (18) and ERC-20 (6) views."""

from twelve.rules import Rule

RULE = Rule(
    id="TW-001",
    name="MIXED_ARITH",
    severity="HIGH",
    messages={
        "default": "Adds or subtracts a native amount (18 decimals) and a USDC ERC-20 amount (6 decimals): "
        "the raw values differ by 10^12.",
    },
    fix="Convert one side first: ERC-20 amounts to native with Usdc.toNative(...), or type both as Usdc6/Usdc18.",
)
