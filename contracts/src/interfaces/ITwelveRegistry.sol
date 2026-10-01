// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title ITwelveRegistry
/// @notice On-chain attestations of Twelve scan results, bound to code (docs/REGISTRY.md).
interface ITwelveRegistry {
    enum Verdict {
        NONE,
        CLEAN,
        FINDINGS,
        INCOMPLETE
    }

    enum Status {
        NONE,
        CLEAN,
        FINDINGS,
        INCOMPLETE,
        STALE,
        REVOKED
    }

    struct Attestation {
        bytes32 codehash; // extcodehash(target) at attest time
        bytes32 reportHash; // keccak256(JCS(reportCore))
        bytes32 implCodehash; // 0 if not a proxy
        address implementation; // 0 if not a proxy
        uint40 attestedAt;
        uint16 high;
        uint16 medium;
        uint8 verdict; // Verdict
        uint8 schemaVersion; // report schema
        bool revoked;
        bytes32 toolVersion; // e.g. bytes32("twelve/0.1.0+abcdef1")
    }

    event Attested(
        address indexed attester,
        address indexed target,
        bytes32 indexed reportHash,
        bytes32 codehash,
        uint8 verdict,
        uint16 high,
        uint16 medium,
        address implementation
    );
    event Revoked(address indexed attester, address indexed target, bytes32 reason);

    error TargetHasNoCode();
    error CodehashMismatch(bytes32 expected, bytes32 actual);
    error InvalidVerdict();
    error NothingToRevoke();

    /// @notice Attest a scan result under `msg.sender`. `expectedCodehash` guards against code changing between
    ///         the off-chain scan and this write (front-run / redeploy race).
    /// @param target Scanned contract (the proxy, for proxies).
    /// @param expectedCodehash `extcodehash(target)` the scan was performed against.
    /// @param reportHash keccak256 of the RFC 8785 canonical report core.
    /// @param verdict 1 CLEAN, 2 FINDINGS, 3 INCOMPLETE.
    /// @param high Number of HIGH findings.
    /// @param medium Number of MEDIUM findings.
    /// @param implementation Proxy implementation that was scanned, or address(0).
    /// @param implCodehash `extcodehash(implementation)`, or 0.
    /// @param schemaVersion Report schema version.
    /// @param toolVersion Analyzer identity.
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
    ) external;

    /// @notice Revoke `msg.sender`'s attestation of `target`.
    /// @param target Attested contract.
    /// @param reason Short tag, e.g. bytes32("UPGRADED").
    function revoke(address target, bytes32 reason) external;

    /// @notice Raw record of `attester` for `target` (zero struct if none).
    /// @param attester Attester namespace.
    /// @param target Attested contract.
    /// @return The stored attestation.
    function get(address attester, address target) external view returns (Attestation memory);

    /// @notice Current status, including code freshness (docs/REGISTRY.md §4.2).
    /// @param attester Attester namespace.
    /// @param target Attested contract.
    /// @return The derived status.
    function status(address attester, address target) external view returns (Status);

    /// @notice True iff CLEAN, not revoked, codehash fresh and (if proxy) the recorded implementation's code fresh.
    /// @param attester Attester namespace.
    /// @param target Attested contract.
    /// @return Whether `target` is currently clean under `attester`.
    function isClean(address attester, address target) external view returns (bool);
}
