// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}


/// Payment token set after deployment through a setter; set to 0x3600 on testnet.
contract StorageCashier {
    IERC20 public payToken;
    address public immutable admin = msg.sender;

    function setToken(IERC20 t) external {
        require(msg.sender == admin, "admin");
        payToken = t;
    }

    function cashOut(address to) external payable {
        payToken.transfer(to, msg.value); // @expect TW-004 HIGH cashOut(address)
    }
}