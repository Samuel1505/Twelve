import { z } from "zod";
import { isAddress, type Address, type Hex } from "viem";
import { parseUsdc18, type Usdc18 } from "@twelve/shared";

const addr = z.string().refine((s) => isAddress(s), "address").transform((s) => s as Address);
const key = z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/).transform((s) => (s.startsWith("0x") ? s : `0x${s}`) as Hex);

/** Every variable is listed in .env.example (I11). The deployer key is never read here (I12). */
export const Env = z.object({
  DATABASE_URL: z.string().min(1),
  ARC_RPC_URL: z.string().url().optional(),
  ARC_TESTNET_RPC_URL: z.string().url().optional(),
  BLOCKSCOUT_API_KEY: z.string().min(1).optional(),
  REGISTRY_ADDRESS: addr.optional(),
  ATTESTER_PRIVATE_KEY: key.optional(),
  ATTESTER_MIN_BALANCE: z.string().default("0.05").transform((s): Usdc18 => parseUsdc18(s)),
  ADMIN_TOKEN: z.string().min(16).optional(),
  API_PORT: z.coerce.number().int().default(8787),
  ANALYZER_CMD: z.string().default("uv run --project analyzer twelve"),
  ANALYZER_CWD: z.string().default("../.."),
  SCAN_RATE_PER_MIN: z.coerce.number().int().default(10),
  DISCLOSED_ADDRESSES: z.string().default("").transform((s) => new Set(s.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean))),
  WEB_ORIGIN: z.string().default("http://localhost:3000").transform((s) => s.split(",").map((x) => x.trim())),
});
export type Env = z.infer<typeof Env>;

export const CHAINS = { 5042: "arc", 5042002: "arc-testnet" } as const;
export type ChainId = keyof typeof CHAINS;
export const isChainId = (n: number): n is ChainId => n in CHAINS;

export function rpcUrl(env: Env, chainId: ChainId): string | undefined {
  return chainId === 5042 ? env.ARC_RPC_URL : env.ARC_TESTNET_RPC_URL;
}
