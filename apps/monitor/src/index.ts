// apps/monitor entrypoint: migrate → load state → follow head (or backfill from genesis) → deliver webhooks.
import { createPublicClient, http, zeroHash, type PublicClient } from "viem";
import { arcMainnet, arcTestnet } from "@twelve/shared";
import { connect, migrate } from "@twelve/db";
import { Accounts } from "./accounts.js";
import { Env } from "./config.js";
import { telegram } from "./deliver/telegram.js";
import { deliverDue } from "./deliver/webhook.js";
import { follow } from "./follow.js";
import { errorText } from "./ingest/fetch.js";
import { apiRevoker } from "./revoker.js";
import { getCheckpoint, loadAttestations, loadProfiles } from "./store.js";

const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ level: "info", t: new Date().toISOString(), msg, ...extra }));

async function main(): Promise<void> {
  const env = Env.parse(process.env);
  const chainId = env.MONITOR_CHAIN_ID;
  const url = chainId === 5042 ? env.ARC_RPC_URL : env.ARC_TESTNET_RPC_URL;
  if (!url) throw new Error("RPC URL for MONITOR_CHAIN_ID not set");
  if (!env.ATTESTER_ADDRESS) throw new Error("ATTESTER_ADDRESS not set");
  const client = createPublicClient({ chain: chainId === 5042 ? arcMainnet : arcTestnet,
    transport: http(url, { retryCount: 5, retryDelay: 300, timeout: 60_000 }) }) as PublicClient;
  if ((await client.getChainId()) !== chainId) throw new Error("RPC chainId mismatch (gotcha #7)");

  const db = connect(env.DATABASE_URL);
  await migrate(db);
  const saved = await getCheckpoint(db, chainId);
  const startBlock = env.MONITOR_START_BLOCK ?? 0n;
  // genesis backfill gives exact balances; starting mid-chain marks profiles incomplete (D3/BALANCE off for them).
  // MONITOR_START_BLOCK must stay the same across restarts of one database for this to be meaningful.
  const completeHistory = startBlock === 0n;
  const cp = saved ?? (startBlock === 0n
    ? { block: -1n, hash: zeroHash }
    : { block: startBlock - 1n, hash: (await client.getBlock({ blockNumber: startBlock - 1n })).hash });

  const accounts = new Accounts(chainId, client, db);
  await accounts.load();
  const state = {
    chainId, completeHistory,
    profiles: await loadProfiles(db, chainId, completeHistory),
    attestations: await loadAttestations(db, chainId, env.ATTESTER_ADDRESS),
  };
  log("monitor starting", { chainId, from: (cp.block + 1n).toString(), profiles: state.profiles.size,
    attestations: state.attestations.size, completeHistory, revoker: Boolean(env.ADMIN_TOKEN) });

  setInterval(() => void deliverDue(db).catch((e) => log("delivery error", { e: errorText(e) })), 1000);
  await follow({
    db, client, chainId, registry: env.REGISTRY_ADDRESS ?? null, attester: env.ATTESTER_ADDRESS, state, accounts,
    revoke: env.ADMIN_TOKEN ? apiRevoker(env.API_URL, env.ADMIN_TOKEN, log) : null, window: env.MONITOR_WINDOW, log,
    onAlert: (a) => {
      log("alert", { detector: a.detector, severity: a.severity, address: a.address, tx: a.tx, block: a.block?.toString() });
      if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) void telegram(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, chainId, a);
    },
  }, cp, env.MONITOR_POLL_MS);
}

main().catch((e) => {
  console.error(JSON.stringify({ level: "error", msg: "monitor halted", error: errorText(e) }));
  process.exit(1);
});
