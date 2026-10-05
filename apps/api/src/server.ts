// HTTP API (docs/ARCHITECTURE.md §2.2). zod at every boundary; wallet-free; read-only except scan submission and
// the admin revoke.
import { randomBytes } from "node:crypto";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { getAddress, isAddress, type Address, type Hex, type PublicClient } from "viem";
import { z } from "zod";
import { twelveRegistryAbi } from "@twelve/shared";
import type { Attester } from "./attester.js";
import { isChainId, type ChainId } from "./config.js";
import { TERMINAL, getReport, getScan, insertScan, latestReportFor, scanEvents, type Db } from "./db.js";
import type { ScanBus } from "./events.js";
import { redact } from "./redact.js";
import type { SourceFetcher } from "./source.js";

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
  webOrigins?: string[]; // browser origins allowed to call the API (apps/web)
  trustProxy?: boolean; // behind Cloudflare Tunnel: req.ip from X-Forwarded-For, so rate limits are per visitor
  sources?: SourceFetcher; // verified source for finding excerpts; absent ⇒ /v1/source answers 503
  disclosed?: ReadonlySet<string>; // lowercase addresses whose alerts the public feed may name (ADR-022)
  privateTargets?: ReadonlySet<string>; // lowercase; reports and alerts withheld from public endpoints (§7.4)
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

type AlertQuery = { chainId?: number; address?: Address; severity?: string; before?: bigint; id?: bigint; limit: number };

async function alertsFor(db: Db, q: AlertQuery): Promise<Record<string, unknown>[]> {
  const where: string[] = [];
  const args: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    args.push(v);
    where.push(sql.replace("?", `$${args.length}`));
  };
  if (q.id !== undefined) add("id = ?", q.id.toString());
  if (q.chainId !== undefined) add("chain_id = ?", q.chainId);
  if (q.address) add("address = ?", Buffer.from(q.address.slice(2).toLowerCase(), "hex"));
  if (q.severity) add("severity = ?", q.severity);
  if (q.before !== undefined) add("id < ?", q.before.toString());
  args.push(q.limit);
  const r = await db.query(
    `SELECT id::text, chain_id, detector, severity, '0x' || encode(address, 'hex') AS address,
            '0x' || encode(tx, 'hex') AS tx, block::text, evidence, created_at
     FROM alerts ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT $${args.length}`, args);
  return r.rows.map((x) => ({ id: x.id, chainId: x.chain_id, detector: x.detector, severity: x.severity,
    address: x.address ? getAddress(x.address) : null, tx: x.tx, block: x.block, evidence: x.evidence, createdAt: x.created_at }));
}

/**
 * Public alert feed (list + stream) names only disclosed addresses (ADR-022, CORPUS_AND_TESTING §7). Others keep
 * detector, severity, kind and ratio; address, tx, block and amounts are withheld and the time is coarsened to the
 * hour so the transaction cannot be recovered from the feed. /v1/status/:address is unaffected: it requires the address.
 */
export function publicAlert(a: Record<string, unknown>, disclosed: ReadonlySet<string>): Record<string, unknown> {
  const addr = typeof a.address === "string" ? a.address.toLowerCase() : null;
  if (addr && disclosed.has(addr)) return a;
  const ev = (a.evidence ?? {}) as Record<string, unknown>;
  const hour = new Date(a.createdAt as string | Date);
  hour.setUTCMinutes(0, 0, 0);
  return {
    id: a.id, chainId: a.chainId, detector: a.detector, severity: a.severity, address: null, tx: null, block: null,
    evidence: { withheld: true, ...(typeof ev.kind === "string" ? { kind: ev.kind } : {}),
      ...(typeof ev.ratio === "string" ? { ratio: ev.ratio } : {}) },
    createdAt: hour.toISOString(),
  };
}

