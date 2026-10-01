# REGISTRY.md — On-chain attestations

## 1. Purpose
Make a scan result **consumable by contracts**: a router, wallet, or protocol can ask "is this target CLEAN for the code it has *right now*, according to an attester I trust?" in one `staticcall`.

## 2. Design principles
- **Permissionless, namespaced by attester.** Anyone can attest; every record lives under `msg.sender`. Twelve's service key is one attester among possibly many. Consumers pin the attester(s) they trust. (ADR-003/004)
- **Bound to code, not address.** Store `extcodehash(target)` at attest time. If code changes (CREATE2 redeploy, 7702 delegation change), status becomes `STALE` automatically with zero off-chain action.
- **Verifiable, not authoritative.** Each record stores `reportHash`. Anyone can rerun `twelve verify` and check they get the same hash (I4, I6). The attester is a *convenience* for the chain, not a source of truth.
- **Immutable contract.** No owner, no upgrade, no pause (I7). A bug means deploy v2 and move consumers.

## 3. Storage

```solidity
enum Verdict { NONE, CLEAN, FINDINGS, INCOMPLETE }
enum Status  { NONE, CLEAN, FINDINGS, INCOMPLETE, STALE, REVOKED }

struct Attestation {
    bytes32 codehash;        // extcodehash(target) at attest time
    bytes32 reportHash;      // keccak256(JCS(reportCore))
    bytes32 implCodehash;    // 0 if not a proxy
    address implementation;  // 0 if not a proxy
    uint40  attestedAt;
    uint16  high;
    uint16  medium;
    uint8   verdict;         // Verdict
    uint8   schemaVersion;   // report schema
    bool    revoked;
    bytes32 toolVersion;     // bytes32(bytes("twelve/0.1.0")) or git commit
}

mapping(address attester => mapping(address target => Attestation)) private _att;
```
Pack order above keeps `implementation(20)+attestedAt(5)+high(2)+medium(2)+verdict(1)+schemaVersion(1)+revoked(1)` = 32 bytes in one slot. Verify with `forge inspect TwelveRegistry storage-layout` and a test asserting slot count.

## 4. Interface

```solidity
interface ITwelveRegistry {
    event Attested(address indexed attester, address indexed target, bytes32 indexed reportHash,
                   bytes32 codehash, uint8 verdict, uint16 high, uint16 medium, address implementation);
    event Revoked(address indexed attester, address indexed target, bytes32 reason);

    error TargetHasNoCode();
    error CodehashMismatch(bytes32 expected, bytes32 actual);
    error InvalidVerdict();
    error NothingToRevoke();

    /// @notice Attest a scan result. `expectedCodehash` guards against code changing
    ///         between off-chain scan and on-chain write (front-run / redeploy race).
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

    function revoke(address target, bytes32 reason) external;

    function get(address attester, address target) external view returns (Attestation memory);
    function status(address attester, address target) external view returns (Status);
    /// @notice true iff CLEAN, not revoked, codehash fresh, and (if proxy) implCodehash fresh
    ///         for the *recorded* implementation.
    function isClean(address attester, address target) external view returns (bool);
}
```

### 4.1 `attest` checks
1. `target.code.length > 0` else `TargetHasNoCode`.
2. `target.codehash == expectedCodehash` else `CodehashMismatch`.
3. `verdict ∈ {CLEAN, FINDINGS, INCOMPLETE}` else `InvalidVerdict`.
4. If `implementation != 0`: `implementation.codehash == implCodehash` else `CodehashMismatch`. If `implementation == 0`, `implCodehash` must be 0 (else `CodehashMismatch(0, implCodehash)`) — a non-proxy record never carries an implementation hash (added in Phase 3).
5. Overwrite record (re-attestation replaces), `revoked = false`, emit `Attested`.

### 4.2 `status` logic
```
a = _att[attester][target]
if a.verdict == NONE                     → NONE
if a.revoked                             → REVOKED
if target.codehash != a.codehash         → STALE
if a.implementation != 0 &&
   a.implementation.codehash != a.implCodehash → STALE
return Status(a.verdict)
```

### 4.3 The proxy limit (state it honestly in docs and UI)
A contract cannot read another contract's storage, so `status` **cannot** see that a proxy now points at a different implementation. It only sees that the *recorded* implementation's code is unchanged. Closing this gap is the monitor's job: it watches `Upgraded(address)` from every attested proxy and calls `revoke(target, "UPGRADED")` in the same few seconds (MONITOR.md §7). Consumers who need a trustless answer for proxies should treat `implementation != 0` as "trust the attester's liveness" — the UI says exactly that.

### 4.4 Gas
Arc gas is paid in USDC at 18-dec native precision. `attest` writes 5 slots for a new record. Measured on Arc testnet (Phase 3): **124,116 gas × 32.5 gwei = 0.00403377 USDC per attestation** (txs in `docs/evidence/phase3-testnet-e2e.md`); local snapshot in `contracts/.gas-snapshot`. Re-measure on mainnet at deploy.

## 5. Consumer pattern (what `TwelveGate` demonstrates)

```solidity
if (!registry.isClean(TWELVE_ATTESTER, target)) revert TargetNotClean(registry.status(TWELVE_ATTESTER, target));
(bool ok,) = target.call{value: msg.value}(data);
```
Consumers may accept multiple attesters (k-of-n) — out of scope for the demo, documented as a pattern in `/integrate`.

## 6. Attester service (in `apps/api`)

- Key: `ATTESTER_PRIVATE_KEY`, only used for `attest`/`revoke` calls to `REGISTRY_ADDRESS`. A wrapper refuses any other `to`/selector.
- Flow per scan in `ATTESTING`:
  1. Read `codehash` again at latest block; if ≠ scanned `codehash` → rescan (code changed mid-scan).
  2. `simulateContract` → `writeContract` with explicit nonce from the single-writer queue.
  3. Wait receipt (1 block). Persist `attestations` row + tx hash. Emit SSE event for the web progress bar.
- Revocation triggers: monitor (proxy upgrade), manual (`POST /v1/admin/revoke` behind admin token), tool version deprecation (batch revoke of reports produced by a tool version with a known analyzer bug — record ADR when used).
- Re-attestation policy: new tool version with changed rules → rescans are **not** automatic in v1; web shows "scanned with twelve/x.y (current z.w)".

## 7. Tests (contracts/test/TwelveRegistry.t.sol)
- attest happy path; overwrite; event fields.
- `CodehashMismatch` via `vm.etch` changing code between expected/actual.
- STALE after `vm.etch` post-attest.
- proxy: attest with impl, `vm.etch` impl → STALE.
- revoke → REVOKED; revoke nonexistent → `NothingToRevoke`.
- attester isolation: attester A's record never affects B's.
- fuzz: `status` never returns CLEAN when codehash differs.
- storage layout snapshot test.
- invariant test: for any sequence of attest/revoke/etch, `isClean ⇒ status == CLEAN`.

## 8. Deployment
`script/DeployRegistry.s.sol` with `DEPLOYER_PRIVATE_KEY`. Verify on Blockscout. Record address + deploy tx in `docs/BUILD_PLAN.md §Deployed`. Deploy to testnet first, run `test-arc/` suite, then mainnet. CREATE2 with a fixed salt so the testnet and mainnet addresses match (nice for docs; not required).
