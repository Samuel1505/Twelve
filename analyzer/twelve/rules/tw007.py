"""TW-007 DUST_TRUNCATION — an 18→6 floor conversion sent via ERC-20 while the remainder is dropped."""

from twelve.rules import Rule

RULE = Rule(
    id="TW-007",
    name="DUST_TRUNCATION",
    severity="INFO",
    messages={
        "default": "Native amount is floored to 6 decimals and sent through the ERC-20 interface; "
        "the remainder below 10^-6 USDC is never accounted for.",
    },
    fix="Use Usdc.toErc20(...) and refund or record the returned dust, or Usdc.toErc20Exact(...).",
)
