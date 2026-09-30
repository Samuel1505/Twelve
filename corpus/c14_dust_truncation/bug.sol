// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}


/// Converts a native payment to ERC-20 units and forwards it; the remainder is ignored.
contract Forwarder {
    IERC20 constant USDC = IERC20(0x3600000000000000000000000000000000000000);

    function forward(address to) external payable {
        uint256 amt6 = msg.value / 1e12;
        USDC.transfer(to, amt6); // @expect TW-007 INFO forward(address)
    }
}