"""twelve.sources_sinks — where units are born and where they are checked (docs/ANALYZER.md §2, §4, §5)."""

from __future__ import annotations

from typing import Final

from twelve.units import DIMENSIONLESS, NATIVE, Unit

USDC_ERC20_ADDRESS: Final[int] = 0x3600000000000000000000000000000000000000
USDC_DECIMALS: Final[int] = 6

# SolidityVariableComposed names that are native-view amounts on Arc (§2).
NATIVE_SOLIDITY_VARIABLES: Final[frozenset[str]] = frozenset(
    {"msg.value", "tx.gasprice", "block.basefee", "block.blobbasefee"}
)

# SolidityCall function names -> unit of the result.
SOLIDITY_CALL_UNITS: Final[dict[str, Unit]] = {
    "balance(address)": NATIVE,
    "gasleft()": DIMENSIONLESS,
}

# Calls on a bound USDC ERC-20 receiver whose return is a 6-decimal amount.
ERC20_AMOUNT_GETTERS: Final[frozenset[str]] = frozenset({"balanceOf", "allowance", "totalSupply"})
ERC20_DECIMALS_GETTER: Final[str] = "decimals"

# Direct calls on the ERC-20 receiver: function name -> index of the amount argument.
ERC20_SINKS: Final[dict[str, int]] = {
    "transfer": 1,
    "transferFrom": 2,
    "approve": 1,
    "increaseAllowance": 1,
    "decreaseAllowance": 1,
}

# SafeERC20-style library calls (token is argument 0): function name -> index of the amount argument.
ERC20_LIBRARY_SINKS: Final[dict[str, int]] = {
    "safeTransfer": 2,
    "safeTransferFrom": 3,
    "safeApprove": 2,
    "forceApprove": 2,
    "safeIncreaseAllowance": 2,
    "safeDecreaseAllowance": 2,
}

# Math library models (§4): name -> model. Applied to library calls instead of analyzing their bodies
# (OZ/solmate implementations are assembly-heavy).
MULDIV_FUNCTIONS: Final[frozenset[str]] = frozenset({"mulDiv", "mulDivDown", "mulDivUp", "fullMulDiv"})
MINMAX_FUNCTIONS: Final[frozenset[str]] = frozenset({"min", "max"})

# Guard UDVTs (docs/GUARD.md): values of these types carry their unit by construction (§5.1).
TYPED_UNITS: Final[dict[str, Unit]] = {"Usdc6": Unit(1, 6), "Usdc18": NATIVE}

# Pre-deploy name heuristic for interface-typed state variables (§3.3).
USDC_NAME_HEURISTIC: Final[frozenset[str]] = frozenset({"usdc", "USDC", "_usdc"})
