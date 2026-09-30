// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}


/// Sells an arbitrary token 1:1 for native USDC. If `token` is USDC on Arc, the units differ by 10^12.
contract Swap {
    IERC20 public immutable token;

    constructor(IERC20 t) {
        token = t;
    }

    function buy() external payable {
        require(token.balanceOf(address(this)) >= msg.value, "liquidity"); // @expect TW-900 INFO buy()
        token.transfer(msg.sender, msg.value); // @expect TW-900 INFO buy()
    }
}