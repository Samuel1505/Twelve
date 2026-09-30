// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}


/// Minimum contribution of "1 USDC", written in the wrong view.
contract Tipjar {
    uint256 public total;

    function tip() external payable {
        require(msg.value >= 1e6, "min 1 USDC"); // @expect TW-006 MEDIUM tip()
        total += msg.value;
    }
}