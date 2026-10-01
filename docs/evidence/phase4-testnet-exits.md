# Phase 4 evidence — monitor exit runs on Arc testnet (5042002)

Run 2026-10-01 with `apps/monitor` following testnet head (dRPC, 100-block windows, 250 ms polling) and `apps/api`
as the attester. Block timestamps are whole seconds, so latencies are given as ranges.

## D1 — LeakyRefund tx detected within 2 s
LeakyRefund `0x3DBE97Cf796e313Be59B61E836488203Cb5CBe07` (`contracts/src/demo/LeakyRefund.sol`, capacity 0: every buy is
refunded natively and unscaled). Buyer is a throwaway testnet key (`cast send`: forge's local simulation cannot run the
0x1800 precompile behind `transferFrom`, ADR-017).

| Buy tx | Block | D1 alert after block timestamp | Monitor step |
|---|---|---|---|
| `0x6304d633b44cb19588ba088be5b04d70fe0ac04e1b1a71b67c8a4de1586fb763` | 65,021,460 | 0.23 – 1.23 s | 985 ms |
| `0xb80daa6aa8eab3f9accfa7ccfbe22a3ab2511e70c034fd1f64a40f1253eef7a5` | 65,021,471 | 0.16 – 1.16 s | 1,033 ms |
| `0xe15423a983aa170cd67ced0958172564b008b6bf79e0b5443e4fee1a869dd084` | 65,021,483 | 0.05 – 1.05 s | 381 ms |

Evidence for each: `{"kind":"underpay","inflow":{"iface":"erc20","usdc":"0.05"},"outflow":{"iface":"native","usdc":"0.00000000000005"},"ratio":"10^-12"}`.
A first run before the one-round-trip change measured 1.3 – 2.3 s (tx `0xd942ab8a…ad85`).

## D4 — attested proxy upgraded ⇒ revoked within 5 s
Proxy `0x9B851BA8a469314EAafDDa5A0DD46B309E34cbd0` (EIP-1967, `DemoUpgradeableProxy`), v1 `0x63Dbb10EA994AAc43D1E94d5429B4f28DfFC8BDa`,
v2 `0x309C14339f77671305C1A8d020E9E081c6336251`, all verified.

| Upgrade | Upgrade tx (block) | Revoke tx (block) | Latency | Re-attested implementation |
|---|---|---|---|---|
| v1 → v2 | `0xf55d6985…34cb` (65,021,767) | `0x26fb3dbf…9560` (65,021,774) | +7 blocks, +4 s | **v1 — stale (bug)** |
| v2 → v1 | `0xda893ca7e27e5938a948d73f0867f9e7887fd8e335c3a26b98dc710ddfe586e6` (65,022,089) | `0xa8a272a7a461821269fe29f560c458917d9c4d39b1e59ec97f1027d21c171421` (65,022,096) | +7 blocks, +3 s | v1 — correct |

**Bug found by this run and fixed:** the API reused a cached report keyed by the proxy's codehash, which an upgrade does
not change, and re-attested the old implementation after the revoke — a false CLEAN for code no longer behind the proxy.
`apps/api/src/scans.ts` now reuses a cached proxy report only if the proxy still points at the recorded implementation
with the same codehash (`currentImplementation`, regression test "proxy dedupe" in `apps/api/test/scans.test.ts`). The
stale record was corrected by a fresh scan (attest tx `0x8da57835…16f0`, implementation v2) before the second upgrade.
