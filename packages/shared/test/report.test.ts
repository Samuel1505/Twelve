// Cross-language golden test (ADR-006): TS recomputes the Python analyzer's reportHash byte for byte.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AnalyzerOutput, reportHash } from "../src/report.ts";

for (const name of ["report_source_c03.json", "report_deployed_c10.json"]) {
  test(`reportHash matches Python for ${name}`, () => {
    const raw = JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
    const parsed = AnalyzerOutput.parse(raw);
    assert.ok("reportCore" in parsed);
    assert.equal(reportHash(raw.reportCore), raw.reportHash);
    // key order must not matter
    const shuffled = JSON.parse(JSON.stringify(raw.reportCore, Object.keys(raw.reportCore).sort().reverse()));
    assert.equal(reportHash({ ...shuffled, ...raw.reportCore }), raw.reportHash);
  });
}

test("structured analyzer errors parse", () => {
  const e = AnalyzerOutput.parse({ error: { code: "NOT_VERIFIED", type: "NotVerified", message: "0x1" } });
  assert.ok("error" in e);
});
