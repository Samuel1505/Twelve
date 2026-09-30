// Arc ledger constants. Values verbatim from docs/ARC_LEDGER.md §2 and §6.
import type { Address, Hex } from "viem";

/** 6-decimal ERC-20 view of native USDC (NativeFiatToken). */
export const USDC_ERC20: Address = "0x3600000000000000000000000000000000000000";

/** EIP-7708 system emitter of 18-decimal native Transfer logs. */
export const SYSTEM_EMITTER: Address = "0xfffffffffffffffffffffffffffffffffffffffe";

/** keccak256("Transfer(address,address,uint256)") — same topic0 for both streams; emitter discriminates. */
export const TRANSFER_TOPIC: Hex =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/** EIP-1967 implementation slot. */
export const EIP1967_IMPLEMENTATION_SLOT: Hex =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

/** EIP-1967 beacon slot. */
export const EIP1967_BEACON_SLOT: Hex =
  "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";

/** keccak256("Upgraded(address)"). */
export const UPGRADED_TOPIC: Hex =
  "0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b";

/** EIP-7702 delegation designator prefix (code = 0xef0100 ‖ delegate). v1: UNSUPPORTED. */
export const EIP7702_PREFIX: Hex = "0xef0100";

export const ARC_MAINNET_CHAIN_ID = 5042 as const;
export const ARC_TESTNET_CHAIN_ID = 5042002 as const;
