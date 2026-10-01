// Live path against real Postgres (fresh DB) and a fake Arc RPC serving raw logs: anvil has no EIP-7708 system
// logs, so the chain side is a fixture here; the real-chain checks are the testnet exit runs (MONITOR §9).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { getAddress, pad, toHex, type Address, type Hex, type PublicClient } from "viem";
import { SYSTEM_EMITTER, TRANSFER_TOPIC, UPGRADED_TOPIC, USDC_ERC20, USDC_SCALE, parseUsdc18 } from "@twelve/shared";
import { connect, migrate, type Db } from "@twelve/db";
import { Accounts } from "../src/accounts.js";
import { ATTESTED_TOPIC, type RpcLog } from "../src/decode.js";
import { deliverDue, sign } from "../src/deliver/webhook.js";
import { ContinuityError, step, type FollowDeps } from "../src/follow.js";
import type { Checkpoint } from "../src/store.js";

const ADMIN = process.env.TEST_PG_ADMIN_URL ?? "postgres://twelve:twelve@localhost:5432/postgres";
const NAME = `twelve_test_mon_${process.pid}`;
let db: Db;

before(async () => {
  const a = new pg.Client({ connectionString: ADMIN });
  await a.connect();
  await a.query(`DROP DATABASE IF EXISTS ${NAME}`);
  await a.query(`CREATE DATABASE ${NAME}`);
  await a.end();
  db = connect(ADMIN.replace(/\/[^/]*$/, `/${NAME}`));
  await migrate(db);
});
after(async () => {
  await db.end();
  const a = new pg.Client({ connectionString: ADMIN });
  await a.connect();
  await a.query(`DROP DATABASE IF EXISTS ${NAME}`);
  await a.end();
});

const addr = (n: number): Address => getAddress(`0x${n.toString(16).padStart(40, "0")}`);
const h32 = (n: number | bigint): Hex => pad(toHex(n), { size: 32 });
const C = addr(0xc0), USER = addr(0xaa), REG = addr(0x1e), ATT = addr(0xa7), PROXY = addr(0x70), IMPL = addr(0x71), IMPL2 = addr(0x72);

function rlog(block: bigint, tx: number, logIndex: number, address: string, topics: Hex[], data: Hex): RpcLog {
  return { address: address as Hex, topics, data, blockNumber: toHex(block), blockHash: h32(block + 1000n),
    transactionHash: h32(tx), transactionIndex: toHex(0), logIndex: toHex(logIndex) };
}
const transfer = (block: bigint, tx: number, li: number, emitter: string, from: Address, to: Address, v: bigint) =>
  rlog(block, tx, li, emitter, [TRANSFER_TOPIC, pad(from), pad(to)], h32(v));

/** Fake chain: block n has hash h32(n+1000), parent h32(n+999). */
function fakeClient(logs: RpcLog[], head: bigint, code: Record<string, string | undefined> = {}, brokenParentAt?: bigint): PublicClient {
  return {
    getBlockNumber: async () => head,
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ hash: h32(blockNumber + 1000n),
      parentHash: blockNumber === brokenParentAt ? h32(1) : h32(blockNumber + 999n) }),
    getCode: async ({ address }: { address: string }) => code[address],
    request: async ({ params }: { params: [{ fromBlock: Hex; toBlock: Hex; address: string[] }] }) => {
      const [f] = params;
      const allowed = new Set(f.address.map((a) => a.toLowerCase()));
      return logs.filter((l) => BigInt(l.blockNumber) >= BigInt(f.fromBlock) && BigInt(l.blockNumber) <= BigInt(f.toBlock)
        && allowed.has(l.address.toLowerCase()));
    },
  } as unknown as PublicClient;
}

function deps(client: PublicClient, revoked: Address[] = []): FollowDeps {
  return {
    db, client, chainId: 5042002, registry: REG, attester: ATT, window: 100n, log: () => {},
    state: { chainId: 5042002, profiles: new Map(), attestations: new Map(), completeHistory: true },
    accounts: new Accounts(5042002, client, db),
    revoke: async (_c, p) => {
      revoked.push(p);
      return { ok: true, tx: "0xabc" };
    },
  };
}

const startCp: Checkpoint = { block: 9n, hash: h32(1009n) };

