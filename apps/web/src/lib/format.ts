// Deterministic formatting (identical on server and client, so hydration never disagrees).

/** `2026-10-02 08:38 UTC` */
export function utc(input: string | number | Date): string {
  const d = typeof input === "number" ? new Date(input * 1000) : new Date(input);
  if (Number.isNaN(d.getTime())) return "unknown";
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export const shortHash = (h: string, head = 6, tail = 4) => `${h.slice(0, head)}…${h.slice(-tail)}`;

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Analyzer unit tuple (dim, exp) → the view it belongs to, if any. */
export function viewOf(u: unknown): 6 | 18 | null {
  if (!Array.isArray(u) || u[0] !== 1) return null;
  return u[1] === 6 ? 6 : u[1] === 18 ? 18 : null;
}

export const unitLabel = (u: unknown): string =>
  Array.isArray(u) ? (u[0] === 0 ? (u[1] === 0 ? "number" : `scale 10^${u[1]}`) : `10^-${u[1]} USDC`) : String(u ?? "unknown");
