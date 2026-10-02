// Replay CLI (MONITOR §5 replay gate): stream history from RPC through the engine, count alerts, keep them for triage.
// No delivery, no writes except the accounts cache. Resumable via a state file.
//   pnpm --filter @twelve/monitor replay -- --chain 5042 --from 0 --to latest --out replay.json
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, getAddress, http, type Address, type PublicClient } from "viem";
import { arcMainnet, arcTestnet, formatUsdc18, usdc18 } from "@twelve/shared";
import { connect, migrate, type Db } from "@twelve/db";
import { Accounts } from "./accounts.js";
import { decodeLogs, logFilter } from "./decode.js";
import type { AttestationView } from "./detectors/context.js";
import { BLOCKS_PER_DAY } from "./detectors/d5.js";
import { onlyContracts, processBatch, type EngineState } from "./engine.js";
import { errorText, getLogsAdaptive } from "./ingest/fetch.js";
import type { Profile } from "./profiles.js";
import type { Alert } from "./types.js";

type Args = { chain: number; from: bigint; to: bigint | "latest"; window: bigint; concurrency: number; out: string };

function parseArgs(argv: string[]): Args {
  const get = (k: string, d?: string) => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : d;
  };
  const to = get("to", "latest")!;
  return {
    chain: Number(get("chain", "5042")),
    from: BigInt(get("from", "0")!),
    to: to === "latest" ? "latest" : BigInt(to),
    window: BigInt(get("window", "10000")!),
    concurrency: Number(get("concurrency", "4")),
    out: get("out", `replay-${get("chain", "5042")}.json`)!,
  };
}

type Saved = { next: string; to: string; profiles: [string, unknown][]; alerts: Alert[]; counts: Record<string, number>;
  logs: number; movements: number; startedAt: number; density?: number };

