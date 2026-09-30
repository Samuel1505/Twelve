// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

// The ONLY Solidity file where the 10^12 USDC scale appears (invariant I1).
// Usdc6 / Usdc18 UDVTs, operators and conversions land in Phase 6 (docs/GUARD.md).

/// @dev Raw-integer ratio between the native (18-dec) and ERC-20 (6-dec) views of USDC.
uint256 constant SCALE = 1e12;
