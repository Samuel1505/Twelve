// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}


/// Basis-point fee math on native amounts only.
contract Marketplace {
    address payable public immutable treasury = payable(msg.sender);

    function buy(address payable seller) external payable {
        uint256 fee = msg.value * 30 / 10_000;
        treasury.transfer(fee);
        (bool ok,) = seller.call{value: msg.value - fee}("");
        require(ok, "send");
    }
}