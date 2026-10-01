// HTTP API (docs/ARCHITECTURE.md §2.2). zod at every boundary; wallet-free; read-only except scan submission and
// the admin revoke.
import Fastify, { type FastifyInstance } from "fastify";
import { getAddress, isAddress, type Address, type Hex, type PublicClient } from "viem";
import { z } from "zod";
import { twelveRegistryAbi } from "@twelve/shared";
import type { Attester } from "./attester.js";
import { isChainId, type ChainId } from "./config.js";
import { TERMINAL, getReport, getScan, insertScan, latestReportFor, scanEvents, type Db } from "./db.js";
import type { ScanBus } from "./events.js";

export interface Queue {
  enqueue(scanId: string): Promise<void>;
}

export type ServerDeps = {
  db: Db;
  bus: ScanBus;
  queue: Queue;
  clients: Partial<Record<ChainId, PublicClient>>;
  registry: Address | null;
  attester: Attester | null;
  adminToken: string | null;
  scanRatePerMin: number;
};

const STATUS = ["NONE", "CLEAN", "FINDINGS", "INCOMPLETE", "STALE", "REVOKED"] as const;
const hash32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const ScanBody = z.object({
  chainId: z.number().int().refine(isChainId, "unsupported chainId (5042 mainnet, 5042002 testnet)"),
  address: z.string().refine((s) => isAddress(s), "not an address"),
});

/** Per-IP token bucket for scan submissions (ARCHITECTURE §2.2). In-memory: one api process. */
function rateLimiter(perMin: number) {
  const buckets = new Map<string, { tokens: number; at: number }>();
  return (ip: string): boolean => {
    const now = Date.now();
    const b = buckets.get(ip) ?? { tokens: perMin, at: now };
    b.tokens = Math.min(perMin, b.tokens + ((now - b.at) / 60_000) * perMin);
    b.at = now;
    if (b.tokens < 1) {
      buckets.set(ip, b);
      return false;
    }
    b.tokens -= 1;
    buckets.set(ip, b);
    return true;
  };
}

