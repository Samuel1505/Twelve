"""TW-005 STORAGE_UNIT_MERGE — a state cell written with both views."""

from twelve.rules import Rule

RULE = Rule(
    id="TW-005",
    name="STORAGE_UNIT_MERGE",
    severity="HIGH",
    messages={
        "default": "This storage location is written with both native (18 decimals) and USDC ERC-20 "
        "(6 decimals) amounts; every later read is ambiguous by 10^12.",
    },
    fix="Store one view only (convert at the write site), or type the storage as Usdc6/Usdc18.",
)
