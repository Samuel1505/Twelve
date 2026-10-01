// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC20Min {
    function transferFrom(address, address, uint256) external returns (bool);
}

/// @title LeakyRefund
/// @notice DELIBERATELY VULNERABLE — Twelve demo. Do not send funds.
/// @dev A ticket shop that takes payment through the ERC-20 view (6 decimals) and, when sold out, refunds through
///      the native view (18 decimals) without converting: the buyer gets 10^-12 of their money back (docs/GUARD.md §4.1).
///      Analyzer: TW-003 HIGH. Monitor: D1 HIGH (ERC-20 inflow y, native outflow raw y, same tx).
contract LeakyRefund {
    IERC20Min public constant USDC = IERC20Min(0x3600000000000000000000000000000000000000);
    uint256 public immutable capacity;
    uint256 public sold;

    bool private transient _locked;

    error Reentrancy();
    error RefundFailed();

    /// @param capacity_ Tickets for sale before every further buy is refunded.
    constructor(uint256 capacity_) {
        capacity = capacity_;
    }

    /// @notice Buy a ticket paying `paid6` USDC through the ERC-20 interface (requires approval).
    /// @param paid6 Amount in the ERC-20 view (6 decimals).
    function buy(uint256 paid6) external {
        if (_locked) revert Reentrancy();
        _locked = true;
        USDC.transferFrom(msg.sender, address(this), paid6); // ERC-20 view, 6-dec
        if (sold >= capacity) {
            (bool ok,) = payable(msg.sender).call{value: paid6}(""); // BUG: native view expects 18-dec
            if (!ok) revert RefundFailed();
        } else {
            sold++;
        }
        _locked = false;
    }
}
