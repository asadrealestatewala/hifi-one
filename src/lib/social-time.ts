// Turning a post's planned date and time (company time) into the instant it should go out. Kept apart from the publisher
// so content.ts can move queued posts when a scheduled post is dragged to another day, without importing the publisher.
import type { PrismaClient } from "@prisma/client";

export const DEFAULT_POST_TIME = "10:00";

// "2026-12-03" + "18:30" in Asia/Karachi -> 2026-12-03T13:30:00Z
export function localToUtc(date: string, time: string, timeZone: string): Date {
  const [h, m] = (time || DEFAULT_POST_TIME).split(":").map(Number);
  const guess = new Date(`${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
  const offset = (d: Date) => {
    let parts: Intl.DateTimeFormatPart[];
    try { parts = new Intl.DateTimeFormat("en-US", { timeZone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(d); }
    catch { return 0; } // an unknown zone is treated as UTC
    const v = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    return Date.UTC(v("year"), v("month") - 1, v("day"), v("hour") % 24, v("minute"), v("second")) - d.getTime();
  };
  const first = new Date(guess.getTime() - offset(guess));
  return new Date(guess.getTime() - offset(first)); // second pass gets daylight-saving edges right
}

export async function companyTimeZone(db: PrismaClient, organizationId: string): Promise<string> {
  const p = await db.companyProfile.findFirst({ where: { organizationId, isDefault: true }, select: { timezone: true } });
  return p?.timezone || "UTC";
}

// A scheduled post moved to another day or time: its queued automatic posts move with it.
export async function moveQueuedPublications(db: PrismaClient, item: { id: string; organizationId: string; plannedDate: string | null; plannedTime: string | null }) {
  if (!item.plannedDate) return 0;
  const at = localToUtc(item.plannedDate, item.plannedTime ?? DEFAULT_POST_TIME, await companyTimeZone(db, item.organizationId));
  return (await db.contentPublication.updateMany({ where: { itemId: item.id, status: "QUEUED" }, data: { scheduledFor: at } })).count;
}
