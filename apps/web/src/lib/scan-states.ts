// Scan pipeline as people read it (docs/ARCHITECTURE.md §3). Every terminal state has one human sentence.

export const STAGES = [
  { id: "RESOLVING", label: "Reading code" },
  { id: "FETCHING", label: "Fetching source" },
  { id: "REBUILDING", label: "Rebuilding" },
  { id: "COMPILING", label: "Compiling" },
  { id: "MATCHING", label: "Matching bytecode" },
  { id: "BINDING", label: "Finding USDC" },
  { id: "ANALYZING", label: "Tracing units" },
  { id: "HASHING", label: "Hashing report" },
  { id: "ATTESTING", label: "Attesting on Arc" },
] as const;

export const stageIndex = (state: string) => STAGES.findIndex((s) => s.id === state);

export type Outcome = { title: string; body: string; tone: "neutral" | "warn" | "bad"; monitorOnly?: boolean; retry?: boolean };

/** Terminal failures. `code` is the scan state, or the error code where it is more specific (CODE_CHANGED). */
export function outcomeFor(state: string, code?: string, message?: string): Outcome | null {
  if (state === "FETCH_FAILED" && code === "RPC") {
    return { title: "Arc's RPC isn't answering right now", body: "Twelve couldn't read this contract from the chain because the RPC provider is limiting requests. Nothing about the contract is implied by this. Try again in a few minutes.", tone: "warn", retry: true };
  }
  if (code === "CODE_CHANGED") {
    return { title: "The code changed mid-scan", body: "This contract's code changed while it was being analyzed. Scan again to check the code that's there now.", tone: "warn", retry: true };
  }
  switch (state) {
    case "NOT_A_CONTRACT":
      return { title: "No contract here", body: "There's no code at this address on Arc mainnet. It's a wallet, or nothing has been deployed here yet, so there's nothing to analyze.", tone: "neutral" };
    case "NOT_VERIFIED":
      return { title: "Source isn't verified", body: "Twelve analyzes verified source, and this contract hasn't published its source on the Arc explorer. The live monitor still watches every USDC movement in and out of it.", tone: "neutral", monitorOnly: true };
    case "MATCH_FAILED":
      return { title: "Source doesn't match the deployed code", body: "The verified source compiles to different bytecode than what's deployed here. Twelve only reports on code it can prove is live, so no report was made. The live monitor still covers it.", tone: "warn", monitorOnly: true };
    case "COMPILE_FAILED":
      return { title: "Couldn't recompile the source", body: "The verified source didn't compile with the compiler and settings recorded on the explorer, so it can't be matched to the chain. No report was made.", tone: "warn", monitorOnly: true };
    case "UNSUPPORTED":
      return { title: "Not something the analyzer can cover yet", body: `${message ? `${sentence(message)} ` : ""}Rather than guess, Twelve reports nothing for this contract. The live monitor still watches every USDC movement in and out of it.`, tone: "neutral", monitorOnly: true };
    case "FETCH_FAILED":
      return { title: "The explorer didn't answer", body: "Twelve couldn't fetch the verified source in time. That's usually temporary; try again in a minute.", tone: "warn", retry: true };
    case "ANALYZER_ERROR":
      return { title: "The analyzer stopped", body: "The analysis hit an error, and Twelve never publishes a partial report. Try again; if it happens twice, it's a bug on our side.", tone: "bad", retry: true };
    case "CONFIG":
    case "CHAIN_MISMATCH":
      return { title: "This server can't scan mainnet right now", body: "Twelve's scanner isn't connected to Arc mainnet at the moment. Nothing about this contract is implied by that.", tone: "warn" };
    case "WITHHELD":
      return { title: "Results for this contract aren't public right now", body: "Twelve has scanned this contract, but its results are being shared privately for the moment. They'll appear here later. The verified source is on the explorer if you'd like to review it yourself.", tone: "neutral" };
    case "ATTEST_FAILED":
      return { title: "Report ready, attestation pending", body: "The analysis finished, but writing the result on-chain failed. The report below is final; the attestation can be retried.", tone: "warn", retry: true };
    default:
      return null;
  }
}

const sentence = (s: string) => {
  const t = s.trim().replace(/\s+/g, " ").slice(0, 200);
  return /[.!?]$/.test(t) ? t.charAt(0).toUpperCase() + t.slice(1) : `${t.charAt(0).toUpperCase()}${t.slice(1)}.`;
};

export function apiErrorSentence(e: { kind: string; status?: number; message?: string }): string {
  if (e.kind === "unreachable") return "Twelve's API isn't reachable right now, so this contract can't be checked. That says nothing about the contract itself.";
  if (e.kind === "http" && e.status === 429) return "That's a lot of scans in a short time. Wait a minute and try again.";
  if (e.kind === "invalid") return "The API answered with something this page doesn't understand. Reload to get the current version.";
  return "Twelve's API couldn't handle that request. Try again in a moment.";
}
