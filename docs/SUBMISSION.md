# SUBMISSION.md — Arc Microgrants entry

Required fields: live deployment link, public repo, short description (what it does + what it uses Arc for), builder profile (GitHub / X / Farcaster). Fill placeholders after Phase 6.

## Live link
`https://<web-domain>` — opens on the home page with a paste box pre-filled with the mainnet LeakyRefund address and a "Scan" button, plus the live alert ticker. First impression in < 5 seconds.

## Repo
`https://github.com/<handle>/twelve`

## Description (≤ 150 words)
> On Arc, USDC is one balance with two views: 18 decimals natively (`msg.value`, balances, gas) and 6 decimals through the ERC-20 at `0x3600…`. Code ported from other EVM chains mixes them and misprices by 10¹² — overpaying until drained, or refunding users dust. Arc's docs warn about it; nothing enforced it.
>
> Twelve is Arc's decimal-safety layer. A Slither-based analyzer tracks the decimal unit of every USDC value and flags where 18 meets 6, with a full trace. Results are attested on Arc mainnet, bound to the contract's codehash, so routers can refuse to send native USDC to unsafe contracts in one call. A live monitor reads Arc's EIP-7708 native Transfer logs across mainnet and flags the 10¹² fingerprint — including in unverified contracts — within seconds. A `Usdc6`/`Usdc18` type library makes the bug a compile error.

## What it uses Arc for (be specific)
- The dual-view USDC ledger is the problem itself — Twelve has no reason to exist on any other chain.
- EIP-7708 system Transfer logs (`0xffff…fffe`) + ERC-20 twin logs (`0x3600…`): pairing them classifies every USDC movement by interface, which is how the monitor sees cross-view raw equality.
- USDC-denominated gas: attestations and revocations cost fractions of a cent, so every scan can be attested.
- Deterministic sub-second finality: alerts and proxy-upgrade revocations are final, no reorg handling.

## Evidence to link
- Registry + gate + demo contract addresses (explorer links).
- `/corpus` precision/recall table.
- `/sweep` mainnet stats.
- Demo video.

## Builder profile
GitHub: `<handle>` · X: `<handle>`
