// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}


/// Takes a protocol fee on native payments, forwards it natively.
contract Checkout {
    IERC20 constant USDC = IERC20(0x3600000000000000000000000000000000000000);
    uint256 constant FEE_BPS = 30;
    address public immutable treasury = msg.sender;

    function pay(address payable seller) external payable {
        uint256 fee = msg.value * FEE_BPS / 1e4;
        (bool okFee,) = payable(treasury).call{value: fee}("");
        require(okFee, "fee");
        (bool ok,) = seller.call{value: msg.value - fee}("");
        require(ok, "send");
    }
}