/** hijacked SSE replies bypass fastify's header pipeline: carry over what @fastify/cors set in onRequest */
const sseCors = (h: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(Object.entries(h).filter(([k]) => k.startsWith("access-control-") || k === "vary").map(([k, v]) => [k, String(v)]));

export function buildServer(d: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false, trustProxy: d.trustProxy ?? false });
  const isAdmin = (h: string | undefined) => !!d.adminToken && h === `Bearer ${d.adminToken}`;
  const hidden = (address: string | null | undefined, auth: string | undefined) =>
    !!address && !!d.privateTargets?.has(address.toLowerCase()) && !isAdmin(auth);
  // read-only data for the web app; scans are rate-limited per IP regardless of origin
  void app.register(cors, { origin: d.webOrigins ?? ["http://localhost:3000"], methods: ["GET", "POST"] });
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
        (out.chains as Record<string, unknown>)[id] = { error: redact(String(e)).slice(0, 120) };
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
    const priv = hidden(scan.address, req.headers.authorization);
    const report = scan.report_hash && !priv ? await getReport(d.db, scan.report_hash) : null;
    return {
      id: scan.id, chainId: scan.chain_id, address: getAddress(scan.address), codehash: scan.codehash,
      state: scan.state, terminal: TERMINAL.has(scan.state), error: scan.error, reportHash: priv ? null : scan.report_hash,
      attestTx: scan.attest_tx, events, report: report ? JSON.parse(report.core_jcs) : null,
    };
  });

  app.get<{ Params: { id: string } }>("/v1/scans/:id/events", async (req, reply) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return reply.code(400).send({ error: "bad id" });
    const scan = await getScan(d.db, req.params.id);
    if (!scan) return reply.code(404).send({ error: "not found" });
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { ...sseCors(reply.getHeaders()), "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write(": open\n\n"); // flush headers now: EventSource only reports open once they arrive
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
    if (!r || hidden(r.address, req.headers.authorization)) return reply.code(404).send({ error: "not found" });
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
        onchain = { error: redact(String(e)).slice(0, 200) };
      }
    }
    const priv = hidden(address, req.headers.authorization);
    const latest = priv ? null : await latestReportFor(d.db, chainId, address);
    const alerts = await alertsFor(d.db, { chainId, address, limit: 20 });
    return {
      chainId, address, onchain, ...(priv ? { withheld: true } : {}),
      report: latest ? { reportHash: latest.report_hash, verdict: latest.verdict, toolVersion: latest.tool_version,
        scannedAt: latest.created_at, core: JSON.parse(latest.core_jcs) } : null,
      alerts: priv ? alerts.map((a) => publicAlert(a, new Set())) : alerts,
    };
  });

  // one verified file, for the web's finding excerpts (paths equal report location.file)
  app.get<{ Params: { address: string }; Querystring: { chainId?: string; file?: string } }>("/v1/source/:address", async (req, reply) => {
    if (!isAddress(req.params.address)) return reply.code(400).send({ error: "not an address" });
    const chainId = Number(req.query.chainId ?? 5042);
    if (!isChainId(chainId)) return reply.code(400).send({ error: "unsupported chainId" });
    if (!req.query.file) return reply.code(400).send({ error: "file is required" });
    if (!d.sources) return reply.code(503).send({ error: "source lookup not configured" });
    const r = await d.sources(chainId, getAddress(req.params.address));
    if (!r.ok) return reply.code(r.error.code === "NOT_VERIFIED" ? 404 : 502).send({ error: r.error.code });
    const content = r.value[req.query.file];
    if (content === undefined) return reply.code(404).send({ error: "FILE_NOT_FOUND", files: Object.keys(r.value).sort() });
    reply.header("cache-control", "public, max-age=3600");
    return { file: req.query.file, content };
  });

  app.get<{ Querystring: { chainId?: string; address?: string; severity?: string; cursor?: string; limit?: string } }>(
    "/v1/alerts", async (req, reply) => {
      const q = req.query;
      if (q.address && !isAddress(q.address)) return reply.code(400).send({ error: "not an address" });
      if (q.severity && !["HIGH", "MEDIUM", "LOW", "INFO", "OPS"].includes(q.severity)) return reply.code(400).send({ error: "bad severity" });
      const rows = await alertsFor(d.db, {
        ...(q.chainId ? { chainId: Number(q.chainId) } : {}),
        ...(q.address ? { address: getAddress(q.address) } : {}),
        ...(q.severity ? { severity: q.severity } : {}),
        ...(q.cursor ? { before: BigInt(q.cursor) } : {}),
        limit: Math.min(200, Number(q.limit ?? 50)),
      });
      const full = isAdmin(req.headers.authorization);
      const disclosed = d.disclosed ?? new Set<string>();
      return { alerts: full ? rows : rows.map((a) => publicAlert(a, disclosed)),
        nextCursor: rows.length ? rows[rows.length - 1]!.id : null };
    });

  // live ticker (MONITOR §6): the monitor NOTIFYs twelve_alerts with each new alert id
  app.get("/v1/alerts/stream", async (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { ...sseCors(reply.getHeaders()), "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write(": open\n\n"); // flush headers now: EventSource only reports open once they arrive
    const client = await d.db.connect();
    const onNote = async (n: { channel: string; payload?: string | undefined }) => {
      if (n.channel !== "twelve_alerts" || !n.payload) return;
      const [a] = await alertsFor(d.db, { id: BigInt(n.payload), limit: 1 });
      if (a) res.write(`data: ${JSON.stringify(publicAlert(a, d.disclosed ?? new Set()))}\n\n`);
    };
    client.on("notification", (n) => void onNote(n));
    await client.query("LISTEN twelve_alerts");
    const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
    req.raw.on("close", () => {
      clearInterval(ping);
      void client.query("UNLISTEN twelve_alerts").finally(() => client.release());
    });
  });

  app.post("/v1/subscriptions", async (req, reply) => {
    const b = z.object({ address: z.string().refine((s) => isAddress(s)), webhookUrl: z.string().url().refine(
      (u) => u.startsWith("https://") || u.startsWith("http://localhost"), "webhook must be https") }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: b.error.issues.map((i) => i.message).join("; ") });
    const secret = randomBytes(32).toString("hex");
    const r = await d.db.query<{ id: string }>(
      "INSERT INTO subscriptions (address, webhook_url, secret) VALUES ($1, $2, $3) RETURNING id",
      [Buffer.from(getAddress(b.data.address).slice(2).toLowerCase(), "hex"), b.data.webhookUrl, secret]);
    // the secret is shown once: deliveries carry X-Twelve-Signature = hex(hmac_sha256(secret, body))
    return reply.code(201).send({ id: r.rows[0]?.id, secret });
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
