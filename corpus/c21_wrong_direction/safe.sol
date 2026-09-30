// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}


/// Converts native to ERC-20 units in the right direction and refunds the remainder.
contract Converter {
    IERC20 constant USDC = IERC20(0x3600000000000000000000000000000000000000);

    function forward(address to) external payable {
        USDC.transfer(to, msg.value / 1e12);
        uint256 dust = msg.value % 1e12;
        if (dust != 0) {
            (bool ok,) = payable(msg.sender).call{value: dust}("");
            require(ok, "dust");
        }
    }
}