// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {TwelvePayout} from "../guard/TwelvePayout.sol";

interface IUsdcTransfer {
    function transfer(address, uint256) external returns (bool);
}

/// @title OverpayVault
/// @notice DELIBERATELY VULNERABLE — Twelve demo. Do not send funds.
/// @dev The drain shape (docs/GUARD.md §4.3): deposits are credited in the native view (msg.value, 18 decimals) and
///      paid out through the ERC-20 view (6 decimals) without converting, asking for 10^12 times the deposit.
///      Analyzer: TW-004 HIGH. `withdrawGuarded` routes the same legacy amount through TwelvePayout, which refuses it
///      with UnitMismatch before any value moves. Keep the vault's balance trivial: the unguarded path would pay out
///      whatever it holds.
contract OverpayVault is TwelvePayout {
    IUsdcTransfer public constant USDC = IUsdcTransfer(0x3600000000000000000000000000000000000000);

    mapping(address => uint256) public credits;

    bool private transient _locked;

    error Reentrancy();
    error NothingToWithdraw();
    error TransferFailed();

    modifier nonReentrant() {
        if (_locked) revert Reentrancy();
        _locked = true;
        _;
        _locked = false;
    }

    /// @param windowCap6_ Guarded payout cap per window, ERC-20 units.
    /// @param windowLength_ Window length in seconds.
    constructor(uint256 windowCap6_, uint256 windowLength_) TwelvePayout(windowCap6_, windowLength_) {}

    /// @notice Deposit native USDC; it is credited in the native view.
    function deposit() external payable {
        credits[msg.sender] += msg.value; // native view, 18-dec
    }

    /// @notice Withdraw the credit through the ERC-20 interface. BUG: the 18-dec credit is used as a 6-dec amount.
    function withdraw() external nonReentrant {
        uint256 c = credits[msg.sender];
        if (c == 0) revert NothingToWithdraw();
        credits[msg.sender] = 0;
        if (!USDC.transfer(msg.sender, c)) revert TransferFailed(); // BUG: ERC-20 view expects 6-dec
    }

    /// @notice The same legacy amount, paid through TwelvePayout: reverts with UnitMismatch instead of mispaying.
    function withdrawGuarded() external nonReentrant {
        uint256 c = credits[msg.sender];
        if (c == 0) revert NothingToWithdraw();
        credits[msg.sender] = 0;
        // legacy code believes `c` is an ERC-20 amount; the check compares it with what it actually sends natively
        _payNativeChecked(payable(msg.sender), c, c);
    }
}
