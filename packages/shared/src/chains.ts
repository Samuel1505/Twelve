// Arc chain definitions. Values verbatim from docs/ARC_LEDGER.md §3.
// Chain IDs are verified at runtime against eth_chainId (gotcha #7) — see scripts/phase0/chain-id.ts.
import { defineChain } from "viem";

export const arcMainnet = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    // Listed as permissioned; services use ARC_RPC_URL / ARC_WS_URL from a provider.
    default: {
      http: ["https://rpc.mainnet.arc.io"],
      webSocket: ["wss://rpc.quicknode.mainnet.arc.io"],
    },
  },
  blockExplorers: {
    default: { name: "Arc Explorer", url: "https://explorer.arc.io" },
  },
});

export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: {
      http: ["https://rpc.testnet.arc.io"],
      webSocket: ["wss://rpc.testnet.arc.io"],
    },
  },
  blockExplorers: {
    default: { name: "Arc Testnet Explorer", url: "https://explorer.testnet.arc.io" },
  },
  testnet: true,
});

export const ARC_CHAINS = { [arcMainnet.id]: arcMainnet, [arcTestnet.id]: arcTestnet } as const;
