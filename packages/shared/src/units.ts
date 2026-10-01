// The ONLY TypeScript module where the 10^12 USDC scale appears (invariant I1).
// Usdc6 / Usdc18 are distinct brands over bigint (I2): mixing them is a type error, never a silent bug.

declare const usdc6Brand: unique symbol;
declare const usdc18Brand: unique symbol;

/** ERC-20 view amount: raw integer with 6 decimals (`0x3600…` balanceOf/transfer). */
export type Usdc6 = bigint & { readonly [usdc6Brand]: true };
/** Native view amount: raw integer with 18 decimals (msg.value, balances, gas). */
export type Usdc18 = bigint & { readonly [usdc18Brand]: true };

/** Raw-integer ratio between the native (18-dec) and ERC-20 (6-dec) views. */
export const USDC_SCALE = 10n ** 12n;
export const USDC6_DECIMALS = 6;
export const USDC18_DECIMALS = 18;

export const usdc6 = (raw: bigint): Usdc6 => {
  if (raw < 0n) throw new RangeError("Usdc6 cannot be negative");
  return raw as Usdc6;
};

export const usdc18 = (raw: bigint): Usdc18 => {
  if (raw < 0n) throw new RangeError("Usdc18 cannot be negative");
  return raw as Usdc18;
};

/** 6 → 18: exact. */
export const toUsdc18 = (a: Usdc6): Usdc18 => (a * USDC_SCALE) as Usdc18;

/** 18 → 6: floors and returns the remainder the ERC-20 view cannot move (I3). Never drops dust silently. */
export const toUsdc6 = (a: Usdc18): { amount: Usdc6; dust: Usdc18 } => ({
  amount: (a / USDC_SCALE) as Usdc6,
  dust: (a % USDC_SCALE) as Usdc18,
});

/** True iff `v18 == v6 * 10^12` exactly (the EIP-7708 / ERC-20 log pairing rule, ARC_LEDGER §2.1). */
export const isSameAmount = (v18: Usdc18, v6: Usdc6): boolean => v18 === v6 * USDC_SCALE;

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

function parseDecimal(s: string, decimals: number): bigint {
  const m = DECIMAL.exec(s.trim());
  if (!m) throw new SyntaxError(`not a non-negative decimal: ${JSON.stringify(s)}`);
  const whole = m[1] ?? "0";
  const frac = m[2] ?? "";
  if (frac.length > decimals) throw new RangeError(`more than ${decimals} decimals: ${s}`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

function formatDecimal(raw: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const frac = (raw % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${raw / base}.${frac}` : `${raw / base}`;
}

/** "1.5" USDC → Usdc18 (exact; rejects more than 18 decimals). */
export const parseUsdc18 = (s: string): Usdc18 => usdc18(parseDecimal(s, USDC18_DECIMALS));
/** "1.5" USDC → Usdc6 (exact; rejects more than 6 decimals). */
export const parseUsdc6 = (s: string): Usdc6 => usdc6(parseDecimal(s, USDC6_DECIMALS));
export const formatUsdc18 = (a: Usdc18): string => formatDecimal(a, USDC18_DECIMALS);
export const formatUsdc6 = (a: Usdc6): string => formatDecimal(a, USDC6_DECIMALS);

/**
 * Raw-integer equality ACROSS views — deliberately unit-violating. This is the 10^12 bug's fingerprint (MONITOR D1):
 * one variable fed both interfaces unscaled. Use only for detection, never for accounting.
 */
export const rawEqualAcrossViews = (a18: Usdc18, b6: Usdc6): boolean => (a18 as bigint) === (b6 as bigint);
