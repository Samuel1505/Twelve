// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}


/// Credits native deposits, pays withdrawals through the ERC-20 interface.
contract Bank {
    IERC20 constant USDC = IERC20(0x3600000000000000000000000000000000000000);
    mapping(address => uint256) public credits;

    function deposit() external payable {
        credits[msg.sender] += msg.value;
    }

    function withdraw() external {
        uint256 amt = credits[msg.sender];
        credits[msg.sender] = 0;
        USDC.transfer(msg.sender, amt); // @expect TW-004 HIGH withdraw()
    }
}