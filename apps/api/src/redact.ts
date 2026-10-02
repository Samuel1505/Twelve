/** Provider URLs carry API keys in the path (Infura, QuickNode) or query (Blockscout `apikey`). Anything that leaves
 * the process — DB rows served by the API, SSE, logs — goes through this first (I11). Keeps only scheme + host. */
export const redact = (s: string): string => s.replace(/\b(https?|wss?):\/\/([^/\s"'?#]+)[^\s"']*/g, "$1://$2/…");

/** Deep-redacts every string in a JSON-shaped value. */
export function redactDeep<T>(v: T): T {
  return JSON.parse(redact(JSON.stringify(v ?? null))) as T;
}
