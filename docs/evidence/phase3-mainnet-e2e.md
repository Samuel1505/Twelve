# Phase 3 exit — curl → scan → attestation → TwelveGate, on Arc **mainnet** (5042)

Run 2026-10-01. API running locally (`pnpm --filter @twelve/api dev`) against the mainnet registry. Targets are
Twelve's own corpus c10 pair deployed by `script/arc/DeployGateTargets.s.sol` — never third-party contracts
(attesting FINDINGS publicly would disclose an undisclosed finding, CORPUS_AND_TESTING §7).

| Step | FINDINGS target `0x5A76D4AB409CA2114808eDD38cB9A8343a34b7Fb` | CLEAN target `0x42957B36F5623912dED1a0A16bba3dad22E571C9` |
|---|---|---|
| `curl -X POST /v1/scans {"chainId":5042,…}` → stages | RESOLVING > FETCHING > REBUILDING > COMPILING > MATCHING > BINDING > ANALYZING > HASHING > ATTESTING > DONE | same |
| Bytecode match | masked (2 immutables + CBOR) | masked (2 immutables + CBOR) |
| Verdict | FINDINGS — TW-004 HIGH (`payToken` bound from storage at the pinned block) | CLEAN |
| reportHash | `0x9c6ac75261558320859ec6f10a984e88b2c229bac5b768d0d515247da4ad3c58` | `0xf865daf06c9cd605471a3b647c68b0dd207b5c956cd1256e1fd45562fdf1dc83` |
| attest tx | `0x9862a8c52fd0c59db4cf530c3c2d3e6b1231260ee2245cf4728878624db6bde6` (block 23778529) | `0x1e4813cd3dea6e88a54fb44dbddc268c703bf6ba9051a20ff4ed9d8f2d5f5685` (block 23778548) |
| `registry.status(attester, target)` | 2 (FINDINGS) | 1 (CLEAN) |
| `TwelveGate.forward` | **reverts** `TargetNotClean(0x5a76…, 2)` (selector `0x288c31a8`), `eth_call` on the mainnet node | **succeeds**: tx `0xea616fce40807a083297a49f7fa6a3436f20c5e9cd3003e3fbb91ac3211528d8` (block 23778616), 0.001 USDC forwarded and paid on |

Registry `0x6670030e9df18e3A454eA77d69D00Fd8d17728A1` and gate `0x7a63d663861f84cd0F6F66DE29945620C1Cc95b7` —
same addresses as testnet (CREATE2). Attester `0xe98540d28F45830E01D237251Bfc4777E69c9A46`.

Costs at 20 gwei: registry deploy 0.0118 USDC, gate 0.0062, each target ~0.0046 incl. `setToken`, each attest
≈ 0.00248, forward ≈ 0.001. Deployer spent ≈ 0.028 USDC in total; attester ≈ 0.005.

Note: the mainnet target addresses coincide with *different* testnet contracts (deployer nonces differ per network);
on testnet `0x4295…` is the c10 **bug**.
