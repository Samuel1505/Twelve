// The analyzer is a pure CLI behind a JSON boundary (ADR-002); TS never imports Python.
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { z } from "zod";
import { AnalyzerOutput, type ReportCore } from "@twelve/shared";
import type { Hex } from "viem";
import { err, ok, type Result } from "./result.js";

export const ToolInfo = z.object({
  name: z.literal("twelve"), version: z.string(), gitCommit: z.string(), slither: z.string(),
  rulesHash: z.string(), schemaVersion: z.number().int(),
});
export type ToolInfo = z.infer<typeof ToolInfo>;

/** Dedupe key and on-chain toolVersion source: same tool ⇒ same report for the same code (I4). */
export const toolVersionString = (t: ToolInfo): string => `twelve/${t.version}+${t.gitCommit.slice(0, 7)}`;

export type AnalyzerError = { code: string; message: string };
export type AnalyzerSuccess = { reportHash: Hex; core: ReportCore; meta: Record<string, unknown> };

export interface Analyzer {
  tool(): Promise<ToolInfo>;
  scan(chain: "arc" | "arc-testnet", address: Hex, onStage: (stage: string) => void): Promise<Result<AnalyzerSuccess, AnalyzerError>>;
}

function run(cmd: string, args: string[], cwd: string, onStderrLine: (l: string) => void, timeoutMs: number):
  Promise<{ code: number | null; stdout: string; stderrTail: string; timedOut: boolean }> {
  const [bin, ...pre] = cmd.split(" ").filter(Boolean);
  if (!bin) throw new Error("ANALYZER_CMD is empty");
  return new Promise((done) => {
    const child = spawn(bin, [...pre, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderrBuf = "";
    let tail: string[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => {
      stderrBuf += d.toString();
      let i;
      while ((i = stderrBuf.indexOf("\n")) >= 0) {
        const line = stderrBuf.slice(0, i);
        stderrBuf = stderrBuf.slice(i + 1);
        onStderrLine(line);
        tail = [...tail.slice(-19), line];
      }
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code, stdout, stderrTail: tail.join("\n"), timedOut });
    });
  });
}

export function cliAnalyzer(cmd: string, cwd: string, timeoutMs = 3 * 60_000): Analyzer {
  const root = resolve(cwd);
  let cached: ToolInfo | null = null;
  return {
    async tool() {
      if (cached) return cached;
      const r = await run(cmd, ["tool"], root, () => {}, 120_000);
      cached = ToolInfo.parse(JSON.parse(r.stdout));
      return cached;
    },
    async scan(chain, address, onStage) {
      const r = await run(cmd, ["scan", "--address", address, "--chain", chain, "--json", "--progress"], root,
        (line) => {
          try {
            const m = z.object({ stage: z.string() }).safeParse(JSON.parse(line));
            if (m.success) onStage(m.data.stage);
          } catch {
            /* not a progress line (compiler warnings etc.) */
          }
        }, timeoutMs);
      // one worker serves every visitor: a runaway analysis must not hold the queue (never attested, never partial)
      if (r.timedOut) return err({ code: "TIMEOUT", message: `analysis exceeded ${Math.round(timeoutMs / 1000)} s` });
      let parsed: z.infer<typeof AnalyzerOutput>;
      try {
        parsed = AnalyzerOutput.parse(JSON.parse(r.stdout));
      } catch (e) {
        return err({ code: "ANALYZER_ERROR", message: `exit ${r.code}: ${r.stderrTail.slice(-800) || String(e)}` });
      }
      if ("error" in parsed) return err({ code: parsed.error.code, message: parsed.error.message });
      return ok({ reportHash: parsed.reportHash as Hex, core: parsed.reportCore, meta: parsed.meta });
    },
  };
}
