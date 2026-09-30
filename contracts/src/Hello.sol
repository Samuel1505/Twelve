// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title Hello
/// @notice Phase 0 spike: proves the chosen solc + evm_version compiles and deploys on Arc. Not product code.
contract Hello {
    uint256 public immutable bornAt;

    constructor() {
        bornAt = block.number;
    }

    /// @notice Returns a constant greeting.
    function hello() external pure returns (string memory) {
        return "twelve";
    }
}