test("D1 LeakyRefund tx is detected and persisted; re-running the window is idempotent", async () => {
  const y = 5_000_000n;
  const logs = [
    transfer(10n, 1, 0, SYSTEM_EMITTER, USER, C, y * USDC_SCALE),
    transfer(10n, 1, 1, USDC_ERC20, USER, C, y),
    transfer(10n, 1, 2, SYSTEM_EMITTER, C, USER, y),
  ];
  const client = fakeClient(logs, 12n, { [C]: "0x6080" }); // USER has no code
  const r = await step(deps(client), startCp);
  assert.equal(r.cp.block, 12n);
  const al = await db.query("SELECT detector, severity, '0x' || encode(address,'hex') AS a FROM alerts WHERE detector = 'D1'");
  assert.deepEqual(al.rows, [{ detector: "D1", severity: "HIGH", a: C.toLowerCase() }]);
  const again = await step(deps(client), startCp); // same window again
  assert.equal(again.alerts, 0);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM movements")).rows[0].n, 2);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM logs_raw")).rows[0].n, 3);
});

test("D4: an Upgraded event from an attested proxy triggers one revoke", async () => {
  const attested = rlog(20n, 5, 0, REG,
    [ATTESTED_TOPIC, pad(ATT), pad(PROXY), h32(77)],
    `0x${[h32(88), h32(1), h32(0), h32(0), pad(IMPL)].map((x) => x.slice(2)).join("")}` as Hex);
  const upgraded = rlog(21n, 6, 0, PROXY, [UPGRADED_TOPIC, pad(IMPL2)], "0x");
  const client = fakeClient([attested, upgraded], 30n);
  const revoked: Address[] = [];
  const d = deps(client, revoked);
  let cp: Checkpoint = { block: 19n, hash: h32(1019n) };
  cp = (await step({ ...d, window: 1n }, cp)).cp; // block 20: attestation lands, proxy enters the watch set
  assert.equal(d.state.attestations.get(PROXY)?.implementation, IMPL);
  cp = (await step({ ...d, window: 1n }, cp)).cp; // block 21: upgrade
  assert.deepEqual(revoked, [PROXY]);
  assert.equal(d.state.attestations.get(PROXY)?.revoked, true);
  const a = await db.query("SELECT detector FROM alerts WHERE detector = 'D4'");
  assert.equal(a.rowCount, 1);
  const row = await db.query("SELECT '0x' || encode(implementation,'hex') AS i FROM attestations WHERE chain_id = 5042002");
  assert.equal(row.rows[0].i, IMPL.toLowerCase());
});

test("continuity: a parentHash mismatch halts with an OPS alert (I9)", async () => {
  const client = fakeClient([], 50n, {}, 41n);
  await assert.rejects(step(deps(client), { block: 40n, hash: h32(1040n) }), ContinuityError);
  const a = await db.query("SELECT severity FROM alerts WHERE detector = 'CONTINUITY'");
  assert.equal(a.rows[0].severity, "OPS");
});

test("webhooks: signed, retried with backoff, then dead-lettered", async () => {
  await db.query("INSERT INTO subscriptions (address, webhook_url, secret) VALUES ($1, 'http://hook', 's3cret')",
    [Buffer.from(C.slice(2).toLowerCase(), "hex")]);
  const id = (await db.query("SELECT id FROM alerts WHERE detector = 'D1'")).rows[0].id;
  await db.query("INSERT INTO deliveries (alert_id, subscription_id) SELECT $1, id FROM subscriptions", [id]);
  const seen: { body: string; sig: string }[] = [];
  await deliverDue(db, async (_u, body, sig) => {
    seen.push({ body, sig });
    return 200;
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.sig, sign("s3cret", seen[0]!.body));
  assert.equal((await db.query("SELECT status FROM deliveries")).rows[0].status, "delivered");
  await db.query("UPDATE deliveries SET status = 'pending', attempts = 0, next_at = now()");
  for (let i = 0; i < 5; i++) {
    await deliverDue(db, async () => 500);
    await db.query("UPDATE deliveries SET next_at = now()");
  }
  const d = (await db.query("SELECT status, attempts FROM deliveries")).rows[0];
  assert.deepEqual(d, { status: "dead", attempts: 5 });
});

test("D3/BALANCE stay off for profiles without complete history", async () => {
  const client = fakeClient([transfer(60n, 9, 0, SYSTEM_EMITTER, C, USER, parseUsdc18("1"))], 60n, { [C]: "0x6080" });
  const d = deps(client);
  d.state.completeHistory = false;
  await step(d, { block: 59n, hash: h32(1059n) });
  const a = await db.query("SELECT count(*)::int AS n FROM alerts WHERE detector = 'BALANCE' AND block = 60");
  assert.equal(a.rows[0].n, 0);
});
