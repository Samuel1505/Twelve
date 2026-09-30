// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}


/// Lends the pool's idle USDC against native collateral.
contract Lender {
    IERC20 constant USDC = IERC20(0x3600000000000000000000000000000000000000);
    uint256 constant LTV_BPS = 7500;
    uint256 constant SCALE = 1e12;
    mapping(address => uint256) public collateral; // native, 18 decimals
    mapping(address => uint256) public debt; // ERC-20, 6 decimals

    function depositCollateral() external payable {
        collateral[msg.sender] += msg.value;
    }

    function borrowAll() external {
        uint256 available = USDC.balanceOf(address(this));
        require(collateral[msg.sender] * LTV_BPS / 10_000 >= available * SCALE, "LTV");
        debt[msg.sender] += available;
        USDC.transfer(msg.sender, available);
    }
}