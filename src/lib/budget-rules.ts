// Pure budget rules. A budget keeps its original amount forever; approved transfers adjust what is
// available. Spend is split into committed (approved, not yet posted) and incurred (posted or paid).
import { dec, round2 } from "./ledger-math";

type N = string | number | { toString(): string };

export function effectiveBudget(original: N, transfersIn: N[], transfersOut: N[]) {
  const inn = transfersIn.reduce<ReturnType<typeof dec>>((a, v) => a.add(round2(v.toString())), dec(0));
  const out = transfersOut.reduce<ReturnType<typeof dec>>((a, v) => a.add(round2(v.toString())), dec(0));
  return round2(original.toString()).add(inn).sub(out);
}

export const THRESHOLDS = [75, 90, 100] as const;

export function utilization(effective: N, committed: N, incurred: N) {
  const eff = round2(effective.toString());
  const used = round2(committed.toString()).add(round2(incurred.toString()));
  const pct = eff.lte(0) ? (used.gt(0) ? 999 : 0) : Math.floor(used.div(eff).mul(100).toNumber());
  const level = [...THRESHOLDS].reverse().find((t) => pct >= t) ?? 0;
  return { used, remaining: eff.sub(used), pct, level, over: used.gt(eff) };
}

// Would approving `amount` push this budget past its limit?
export function wouldExceed(effective: N, committed: N, incurred: N, amount: N) {
  const after = round2(committed.toString()).add(round2(incurred.toString())).add(round2(amount.toString()));
  return after.gt(round2(effective.toString()));
}

// A transfer may only move money that is still unspent in the source budget.
export function canTransfer(effectiveFrom: N, committed: N, incurred: N, amount: N) {
  const free = round2(effectiveFrom.toString()).sub(round2(committed.toString())).sub(round2(incurred.toString()));
  return round2(amount.toString()).gt(0) && round2(amount.toString()).lte(free);
}
