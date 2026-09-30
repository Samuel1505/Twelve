// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}


/// Relayer gas refund paid through the ERC-20 interface.
contract Relayer {
    IERC20 constant USDC = IERC20(0x3600000000000000000000000000000000000000);
    uint256 public calls;

    function relay() external {
        uint256 startGas = gasleft();
        calls += 1;
        uint256 refundAmt = (startGas - gasleft()) * tx.gasprice;
        USDC.transfer(msg.sender, refundAmt); // @expect TW-004 HIGH relay()
    }
}