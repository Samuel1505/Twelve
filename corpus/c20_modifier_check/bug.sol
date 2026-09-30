// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}


/// Minimum payment enforced in a modifier, set from the ERC-20 view.
contract Club {
    IERC20 constant USDC = IERC20(0x3600000000000000000000000000000000000000);
    uint256 public minDues6;
    uint256 public members;

    modifier paysDues() {
        require(msg.value >= minDues6, "dues"); // @expect TW-002 HIGH paysDues()
        _;
    }

    function setDues() external {
        minDues6 = USDC.balanceOf(address(this)) / 1000;
    }

    function join() external payable paysDues {
        members += 1;
    }
}