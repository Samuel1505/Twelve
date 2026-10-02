// Per-contract outflow profiles (MONITOR §3). Updated per tx AFTER detectors ran on the pre-tx snapshot.
import { usdc18, type Usdc18 } from "@twelve/shared";
import type { Address } from "viem";
import type { Movement } from "./types.js";

export const BUCKETS = 64;
const RATIO_PRECISION = 10n ** 9n; // fixed-point precision for max_out_frac (a dimensionless ratio)

/** Profiles exist for every address that moves USDC (ADR-020); contract-ness lives in the accounts cache and is
 *  resolved only for alert candidates. Histograms are sparse: bucket → count. */
export type Hist = Record<number, number>;
export type Profile = {
  address: Address;
  nOut: { native: number; erc20: number };
  hist: { native: Hist; erc20: Hist };
  balance18: Usdc18;
  maxOutFrac: number; // dimensionless
  updatedBlock: bigint;
  balanceUnderflow: boolean; // movements implied a negative balance: history incomplete → ops signal
  completeHistory: boolean; // seen from genesis: balance is exact (contracts pay no gas). Required by D3 and BALANCE.
};

export const emptyProfile = (address: Address, block: bigint, completeHistory = true, seed: Usdc18 = usdc18(0n)): Profile => ({
  address, nOut: { native: 0, erc20: 0 }, hist: { native: {}, erc20: {} }, completeHistory,
  balance18: seed, maxOutFrac: 0, updatedBlock: block, balanceUnderflow: false,
});

/** ⌊log10(amount)⌋, 0 for 0; capped to the histogram. */
export const bucketOf = (a: bigint): number => (a <= 0n ? 0 : Math.min(BUCKETS - 1, a.toString().length - 1));

export const nOut = (p: Profile): number => p.nOut.native + p.nOut.erc20;

/** Median outflow (18-dec), approximated by the geometric midpoint of the median bucket (~3·10^b). */
export function medianOut(p: Profile): Usdc18 | null {
  const n = nOut(p);
  if (n === 0) return null;
  let acc = 0;
  for (let b = 0; b < BUCKETS; b++) {
    acc += (p.hist.native[b] ?? 0) + (p.hist.erc20[b] ?? 0);
    if (acc * 2 >= n) return usdc18(3n * 10n ** BigInt(b));
  }
  return null;
}

/** Number of outflows within ±`orders` decades of `amount`'s bucket. */
export function countNear(p: Profile, amount: bigint, orders: number): number {
  const c = bucketOf(amount);
  let m = 0;
  for (let b = Math.max(0, c - orders); b <= Math.min(BUCKETS - 1, c + orders); b++) {
    m += (p.hist.native[b] ?? 0) + (p.hist.erc20[b] ?? 0);
  }
  return m;
}

/** Fraction of all outflows within ±`orders` decades of `amount`'s bucket (D2 suppression). */
export function massNear(p: Profile, amount: bigint, orders: number): number {
  const n = nOut(p);
  if (n === 0) return 0;
  const c = bucketOf(amount);
  let m = 0;
  for (let b = Math.max(0, c - orders); b <= Math.min(BUCKETS - 1, c + orders); b++) {
    m += (p.hist.native[b] ?? 0) + (p.hist.erc20[b] ?? 0);
  }
  return m / n;
}

const clone = (p: Profile): Profile => ({
  ...p, nOut: { ...p.nOut }, hist: { native: { ...p.hist.native }, erc20: { ...p.hist.erc20 } },
});

/** Dense 64-bucket array (DB int[] column). */
export const dense = (h: Hist): number[] => Array.from({ length: BUCKETS }, (_, b) => h[b] ?? 0);
export const sparse = (a: readonly number[]): Hist =>
  Object.fromEntries(a.map((n, b) => [b, n] as const).filter(([, n]) => n > 0));

/** Apply one tx's movements touching `p.address`. Returns a new profile (snapshots stay immutable). */
export function applyTx(p: Profile, movements: readonly Movement[], block: bigint): Profile {
  const q = clone(p);
  const pre = q.balance18;
  let out = 0n;
  let bal = pre as bigint;
  for (const m of movements) {
    if (m.to === q.address) bal += m.amount18;
    if (m.from === q.address) {
      bal -= m.amount18;
      if (m.iface === "native" || m.iface === "erc20") {
        out += m.amount18;
        q.nOut[m.iface] += 1;
        const h = q.hist[m.iface];
        const b = bucketOf(m.amount18);
        h[b] = (h[b] ?? 0) + 1;
      }
    }
  }
  if (bal < 0n) {
    q.balanceUnderflow = true;
    bal = 0n;
  }
  if (pre > 0n && out > 0n) {
    // ratio of two 18-dec amounts: dimensionless, floating point is fine here
    q.maxOutFrac = Math.max(q.maxOutFrac, Number((out * RATIO_PRECISION) / pre) / Number(RATIO_PRECISION));
  }
  q.balance18 = usdc18(bal);
  q.updatedBlock = block;
  return q;
}