const ser = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? `${x}n` : x));
const de = <T>(s: string): T => JSON.parse(s, (_k, x) => (typeof x === "string" && /^-?\d+n$/.test(x) ? BigInt(x.slice(0, -1)) : x));

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  const url = a.chain === 5042 ? process.env.ARC_RPC_URL : process.env.ARC_TESTNET_RPC_URL;
  if (!url) throw new Error("missing ARC_RPC_URL / ARC_TESTNET_RPC_URL");
  const client = createPublicClient({ chain: a.chain === 5042 ? arcMainnet : arcTestnet,
    // no JSON-RPC batching: Infura's Arc endpoint mishandles batched requests (observed Phase 4)
    transport: http(url, { retryCount: 3, retryDelay: 500, timeout: 40_000 }) }) as PublicClient;
  if ((await client.getChainId()) !== a.chain) throw new Error("RPC chainId mismatch (gotcha #7)");
  const head = await client.getBlockNumber();
  const to = a.to === "latest" ? head : a.to;
  const db: Db | null = process.env.DATABASE_URL ? connect(process.env.DATABASE_URL, 4) : null;
  if (db) await migrate(db);
  const registry = process.env.REGISTRY_ADDRESS ? getAddress(process.env.REGISTRY_ADDRESS) : null;

  const accounts = new Accounts(a.chain, client, db);
  await accounts.load();
  const state: EngineState = { chainId: a.chain, profiles: new Map(), attestations: new Map<Address, AttestationView>(),
    completeHistory: a.from === 0n };
  let next = a.from;
  let alerts: Alert[] = [];
  let counts: Record<string, number> = {};
  let nLogs = 0;
  let nMov = 0;
  let savedDensity = 0;
  const statePath = `${a.out}.state`;
  if (existsSync(statePath)) {
    const s = de<Saved>(readFileSync(statePath, "utf8"));
    next = BigInt(s.next);
    for (const [k, v] of s.profiles) state.profiles.set(k as Address, v as Profile);
    // sparse hist keys come back as strings from JSON; numeric lookups still work
    ({ alerts, counts } = s);
    nLogs = s.logs;
    nMov = s.movements;
    savedDensity = s.density ?? 0;
    console.error(`resuming at block ${next} (${state.profiles.size} profiles)`);
  }
  const t0 = Date.now();
  const filter = logFilter(registry, new Set());
  const inflight: Promise<{ from: bigint; to: bigint; logs: Awaited<ReturnType<typeof getLogsAdaptive>> }>[] = [];
  let cursor = next;
  let progressAt = Date.now();
  // adaptive window: aim for ~TARGET_LOGS per request from the observed density. Dense history (7–23 logs/block near
  // block 12.87M) would otherwise need many sequential 20k-result splits per 10k-block window under rate limiting.
  const TARGET_LOGS = 8_000;
  // resumes with the saved density: after a restart in dense history, a full 10k-block first window can hold 270k+ logs
  let density = savedDensity; // logs per block, exponential moving average
  const windowSize = (): bigint => {
    if (density <= 0) return a.window < 1_000n ? a.window : 1_000n; // unknown density: start small, adapt after one window
    const w = BigInt(Math.max(100, Math.min(Number(a.window), Math.floor(TARGET_LOGS / density))));
    return w;
  };
  const launch = () => {
    while (inflight.length < a.concurrency && cursor <= to) {
      const f = cursor;
      const size = windowSize();
      const e = f + size - 1n > to ? to : f + size - 1n;
      cursor = e + 1n;
      inflight.push(getLogsAdaptive(client, filter, f, e, 0, () => { progressAt = Date.now(); })
        .then((logs) => ({ from: f, to: e, logs })));
    }
  };
  let windows = 0;
  const cooled = new Set<string>();
  let savedAt = Date.now();
  // watchdog: a replay that makes no progress for 15 minutes exits (resumable from the state file) instead of idling
  const watchdog = setInterval(() => {
    if (Date.now() - progressAt > 15 * 60_000) {
      console.error(`watchdog: no progress for 15 min at block ${next}; exiting (resume with the same command)`);
      process.exit(3);
    }
  }, 30_000);
  watchdog.unref();
  launch();
  while (inflight.length) {
    const tw = Date.now();
    const w = await inflight.shift()!; // applied strictly in block order
    if (Date.now() - tw > 20_000) console.error(`slow window [${w.from}, ${w.to}]: ${Date.now() - tw} ms, ${w.logs.length} logs`);
    launch();
    const dec = decodeLogs(a.chain, w.logs, registry, new Set());
    for (const ev of dec.registry) {
      if (ev.kind === "Attested") {
        state.attestations.set(ev.target, { verdict: ev.verdict as 1 | 2 | 3, revoked: false,
          implementation: ev.implementation === "0x0000000000000000000000000000000000000000" ? null : ev.implementation });
      } else {
        const cur = state.attestations.get(ev.target);
        if (cur) state.attestations.set(ev.target, { ...cur, revoked: true });
      }
    }
    if (dec.transfers.length) {
      const r = processBatch(state, dec.transfers);
      nMov += r.movements.length;
      const kept = await onlyContracts(r.alerts, (x) => accounts.resolve(x), (x) => accounts.map.get(x));
      for (const al of kept) {
        // count what production would deliver: one MEDIUM/INFO per detector per address per day (MONITOR §6)
        if ((al.severity === "MEDIUM" || al.severity === "INFO") && al.address && al.block !== null) {
          const k = `${al.detector}:${al.address}:${al.block / BLOCKS_PER_DAY}`;
          if (cooled.has(k)) continue;
          cooled.add(k);
        }
        counts[al.detector] = (counts[al.detector] ?? 0) + 1;
        if (alerts.length < 5000 && !alerts.some((x) => x.dedupeKey === al.dedupeKey)) alerts.push(al);
      }
    }
    nLogs += dec.transfers.length;
    next = w.to + 1n;
    windows++;
    progressAt = Date.now();
    const d = w.logs.length / Number(w.to - w.from + 1n);
    density = density === 0 ? d : 0.5 * density + 0.5 * d;
    if (windows % 20 === 0 || next > to) {
      const save = Date.now() - savedAt > 120_000 || next > to;
      const done = Number(next - a.from) / Number(to - a.from + 1n);
      console.error(`block ${w.to}/${to} (${(done * 100).toFixed(1)}%) logs=${nLogs} movements=${nMov} ` +
        `profiles=${state.profiles.size} alerts=${JSON.stringify(counts)} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      if (save) {
        savedAt = Date.now();
        writeFileSync(statePath, ser({ next: next.toString(), to: to.toString(), profiles: [...state.profiles],
          alerts, counts, logs: nLogs, movements: nMov, startedAt: t0, density } satisfies Saved));
      }
    }
  }

  const blocks = to - a.from + 1n;
  const days = Number(blocks) / Number(BLOCKS_PER_DAY);
  const summary = {
    chainId: a.chain, from: a.from.toString(), to: to.toString(), blocks: blocks.toString(), days: days.toFixed(2),
    logs: nLogs, movements: nMov, profiles: state.profiles.size, counts,
    perDay: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, (v / Math.max(days, 1e-9)).toFixed(3)])),
    alerts: alerts.map((x) => ({ ...x, block: x.block?.toString() ?? null })),
    topBalances: [...state.profiles.values()].sort((p, q) => (q.balance18 > p.balance18 ? 1 : -1)).slice(0, 5)
      .map((p) => ({ address: p.address, usdc: formatUsdc18(usdc18(p.balance18)), n_out: p.nOut })),
  };
  writeFileSync(a.out, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ...summary, alerts: undefined, topBalances: undefined }, null, 2));
  await db?.end();
}

main().catch((e) => {
  console.error(errorText(e));
  process.exit(1);
});