export function buildServer(d: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  const allow = rateLimiter(d.scanRatePerMin);

  app.get("/healthz", async () => {
    const out: Record<string, unknown> = { db: false, chains: {} };
    try {
      await d.db.query("SELECT 1");
      out.db = true;
    } catch {
      /* reported as false */
    }
    for (const [id, c] of Object.entries(d.clients)) {
      try {
        (out.chains as Record<string, unknown>)[id] = { head: (await c!.getBlockNumber()).toString() };
      } catch (e) {
        (out.chains as Record<string, unknown>)[id] = { error: String(e).slice(0, 120) };
      }
    }
    return out;
  });

  app.post("/v1/scans", async (req, reply) => {
    if (!allow(req.ip)) return reply.code(429).send({ error: "rate limited" });
    const body = ScanBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues.map((i) => i.message).join("; ") });
    const chainId = body.data.chainId as ChainId;
    if (!d.clients[chainId]) return reply.code(400).send({ error: `chain ${chainId} not enabled on this server` });
    const scanId = await insertScan(d.db, chainId, getAddress(body.data.address));
    await d.queue.enqueue(scanId);
    return reply.code(202).send({ scanId });
  });

  app.get<{ Params: { id: string } }>("/v1/scans/:id", async (req, reply) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return reply.code(400).send({ error: "bad id" });
    const scan = await getScan(d.db, req.params.id);
    if (!scan) return reply.code(404).send({ error: "not found" });
    const events = await scanEvents(d.db, scan.id);
    const report = scan.report_hash ? await getReport(d.db, scan.report_hash) : null;
    return {
      id: scan.id, chainId: scan.chain_id, address: getAddress(scan.address), codehash: scan.codehash,
      state: scan.state, terminal: TERMINAL.has(scan.state), error: scan.error, reportHash: scan.report_hash,
      attestTx: scan.attest_tx, events, report: report ? JSON.parse(report.core_jcs) : null,
    };
  });

  app.get<{ Params: { id: string } }>("/v1/scans/:id/events", async (req, reply) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return reply.code(400).send({ error: "bad id" });
    const scan = await getScan(d.db, req.params.id);
    if (!scan) return reply.code(404).send({ error: "not found" });
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    for (const e of await scanEvents(d.db, scan.id)) send({ scanId: scan.id, state: e.stage, error: e.error });
    if (TERMINAL.has(scan.state)) return res.end();
    const off = d.bus.subscribe(scan.id, (ev) => {
      send(ev);
      if (TERMINAL.has(ev.state)) {
        off();
        res.end();
      }
    });
    req.raw.on("close", off);
  });

  app.get<{ Params: { hash: string } }>("/v1/reports/:hash", async (req, reply) => {
    if (!hash32.safeParse(req.params.hash).success) return reply.code(400).send({ error: "bad hash" });
    const r = await getReport(d.db, req.params.hash.toLowerCase() as Hex);
    if (!r) return reply.code(404).send({ error: "not found" });
    // content-addressed ⇒ immutable: the body is the exact canonical bytes that hash to the key
    reply.header("cache-control", "public, max-age=31536000, immutable").type("application/json");
    return reply.send(`{"reportHash":"${r.report_hash}","reportCore":${r.core_jcs},"meta":${JSON.stringify(r.meta)}}`);
  });

  app.get<{ Params: { address: string }; Querystring: { chainId?: string } }>("/v1/status/:address", async (req, reply) => {
    if (!isAddress(req.params.address)) return reply.code(400).send({ error: "not an address" });
    const chainId = Number(req.query.chainId ?? 5042);
    if (!isChainId(chainId) || !d.clients[chainId]) return reply.code(400).send({ error: "unsupported chainId" });
    const address = getAddress(req.params.address);
    const client = d.clients[chainId]!;
    let onchain: Record<string, unknown> | null = null;
    if (d.registry && d.attester) {
      try {
        const [s, a] = await Promise.all([
          client.readContract({ address: d.registry, abi: twelveRegistryAbi, functionName: "status", args: [d.attester.address, address] }),
          client.readContract({ address: d.registry, abi: twelveRegistryAbi, functionName: "get", args: [d.attester.address, address] }),
        ]);
        onchain = {
          registry: d.registry, attester: d.attester.address, status: STATUS[s] ?? "NONE",
          reportHash: a.reportHash, codehash: a.codehash, attestedAt: a.attestedAt,
          implementation: a.implementation === "0x0000000000000000000000000000000000000000" ? null : a.implementation,
          // REGISTRY §4.3: for proxies, freshness of the *current* implementation relies on attester liveness
          proxyNote: a.implementation === "0x0000000000000000000000000000000000000000" ? undefined
            : "implementation swaps are revoked by the monitor; on-chain status alone cannot see them",
        };
      } catch (e) {
        onchain = { error: String(e).slice(0, 200) };
      }
    }
    const latest = await latestReportFor(d.db, chainId, address);
    return {
      chainId, address, onchain,
      report: latest ? { reportHash: latest.report_hash, verdict: latest.verdict, toolVersion: latest.tool_version,
        scannedAt: latest.created_at, core: JSON.parse(latest.core_jcs) } : null,
      alerts: [], // monitor output arrives in Phase 4
    };
  });

  app.post("/v1/admin/revoke", async (req, reply) => {
    if (!d.adminToken || req.headers.authorization !== `Bearer ${d.adminToken}`) return reply.code(401).send({ error: "unauthorized" });
    const b = z.object({
      chainId: z.number().int().refine(isChainId),
      target: z.string().refine((s) => isAddress(s)),
      reason: z.string().min(1).max(31),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "bad body" });
    if (!d.attester) return reply.code(503).send({ error: "attester not configured" });
    const chainId = b.data.chainId as ChainId;
    const target = getAddress(b.data.target);
    const r = await d.attester.revoke(chainId, target, b.data.reason);
    if (!r.ok) return reply.code(502).send({ error: r.error });
    await d.db.query("UPDATE attestations SET revoked = true, updated_at = now() WHERE chain_id = $1 AND target = $2",
      [chainId, Buffer.from(target.slice(2).toLowerCase(), "hex")]);
    return { tx: r.value.tx, block: r.value.block.toString() };
  });

  return app;
}
