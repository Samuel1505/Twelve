import { test } from "node:test";
import assert from "node:assert/strict";
import { USDC_SCALE } from "@twelve/shared";
import { pairTx } from "../src/pair.js";
import { A, ZERO, erc, erc20Transfer, sys } from "./fixtures.js";

test("ERC-20 transfer pairs into one erc20 movement", () => {
  const r = pairTx(erc20Transfer(1, A(1), A(2), 5_000n));
  assert.equal(r.movements.length, 1);
  assert.equal(r.movements[0]?.iface, "erc20");
  assert.equal(r.movements[0]?.raw6, 5_000n);
  assert.equal(r.unpaired.length, 0);
});

test("native send has only a system log", () => {
  const r = pairTx([sys(1, A(1), A(2), 7n)]);
  assert.equal(r.movements[0]?.iface, "native");
  assert.equal(r.movements[0]?.raw6, null);
});

test("two identical transfers in one tx pair one-to-one, never double count (I10)", () => {
  const logs = [...erc20Transfer(1, A(1), A(2), 9n), ...erc20Transfer(1, A(1), A(2), 9n)];
  const r = pairTx(logs);
  assert.deepEqual(r.movements.map((m) => m.iface), ["erc20", "erc20"]);
  assert.notEqual(r.movements[0]?.erc20Idx, r.movements[1]?.erc20Idx);
});

test("pairing does not assume adjacency or log order between the twins", () => {
  const s = sys(1, A(1), A(2), 3n * USDC_SCALE, 10);
  const other = sys(1, A(5), A(6), 1n, 11);
  const e = erc(1, A(1), A(2), 3n, 12);
  const r = pairTx([e, other, s]);
  assert.deepEqual(r.movements.map((m) => m.iface), ["erc20", "native"]);
});

test("transferFrom by a third party: from is the owner, not the caller", () => {
  const owner = A(10);
  const r = pairTx(erc20Transfer(1, owner, A(11), 42n));
  assert.equal(r.movements[0]?.from, owner);
});

test("zero-value transfers still pair", () => {
  const r = pairTx(erc20Transfer(1, A(1), A(2), 0n));
  assert.equal(r.movements[0]?.iface, "erc20");
});

test("mint and burn (zero address) when unpaired", () => {
  const r = pairTx([sys(1, ZERO, A(1), 5n), sys(1, A(1), ZERO, 2n)]);
  assert.deepEqual(r.movements.map((m) => m.iface), ["mint", "burn"]);
});

test("an ERC-20 log with no system twin is surfaced, not dropped", () => {
  const r = pairTx([erc(1, A(1), A(2), 4n), sys(1, A(1), A(2), 4n)]); // values do not satisfy v18 == v6·10^12
  assert.equal(r.unpaired.length, 1);
  assert.equal(r.movements[0]?.iface, "native");
});
