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
