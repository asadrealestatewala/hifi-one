// Date-range filters carried in the address (?from=2026-10-01&to=2026-10-31). Invalid or reversed input is
// ignored rather than guessed. Both ends are inclusive whole days (UTC, as stored).
export type DateRange = { from?: string; to?: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const valid = (d?: string) => (d && DAY.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) ? d : undefined);

export function parseRange(from?: string, to?: string): DateRange {
  const f = valid(from), t = valid(to);
  if (f && t && t < f) return {};
  return { from: f, to: t };
}

// Prisma filter for a DateTime column, or undefined when no range is set
export function rangeFilter(r: DateRange): { gte?: Date; lte?: Date } | undefined {
  if (!r.from && !r.to) return undefined;
  return { ...(r.from ? { gte: new Date(`${r.from}T00:00:00.000Z`) } : {}), ...(r.to ? { lte: new Date(`${r.to}T23:59:59.999Z`) } : {}) };
}

export const rangeLabel = (r: DateRange) => (r.from && r.to ? (r.from === r.to ? r.from : `${r.from} to ${r.to}`) : r.from ? `from ${r.from}` : r.to ? `until ${r.to}` : "");
