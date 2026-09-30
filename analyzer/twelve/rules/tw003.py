"""TW-003 NATIVE_SINK_6 — a 6-decimal value reaches call{value}/transfer/send."""

from twelve.rules import Rule

RULE = Rule(
    id="TW-003",
    name="NATIVE_SINK_6",
    severity="HIGH",
    messages={
        "default": "USDC ERC-20 amount (6 decimals) is sent natively (18 decimals): "
        "pays 10^-12 of the intended amount (dust).",
    },
    fix="Convert with Usdc.toNative(...) before sending natively, or pay through the ERC-20 interface.",
)
