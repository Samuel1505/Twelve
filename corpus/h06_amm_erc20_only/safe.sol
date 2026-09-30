// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}


/// Constant-product quote entirely in the ERC-20 view.
contract Pool6 {
    IERC20 constant USDC = IERC20(0x3600000000000000000000000000000000000000);
    uint256 public reserveIn;
    uint256 public reserveOut;

    function sync() external {
        reserveIn = USDC.balanceOf(address(this)) / 2;
        reserveOut = USDC.balanceOf(address(this)) - reserveIn;
    }

    function swap(address to) external {
        uint256 amountIn = USDC.balanceOf(address(this)) - reserveIn - reserveOut;
        uint256 amountInWithFee = amountIn * 997;
        uint256 amountOut = amountInWithFee * reserveOut / (reserveIn * 1000 + amountInWithFee);
        reserveIn += amountIn;
        reserveOut -= amountOut;
        USDC.transfer(to, amountOut);
    }
}