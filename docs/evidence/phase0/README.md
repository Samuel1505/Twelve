Raw Phase 0 evidence (Arc testnet 5042002, 2026-09-30), produced by `scripts/phase0/logs.ts --net testnet`.
Summarized in `docs/ARC_LEDGER.md §7–§8`. Deploy broadcasts: `contracts/broadcast/DeployHello.s.sol/5042002/`.
- `testnet-erc20-transfer.json` — receipt, tx 0x89cf56aa…dc75 (2 logs: system idx 4, ERC-20 idx 5)
- `testnet-native-send.json` — receipt, tx 0x7a5105e9…b281e (1 system log)
- `testnet-gas-only.json` — receipt, tx 0x423f8cef…be61c (0 system logs, fee > 0)
Mainnet (5042), same script without `--net`:
- `mainnet-erc20-transfer.json` — tx 0xf48fa394…858b (system idx 10, ERC-20 idx 11)
- `mainnet-native-send.json` — tx 0xf5f4ccb6…95a2 (1 system log)
- `mainnet-gas-only.json` — tx 0xa38de0c7…bf96 (0 system logs, fee > 0)
