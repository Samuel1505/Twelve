// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}


/// ETH-style escrow; only native flows.
contract Escrow {
    mapping(address => uint256) public held;

    function fund(address payee) external payable {
        held[payee] += msg.value;
    }

    function release() external {
        uint256 amt = held[msg.sender];
        held[msg.sender] = 0;
        require(address(this).balance >= amt, "insolvent");
        (bool ok,) = payable(msg.sender).call{value: amt}("");
        require(ok, "send");
    }
}