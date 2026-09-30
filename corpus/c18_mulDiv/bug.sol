// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}


library Math {
    /// OZ-style full-precision mulDiv; the analyzer models it as a⊗b⊘c instead of reading the assembly.
    function mulDiv(uint256 x, uint256 y, uint256 denominator) internal pure returns (uint256 result) {
        assembly {
            result := div(mul(x, y), denominator)
        }
    }
}

/// Converts a native payment to ERC-20 units with mulDiv and refunds the remainder.
contract MulDivForwarder {
    IERC20 constant USDC = IERC20(0x3600000000000000000000000000000000000000);

    function forward(address to) external payable {
        uint256 amt6 = Math.mulDiv(msg.value, 1, 1e12);
        uint256 dust = msg.value % 1e12;
        USDC.transfer(to, amt6);
        if (dust != 0) {
            (bool ok,) = payable(msg.sender).call{value: dust}("");
            require(ok, "dust");
        }
    }
}