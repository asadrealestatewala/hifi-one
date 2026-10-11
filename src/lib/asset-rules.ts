// Pure straight-line depreciation rules. Convention: depreciation starts in the month of purchase
// (a full month is charged for that month). The last month absorbs rounding so the total always
// equals cost minus salvage value exactly.
import { dec, round2 } from "./ledger-math";

export function addMonths(period: string, n: number): string {
  const [y, m] = period.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

export function monthlyAmount(cost: string | number, salvage: string | number, months: number, indexFromZero: number) {
  if (months <= 0) throw new Error("Useful life must be at least one month");
  const base = dec(cost).sub(salvage);
  if (base.isNegative()) throw new Error("Salvage value cannot exceed cost");
  const regular = round2(base.div(months));
  if (indexFromZero < months - 1) return regular;
  return base.sub(regular.mul(months - 1)); // final month: whatever remains
}

export function startPeriod(purchaseDate: string) {
  return purchaseDate.slice(0, 7);
}

// Periods that should be depreciated up to and including `upTo`, minus those already posted.
export function periodsDue(purchaseDate: string, months: number, upTo: string, posted: string[]) {
  const start = startPeriod(purchaseDate);
  const out: string[] = [];
  for (let i = 0; i < months; i++) {
    const p = addMonths(start, i);
    if (p > upTo) break;
    if (!posted.includes(p)) out.push(p);
  }
  return out;
}

export function netBookValue(cost: string | number, accumulated: string | number) {
  return round2(dec(cost).sub(accumulated));
}
