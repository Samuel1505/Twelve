// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}


/// Sums both views correctly in native units.
contract Meter {
    IERC20 constant USDC = IERC20(0x3600000000000000000000000000000000000000);
    uint256 constant MIN18 = 5e18;

    function checkIn() external payable returns (uint256 total18) {
        total18 = USDC.balanceOf(msg.sender) * 1e12 + msg.value;
        require(total18 >= MIN18, "min");
        require(10 ** 12 * USDC.balanceOf(address(this)) >= msg.value, "reserve");
    }
}