// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}


/// The same parameter reaches sinks of both views on different branches. Ambiguous: no finding.
contract Payer {
    IERC20 constant USDC = IERC20(0x3600000000000000000000000000000000000000);

    function pay(uint256 amount, bool native) external {
        if (native) {
            (bool ok,) = payable(msg.sender).call{value: amount}("");
            require(ok, "send");
        } else {
            USDC.transfer(msg.sender, amount);
        }
    }
}