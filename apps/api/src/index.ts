// apps/api entrypoint: migrations → pg-boss worker (scan state machine) → HTTP. One process holds the attester key.
import { PgBoss } from "pg-boss";
import type { PublicClient } from "viem";
import { cliAnalyzer } from "./analyzer.js";
import { makeAttester } from "./attester.js";
import { publicClient } from "./chain.js";
import { CHAINS, Env, rpcUrl, type ChainId } from "./config.js";
import { connect, migrate } from "./db.js";
import { ScanBus } from "./events.js";
import { processScan } from "./scans.js";
import { buildServer } from "./server.js";

const QUEUE = "scan";

async function main(): Promise<void> {
  const env = Env.parse(process.env);
  const db = connect(env.DATABASE_URL);
  const applied = await migrate(db);
  if (applied.length) console.log(JSON.stringify({ level: "info", msg: "migrations applied", applied }));

  const clients: Partial<Record<ChainId, PublicClient>> = {};
  const rpc: Partial<Record<ChainId, { pub: PublicClient; rpcUrl: string }>> = {};
  for (const id of Object.keys(CHAINS).map(Number) as ChainId[]) {
    const url = rpcUrl(env, id);
    if (!url) continue;
    clients[id] = publicClient(id, url);
    rpc[id] = { pub: clients[id]!, rpcUrl: url };
  }
  const attester = env.ATTESTER_PRIVATE_KEY && env.REGISTRY_ADDRESS
    ? makeAttester({ privateKey: env.ATTESTER_PRIVATE_KEY, registry: env.REGISTRY_ADDRESS, minBalance: env.ATTESTER_MIN_BALANCE, clients: rpc })
    : null;
  const bus = new ScanBus();
  const analyzer = cliAnalyzer(env.ANALYZER_CMD, env.ANALYZER_CWD);

  const boss = new PgBoss(env.DATABASE_URL);
  boss.on("error", (e) => console.error(JSON.stringify({ level: "error", msg: "pg-boss", error: String(e) })));
  await boss.start();
  await boss.createQueue(QUEUE);
  // one scan at a time: the analyzer is CPU-bound and the attester is a single writer anyway
  await boss.work<{ scanId: string }>(QUEUE, { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) await processScan({ db, bus, analyzer, attester, clients }, job.data.scanId);
  });

  const app = buildServer({
    db, bus, clients, attester, registry: env.REGISTRY_ADDRESS ?? null, adminToken: env.ADMIN_TOKEN ?? null,
    scanRatePerMin: env.SCAN_RATE_PER_MIN,
    queue: { enqueue: async (scanId) => void (await boss.send(QUEUE, { scanId }, { retryLimit: 2, retryBackoff: true })) },
  });
  await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
  console.log(JSON.stringify({ level: "info", msg: "api listening", port: env.API_PORT, chains: Object.keys(clients),
    attester: attester?.address ?? null, registry: env.REGISTRY_ADDRESS ?? null }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
