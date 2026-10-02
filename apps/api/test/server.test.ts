import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { keccak256, toHex } from "viem";
import { canonicalJson } from "@twelve/shared";
import type { Db } from "../src/db.js";
import { insertReport } from "../src/db.js";
import { ScanBus } from "../src/events.js";
import { buildServer } from "../src/server.js";
import { freshDb, startAnvil, type Chain } from "./helpers.js";

let chain: Chain;
let db: Db;
let drop: () => Promise<void>;
const queued: string[] = [];

before(async () => {
  chain = await startAnvil();
  ({ db, drop } = await freshDb(`twelve_test_srv_${process.pid}`));
});
after(async () => {
  chain.stop();
  await drop();
});

const app = () => buildServer({
  db, bus: new ScanBus(), queue: { enqueue: async (id) => void queued.push(id) }, clients: { 5042002: chain.pub },
  registry: null, attester: null, adminToken: "t".repeat(20), scanRatePerMin: 5,
});

test("POST /v1/scans validates, enqueues, and rate-limits", async () => {
  const a = app();
  const bad = await a.inject({ method: "POST", url: "/v1/scans", payload: { chainId: 1, address: "0x1" } });
  assert.equal(bad.statusCode, 400);
  const off = await a.inject({ method: "POST", url: "/v1/scans", payload: { chainId: 5042, address: chain.registry } });
  assert.equal(off.statusCode, 400); // mainnet not enabled in this server
  const okRes = await a.inject({ method: "POST", url: "/v1/scans", payload: { chainId: 5042002, address: chain.registry } });
  assert.equal(okRes.statusCode, 202);
  const { scanId } = okRes.json();
  assert.ok(queued.includes(scanId));
  const got = await a.inject({ method: "GET", url: `/v1/scans/${scanId}` });
  assert.equal(got.json().state, "QUEUED");
  // invalid requests count too (they still cost work): 3 used above, 2 left, then 429
  for (let i = 0; i < 2; i++) {
    assert.equal((await a.inject({ method: "POST", url: "/v1/scans", payload: { chainId: 5042002, address: chain.registry } })).statusCode, 202);
  }
  assert.equal((await a.inject({ method: "POST", url: "/v1/scans", payload: { chainId: 5042002, address: chain.registry } })).statusCode, 429);
});

test("GET /v1/reports/:hash serves canonical bytes that hash to the key, cacheable forever", async () => {
  const core = { schemaVersion: 1, verdict: "CLEAN", z: [1, 2], a: "x" };
  const coreJcs = canonicalJson(core);
  const hash = keccak256(toHex(coreJcs));
  await insertReport(db, { hash, schemaVersion: 1, toolVersion: "t", chainId: 5042002, address: chain.registry,
    codehash: `0x${"00".repeat(32)}`, verdict: "CLEAN", coreJcs, meta: { scannedAt: 1 } });
  const r = await app().inject({ method: "GET", url: `/v1/reports/${hash}` });
  assert.equal(r.statusCode, 200);
  assert.match(String(r.headers["cache-control"]), /immutable/);
  const body = r.body;
  const coreText = body.slice(body.indexOf('"reportCore":') + 13, body.lastIndexOf(',"meta"'));
  assert.equal(keccak256(toHex(coreText)), hash);
  assert.equal((await app().inject({ method: "GET", url: `/v1/reports/0x${"ab".repeat(32)}` })).statusCode, 404);
});

test("GET /v1/status returns the latest report; admin revoke needs the token", async () => {
  const s = await app().inject({ method: "GET", url: `/v1/status/${chain.registry}?chainId=5042002` });
  assert.equal(s.statusCode, 200);
  assert.equal(s.json().report.verdict, "CLEAN");
  const unauth = await app().inject({ method: "POST", url: "/v1/admin/revoke", payload: {} });
  assert.equal(unauth.statusCode, 401);
});

test("healthz reports db and chain head", async () => {
  const h = (await app().inject({ method: "GET", url: "/healthz" })).json();
  assert.equal(h.db, true);
  assert.ok(h.chains["5042002"].head);
});

