// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Usdc, Usdc6, Usdc18} from "./Usdc.sol";

/// @title TwelvePayout
/// @notice Runtime check for untyped legacy code (docs/GUARD.md §2): pay natively while declaring the intended amount
///         in ERC-20 units. If the two disagree by anything — including the 10^12 bug — the payment reverts.
/// @dev A rolling cap per window bounds the blast radius of bugs the equality check cannot see.
abstract contract TwelvePayout {
    error UnitMismatch(uint256 intended6, uint256 native18);
    error WindowCapExceeded(uint256 attempted6, uint256 remaining6);

    /// @notice Maximum paid out per window, in ERC-20 units (6 decimals).
    uint256 public immutable windowCap6;
    /// @notice Window length in seconds.
    uint256 public immutable windowLength;

    uint256 private _windowStart;
    uint256 private _spent6;

    /// @param windowCap6_ Cap per window in ERC-20 units.
    /// @param windowLength_ Window length in seconds.
    constructor(uint256 windowCap6_, uint256 windowLength_) {
        windowCap6 = windowCap6_;
        windowLength = windowLength_;
    }

    /// @dev Pays exactly `intended6` USDC natively. `native18` is what the legacy code computed; it must equal
    ///      `intended6` in the native view or the call reverts. This is the 10^12 circuit breaker.
    function _payNativeChecked(address payable to, uint256 intended6, uint256 native18) internal {
        if (Usdc18.unwrap(Usdc.toNative(Usdc6.wrap(intended6))) != native18) revert UnitMismatch(intended6, native18);
        _consume(intended6);
        Usdc.sendNative(to, Usdc18.wrap(native18));
    }

    /// @notice What can still be paid out in the current window, in ERC-20 units.
    function remainingInWindow6() public view returns (uint256) {
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp >= _windowStart + windowLength) return windowCap6;
        return windowCap6 - _spent6;
    }

    function _consume(uint256 amt6) private {
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp >= _windowStart + windowLength) {
            _windowStart = block.timestamp;
            _spent6 = 0;
        }
        uint256 remaining = windowCap6 - _spent6;
        if (amt6 > remaining) revert WindowCapExceeded(amt6, remaining);
        _spent6 += amt6;
    }
}
