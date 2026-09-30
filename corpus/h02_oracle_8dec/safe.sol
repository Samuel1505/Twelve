// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}


interface AggregatorV3 {
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}

/// Pays out the USD value of the pool using an 8-decimal oracle; result stays in 6 decimals.
contract OraclePayout {
    IERC20 constant USDC = IERC20(0x3600000000000000000000000000000000000000);
    uint256 constant FIXED_PRICE8 = 99_000_000; // 0.99, 8 decimals
    AggregatorV3 public immutable feed;

    constructor(AggregatorV3 f) {
        feed = f;
    }

    function payFixed(address to) external {
        uint256 value6 = USDC.balanceOf(address(this)) * FIXED_PRICE8 / 1e8;
        USDC.transfer(to, value6);
    }

    function payOracle(address to) external {
        (, int256 answer,,,) = feed.latestRoundData();
        uint256 value6 = USDC.balanceOf(address(this)) * uint256(answer) / 1e8;
        USDC.transfer(to, value6);
    }
}