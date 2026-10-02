// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Usdc, Usdc6} from "../guard/Usdc.sol";

/// @title FixedRefund
/// @notice Twelve demo: LeakyRefund's ticket shop with typed amounts. Do not send funds.
/// @dev Same flow as LeakyRefund (docs/GUARD.md §4.2), but the amount is a Usdc6 and the refund converts it with
///      Usdc.toNative, so the buyer gets back exactly what they paid. Analyzer: CLEAN. Monitor: native outflow raw is
///      the inflow × 10^12, so no D1.
contract FixedRefund {
    uint256 public immutable capacity;
    uint256 public sold;

    bool private transient _locked;

    error Reentrancy();

    /// @param capacity_ Tickets for sale before every further buy is refunded.
    constructor(uint256 capacity_) {
        capacity = capacity_;
    }

    /// @notice Buy a ticket paying `paid` USDC through the ERC-20 interface (requires approval).
    /// @param paid Amount in the ERC-20 view (6 decimals).
    function buy(Usdc6 paid) external {
        if (_locked) revert Reentrancy();
        _locked = true;
        Usdc.pullErc20(msg.sender, paid);
        if (sold >= capacity) {
            Usdc.sendNative(payable(msg.sender), Usdc.toNative(paid)); // same value, native view
        } else {
            sold++;
        }
        _locked = false;
    }
}
