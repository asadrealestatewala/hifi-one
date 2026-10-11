// Pure payroll calculation. Exact decimals, consistent half-up rounding to 2 places.
import { dec, round2 } from "./ledger-math";
import { rangesOverlap, workingDays } from "./hr-rules";

export function periodBounds(period: string): { start: string; end: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error("Period must be YYYY-MM");
  const [y, m] = period.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${period}-01`, end: `${period}-${String(last).padStart(2, "0")}` };
}

// Working days of unpaid leave that fall inside the period (ranges are clipped to the period).
export function unpaidDaysInPeriod(period: string, leaves: { startDate: string; endDate: string }[], holidays: string[] = []): number {
  const b = periodBounds(period);
  let n = 0;
  for (const l of leaves) {
    if (!rangesOverlap({ start: l.startDate, end: l.endDate }, b)) continue;
    n += workingDays(l.startDate < b.start ? b.start : l.startDate, l.endDate > b.end ? b.end : l.endDate, holidays);
  }
  return n;
}

export type PayInput = {
  period: string;
  basic: string | number;
  allowance: string | number;
  bonus?: string | number;
  taxPercent: string | number;
  unpaidLeaves: { startDate: string; endDate: string }[];
  holidays?: string[];
};

export function calculatePay(i: PayInput) {
  const b = periodBounds(i.period);
  const workDays = workingDays(b.start, b.end, i.holidays);
  const unpaidDays = Math.min(unpaidDaysInPeriod(i.period, i.unpaidLeaves, i.holidays), workDays);
  const basic = round2(i.basic);
  const allowance = round2(i.allowance);
  const bonus = round2(i.bonus ?? 0);
  const unpaidDeduction = workDays === 0 ? dec(0) : round2(basic.mul(unpaidDays).div(workDays));
  const gross = basic.add(allowance).add(bonus).sub(unpaidDeduction);
  const tax = round2(gross.mul(i.taxPercent).div(100));
  const net = gross.sub(tax);
  return { workingDays: workDays, unpaidDays, basic, allowance, bonus, unpaidDeduction, gross, tax, net };
}
