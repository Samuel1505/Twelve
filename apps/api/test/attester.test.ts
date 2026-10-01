import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { keccak256, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { parseUsdc18, twelveRegistryAbi } from "@twelve/shared";
import { makeAttester, type AttestRequest } from "../src/attester.js";
import { ANVIL_KEYS, initCodeFor, startAnvil, type Chain } from "./helpers.js";

let chain: Chain;
let target: Address;
const attesterAddr = privateKeyToAccount(ANVIL_KEYS.attester).address;

before(async () => {
  chain = await startAnvil();
  target = await chain.deploy(initCodeFor(1));
});
after(() => chain.stop());

const req = async (over: Partial<AttestRequest> = {}): Promise<AttestRequest> => ({
  target,
  codehash: keccak256((await chain.pub.getCode({ address: target }))!),
  reportHash: keccak256("0x01"),
  verdict: 1, high: 0, medium: 0, implementation: null, implCodehash: null, schemaVersion: 1,
  toolVersion: "twelve/0.1.0+abcdef1",
  ...over,
});

const attesterWith = (min = "0.05") => makeAttester({
  privateKey: ANVIL_KEYS.attester, registry: chain.registry, minBalance: parseUsdc18(min),
  clients: { 5042002: { pub: chain.pub, rpcUrl: chain.url } }, log: () => {},
});

test("attest writes a record the registry reports as CLEAN", async () => {
  const a = attesterWith();
  const r = await a.attest(5042002, await req());
  assert.ok(r.ok, JSON.stringify(!r.ok && r.error));
  const status = await chain.pub.readContract({ address: chain.registry, abi: twelveRegistryAbi, functionName: "status", args: [attesterAddr, target] });
  assert.equal(status, 1);
});

test("concurrent attests are serialized with correct nonces", async () => {
  const a = attesterWith();
  const rs = await Promise.all([1, 2, 3].map(async (i) => a.attest(5042002, await req({ reportHash: keccak256(`0x0${i}`), verdict: 2, high: i }))));
  assert.ok(rs.every((r) => r.ok), "every concurrent attest landed: no nonce collisions");
  const txs = rs.map((r) => (r.ok ? r.value.tx : ""));
  assert.equal(new Set(txs).size, 3);
  const rec = await chain.pub.readContract({ address: chain.registry, abi: twelveRegistryAbi, functionName: "get", args: [attesterAddr, target] });
  assert.ok([1, 2, 3].includes(rec.high));
});

test("refuses when code changed since the scan", async () => {
  const a = attesterWith();
  const stale = await req();
  await chain.setCode(target, "0x60aa5f5500");
  const r = await a.attest(5042002, stale);
  assert.ok(!r.ok && r.error.code === "CODE_CHANGED" && r.error.retryable);
});

test("balance watchdog refuses below the floor", async () => {
  const a = attesterWith("999999999"); // far above any anvil balance
  const r = await a.attest(5042002, await req());
  assert.ok(!r.ok && r.error.code === "LOW_BALANCE");
});

test("revoke, then revoking again is a non-retryable revert", async () => {
  const a = attesterWith();
  assert.ok((await a.attest(5042002, await req())).ok);
  assert.ok((await a.revoke(5042002, target, "UPGRADED")).ok);
  const status = await chain.pub.readContract({ address: chain.registry, abi: twelveRegistryAbi, functionName: "status", args: [attesterAddr, target] });
  assert.equal(status, 5);
  const again = await a.revoke(5042002, target, "UPGRADED");
  assert.ok(!again.ok && again.error.code === "REVERTED" && !again.error.retryable);
});

test("unconfigured chain is a typed error", async () => {
  const r = await attesterWith().attest(5042, await req());
  assert.ok(!r.ok && r.error.code === "NOT_CONFIGURED");
});
