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

`VERIFY:` log ordering within a tx — whether the system log is emitted immediately before or after its ERC-20 twin. The pairing algorithm must not assume adjacency; pair by `(from, to, value)` equality within the tx, FIFO by `logIndex`.

`VERIFY:` whether gas fee deduction emits a system Transfer (docs list "explicit" transfers; gas burn is likely **not** logged). Monitor must not assume gas appears in logs.

---

## 3. Network parameters

| Param | Mainnet | Testnet | Source |
|---|---|---|---|
| Chain ID | `5042` | `5042002` | [DOC] |
| RPC | `https://rpc.mainnet.arc.io` (listed **permissioned**) | `https://rpc.testnet.arc.io` | [DOC] |
| WS | `wss://rpc.quicknode.mainnet.arc.io` (in docs' viem chain def) | `wss://rpc.testnet.arc.io` | [DOC] |
| Explorer | `https://explorer.arc.io` (listed permissioned) | `https://explorer.testnet.arc.io` | [DOC] |
| Explorer API | Blockscout Pro API `https://api.blockscout.com/5042/api/v2/...` (key required) | same with `5042002` | [3P] |
| Verified source | `GET /api/v2/smart-contracts/<address>` on the Pro API | | [3P] |
| Currency | `USDC`, `nativeCurrency.decimals = 18` | | [DOC] |
| Mainnet gas USDC | docs say request via Circle point of contact; alternative: CCTP from another chain | | [DOC] |

Mainnet went live on 16 September 2026. [3P]

---

## 4. Execution environment

- EVM baseline **Osaka**, plus EIP-7708 ahead of upstream (Amsterdam track). EIP-7702 supported. [DOC]
- Native-coin **precompiles** back the `0x3600…` interface, EIP-7708 logs, and **USDC blocklist enforcement**; these only surface against an Arc RPC endpoint. [DOC] ⇒ local anvil cannot reproduce ERC-20-view semantics. See invariant I8.
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

- [ ] `eth_chainId` on the chosen mainnet provider returns `0x13b2` (5042). — **BLOCKED (env)**; script `scripts/phase0/chain-id.ts`.
- [ ] Pick one mainnet ERC-20 USDC transfer; fetch receipt; confirm exactly two Transfer logs with emitters `0x3600…` and `0xffff…fffe` and `v18 == v6 * 10¹²`; record ordering. — **BLOCKED (env)**; `scripts/phase0/logs.ts`.
- [ ] Pick one native send; confirm exactly one system log, zero `0x3600…` logs. — **BLOCKED (env)**; `scripts/phase0/logs.ts`.
- [ ] Confirm gas deduction produces no Transfer log. — **BLOCKED (env)**; `scripts/phase0/logs.ts` (native send + zero-value tx).
- [ ] `eth_getLogs` max block range and result cap on the chosen provider. — **BLOCKED (env, no provider chosen)**; `scripts/phase0/getlogs-range.ts`.
- [ ] Blockscout Pro `smart-contracts/<addr>` response shape: field names for sources, compiler version, settings, EVM version, constructor args, `immutable_references` if present. — **BLOCKED (env)**; `scripts/phase0/blockscout.ts` writes `analyzer/tests/fixtures/blockscout_smart_contract.json`. `VERIFY:` Pro API auth scheme (query `apikey` vs header); the script tries both and reports which worked.
- [ ] Highest solc + Foundry `evm_version` accepted for Arc; deploy a hello-world to testnet. — **PARTIAL**: local compile only (see §8). Deploy **BLOCKED (env)**; `contracts/script/DeployHello.s.sol`.
- [ ] Whether `forge test --fork-url <arc-testnet>` exercises the `0x3600…` precompiles. — **BLOCKED (env)**; `contracts/test-arc/Precompile.t.sol`.
- [ ] Obtain a small mainnet USDC balance for deployer and attester (CCTP path documented in `docs/BUILD_PLAN.md`). — **NOT STARTED**: out of scope for this Phase 0 pass (no mainnet spend); needs owner decision.

---

## 8. Phase 0 log

Run: 2026-09-30. Status: **offline half done, live half blocked.** No `.env` existed, so none of the RPC or
Blockscout facts above have been observed yet and every Arc `VERIFY:` in this file remains open.

### 8.1 Established offline

| Fact | Result | Evidence |
|---|---|---|
| `TRANSFER_TOPIC`, `UPGRADED_TOPIC`, EIP-1967 impl/beacon slots in §2/§6 | Correct: recomputed from preimages | `packages/shared/test/constants.test.ts` (4/4 pass) |
| Foundry 1.7.1 accepts `evm_version = "osaka"` | Yes, with solc 0.8.30 and 0.8.37 (latest release on 2026-09-30); metadata records `evmVersion: osaka` | `forge build --use 0.8.37 --evm-version osaka` → `0.8.37+commit.f401782d osaka` |
| Hello deploys under local osaka EVM | Yes (anvil `--hardfork osaka`). **Not Arc evidence** (I8) | local only |
| Arc accepts osaka bytecode / solc 0.8.37 | **Unknown**: needs testnet deploy | — |

### 8.2 Deviations from doc assumptions found so far

- `Contract addresses` source in the header uses `docs.arc.network` while every other source uses `docs.arc.io`.
  `VERIFY:` which domain is canonical (owner: Phase 0 live run) before §5 is resolved.
- crytic-compile's standard-JSON path mutates its input and rewrites `settings.optimizer` (drops `details`),
  and needs sources on disk. This contradicts `ANALYZER.md §8` step 3 as written; see proposed ADR-016.
