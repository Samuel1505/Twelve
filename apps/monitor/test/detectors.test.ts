import { test } from "node:test";
import assert from "node:assert/strict";
import { getAddress, keccak256, toHex, type Address } from "viem";
import { USDC_SCALE, parseUsdc18, twelveRegistryAbi, usdc18 } from "@twelve/shared";
import { ATTESTED_TOPIC, REVOKED_TOPIC } from "../src/decode.js";
import { d4 } from "../src/detectors/d4.js";
import { onlyContracts, processBatch, type Account, type EngineState } from "../src/engine.js";
import { applyTx, bucketOf, emptyProfile, medianOut, type Profile } from "../src/profiles.js";
import type { Movement } from "../src/types.js";
import { A, TX, erc20Transfer, sys } from "./fixtures.js";

const C = A(0xc0);
const USER = A(0xaa);

function state(over: Partial<EngineState> = {}): EngineState {
  return { chainId: 5042, profiles: new Map(), attestations: new Map(), completeHistory: true, ...over };
}

const accounts = new Map<Address, Account>([[C, { isContract: true, delegated: false }], [USER, { isContract: false, delegated: false }]]);
const contractsOnly = (alerts: Parameters<typeof onlyContracts>[0]) =>
  onlyContracts(alerts, async () => undefined, (a) => accounts.get(a));

const history = (p: Profile, n: number, amount18: bigint): Profile => {
  let q = p;
  const mv = (i: number): Movement => ({ block: 1n, tx: TX(i), txIndex: 0, idx: i, erc20Idx: null, from: C, to: USER,
    amount18: usdc18(amount18), raw6: null, iface: "native" });
  for (let i = 0; i < n; i++) q = applyTx({ ...q, balance18: usdc18(q.balance18 + amount18) }, [mv(i)], 1n);
  return q;
};

test("D1 fires on the LeakyRefund shape: ERC-20 in y, native out raw y (underpay)", async () => {
  const paid6 = 5_000_000n; // 5 USDC in the ERC-20 view
  const logs = [...erc20Transfer(1, USER, C, paid6), sys(1, C, USER, paid6)];
  const r = processBatch(state(), logs);
  const d1 = (await contractsOnly(r.alerts)).filter((a) => a.detector === "D1");
  assert.equal(d1.length, 1);
  assert.equal(d1[0]?.severity, "HIGH");
  assert.equal((d1[0]?.evidence as { kind: string }).kind, "underpay");
});

test("D1 fires on the overpay shape: native in x, ERC-20 out raw x", async () => {
  const x = 2_000_000n;
  const r = processBatch(state(), [sys(1, USER, C, x), ...erc20Transfer(1, C, USER, x)]);
  const d1 = (await contractsOnly(r.alerts)).filter((a) => a.detector === "D1");
  assert.equal(d1.length, 1);
  assert.equal((d1[0]?.evidence as { kind: string }).kind, "overpay");
});

test("D1 does not fire on a correct conversion, below the floor, or for EOAs", () => {
  const paid6 = 5_000_000n;
  const correct = processBatch(state(), [...erc20Transfer(1, USER, C, paid6), sys(1, C, USER, paid6 * USDC_SCALE)]);
  assert.equal(correct.alerts.filter((a) => a.detector === "D1").length, 0);
  const tiny = processBatch(state(), [...erc20Transfer(2, USER, C, 9_999n), sys(2, C, USER, 9_999n)]);
  assert.equal(tiny.alerts.filter((a) => a.detector === "D1").length, 0);
});

test("candidates on EOAs are dropped after (cached) code resolution; unknown addresses get resolved", async () => {
  // the D1 shape is symmetric: the EOA counterparty mirrors it and is a candidate too, until resolution drops it
  const r = processBatch(state(), [...erc20Transfer(3, C, USER, 5_000_000n), sys(3, USER, C, 5_000_000n)]);
  assert.ok(r.alerts.some((a) => a.detector === "D1" && a.address === USER));
  const kept = (await contractsOnly(r.alerts)).filter((a) => a.detector === "D1");
  assert.deepEqual(kept.map((a) => a.address), [C]);
  const resolved: Address[] = [];
  const unknown = A(0xdd);
  const r2 = processBatch(state(), [...erc20Transfer(4, USER, unknown, 5_000_000n), sys(4, unknown, USER, 5_000_000n)]);
  const kept2 = await onlyContracts(r2.alerts, async (xs) => {
    resolved.push(...xs);
    for (const x of xs) if (!accounts.has(x)) accounts.set(x, { isContract: true, delegated: false });
  }, (a) => accounts.get(a));
  assert.ok(resolved.includes(unknown));
  assert.deepEqual(kept2.filter((a) => a.detector === "D1").map((a) => a.address), [unknown]);
});

test("D2: a 10^9 collapse versus a 20+ outflow history fires; routine tiny senders are suppressed", () => {
  const p = history(emptyProfile(C, 1n), 30, parseUsdc18("10"));
  assert.ok((medianOut(p) ?? 0n) > 0n);
  const fire = processBatch(state({ profiles: new Map([[C, p]]) }), [sys(1, C, USER, 10_000_000n)]); // "10 USDC" in 6-dec
  assert.equal(fire.alerts.filter((a) => a.detector === "D2").length, 1);
  const young = history(emptyProfile(C, 1n), 5, parseUsdc18("10"));
  assert.equal(processBatch(state({ profiles: new Map([[C, young]]) }), [sys(1, C, USER, 1_000n)])
    .alerts.filter((a) => a.detector === "D2").length, 0);
  const mixed = history(history(emptyProfile(C, 1n), 25, parseUsdc18("10")), 5, 2_000n);
  assert.equal(processBatch(state({ profiles: new Map([[C, mixed]]) }), [sys(1, C, USER, 1_000n)])
    .alerts.filter((a) => a.detector === "D2").length, 0);
});

