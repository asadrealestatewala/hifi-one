// Pure HR rules (no database), shared by actions and tests.
// Dates are plain YYYY-MM-DD strings so timezones and daylight saving never shift a leave day.

export const WEEKEND_DAYS = [0, 6]; // Sunday, Saturday (configurable per organization later)

const parse = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
};

export const isDateString = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(parse(d).getTime()) && parse(d).toISOString().slice(0, 10) === d;

// Working days between two dates inclusive, skipping weekends and any listed holidays.
export function workingDays(start: string, end: string, holidays: string[] = [], weekend = WEEKEND_DAYS): number {
  if (end < start) return 0;
  let n = 0;
  for (let t = parse(start).getTime(); t <= parse(end).getTime(); t += 86400000) {
    const d = new Date(t);
    if (weekend.includes(d.getUTCDay())) continue;
    if (holidays.includes(d.toISOString().slice(0, 10))) continue;
    n++;
  }
  return n;
}

export function rangesOverlap(a: { start: string; end: string }, b: { start: string; end: string }): boolean {
  return a.start <= b.end && b.start <= a.end;
}

export function leaveRemaining(allowance: number, approvedDays: number, pendingDays = 0) {
  return { remaining: allowance - approvedDays, available: allowance - approvedDays - pendingDays };
}

// Today's date in the company timezone, as YYYY-MM-DD (en-CA formats that way).
export function dateInZone(now: Date, timeZone: string): string {
  return now.toLocaleDateString("en-CA", { timeZone });
}

// Attendance time = clock in to clock out, minus breaks. An open record counts up to `now`.
export function workedMinutes(
  rec: { clockIn: Date; clockOut: Date | null },
  breaks: { startAt: Date; endAt: Date | null }[],
  now = new Date(),
): { attendance: number; breaks: number; worked: number } {
  const end = rec.clockOut ?? now;
  const total = Math.max(0, Math.round((end.getTime() - rec.clockIn.getTime()) / 60000));
  const brk = breaks.reduce((a, b) => a + Math.max(0, Math.round(((b.endAt ?? end).getTime() - b.startAt.getTime()) / 60000)), 0);
  return { attendance: total, breaks: brk, worked: Math.max(0, total - brk) };
}

export const fmtMinutes = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
