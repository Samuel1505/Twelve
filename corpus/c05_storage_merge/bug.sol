// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}


/// Accepts both interfaces into one ledger.
contract DualBank {
    IERC20 constant USDC = IERC20(0x3600000000000000000000000000000000000000);
    mapping(address => uint256) public balances;

    function depositNative() external payable {
        balances[msg.sender] += msg.value;
    }

    function depositErc20(uint256 amount) external {
        uint256 before = USDC.balanceOf(address(this));
        USDC.transferFrom(msg.sender, address(this), amount);
        balances[msg.sender] += USDC.balanceOf(address(this)) - before; // @expect TW-005 HIGH depositErc20(uint256)
    }

    function withdraw() external {
        uint256 amt = balances[msg.sender];
        balances[msg.sender] = 0;
        USDC.transfer(msg.sender, amt);
    }
}