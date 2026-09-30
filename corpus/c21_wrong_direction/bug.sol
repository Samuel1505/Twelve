// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}


/// Converts in the wrong direction: multiplies a native amount by the scale before an ERC-20 payout.
contract Converter {
    IERC20 constant USDC = IERC20(0x3600000000000000000000000000000000000000);

    function forward(address to) external payable {
        USDC.transfer(to, msg.value * 1e12); // @expect TW-008 LOW forward(address)
    }
}