# Phase 6 evidence — guard library and demo beats on Arc mainnet

Run 2026-10-02, chain 5042. Deployer `0x89a68d0731F9Bc419d606f1F31Ead04c3fBDFdd6`, attester
`0xe98540d28F45830E01D237251Bfc4777E69c9A46`. All contracts below are Twelve's own demo contracts.

## Deployments (`contracts/script/arc/Phase6Demo.s.sol`, verified via `scripts/verify-pro.sh`)
| Contract | Address | Deploy tx | Gas |
|---|---|---|---|
| FixedRefund(0) | `0x62e325C4aaB5f3808DCAaFb71d932f4E97455368` | `0x57488d5e6f0a8d57b41e2a2ae94c726534e617045de997d69823d0f52aca82b3` | 252,305 |
| OverpayVault(2 USDC cap, 1 day) | `0xc2Dc300E524Cb9Ee18887E7c2333D24403dF076A` | `0x3cef66e811915cf0568acf26d3b3dd0a0b9ab185a731bd6b60900cc8a106eb4f` | 395,137 |
| approve(FixedRefund) | — | `0x032df7e7d46b99a3caf35ec45740340928a18f1de443d24369337e7946c4cc3e` | 55,786 |

At 20 gwei-units: 0.014 USDC for the three. OverpayVault holds a 0.01 USDC deposit that neither withdrawal can return
(by design: one path reverts on the unit check, the other asks for 10^12 times too much).

## Beats
| Beat | What ran | Result |
|---|---|---|
| 2 | `LeakyRefund.buy(10000)` (0.01 USDC, ERC-20 view), tx `0x0bc4e2f726d774418f899f3a6f7f442e55678be8af796b48a1001d7da284f284`, block 23,950,938 | Refund raw `10000` in the native view = 0.00000000000001 USDC. Monitor D1 HIGH (`inflow 10000 erc20`, `outflow 10000 native`, ratio 10^-12) and D5 INFO. Block timestamp → alert row: **1.84 s** at `MONITOR_POLL_MS=400` (1 s timestamp resolution; Phase 4 measured 0.94 s at 250 ms). |
| 3 | API scan + attest | FixedRefund **CLEAN**, attest tx `0x26211614c394a63e209d1efd3e21f1a61b8d50358bd7df8b8843d4e19635c510`. OverpayVault **FINDINGS** (TW-004 HIGH INFERRED, `withdraw()` line 49), attest tx `0x317a148eb53e53a1f22f0ea22aff2f044307bec0cf769068f80d15cc78b1a3a7`. LeakyRefund FINDINGS (TW-003 HIGH INFERRED) attested earlier, tx `0xff73f44ff7f0756580a2455faf534a5aa2bcaba1a0e166bff5d26bc959c384e1`. |
| 4 | `eth_call TwelveGate.forward(target, sold())` from the deployer | LeakyRefund: reverts `TargetNotClean(0xa6c1…76bc, 2)` (`0x288c31a8…`). FixedRefund: passes, returns `sold() = 0`. Registry status 2 / 1. |
| 5 | `twelve verify --report` on LeakyRefund's attested report `0xb87fdad3…252ad` | **MATCH** when run at the report's analyzer commit `2678d1c`; MISMATCH at a later HEAD because `tool.gitCommit` differs (CLI now prints the `git checkout` to reproduce). See open decision below. |
| 6 | `contracts/script/compile-fail.sh` | solc rejects `Usdc6 + Usdc18`: Error (5653) "…which is Usdc6." |
| 6 | `eth_call OverpayVault.withdrawGuarded()` after a 0.01 USDC deposit | reverts `UnitMismatch(10000000000000000, 10000000000000000)` (`0xdbc210c8…`). Unguarded `withdraw()`: reverts "ERC20: transfer amount exceeds balance" — it asks the ERC-20 view for 10^16 units (10^10 USDC). |

Beat 7 (`/sweep`) awaits Phase 7; DEMO_SCRIPT notes the narration must match what the page shows.

## Open decision
`reportCore.tool.gitCommit` is the repository HEAD, so any commit — including web-only ones — changes every new
reportHash, defeats the API's dedupe after each deploy, and makes `verify` require a checkout of that exact commit.
Proposed (needs owner sign-off, it changes the meaning of a report-core field): identify the analyzer by a hash of its
own source tree (`analyzer/twelve/**`, `uv.lock`) instead of the repo commit.
