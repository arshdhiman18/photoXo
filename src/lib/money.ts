/**
 * Money is stored and calculated as an integer number of minor units
 * (paise for INR). These helpers never use floating-point arithmetic.
 */

export const MAX_EXPENSE_MINOR = 10_000_000_00; // ₹1,00,00,000.00

/** "1,234.5" / "1234.50" / "1234" → 123450. null for anything that isn't a clean amount. */
export function parseMoneyInput(raw: string): number | null {
  const s = raw.trim().replace(/,/g, "");
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const minor = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
}

/** 123450 → "1234.50" (for form inputs). */
export function minorToInput(minor: number): string {
  const major = Math.trunc(minor / 100);
  const cents = String(minor % 100).padStart(2, "0");
  return `${major}.${cents}`;
}

/** 123450, "INR" → "₹1,234.50" (integer grouping via Intl, minor part appended as digits). */
export function formatMoney(minor: number, currency: string): string {
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const major = Math.trunc(abs / 100);
  const cents = String(abs % 100).padStart(2, "0");
  const parts = new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).formatToParts(major);
  const body = parts.map((p) => p.value).join("");
  return `${negative ? "-" : ""}${body}.${cents}`;
}
