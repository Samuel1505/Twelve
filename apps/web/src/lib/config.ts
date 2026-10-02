// Public configuration. Every address here is a real Arc mainnet deployment (docs/BUILD_PLAN.md §Deployed).
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

export const EXPLORER = "https://explorer.arc.io";
export const explorerAddress = (a: string) => `${EXPLORER}/address/${a}`;
export const explorerTx = (h: string) => `${EXPLORER}/tx/${h}`;

export const MAINNET = {
  chainId: 5042,
  registry: "0x6670030e9df18e3A454eA77d69D00Fd8d17728A1",
  gate: "0x7a63d663861f84cd0F6F66DE29945620C1Cc95b7",
  attester: "0xe98540d28F45830E01D237251Bfc4777E69c9A46",
  usdcErc20: "0x3600000000000000000000000000000000000000",
  systemEmitter: "0xfffffffffffffffffffffffffffffffffffffffe",
  /** Deliberately vulnerable demo shop (contracts/src/demo/LeakyRefund.sol). */
  leakyRefund: "0xA6c15eDC8ceffb558A54ead5bd9d833A589276bC",
} as const;
