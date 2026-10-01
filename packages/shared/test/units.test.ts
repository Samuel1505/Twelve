import { test } from "node:test";
import assert from "node:assert/strict";
import {
  USDC_SCALE, formatUsdc18, formatUsdc6, isSameAmount, parseUsdc18, parseUsdc6, toUsdc18, toUsdc6, usdc18, usdc6,
} from "../src/units.ts";

test("scale is exactly 10^12", () => assert.equal(USDC_SCALE, BigInt("1" + "0".repeat(12))));

test("6 -> 18 is exact; 18 -> 6 floors and returns dust (I3)", () => {
  assert.equal(toUsdc18(usdc6(5n)), USDC_SCALE * 5n);
  const { amount, dust } = toUsdc6(usdc18(USDC_SCALE * 7n + 123n));
  assert.equal(amount, 7n);
  assert.equal(dust, 123n);
  assert.equal(toUsdc6(usdc18(999n)).amount, 0n);
});

test("pairing equality", () => {
  assert.ok(isSameAmount(usdc18(29463n * USDC_SCALE), usdc6(29463n)));
  assert.ok(!isSameAmount(usdc18(29463n), usdc6(29463n)));
});

test("decimal parsing and formatting", () => {
  assert.equal(parseUsdc18("0.05"), 5n * USDC_SCALE * 10_000n);
  assert.equal(parseUsdc6("1.5"), 1_500_000n);
  assert.equal(formatUsdc18(parseUsdc18("12.000000000000000001")), "12.000000000000000001");
  assert.equal(formatUsdc6(usdc6(1_500_000n)), "1.5");
  assert.throws(() => parseUsdc6("0.0000001"), RangeError);
  assert.throws(() => parseUsdc18("-1"), SyntaxError);
  assert.throws(() => usdc6(-1n), RangeError);
});
