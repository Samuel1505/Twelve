// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}


/// WAD and parts-per-million fee math on both views; dimensionless rates, correct results.
contract Fees {
    IERC20 constant USDC = IERC20(0x3600000000000000000000000000000000000000);
    uint256 constant FEE_WAD = 3e15; // 0.3%
    uint256 constant FEE_PPM = 2500; // 0.25%
    address payable public immutable treasury = payable(msg.sender);

    function payNative() external payable {
        uint256 fee = msg.value * FEE_WAD / 1e18;
        treasury.transfer(fee);
    }

    function payErc20() external {
        uint256 fee6 = USDC.balanceOf(address(this)) * FEE_PPM / 1e6;
        USDC.transfer(treasury, fee6);
    }
}