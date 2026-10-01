import { getAddress, isAddress, type Address } from "viem";
import { z } from "zod";

const addr = z.string().refine((s) => isAddress(s), "address").transform((s) => getAddress(s) as Address);

/** Every variable is in .env.example (I11). The monitor holds no signing key: revocations go through the API. */
export const Env = z.object({
  DATABASE_URL: z.string().min(1),
  MONITOR_CHAIN_ID: z.coerce.number().int().refine((n) => n === 5042 || n === 5042002).default(5042),
  ARC_RPC_URL: z.string().url().optional(),
  ARC_TESTNET_RPC_URL: z.string().url().optional(),
  REGISTRY_ADDRESS: addr.optional(),
  ATTESTER_ADDRESS: addr.optional(), // Twelve's attester (public address only)
  API_URL: z.string().url().default("http://localhost:8787"),
  ADMIN_TOKEN: z.string().min(16).optional(),
  MONITOR_START_BLOCK: z.coerce.bigint().optional(), // default: genesis (complete baselines, MONITOR §1)
  MONITOR_WINDOW: z.coerce.bigint().default(10_000n),
  MONITOR_POLL_MS: z.coerce.number().int().default(400),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
});
export type Env = z.infer<typeof Env>;