test("D2 ignores sub-10^4-raw rounding dust (mainnet replay FP class: v4 PoolManager settlement)", () => {
  const p = history(emptyProfile(C, 1n), 106, parseUsdc18("0.3"));
  for (const raw of [40n, 99n, 9_900n]) {
    assert.equal(processBatch(state({ profiles: new Map([[C, p]]) }), [sys(1, C, USER, raw)])
      .alerts.filter((a) => a.detector === "D2").length, 0, `raw ${raw}`);
  }
  // a 10^12 underpay of a 0.3 USDC payment (300000 raw) still fires
  assert.equal(processBatch(state({ profiles: new Map([[C, p]]) }), [sys(1, C, USER, 300_000n)])
    .alerts.filter((a) => a.detector === "D2").length, 1);
});

test("D2 requires the 10^12 signature (ADR-021): mainnet replay cases", () => {
  // TP shape: a fixed "5 USDC" fee written in 6-dec units sent natively; typical payouts ~3 USDC
  const fee = history(emptyProfile(C, 1n), 50, parseUsdc18("3"));
  assert.equal(processBatch(state({ profiles: new Map([[C, fee]]) }), [sys(1, C, USER, 5_000_000n)])
    .alerts.filter((a) => a.detector === "D2").length, 1);
  // FP shape: aggregator rounding dust (806,059,183 raw ≈ "806 USDC" if 6-dec) vs ~30 USDC typical payouts
  const agg = history(emptyProfile(C, 1n), 200, parseUsdc18("30"));
  for (const raw of [806_059_183n, 2_302_501_163n, 9_352_036_152n]) {
    assert.equal(processBatch(state({ profiles: new Map([[C, agg]]) }), [sys(1, C, USER, raw)])
      .alerts.filter((a) => a.detector === "D2").length, 0, `raw ${raw}`);
  }
});

test("D3: sweeping >= 90% of a 100+ USDC balance that never moved >= 10% fires", () => {
  let p = history(emptyProfile(C, 1n), 25, parseUsdc18("1"));
  p = { ...p, balance18: parseUsdc18("1000"), maxOutFrac: 0.05 };
  const r = processBatch(state({ profiles: new Map([[C, p]]) }), [sys(1, C, USER, parseUsdc18("950"))]);
  const d3 = r.alerts.filter((a) => a.detector === "D3");
  assert.equal(d3.length, 1);
  assert.equal((d3[0]?.evidence as { d1_also_fired: boolean }).d1_also_fired, false);
  const sweeper = { ...p, maxOutFrac: 0.5 };
  assert.equal(processBatch(state({ profiles: new Map([[C, sweeper]]) }), [sys(1, C, USER, parseUsdc18("950"))])
    .alerts.filter((a) => a.detector === "D3").length, 0);
});

test("D5: inflow to a FINDINGS-attested contract, once per day bucket", () => {
  const st = state({ attestations: new Map([[C, { verdict: 2, revoked: false, implementation: null }]]) });
  const r = processBatch(st, [sys(1, USER, C, 5n), sys(2, USER, C, 6n)]);
  const d5 = r.alerts.filter((a) => a.detector === "D5");
  assert.equal(d5.length, 2);
  assert.equal(d5[0]?.dedupeKey, d5[1]?.dedupeKey); // same day ⇒ one stored alert
});

test("D4: only live attested proxies trigger a revoke", () => {
  const u = { chainId: 5042002, block: 1n, tx: TX(1), logIndex: 0, proxy: C, newImplementation: A(0xbb), kind: "Upgraded" as const };
  assert.equal(d4(u, undefined), null);
  assert.equal(d4(u, { verdict: 1, revoked: false, implementation: null }), null);
  assert.equal(d4(u, { verdict: 1, revoked: true, implementation: A(0xba) }), null);
  assert.equal(d4(u, { verdict: 1, revoked: false, implementation: A(0xba) })?.revoke, true);
});

test("partial history: no BALANCE signal and no D3 (balances unknown)", () => {
  const r = processBatch(state({ completeHistory: false }), [sys(1, C, USER, 5n)]);
  assert.equal(r.alerts.filter((a) => a.detector === "BALANCE").length, 0);
  let p = history(emptyProfile(C, 1n, false), 25, parseUsdc18("1"));
  p = { ...p, balance18: parseUsdc18("1000"), maxOutFrac: 0.05 };
  assert.equal(processBatch(state({ profiles: new Map([[C, p]]) }), [sys(2, C, USER, parseUsdc18("950"))])
    .alerts.filter((a) => a.detector === "D3").length, 0);
});

test("profiles: buckets, balance and underflow signal", () => {
  assert.equal(bucketOf(0n), 0);
  assert.equal(bucketOf(999n), 2);
  assert.equal(bucketOf(parseUsdc18("1")), 18);
  const r = processBatch(state(), [sys(1, C, USER, 5n)]); // outflow with no known inflow history
  assert.ok(r.alerts.some((a) => a.detector === "BALANCE" && a.address === C));
});

test("registry topics match the ABI", () => {
  const sig = (name: string) => {
    const ev = twelveRegistryAbi.find((x) => x.type === "event" && x.name === name) as { inputs: { type: string }[] };
    return keccak256(toHex(`${name}(${ev.inputs.map((i) => i.type).join(",")})`));
  };
  assert.equal(ATTESTED_TOPIC, sig("Attested"));
  assert.equal(REVOKED_TOPIC, sig("Revoked"));
  assert.equal(getAddress(C) as Address, C);
});
