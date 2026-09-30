// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}


/// Sells an arbitrary token for native USDC at a stored rate; no raw cross-view mixing.
contract Swap {
    IERC20 public immutable token;

    constructor(IERC20 t) {
        token = t;
    }

    function buy(uint256 amountOut) external payable {
        require(token.balanceOf(address(this)) >= amountOut, "liquidity");
        token.transfer(msg.sender, amountOut);
    }
}