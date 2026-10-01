// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ITwelveRegistry} from "./interfaces/ITwelveRegistry.sol";

/// @title TwelveGate
/// @notice Example registry consumer: forwards native USDC + calldata only to targets that are CLEAN, for the code
///         they have right now, under one pinned attester (docs/GUARD.md §3, docs/REGISTRY.md §5).
/// @dev Forwards the native (18-decimal) view only; ERC-20-view flows need the user's approval on the target
///      directly. Proxy targets inherit the registry's proxy limit (REGISTRY §4.3).
contract TwelveGate {
    ITwelveRegistry public immutable registry;
    address public immutable attester;

    bool private transient _locked;

    error TargetNotClean(address target, ITwelveRegistry.Status status);
    error Reentrancy();

    event Forwarded(address indexed from, address indexed target, uint256 value18, bytes4 selector);

    /// @param registry_ TwelveRegistry to consult.
    /// @param attester_ The attester whose records this gate trusts.
    constructor(ITwelveRegistry registry_, address attester_) {
        registry = registry_;
        attester = attester_;
    }

    modifier nonReentrant() {
        if (_locked) revert Reentrancy();
        _locked = true;
        _;
        _locked = false;
    }

    /// @notice Forward `msg.value` (native USDC, 18 decimals) and `data` to `target` if it is CLEAN.
    /// @param target Contract to call.
    /// @param data Calldata for `target`.
    /// @return ret Return data from `target`; reverts bubble up unchanged.
    function forward(address target, bytes calldata data) external payable nonReentrant returns (bytes memory ret) {
        ITwelveRegistry.Status s = registry.status(attester, target);
        if (s != ITwelveRegistry.Status.CLEAN) revert TargetNotClean(target, s);
        bool ok;
        (ok, ret) = target.call{value: msg.value}(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        emit Forwarded(msg.sender, target, msg.value, bytes4(data));
    }
}
