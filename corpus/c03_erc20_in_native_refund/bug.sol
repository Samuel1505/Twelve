// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}


/// Takes ERC-20 deposits (fee-on-transfer safe), refunds natively.
contract LeakyRefund {
    IERC20 constant USDC = IERC20(0x3600000000000000000000000000000000000000);
    mapping(address => uint256) public deposits;

    function deposit(uint256 amount) external {
        uint256 before = USDC.balanceOf(address(this));
        USDC.transferFrom(msg.sender, address(this), amount);
        deposits[msg.sender] += USDC.balanceOf(address(this)) - before;
    }

    function refund() external {
        uint256 amt = deposits[msg.sender];
        deposits[msg.sender] = 0;
        (bool ok,) = payable(msg.sender).call{value: amt}(""); // @expect TW-003 HIGH refund()
        require(ok, "send");
    }
}