// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}


/// Sells a ticket priced from the ERC-20 treasury balance, paid natively.
contract TicketBooth {
    IERC20 constant USDC = IERC20(0x3600000000000000000000000000000000000000);
    uint256 public price6;
    uint256 public sold;

    function syncPrice() external {
        price6 = USDC.balanceOf(address(this)) / 100;
    }

    function buy() external payable {
        require(msg.value >= price6, "price"); // @expect TW-002 HIGH buy()
        sold += 1;
    }
}