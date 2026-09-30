// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}


/// Payment token fixed at construction; deployed with 0x3600. Only deployed mode can bind it (ANALYZER §3.2).
contract ImmutableCashier {
    IERC20 public immutable payToken;

    constructor(IERC20 t) {
        payToken = t;
    }

    function cashOut(address to) external payable {
        payToken.transfer(to, msg.value); // @expect TW-004 HIGH cashOut(address)
    }
}