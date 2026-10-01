# Phase 3 evidence — curl → scan → attestation → TwelveGate, on Arc testnet (5042002)

Run 2026-10-01 with the API running locally (`pnpm --filter @twelve/api dev`, REGISTRY_ADDRESS = testnet registry).
Targets are corpus case c10 (storage-bound USDC), deployed and verified on testnet in Phase 2.

| Step | Bug target `0x42957B36F5623912dED1a0A16bba3dad22E571C9` | Safe target `0x13D73c1fEb412Cc8eF79AbBC3abaa10fC61a3AC9` |
|---|---|---|
| `POST /v1/scans` → stages | RESOLVING > FETCHING > REBUILDING > COMPILING > MATCHING > BINDING > ANALYZING > HASHING > ATTESTING > DONE | same |
| Verdict | FINDINGS (TW-004 HIGH) | CLEAN |
| reportHash | `0x43c4989375b42659819032a51b335ee446808ef70030c7207a4c16653cd13674` | `0xcab6d618ee6222394d8f893c1f9ca9f96e8461cdca7c2b37be2c626982fc5c4b` |
| attest tx | `0xf49d8da92a829a881ec988632db12545097d5d5c622ae858df269b7f2c4920eb` (block 64922200) | `0xdb6da5af70326e0b1ce11edd7dc050ef746d634e19318c48ef4a812bcfeb1257` (block 64922227) |
| `registry.status(attester, target)` | 2 (FINDINGS) | 1 (CLEAN) |
| `TwelveGate.forward` | reverts `TargetNotClean(target, 2)` — selector `0x288c31a8`, via `eth_call` on the Arc node | succeeds — tx `0x679c696a193fcfd07e7d4c06b908ee8e1944f6fc226ed752fd08f7434a17b38c` (`script/arc/GateE2E.s.sol`) |

Registry `0x6670030e9df18e3A454eA77d69D00Fd8d17728A1`, gate `0x7a63d663861f84cd0F6F66DE29945620C1Cc95b7`,
attester `0xe98540d28F45830E01D237251Bfc4777E69c9A46`.

Attest cost: 124,116 gas × 32.5 gwei-equivalent = 0.00403377 USDC per attestation (both txs identical).
