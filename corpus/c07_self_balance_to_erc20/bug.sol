// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}


/// Sweeps the contract balance to the owner.
contract Sweeper {
    IERC20 constant USDC = IERC20(0x3600000000000000000000000000000000000000);
    address public immutable owner = msg.sender;

    function sweep() external {
        USDC.transfer(owner, address(this).balance); // @expect TW-004 HIGH sweep()
    }
}