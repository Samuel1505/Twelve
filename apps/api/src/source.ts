// Verified source for the web's finding excerpts (Phase 5). Same Blockscout Pro endpoint the analyzer rebuilds from
// (analyzer/twelve/fetch/blockscout.py), so file paths equal report `location.file`. The API key stays server-side.
import type { Address } from "viem";
import { err, ok, type Result } from "./result.js";

export type SourceError = { code: "NOT_VERIFIED" | "FETCH_FAILED" | "CONFIG"; message: string };
export type SourceFetcher = (chainId: number, address: Address) => Promise<Result<Record<string, string>, SourceError>>;

type Sc = { is_verified?: boolean; source_code?: string; file_path?: string; name?: string;
  additional_sources?: { file_path: string; source_code: string }[] };

/** Blockscout fetch with a small in-memory cache. Verified source for an address only changes with its code, and a
 * report's excerpt is about the code that matched, so callers pass a codehash-scoped key when they have one. */
export function blockscoutSources(apiKey: string | undefined, fetchImpl: typeof fetch = fetch, max = 200): SourceFetcher {
  const cache = new Map<string, Record<string, string>>();
  return async (chainId, address) => {
    if (!apiKey) return err({ code: "CONFIG", message: "BLOCKSCOUT_API_KEY not configured" });
    const k = `${chainId}:${address.toLowerCase()}`;
    const hit = cache.get(k);
    if (hit) return ok(hit);
    let res: Response;
    try {
      res = await fetchImpl(`https://api.blockscout.com/${chainId}/api/v2/smart-contracts/${address}?apikey=${apiKey}`,
        { signal: AbortSignal.timeout(15_000) });
    } catch (e) {
      // never echo the URL: it carries the key (I11)
      return err({ code: "FETCH_FAILED", message: e instanceof Error ? e.name : "network error" });
    }
    if (res.status === 404) return err({ code: "NOT_VERIFIED", message: "no verified source" });
    if (!res.ok) return err({ code: "FETCH_FAILED", message: `blockscout ${res.status}` });
    const sc = (await res.json().catch(() => null)) as Sc | null;
    if (!sc?.is_verified || !sc.source_code) return err({ code: "NOT_VERIFIED", message: "no verified source" });
    const files: Record<string, string> = { [sc.file_path || `${sc.name ?? "Contract"}.sol`]: sc.source_code };
    for (const x of sc.additional_sources ?? []) files[x.file_path] = x.source_code;
    if (cache.size >= max) cache.delete(cache.keys().next().value!);
    cache.set(k, files);
    return ok(files);
  };
}
