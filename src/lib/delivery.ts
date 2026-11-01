// Marketing delivery: the weekly customer success review and the rebate it earns the team, discovery calls and recordings.
// A review (rating 1 to 5 plus the written review) is recorded once per client per week. The rating picks a tier; the tier's
// percent of the client's weekly retainer is set aside and shared equally among the client's project manager and the staff on the
// client's active projects, as bonus entries that wait for approval like any other bonus (src/lib/commissions.ts).
import type { PrismaClient } from "@prisma/client";
import { dec, round2 } from "./ledger-math";

export class DeliveryError extends Error {}
type Db = PrismaClient;

export const MEETING_PURPOSES = ["GENERAL", "DISCOVERY", "WEEKLY_REVIEW", "SUPPORT", "TUTORIAL", "INQUIRY"] as const;
export const PURPOSE_LABEL: Record<string, string> = { GENERAL: "Meeting", DISCOVERY: "Business discovery call", WEEKLY_REVIEW: "Weekly review", SUPPORT: "Customer support", TUTORIAL: "Product tutorial", INQUIRY: "Inquiry" };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// The Monday of the week a date falls in, as YYYY-MM-DD.
export function weekStartOf(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

export async function setRebateTier(db: Db, p: { organizationId: string; minRating: number; percent: string; actorId: string }) {
  if (!Number.isInteger(p.minRating) || p.minRating < 1 || p.minRating > 5) throw new DeliveryError("Choose a rating from 1 to 5.");
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(p.percent.trim()) || dec(p.percent).gt(50)) throw new DeliveryError("Enter a percent between 0 and 50 with up to two decimals.");
  const key = { organizationId_minRating: { organizationId: p.organizationId, minRating: p.minRating } };
  if (dec(p.percent).eq(0)) { await db.reviewRebateTier.deleteMany({ where: { organizationId: p.organizationId, minRating: p.minRating } }); return; }
  await db.reviewRebateTier.upsert({ where: key, update: { percent: p.percent.trim(), updatedById: p.actorId }, create: { organizationId: p.organizationId, minRating: p.minRating, percent: p.percent.trim(), updatedById: p.actorId } });
}

// The highest tier the rating reaches, or 0.
export function tierPercent(tiers: { minRating: number; percent: { toString(): string } }[], rating: number): string {
  const hit = tiers.filter((t) => t.minRating <= rating).sort((a, b) => b.minRating - a.minRating)[0];
  return hit ? hit.percent.toString() : "0";
}

// The people who share the rebate: the project manager first, then staff on the client's active projects (each once).
export async function rebateTeam(db: Db, organizationId: string, clientId: string): Promise<string[]> {
  const client = await db.client.findFirst({ where: { id: clientId, organizationId }, select: { projectManagerId: true } });
  const members = await db.projectMember.findMany({ where: { project: { organizationId, clientId, status: { in: ["ACTIVE", "ON_HOLD"] } } }, select: { userId: true } });
  const ids = [...new Set([client?.projectManagerId, ...members.map((m) => m.userId)].filter((x): x is string => Boolean(x)))];
  const ok = await db.user.findMany({ where: { id: { in: ids }, organizationId, userType: "EMPLOYEE", active: true }, select: { id: true } });
  const okSet = new Set(ok.map((u) => u.id));
  return ids.filter((i) => okSet.has(i));
}

// What the client's active recurring engagements pay in a week (a year divided by 52), in the client's currency.
export async function weeklyRetainer(db: Db, organizationId: string, clientId: string, today = new Date().toISOString().slice(0, 10)) {
  const rows = await db.engagement.findMany({ where: { organizationId, clientId, status: "ACTIVE", interval: { not: "ONE_TIME" }, startDate: { lte: today }, OR: [{ endDate: null }, { endDate: { gte: today } }] } });
  const perYear = rows.reduce((n, r) => n.add(dec(r.amount.toString()).mul(r.interval === "MONTHLY" ? 12 : r.interval === "QUARTERLY" ? 4 : 1)), dec(0));
  return round2(perYear.div(52));
}

export async function recordReview(db: Db, p: { organizationId: string; clientId: string; weekOf: string; rating: number; review: string; meetingId?: string | null; reviewerId: string }) {
  if (!DATE.test(p.weekOf)) throw new DeliveryError("Choose the week reviewed.");
  if (!Number.isInteger(p.rating) || p.rating < 1 || p.rating > 5) throw new DeliveryError("Choose a rating from 1 to 5.");
  const review = p.review.trim();
  if (review.length < 3) throw new DeliveryError("Write what the client said.");
  if (review.length > 2000) throw new DeliveryError("The review is limited to 2000 characters.");
  const client = await db.client.findFirst({ where: { id: p.clientId, organizationId: p.organizationId } });
  if (!client) throw new DeliveryError("Client not found.");
  if (p.meetingId && !(await db.meeting.findFirst({ where: { id: p.meetingId, organizationId: p.organizationId, clientId: p.clientId } }))) throw new DeliveryError("Choose a meeting held with this client.");
  const weekStart = weekStartOf(p.weekOf);
  const tiers = await db.reviewRebateTier.findMany({ where: { organizationId: p.organizationId } });
  const percent = tierPercent(tiers, p.rating);
  const weekly = await weeklyRetainer(db, p.organizationId, client.id);
  const team = dec(percent).gt(0) && weekly.gt(0) ? await rebateTeam(db, p.organizationId, client.id) : [];
  const pool = team.length > 0 ? round2(weekly.mul(percent).div(100)) : dec(0); // nobody to share it with means nothing is set aside
  return db.$transaction(async (tx) => {
    const dup = await tx.clientReview.findUnique({ where: { clientId_weekStart: { clientId: client.id, weekStart } } });
    if (dup) throw new DeliveryError("This week already has a review for this client.");
    const r = await tx.clientReview.create({ data: { organizationId: p.organizationId, clientId: client.id, meetingId: p.meetingId || null, weekStart, rating: p.rating, review, reviewerId: p.reviewerId, rebatePercent: percent, rebatePool: pool.toString(), currency: client.currency } });
    if (team.length > 0) {
      const cents = pool.mul(100).toNumber();
      const base = Math.floor(cents / team.length);
      const extra = cents - base * team.length; // the first person (the project manager) gets any odd cents
      await tx.commissionEntry.createMany({
        data: team.map((userId, i) => ({
          organizationId: p.organizationId, userId, kind: "BONUS", reviewId: r.id, clientId: client.id, currency: client.currency, base: weekly.toString(), ratePercent: percent,
          amount: dec(base + (i === 0 ? extra : 0)).div(100).toString(), note: `Weekly review ${weekStart} for ${client.name}: ${p.rating}/5`, createdById: p.reviewerId,
        })),
        skipDuplicates: true,
      });
    }
    return { review: r, shared: team.length, pool: pool.toString() };
  });
}

// The host attaches where the recording is kept. The ERP does not record calls itself; people on the call must be told it is recorded.
export async function setRecordingUrl(db: Db, p: { organizationId: string; meetingId: string; url: string }) {
  const url = p.url.trim();
  if (url) {
    let ok = false;
    try { ok = new URL(url).protocol === "https:"; } catch { ok = false; }
    if (!ok || url.length > 500) throw new DeliveryError("Enter the recording link starting with https://.");
  }
  const r = await db.meeting.updateMany({ where: { id: p.meetingId, organizationId: p.organizationId }, data: { recordingUrl: url || null } });
  if (r.count === 0) throw new DeliveryError("Meeting not found.");
}
