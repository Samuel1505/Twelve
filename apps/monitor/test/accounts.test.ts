import { test } from "node:test";
import assert from "node:assert/strict";
import type { PublicClient } from "viem";
import { Accounts } from "../src/accounts.js";
import { A } from "./fixtures.js";

const fake = (codes: Record<string, string | undefined | Error>): PublicClient => ({
  getCode: async ({ address }: { address: string }) => {
    const c = codes[address];
    if (c instanceof Error) throw c;
    return c; // viem returns undefined for empty code
  },
}) as unknown as PublicClient;

test("EOA (getCode → undefined), contract, and 7702-delegated EOA", async () => {
  const eoa = A(1), contract = A(2), delegated = A(3);
  const acc = new Accounts(1, fake({ [eoa]: undefined, [contract]: "0x6080", [delegated]: `0xef0100${"ab".repeat(20)}` }), null);
  await acc.resolve([eoa, contract, delegated]);
  assert.deepEqual(acc.map.get(eoa), { isContract: false, delegated: false });
  assert.deepEqual(acc.map.get(contract), { isContract: true, delegated: false });
  assert.deepEqual(acc.map.get(delegated), { isContract: true, delegated: true });
});

test("persistent RPC failure is an error, never a guess", async () => {
  const acc = new Accounts(1, fake({ [A(4)]: new Error("boom") }), null);
  await assert.rejects(acc.resolve([A(4)]), /could not resolve code/);
  assert.equal(acc.map.has(A(4)), false);
});

test("rate-limit detection never matches digits inside block numbers", async () => {
  const { RATE_LIMITED } = await import("../src/ingest/fetch.js");
  assert.equal(RATE_LIMITED.test("query exceeds max results 20000, retry with the range 21063240-21063429"), false);
  assert.equal(RATE_LIMITED.test("HTTP request failed. | Too Many Requests"), true);
  assert.equal(RATE_LIMITED.test("Status: 429"), true);
});
