// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ITwelveRegistry} from "./interfaces/ITwelveRegistry.sol";

/// @title TwelveRegistry
/// @notice Permissionless, attester-namespaced, code-bound attestations of Twelve scans (docs/REGISTRY.md).
/// @dev Immutable by design (invariant I7): no owner, no proxy, no pause, no admin. Trust = choosing an attester.
///      No external calls, so no reentrancy surface. Proxy limit (§4.3): `status` cannot see an implementation
///      swap, only that the *recorded* implementation's code is unchanged; the monitor revokes on `Upgraded`.
contract TwelveRegistry is ITwelveRegistry {
    mapping(address attester => mapping(address target => Attestation)) private _att;

    /// @inheritdoc ITwelveRegistry
    function attest(
        address target,
        bytes32 expectedCodehash,
        bytes32 reportHash,
        uint8 verdict,
        uint16 high,
        uint16 medium,
        address implementation,
        bytes32 implCodehash,
        uint8 schemaVersion,
        bytes32 toolVersion
    ) external {
        if (target.code.length == 0) revert TargetHasNoCode();
        bytes32 actual = target.codehash;
        if (actual != expectedCodehash) revert CodehashMismatch(expectedCodehash, actual);
        if (verdict == uint8(Verdict.NONE) || verdict > uint8(Verdict.INCOMPLETE)) revert InvalidVerdict();
        if (implementation != address(0)) {
            bytes32 implActual = implementation.codehash;
            if (implActual != implCodehash) revert CodehashMismatch(implCodehash, implActual);
        } else if (implCodehash != bytes32(0)) {
            revert CodehashMismatch(bytes32(0), implCodehash);
        }

        _att[msg.sender][target] = Attestation({
            codehash: actual,
            reportHash: reportHash,
            implCodehash: implCodehash,
            implementation: implementation,
            attestedAt: uint40(block.timestamp),
            high: high,
            medium: medium,
            verdict: verdict,
            schemaVersion: schemaVersion,
            revoked: false,
            toolVersion: toolVersion
        });
        emit Attested(msg.sender, target, reportHash, actual, verdict, high, medium, implementation);
    }

    /// @inheritdoc ITwelveRegistry
    function revoke(address target, bytes32 reason) external {
        Attestation storage a = _att[msg.sender][target];
        if (a.verdict == uint8(Verdict.NONE) || a.revoked) revert NothingToRevoke();
        a.revoked = true;
        emit Revoked(msg.sender, target, reason);
    }

    /// @inheritdoc ITwelveRegistry
    function get(address attester, address target) external view returns (Attestation memory) {
        return _att[attester][target];
    }

    /// @inheritdoc ITwelveRegistry
    function status(address attester, address target) public view returns (Status) {
        Attestation storage a = _att[attester][target];
        uint8 v = a.verdict;
        if (v == uint8(Verdict.NONE)) return Status.NONE;
        if (a.revoked) return Status.REVOKED;
        if (target.codehash != a.codehash) return Status.STALE;
        address impl = a.implementation;
        if (impl != address(0) && impl.codehash != a.implCodehash) return Status.STALE;
        return Status(v);
    }

    /// @inheritdoc ITwelveRegistry
    function isClean(address attester, address target) external view returns (bool) {
        return status(attester, target) == Status.CLEAN;
    }
}