test("alerts: list with filters/cursor, subscriptions return a one-time secret", async () => {
  await db.query(`INSERT INTO alerts (chain_id, detector, severity, address, tx, block, evidence, dedupe_key) VALUES
    (5042002, 'D1', 'HIGH', $1, $2, 10, '{"k":1}', 'a1'), (5042002, 'D2', 'MEDIUM', $1, $2, 11, '{}', 'a2')`,
    [Buffer.from(chain.registry.slice(2).toLowerCase(), "hex"), Buffer.alloc(32, 1)]);
  const all = (await app().inject({ method: "GET", url: "/v1/alerts?chainId=5042002" })).json();
  assert.equal(all.alerts.length, 2);
  assert.equal(all.alerts[0].detector, "D2");
  const high = (await app().inject({ method: "GET", url: `/v1/alerts?severity=HIGH&address=${chain.registry}` })).json();
  assert.deepEqual(high.alerts.map((a: { detector: string }) => a.detector), ["D1"]);
  const page2 = (await app().inject({ method: "GET", url: `/v1/alerts?limit=1&cursor=${all.alerts[0].id}` })).json();
  assert.equal(page2.alerts[0].detector, "D1");
  const status = (await app().inject({ method: "GET", url: `/v1/status/${chain.registry}?chainId=5042002` })).json();
  assert.equal(status.alerts.length, 2);
  const sub = await app().inject({ method: "POST", url: "/v1/subscriptions",
    payload: { address: chain.registry, webhookUrl: "https://example.org/hook" } });
  assert.equal(sub.statusCode, 201);
  assert.match(sub.json().secret, /^[0-9a-f]{64}$/);
  assert.equal((await app().inject({ method: "POST", url: "/v1/subscriptions",
    payload: { address: chain.registry, webhookUrl: "http://evil.example" } })).statusCode, 400);
});

test("GET /v1/source/:address serves one verified file and maps lookup failures to statuses", async () => {
  const files: Record<string, string> = { "src/A.sol": "contract A {}" };
  const a = buildServer({
    db, bus: new ScanBus(), queue: { enqueue: async () => undefined }, clients: {}, registry: null, attester: null,
    adminToken: null, scanRatePerMin: 5,
    sources: async (_c, addr) => addr.toLowerCase().endsWith("1")
      ? { ok: false, error: { code: "NOT_VERIFIED", message: "no" } } : { ok: true, value: files },
  });
  const addr = "0x000000000000000000000000000000000000dEaD";
  const r = await a.inject({ method: "GET", url: `/v1/source/${addr}?chainId=5042&file=src/A.sol` });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().content, "contract A {}");
  assert.equal((await a.inject({ method: "GET", url: `/v1/source/${addr}?file=nope.sol` })).statusCode, 404);
  assert.equal((await a.inject({ method: "GET", url: `/v1/source/${addr}` })).statusCode, 400);
  const nv = await a.inject({ method: "GET", url: `/v1/source/0x0000000000000000000000000000000000000001?file=x` });
  assert.equal(nv.statusCode, 404);
  assert.equal(nv.json().error, "NOT_VERIFIED");
});

test("redact keeps scheme and host, drops path keys and query keys", async () => {
  const { redact } = await import("../src/redact.js");
  const s = redact('Status: 429\nURL: https://arc-mainnet.infura.io/v3/abc123def\n x "https://api.blockscout.com/5042/api/v2/smart-contracts/0x1?apikey=sekrit"');
  assert.ok(!s.includes("abc123def") && !s.includes("sekrit"));
  assert.match(s, /https:\/\/arc-mainnet\.infura\.io\/…/);
});

test("public alert feed names only disclosed addresses; admin sees everything (ADR-022)", async () => {
  const mine = "0x00000000000000000000000000000000000000aa";
  const theirs = "0x00000000000000000000000000000000000000bb";
  for (const [i, a] of [mine, theirs].entries()) {
    await db.query(`INSERT INTO alerts (chain_id, detector, severity, address, tx, block, evidence, dedupe_key, created_at)
      VALUES (5042, 'D1', 'HIGH', $1, $2, 100, $3, $4, '2026-10-02T08:37:37Z')`,
      [Buffer.from(a.slice(2), "hex"), Buffer.alloc(32, i + 1),
        JSON.stringify({ kind: "underpay", ratio: "10^-12", inflow: { raw: "10000", usdc: "0.01", iface: "erc20" } }), `t-${i}`]);
  }
  const a = buildServer({
    db, bus: new ScanBus(), queue: { enqueue: async () => undefined }, clients: {}, registry: null, attester: null,
    adminToken: "t".repeat(20), scanRatePerMin: 5, disclosed: new Set([mine]),
  });
  const pub = (await a.inject({ method: "GET", url: "/v1/alerts?chainId=5042" })).json().alerts as Record<string, unknown>[];
  const byAddr = pub.find((x) => x.address !== null)!;
  assert.equal(String(byAddr.address).toLowerCase(), mine);
  const hidden = pub.find((x) => x.address === null)!;
  assert.equal(hidden.tx, null);
  assert.equal(hidden.block, null);
  assert.deepEqual(hidden.evidence, { withheld: true, kind: "underpay", ratio: "10^-12" });
  assert.equal(hidden.createdAt, "2026-10-02T08:00:00.000Z");
  assert.ok(!JSON.stringify(pub).includes("bb"));
  const admin = (await a.inject({ method: "GET", url: "/v1/alerts?chainId=5042",
    headers: { authorization: `Bearer ${"t".repeat(20)}` } })).json().alerts as Record<string, unknown>[];
  assert.ok(admin.every((x) => x.address !== null));
});
