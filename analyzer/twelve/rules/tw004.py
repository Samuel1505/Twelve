"""TW-004 ERC20_SINK_18 — an 18-decimal value reaches USDC.transfer/transferFrom/approve."""

from twelve.rules import Rule

RULE = Rule(
    id="TW-004",
    name="ERC20_SINK_18",
    severity="HIGH",
    messages={
        "default": "Native amount (18 decimals) flows into a USDC ERC-20 call (6 decimals): "
        "pays 10^12 times the intended amount, or reverts.",
    },
    fix="Convert with Usdc.toErc20(...) (floor, returns dust) or pay natively.",
)
