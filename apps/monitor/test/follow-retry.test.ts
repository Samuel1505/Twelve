import { test } from "node:test";
import assert from "node:assert/strict";
import { ContinuityError, isFatal, retryDelayMs } from "../src/follow.js";

test("only continuity violations stop ingestion (I9); provider errors are retried", () => {
  assert.equal(isFatal(new ContinuityError("parentHash mismatch")), true);
  assert.equal(isFatal(new Error("HTTP request failed. Status: 429 Too Many Requests")), false);
  assert.equal(isFatal(new Error("fetch failed")), false);
});

test("retry backoff doubles from 1 s and caps at 60 s", () => {
  assert.deepEqual([1, 2, 3, 4, 7, 20].map(retryDelayMs), [1000, 2000, 4000, 8000, 60_000, 60_000]);
});
