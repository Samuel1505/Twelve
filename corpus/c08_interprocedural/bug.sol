// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}


/// Share price computed from a helper that reads the ERC-20 view.
contract Pool {
    IERC20 constant USDC = IERC20(0x3600000000000000000000000000000000000000);
    uint256 public totalShares;
    mapping(address => uint256) public shares;

    function _poolAssets() internal view returns (uint256) {
        return USDC.balanceOf(address(this));
    }

    function deposit() external payable {
        uint256 assetsAfter = _poolAssets() + msg.value; // @expect TW-001 HIGH deposit()
        uint256 minted = totalShares == 0 ? msg.value : msg.value * totalShares / assetsAfter;
        shares[msg.sender] += minted;
        totalShares += minted;
    }
}