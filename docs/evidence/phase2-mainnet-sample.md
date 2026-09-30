# Phase 2 evidence — deployed-mode scans of verified Arc mainnet contracts

Command: `uv run --project analyzer python scripts/phase2-sample.py 15` (one contract per name, Blockscout Pro list order).
Run 2026-09-30, blocks 23581831–23582115. Per CORPUS_AND_TESTING §7 this file lists match data only; verdicts are
aggregated. **Result: 15/15 matched (10 exact, 5 masked), 0 MATCH_FAILED; verdicts: 15 CLEAN.**

| Address | Contract | solc | Kind | Match | Masked ranges | Seconds |
|---|---|---|---|---|---|---|
| `0x3dEc604970B5cEdF3843218506264b86A1710087` | LaunchToken | 0.8.28+commit.7893614a | contract | exact | 0 | 5.0 |
| `0x2f55716Cc918b491D148e35c689d8C00c5317e7b` | MoonARCfun | 0.8.26+commit.8a97fa7a | contract | exact | 2 | 7.6 |
| `0x0abd8A8F8c6188C55f7e817273FCb7d9c3699962` | SwapRouter02 | 0.7.6+commit.7338295f | contract | exact | 23 | 15.8 |
| `0x849557f9b979013Fd31C0C61e3d1edAa7Ea59a8B` | QuoterV2 | 0.7.6+commit.7338295f | contract | exact | 4 | 16.3 |
| `0x41509704163f11406DEBE9C69dA1EEfab235F1f8` | NonfungiblePositionManager | 0.7.6+commit.7338295f | contract | exact | 17 | 9.9 |
| `0xa5CD78D40D5DE116aE4c318B9c8EF596f89b725b` | MemeToken | 0.8.24+commit.e11b9ed9 | contract | masked | 1 | 8.9 |
| `0xED95604c968280c10518e3D66db5c5e2cA1553Df` | NonfungibleTokenPositionDescriptor | 0.7.6+commit.7338295f | contract | exact | 7 | 8.8 |
| `0x84169F9aDF4F5F0e483BfC350498a85b1d7eC638` | SynthraV3Factory | 0.7.6+commit.7338295f | contract | exact | 1 | 15.3 |
| `0x494294845B69b3764c828013f707FB15b5F17bf5` | INX | 0.8.26+commit.8a97fa7a | contract | masked | 8 | 7.7 |
| `0xf31675e5Ac818B5100cBb4D19B36c74191ACD330` | FusedLocker | 0.8.26+commit.8a97fa7a | contract | masked | 18 | 8.9 |
| `0xd8aBCbb88a5449D9C3C3004EE1092B7306285851` | FusedFactoryArc | 0.8.26+commit.8a97fa7a | contract | masked | 35 | 16.5 |
| `0x4A4db827a96799671b96c9966D74880E357da0cc` | ArgusV5TaxHook | 0.8.24+commit.e11b9ed9 | contract | exact | 40 | 8.4 |
| `0x8acdc5CA1c99177FC4204158345BFA5694dA4B86` | ArgusV5RewardedToken | 0.8.24+commit.e11b9ed9 | contract | exact | 3 | 8.0 |
| `0x11637C24C454036797aE9c22E8CCAa68bC01f33c` | MoonARCfun | 0.8.26+commit.8a97fa7a | contract | exact | 2 | 7.5 |
| `0xfAc9c4F96D9aeBdB3c278CDaDf1D3466CD63a044` | ArgusV4TaxHook | 0.8.24+commit.e11b9ed9 | contract | exact | 31 | 7.1 |

`masked` = identical executable code; only CBOR metadata differs (Blockscout "partially verified") and/or linked
libraries. Earlier run the same day also covered an EIP-1967 proxy: `0x0690e02173a5f61Ef7E0C3949BdCEcC889E8B100`
(LightAccount, implementation scanned, exact).

## Bugs found and fixed by this run
- **Factory metadata** (`0xd8aB…5851` FusedFactoryArc): the runtime embeds a child's creation code with its own CBOR
  blob mid-code; with partial verification both blobs differ. Matcher now masks every metadata blob present at the
  same offset/length on both sides (`fetch/match.py:cbor_blobs`; test `test_factory_with_embedded_child_metadata`).
- **Over-eager UNSUPPORTED_ASM** (`0x0690…B100` LightAccount): revert-bubbling assembly flagged the function.
  Now only assembly that assigns a Solidity/state variable, writes storage, or makes a value-carrying call counts
  (ANALYZER §4 "touching a tracked value").
