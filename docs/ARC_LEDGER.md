# ARC_LEDGER.md — The ledger Twelve exists because of

Every fact below is tagged **[DOC]** (confirmed in Arc's official docs as of project start), **[3P]** (confirmed by a third-party indexer/explorer), or **VERIFY:** (plausible, unconfirmed — confirm against a live node before depending on it). Primary sources:

- Stablecoin native model — `https://docs.arc.io/arc/concepts/stablecoin-native-model`
- EVM differences — `https://docs.arc.io/arc/references/evm-differences`
- USDC system events — `https://docs.arc.io/arc/references/usdc-system-events`
- RPC endpoints / Connect to Arc — `https://docs.arc.io/arc/references/rpc-endpoints`, `.../connect-to-arc`
- Contract addresses — `https://docs.arc.network/arc/references/contract-addresses`
- arc-node issue #91 (the decimals trap, reported by an integrator) — `https://github.com/circlefin/arc-node/issues/91`

---

## 1. One balance, two views

| View | Decimals | Surfaces | Source |
|---|---|---|---|
| Native | 18 | `msg.value`, `address(x).balance`, `call{value:}`, `transfer/send`, `eth_getBalance`, gas accounting, `tx.gasprice`, `block.basefee` | [DOC] |
| ERC-20 (`NativeFiatToken`) | 6 | `0x3600000000000000000000000000000000000000`: `balanceOf`, `transfer`, `transferFrom`, `approve`, `allowance`, `totalSupply` | [DOC] |

`USDC.balanceOf(a) * 10¹² ≈ a.balance` — the same underlying balance, not two balances. [DOC]
"≈" because the native view can hold **dust** below 10⁻⁶ USDC that the ERC-20 view cannot represent or move. [DOC]

Arc's docs state the trap directly: don't mix `msg.value` with `USDC.balanceOf()` in pool or LTV math; raw values are off by 10¹². [DOC] Integrators hit it in practice (arc-node #91: gas cost `gasPrice*gasUsed` displayed as USDC without conversion). [3P]

### 1.1 Consequences for contract code (what the analyzer models)

| Pattern | Raw effect | Real-world effect |
|---|---|---|
| Credit `msg.value` (18) into a balance, later pay it out via `USDC.transfer` (6) | amount × 10¹² | overpay → drain (or revert if insufficient balance) |
| Take ERC-20 deposit `a6`, refund natively `call{value: a6}` | amount × 10⁻¹² | underpay → user receives dust |
| `require(msg.value >= price6)` with `price6` in 6-dec | threshold 10¹² too low | item sold for dust |
| `require(USDC.balanceOf(this) >= msg.value)` | comparison 10¹² skewed | check always fails or always passes |
| `fee = msg.value * bps / 1e4; USDC.transfer(treasury, fee)` | fee × 10¹² | fee transfer reverts or drains |
| `address(this).balance` passed to `USDC.transfer` | × 10¹² | revert / drain |

### 1.2 Arithmetic facts the whole codebase relies on

- `SCALE = 10**12` exactly. 18→6: `a6 = a18 / SCALE` (floor), `dust18 = a18 % SCALE`. 6→18: `a18 = a6 * SCALE` (exact, overflow impossible for any real supply but still checked).
- The **signature** of the bug is a factor of exactly 10¹² (or 10⁻¹²) between intended and actual raw amounts. The monitor keys on this.

---

## 2. Logs: how every USDC movement is observable

| Stream | Emitter | Topic0 | Value decimals | Emitted for | Source |
|---|---|---|---|---|---|
| Native system (EIP-7708) | `0xfffffffffffffffffffffffffffffffffffffffe` | `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef` | 18 | **every** USDC movement: native sends, contract endowments, self-destruct moves, ERC-20-interface transfers, mints, burns | [DOC] |
| ERC-20 contract | `0x3600000000000000000000000000000000000000` | same topic | 6 | ERC-20-interface activity only | [DOC] |

Event ABI for both: `Transfer(address indexed from, address indexed to, uint256 value)`.

**Critical:** one ERC-20 `transfer()` emits **both** logs. Match on emitter address to avoid double counting. [DOC] Mainnet has emitted the EIP-7708 log since genesis — full history is indexable from block 0. [DOC]

### 2.1 The interface-classification rule (monitor depends on this)

Within one transaction, for a system log `S(from, to, v18)`:
- If there exists an unconsumed ERC-20 log `E(from, to, v6)` in the **same tx** with `v18 == v6 * 10¹²` ⇒ this movement went through the **ERC-20 interface**. Consume `E`.
- Otherwise ⇒ **native interface** (`call{value}`, `msg.value` endowment, `transfer/send`, self-destruct), or mint/burn (`from` or `to` = zero address).

An ERC-20 log with no matching system log is a data anomaly (indexer bug or protocol change) ⇒ raise an ops alert, never silently drop.

**Log ordering [TESTNET, Phase 0]:** the system log is emitted immediately **before** its ERC-20 twin (adjacent `logIndex` 4 → 5 in tx `0x89cf56aa70d9222e883be7ef43e0721c23def1806e642d3f636a757a58b8dc75`, testnet block 64807933). One sample; the pairing algorithm still must not assume adjacency: pair by `(from, to, value)` equality within the tx, FIFO by `logIndex`. `VERIFY:` same ordering on mainnet (owner: Phase 0 mainnet run, needs `ARC_RPC_URL`).

**Gas is not logged [TESTNET, Phase 0]:** native send `0x7a5105e9…b281e` (fee 420000000000000 wei-USDC) has exactly 1 system log, which is the value transfer; zero-value tx `0x423f8cef…be61c` (fee 63379875000000000) has 0 system logs; the Hello contract-creation tx `0xdf54835a…5f55` has 0 logs. Monitor must not expect gas in logs. `VERIFY:` on mainnet (owner: Phase 0 mainnet run).

---

## 3. Network parameters

| Param | Mainnet | Testnet | Source |
|---|---|---|---|
| Chain ID | `5042` | `5042002` | [DOC] |
| RPC | `https://rpc.mainnet.arc.io` (listed **permissioned**) | `https://rpc.testnet.arc.io` | [DOC] |
| Provider in use (Phase 0) | Infura `https://arc-mainnet.infura.io/v3/<PROJECT_ID>` (**no project ID yet**: bare host returns 404, `/v3/` returns 401 `invalid project id`) | dRPC `https://arc-testnet.drpc.org`: `eth_chainId` = `0x4cef52` ✓; **`eth_getLogs` max span 101 blocks on free plan** (error code 35, whose message wrongly says "ranges over 10000 blocks"; a sparse filter over 1000 blocks is rejected too, so this is a span limit, not a result cap) | observed |
| WS | `wss://rpc.quicknode.mainnet.arc.io` (in docs' viem chain def) | `wss://rpc.testnet.arc.io` | [DOC] |
| Explorer | `https://explorer.arc.io` (listed permissioned) | `https://explorer.testnet.arc.io` | [DOC] |
| Explorer API | Blockscout Pro API `https://api.blockscout.com/5042/api/v2/...` (key required; **auth = `?apikey=<key>` query param**, observed on 5042002) | same with `5042002` ✓ | observed |
| Verified source | `GET /api/v2/smart-contracts/<address>` on the Pro API | | [3P] |
| Currency | `USDC`, `nativeCurrency.decimals = 18` | | [DOC] |
| Mainnet gas USDC | docs say request via Circle point of contact; alternative: CCTP from another chain | | [DOC] |

Mainnet went live on 16 September 2026. [3P]

---

## 4. Execution environment

- EVM baseline **Osaka**, plus EIP-7708 ahead of upstream (Amsterdam track). EIP-7702 supported. [DOC]
- Native-coin **precompiles** back the `0x3600…` interface, EIP-7708 logs, and **USDC blocklist enforcement**; these only surface against an Arc RPC endpoint. [DOC] ⇒ local anvil cannot reproduce ERC-20-view semantics. See invariant I8.
- **Anatomy of `0x3600…` [TESTNET, Phase 0]:** it is ordinary EVM code, a **ZeppelinOS-style `AdminUpgradeabilityProxy`** (solc 0.6.12 per CBOR). Implementation in slot `keccak("org.zeppelinos.proxy.implementation")` = `0x7050c9e0…f8c3` → `0xC6AD664ac6679F4Ce74e10E91449C93Ec1ae3cA6`; admin slot `0x10d6a54a…390b` → `0x49f78af090f1f98e7184b7f61f1f1a8a8064b40d`; the **EIP-1967 slot is empty**. `decimals()` = 6, `symbol()` = `USDC`. `balanceOf` is computed in plain EVM (returns `floor(native / 10¹²)`). `transfer` delegates to the **native-coin precompile at `0x1800000000000000000000000000000000000000`** as `transfer(from, to, amount6 * 10¹²)`, i.e. the ERC-20 view converts to 18-dec before moving the native balance. `eth_getCode(0x1800…)` = `0x01` (placeholder). The ERC-20 view is **upgradeable by its admin**.
- **Fork tests [TESTNET, Phase 0]:** `forge test --fork-url` executes `0x3600` **reads** correctly (`balanceOf` 19994219 == floor(19994219546750000000 / 10¹²)) but **not writes**: `transfer` hits the `0x01` placeholder at `0x1800` → `EvmError: StackUnderflow` → revert. Anything that moves USDC through the ERC-20 view must be tested by broadcasting to testnet (proposed ADR-017).
- **Compiler / EVM [TESTNET, Phase 0]:** solc **0.8.37** (latest release) and **0.8.30** with `evm_version = osaka` both deploy and run on testnet: Hello at `0x3C24c652B7b9EcD0CAD86df5E58a4B2f006602C0` (0.8.37, tx `0xdf54835af5aa89ae2deae8e728dfdab0dcbefa2fa7e0a8c314caaa6019aa5f55`, block 64808102) and `0xFFa3A0Ea10FE30a5d7c0F1B5597c189A38364E67` (0.8.30, tx `0x5b4018b78f495b6db21ca6a4a01ae8ebc0369846bbca14f281543b9b8b0c28cd`); `hello()` returns `"twelve"` on both.
- No WETH. [DOC/3P]
- Deterministic BFT finality (~0.5 s blocks, no reorgs) under a permissioned validator set.

---

## 5. Other assets (future rule family, not v1)

| Asset | Address | Decimals | Source |
|---|---|---|---|
| EURC | `0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1` | 6 | [3P] |
| USYC | `0x8a5D989Bbb96929F689B0200f435f53dA42bF490` | 6 | [3P] |

`VERIFY:` both against `docs.arc.network/arc/references/contract-addresses` before any code references them.

---

## 6. Proxy / account-code edges that affect attestations

- EIP-1967 implementation slot: `0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc`
- EIP-1967 beacon slot: `0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50`
- `Upgraded(address indexed implementation)` topic0: `0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b`
- EIP-7702 delegated EOA code: `0xef0100 ‖ 20-byte delegate`. v1: `UNSUPPORTED`.

---

## 7. Phase-0 verification checklist

Run each against live endpoints, record results here, delete the `VERIFY:` markers you resolve.

- [ ] `eth_chainId` on the chosen mainnet provider returns `0x13b2` (5042). — **BLOCKED**: `ARC_RPC_URL` is a bare Infura host with no project ID. Testnet ✓ `0x4cef52`.
- [ ] Pick one mainnet ERC-20 USDC transfer; confirm two logs, emitters, `v18 == v6 * 10¹²`; record ordering. — **PASS on testnet** (§2.1, tx `0x89cf56aa…dc75`: v18 = 29463000000000000, v6 = 29463; system before ERC-20, adjacent). Mainnet **BLOCKED**.
- [ ] Pick one native send; confirm exactly one system log, zero `0x3600…` logs. — **PASS on testnet** (tx `0x7a5105e9778dc26b9386fcde2c62e2c3ce4295b364fe6f9ebd3b2099e7fb281e`; log (from,to,value) == tx). Mainnet **BLOCKED**.
- [ ] Confirm gas deduction produces no Transfer log. — **PASS on testnet** (§2.1). Mainnet **BLOCKED**.
- [ ] `eth_getLogs` max block range and result cap on the chosen provider. — Testnet dRPC free: **101 blocks** (§3), not viable for backfill. Mainnet provider **BLOCKED**.
- [x] Blockscout Pro `smart-contracts/<addr>` response shape. — Fixture `analyzer/tests/fixtures/blockscout_smart_contract.json` (testnet `Exchange` @ `0xd32fA21c25c22bf4afBEF4ac07D9E34e2367d709`, solc 0.8.28, cancun, 15 additional sources). Fields: `source_code` (str), `additional_sources` (`[{file_path, source_code}]`), `file_path`, `compiler_version` (`v0.8.28+commit.7893614a`, note the leading `v`), `compiler_settings` (a **complete solc `settings` object**: `evmVersion, libraries, metadata, optimizer, outputSelection, remappings, viaIR`), `evm_version`, `optimization_enabled`, `optimization_runs`, `constructor_args`, `deployed_bytecode`, `creation_bytecode`, `external_libraries`, `proxy_type`, `implementations`, `is_fully_verified`, `is_partially_verified`, `language`. **`immutable_references` is absent**: take it from our own compile's `evm.deployedBytecode.immutableReferences` (as ANALYZER §3 already assumes). Auth: `?apikey=`. Mainnet (5042) shape assumed identical: same Blockscout instance family.
- [x] Highest solc + Foundry `evm_version` accepted for Arc; deploy hello-world to testnet. — **solc 0.8.37 + `osaka`** deploys (§4). Repo pin stays 0.8.30 until the owner decides (CLAUDE.md §8). Mainnet deploy pending (needs mainnet USDC).
- [x] Whether `forge test --fork-url <arc-testnet>` exercises the `0x3600…` precompiles. — **Reads yes, writes no** (§4). `contracts/test-arc/Precompile.t.sol`: 2 pass, `transfer` fails with StackUnderflow at `0x1800`.
- [ ] Obtain a small mainnet USDC balance for deployer and attester. — **NOT STARTED** (no mainnet spend this phase). Testnet: deployer `0x89a68d0731F9Bc419d606f1F31Ead04c3fBDFdd6` holds ~20 USDC; attester `0xe98540d28F45830E01D237251Bfc4777E69c9A46` ≠ deployer (I12 ✓).

---

## 8. Phase 0 log

Runs: 2026-09-30. Offline half + **testnet** live half done. Mainnet facts are blocked on a usable `ARC_RPC_URL`.
Raw receipts and responses: `docs/evidence/phase0/`.

### 8.1 Results

| Fact | Result | Evidence |
|---|---|---|
| Ledger constants (§2, §6) | Correct | `packages/shared/test/constants.test.ts` 4/4 |
| Testnet chain ID | `0x4cef52` = 5042002 ✓ | `scripts/phase0/chain-id.ts --net testnet` |
| ERC-20 transfer ⇒ 2 logs, `v18 = v6·10¹²`, system first | ✓ testnet | tx `0x89cf56aa…dc75` |
| Native send ⇒ 1 system log, 0 ERC-20 logs | ✓ testnet | tx `0x7a5105e9…b281e` |
| Gas unlogged | ✓ testnet | txs `0x7a5105e9…`, `0x423f8cef…`, `0xdf54835a…` |
| getLogs span (dRPC free, testnet) | 101 blocks | code 35 |
| Blockscout Pro shape, auth | see §7 | fixture committed |
| solc / evm_version on Arc | 0.8.37 + osaka ✓ | Hello `0x3C24…02C0` |
| Fork executes `0x3600` | reads ✓ / writes ✗ | `test-arc/Precompile.t.sol` |
| `0x3600` is a ZOS proxy over `0x1800` precompile | new fact | §4 |
| Mainnet anything | **BLOCKED** | needs Infura project ID (or another provider) |

### 8.2 Deviations from doc assumptions

- `0x3600…` is an **upgradeable ZOS-slot proxy**, not a bare precompile. (a) Twelve's own proxy detection (ANALYZER/ARCHITECTURE: EIP-1967 impl + beacon only) would classify contracts using the legacy ZOS slot as plain contracts. Proposed ADR-018. (b) Circle can upgrade the ERC-20 view; the `Upgraded` topic is in its bytecode, so the monitor can watch it.
- Fork tests cannot exercise ERC-20-view writes → `test-arc/` writes must broadcast (proposed ADR-017; ADR-008 already requires testnet, this changes the mechanism).
- Free-tier providers impose tiny `eth_getLogs` spans (dRPC: 101). Backfill-from-genesis (MONITOR) needs a paid plan or an indexer source; choose with the mainnet provider.
- Blockscout returns `compiler_version` with a leading `v` and no `immutable_references`.
- `Contract addresses` source in the header uses `docs.arc.network`; every other source uses `docs.arc.io`. `VERIFY:` which domain is canonical (owner: next docs pass) before §5 is resolved.
- crytic-compile mutates its standard-JSON input and drops `optimizer.details` (proposed ADR-016).
