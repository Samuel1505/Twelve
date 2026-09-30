"""TW-006 LITERAL_OTHER_VIEW — a power-of-ten threshold whose magnitude matches the other view."""

from twelve.rules import Rule

RULE = Rule(
    id="TW-006",
    name="LITERAL_OTHER_VIEW",
    severity="MEDIUM",
    messages={
        "native": "Threshold literal has the magnitude of a 6-decimal USDC amount but is compared with a "
        "native amount (18 decimals): it is 10^12 times too small.",
        "erc20": "Threshold literal has the magnitude of an 18-decimal native amount but is compared with a "
        "USDC ERC-20 amount (6 decimals): it is 10^12 times too large.",
    },
    fix="Write the threshold in the view it is compared with (1 USDC = 10^18 native units = 10^6 ERC-20 units).",
)
