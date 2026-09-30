// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}


/// Pulls an ERC-20 amount, then tips 1% of it natively.
contract Tipper {
    IERC20 constant USDC = IERC20(0x3600000000000000000000000000000000000000);
    uint256 constant SCALE = 1e12;
    address payable public immutable owner = payable(msg.sender);

    function depositAndTip(uint256 amount) external {
        USDC.transferFrom(msg.sender, address(this), amount);
        (bool ok,) = owner.call{value: amount * SCALE / 100}("");
        require(ok, "tip");
    }
}