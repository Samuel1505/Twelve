// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title DemoUpgradeableProxy
/// @notice Twelve test fixture: minimal EIP-1967 proxy with an admin upgrade, used to exercise monitor D4
///         (attested proxy upgraded ⇒ automatic revoke, docs/MONITOR.md §4).
contract DemoUpgradeableProxy {
    bytes32 internal constant IMPL_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    address public immutable admin;

    event Upgraded(address indexed implementation);

    error NotAdmin();

    /// @param impl Initial implementation.
    constructor(address impl) {
        admin = msg.sender;
        _set(impl);
    }

    /// @notice Point the proxy at a new implementation (admin only).
    /// @param impl New implementation.
    function upgradeTo(address impl) external {
        if (msg.sender != admin) revert NotAdmin();
        _set(impl);
    }

    function _set(address impl) private {
        assembly {
            sstore(IMPL_SLOT, impl)
        }
        emit Upgraded(impl);
    }

    fallback() external payable {
        assembly {
            let impl := sload(IMPL_SLOT)
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch ok
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
}

/// @notice Implementation v1 (no USDC logic: scans CLEAN).
contract DemoImplV1 {
    uint256 public counter;

    /// @notice Increment the counter.
    function bump() external {
        counter += 1;
    }
}

/// @notice Implementation v2.
contract DemoImplV2 {
    uint256 public counter;

    /// @notice Increment the counter by two.
    function bump() external {
        counter += 2;
    }
}
