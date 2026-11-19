// Weekly reviews the client gives directly, and the project manager's monthly bonus that depends on them.
//
// Every Monday each active service client (an active project or an active retainer) gets a review form for the week before, by
// email when an email is on file. The form is a one-time link that works without signing in; the same week can also be answered
// in the client portal. A review is stored as the week's ClientReview (src/lib/delivery.ts), so it shows on the client's Delivery
// tab and in the portal, and the project manager, the project team and the commission approvers are told.
//
// After a month ends (from the 8th, so the last week of the month can still be answered) the project manager earns the configured
// percent of the client's monthly fee when the reviews the client gave for weeks starting in that month average at least the
// configured stars. The outcome is kept once per client and month; an earned bonus is a BONUS entry that waits for approval and is
// paid like any other (src/lib/commissions.ts). Free of Next.js imports so it can be tested against the database.
import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { dec, round2 } from "./ledger-math";
import { CLIENT_SOURCES, DeliveryError, recordReview, weekStartOf } from "./delivery";
import { notifyMany, usersWithPermission } from "./notifications";
import { appUrl, firstName, sendTemplateQuietly } from "./email-template-store";
import { formatMoney } from "./money";

export class ClientReviewError extends Error {}
type Db = PrismaClient;

export const REVIEW_LINK_DAYS = 14;

// What the client rates each week, part by part. A client's own list (set on the Delivery tab) wins; otherwise the default for its type.
// The marketing list follows a full social media and ads scope of work (HB Elan's SOW, 2026-11-12).
export const DEFAULT_REVIEW_AREAS: Record<string, string[]> = {
  MARKETING: [
    "Feed posts and stories", "Reels and short videos", "Graphic design", "Content calendar and posting on time", "Community engagement (comments and DMs)",
    "Paid ads (Meta, TikTok, Snapchat, Google)", "Online store management", "Lead and order coordination", "Monthly reporting", "Communication with your project manager",
  ],
  OTHER: ["Quality of the work", "Delivery on time", "Communication with your project manager"],
};
export const MAX_REVIEW_AREAS = 15;
export const reviewAreasFor = (c: { reviewAreas: string[]; clientType: string }) => (c.reviewAreas.length ? c.reviewAreas : DEFAULT_REVIEW_AREAS[c.clientType] ?? DEFAULT_REVIEW_AREAS.OTHER);

// One area per line; an empty list goes back to the default for the client type.
export async function setReviewAreas(db: Db, p: { organizationId: string; clientId: string; text: string }) {
  const areas = [...new Set(p.text.split(/\r?\n/).map((l) => l.trim().replace(/\s+/g, " ")).filter(Boolean))];
  if (areas.length > MAX_REVIEW_AREAS) throw new ClientReviewError(`Keep the form to ${MAX_REVIEW_AREAS} areas or fewer.`);
  if (areas.some((a) => a.length > 80)) throw new ClientReviewError("Keep each area under 80 characters.");
  const r = await db.client.updateMany({ where: { id: p.clientId, organizationId: p.organizationId }, data: { reviewAreas: areas } });
  if (r.count === 0) throw new ClientReviewError("Client not found.");
  return areas;
}

// Turns the answers for the client's areas (by position: 1..5, or 0 / empty for "not this week") into what is stored.
export function areaAnswers(areas: string[], ratings: (number | string | null | undefined)[]) {
  return areas.map((area, i) => {
    const n = Number(ratings[i] ?? 0);
    if (!Number.isInteger(n) || n < 0 || n > 5) throw new ClientReviewError(`Choose a rating for "${area}".`);
    return { area, rating: n === 0 ? null : n };
  });
}
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
const addDays = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const reviewUrl = (token: string) => `${appUrl()}/review/${token}`;

// The Monday of the week before the one `today` falls in.
export const lastWeekStart = (today: string) => weekStartOf(addDays(today, -7));

// "9 to 15 Nov 2026", for the form and the email.
export function weekLabel(weekStart: string): string {
  const a = new Date(`${weekStart}T00:00:00Z`);
  const b = new Date(`${addDays(weekStart, 6)}T00:00:00Z`);
  const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString("en-GB", { timeZone: "UTC", ...o });
  return `${fmt(a, a.getUTCMonth() === b.getUTCMonth() ? { day: "numeric" } : { day: "numeric", month: "short" })} to ${fmt(b, { day: "numeric", month: "short", year: "numeric" })}`;
}

// Clients the weekly form goes to: active, with an active project or a retainer running today.
export async function reviewableClients(db: Db, organizationId: string, today: string) {
  return db.client.findMany({
    where: {
      organizationId, active: true,
      OR: [
        { engagements: { some: { status: "ACTIVE", interval: { not: "ONE_TIME" }, startDate: { lte: today }, OR: [{ endDate: null }, { endDate: { gte: today } }] } } },
        { id: { in: (await db.project.findMany({ where: { organizationId, status: "ACTIVE", clientId: { not: null } }, select: { clientId: true } })).map((p) => p.clientId!) } },
      ],
    },
    select: { id: true, name: true, email: true, projectManagerId: true },
    orderBy: { name: "asc" },
  });
}

// A fresh link for one client and week. A link issued earlier for the same week stops working. Refused once the week is reviewed.
export async function issueReviewLink(db: Db, p: { organizationId: string; clientId: string; weekStart: string; now?: Date }) {
  if (!DATE.test(p.weekStart) || weekStartOf(p.weekStart) !== p.weekStart) throw new ClientReviewError("Choose the Monday the week starts on.");
  const client = await db.client.findFirst({ where: { id: p.clientId, organizationId: p.organizationId }, select: { id: true } });
  if (!client) throw new ClientReviewError("Client not found.");
  if (await db.clientReview.findUnique({ where: { clientId_weekStart: { clientId: client.id, weekStart: p.weekStart } } })) throw new ClientReviewError("This week is already reviewed.");
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date((p.now ?? new Date()).getTime() + REVIEW_LINK_DAYS * 86_400_000);
  const request = await db.clientReviewRequest.upsert({
    where: { clientId_weekStart: { clientId: client.id, weekStart: p.weekStart } },
    update: { tokenHash: hash(token), expiresAt },
    create: { organizationId: p.organizationId, clientId: client.id, weekStart: p.weekStart, tokenHash: hash(token), expiresAt },
  });
  return { token, request };
}

// Clients with an open project (active or on hold) get the Monday project update, which carries the rating link, so the review
// form is not emailed to them separately. One email instead of two; the rating comes after they have seen the week's work.
export async function getsWeeklyUpdate(db: Db, organizationId: string, clientId: string) {
  return Boolean(await db.project.findFirst({ where: { organizationId, clientId, status: { in: ["ACTIVE", "ON_HOLD"] }, archivedAt: null }, select: { id: true } }));
}

// The Monday job: one form per reviewable client for last week, emailed when the client has an email, unless the Monday project
// update will carry it (see getsWeeklyUpdate). Every form also shows in the client portal. Running it again does nothing.
export async function sendWeeklyReviewRequests(db: Db, p: { organizationId: string; today: string; now?: Date }) {
  const weekStart = lastWeekStart(p.today);
  const clients = await reviewableClients(db, p.organizationId, p.today);
  let created = 0, emailed = 0, inUpdate = 0;
  for (const c of clients) {
    if (await db.clientReviewRequest.findUnique({ where: { clientId_weekStart: { clientId: c.id, weekStart } } })) continue;
    if (await db.clientReview.findUnique({ where: { clientId_weekStart: { clientId: c.id, weekStart } } })) continue;
    const { token, request } = await issueReviewLink(db, { organizationId: p.organizationId, clientId: c.id, weekStart, now: p.now });
    created++;
    if (await getsWeeklyUpdate(db, p.organizationId, c.id)) { inUpdate++; continue; }
    if (!c.email) continue;
    const pm = c.projectManagerId ? await db.user.findUnique({ where: { id: c.projectManagerId }, select: { name: true } }) : null;
    const link = reviewUrl(token);
    const sent = await sendTemplateQuietly(db, {
      organizationId: p.organizationId, key: "client_weekly_review", to: c.email, relatedType: "ClientReviewRequest", relatedId: request.id, buttonUrl: link, secret: true,
      vars: { client_name: c.name, week: weekLabel(weekStart), project_manager: pm?.name ?? "your project manager", link },
    });
    await db.clientReviewRequest.update({ where: { id: request.id }, data: { sentTo: c.email, emailStatus: sent?.status ?? "FAILED" } });
    if (sent?.status === "SENT") emailed++;
  }
  return { weekStart, created, emailed, inUpdate };
}

// What the public form shows. Null when the link is unknown, expired or already answered.
export async function reviewByToken(db: Db, token: string, now = new Date()) {
  if (!token || token.length > 100) return null;
  const r = await db.clientReviewRequest.findUnique({ where: { tokenHash: hash(token) } });
  if (!r || r.answeredAt || r.expiresAt < now) return null;
  const client = await db.client.findUnique({ where: { id: r.clientId }, select: { name: true, projectManagerId: true, reviewAreas: true, clientType: true } });
  if (!client) return null;
  const pm = client.projectManagerId ? await db.user.findUnique({ where: { id: client.projectManagerId }, select: { name: true } }) : null;
  return { requestId: r.id, clientName: client.name, weekStart: r.weekStart, week: weekLabel(r.weekStart), projectManager: pm?.name ?? null, areas: reviewAreasFor(client) };
}

// Weeks a portal user can still review: forms issued for their client in the last five weeks that nobody has answered.
export async function openPortalReviews(db: Db, clientId: string, now = new Date()) {
  const since = addDays(now.toISOString().slice(0, 10), -42);
  const rows = await db.clientReviewRequest.findMany({ where: { clientId, answeredAt: null, weekStart: { gte: since } }, orderBy: { weekStart: "desc" } });
  const reviewed = new Set((await db.clientReview.findMany({ where: { clientId, weekStart: { in: rows.map((r) => r.weekStart) } }, select: { weekStart: true } })).map((r) => r.weekStart));
  return rows.filter((r) => !reviewed.has(r.weekStart)).map((r) => ({ id: r.id, weekStart: r.weekStart, week: weekLabel(r.weekStart) }));
}

// areaRatings: one answer per area of the client's list, in order (1..5, or 0 for "not this week").
type Submit = { rating: number; review: string; areaRatings?: (number | string | null)[]; now?: Date } & ({ token: string } | { requestId: string; clientId: string; userId: string });

// The client's answer, from the emailed link or the portal. Saved as the week's review, then the team is told.
export async function submitClientReview(db: Db, p: Submit) {
  const now = p.now ?? new Date();
  const req = "token" in p
    ? await db.clientReviewRequest.findUnique({ where: { tokenHash: hash(p.token) } })
    : await db.clientReviewRequest.findFirst({ where: { id: p.requestId, clientId: p.clientId } });
  if (!req || ("token" in p && req.expiresAt < now)) throw new ClientReviewError("This review link is not valid any more. Ask your project manager for a new one.");
  if (req.answeredAt) throw new ClientReviewError("Thank you, this week is already reviewed.");
  const client = await db.client.findUniqueOrThrow({ where: { id: req.clientId }, select: { reviewAreas: true, clientType: true } });
  const areas = areaAnswers(reviewAreasFor(client), p.areaRatings ?? []);
  // Claim the request first so a double submit cannot save two reviews
  const claimed = await db.clientReviewRequest.updateMany({ where: { id: req.id, answeredAt: null }, data: { answeredAt: now } });
  if (claimed.count === 0) throw new ClientReviewError("Thank you, this week is already reviewed.");
  let saved;
  try {
    saved = await recordReview(db, {
      organizationId: req.organizationId, clientId: req.clientId, weekOf: req.weekStart, rating: p.rating, review: p.review,
      reviewerId: "token" in p ? null : p.userId, source: "token" in p ? "CLIENT_LINK" : "PORTAL", areas,
    });
  } catch (e) {
    await db.clientReviewRequest.update({ where: { id: req.id }, data: { answeredAt: null } });
    if (e instanceof DeliveryError) throw new ClientReviewError(e.message === "This week already has a review for this client." ? "Thank you, this week is already reviewed." : e.message);
    throw e;
  }
  await db.clientReviewRequest.update({ where: { id: req.id }, data: { reviewId: saved.review.id } });
  await tellTeam(db, req.organizationId, req.clientId, saved.review.id, p.rating, req.weekStart);
  return saved.review;
}

// The project manager, the staff on the client's active projects and the commission approvers hear about every client review.
async function tellTeam(db: Db, organizationId: string, clientId: string, reviewId: string, rating: number, weekStart: string) {
  const client = await db.client.findUnique({ where: { id: clientId }, select: { name: true, projectManagerId: true } });
  if (!client) return;
  const members = await db.projectMember.findMany({ where: { project: { organizationId, clientId, status: { in: ["ACTIVE", "ON_HOLD"] } } }, select: { userId: true } });
  const ids = [...new Set([client.projectManagerId, ...members.map((m) => m.userId), ...(await usersWithPermission(db, organizationId, "commissions.approve"))].filter((x): x is string => Boolean(x)))];
  const staff = (await db.user.findMany({ where: { id: { in: ids }, organizationId, userType: "EMPLOYEE", active: true }, select: { id: true } })).map((u) => u.id);
  await notifyMany(db, staff, {
    kind: rating <= 3 ? "client.review_low" : "client.review",
    title: `${client.name} rated the week of ${weekLabel(weekStart)} ${rating} of 5${rating <= 3 ? ": please follow up" : ""}`,
    link: `/clients/${clientId}?tab=delivery`, dedupeKey: `client-review:${reviewId}`,
  });
}

// ---------- project manager monthly bonus ----------

export async function setPmBonus(db: Db, p: { organizationId: string; percent: string; minAverage: string; active: boolean; actorId: string }) {
  const percent = p.percent.trim(), minAverage = p.minAverage.trim();
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(percent) || dec(percent).gt(50)) throw new ClientReviewError("Enter a percent between 0 and 50 with up to two decimals.");
  if (!/^[1-5](\.\d{1,2})?$/.test(minAverage) || dec(minAverage).gt(5)) throw new ClientReviewError("Enter the average needed, from 1 to 5 (for example 4.5).");
  const before = await db.pmBonusSetting.findUnique({ where: { organizationId: p.organizationId } });
  const row = await db.pmBonusSetting.upsert({
    where: { organizationId: p.organizationId },
    update: { percent, minAverage, active: p.active, updatedById: p.actorId },
    create: { organizationId: p.organizationId, percent, minAverage, active: p.active, updatedById: p.actorId },
  });
  return { row, before };
}

// The client's monthly fee for a month: recurring engagements in the client's currency that ran during it, as a monthly amount.
export async function monthlyFee(db: Db, p: { organizationId: string; clientId: string; currency: string; month: string }) {
  const first = `${p.month}-01`;
  const last = addDays(`${nextMonth(p.month)}-01`, -1);
  const rows = await db.engagement.findMany({ where: { organizationId: p.organizationId, clientId: p.clientId, currency: p.currency, status: { not: "CANCELLED" }, interval: { not: "ONE_TIME" }, startDate: { lte: last }, OR: [{ endDate: null }, { endDate: { gte: first } }] } });
  return round2(rows.reduce((n, r) => n.add(dec(r.amount.toString()).div(r.interval === "QUARTERLY" ? 3 : r.interval === "ANNUAL" ? 12 : 1)), dec(0)));
}

const nextMonth = (m: string) => { const [y, mo] = m.split("-").map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`; };
const prevMonth = (m: string) => { const [y, mo] = m.split("-").map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`; };
export const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", month: "long", year: "numeric" });
export const SETTLE_FROM_DAY = 8;

// Works out last month's bonus for every client with a project manager, once per client and month. From the 8th of the month only,
// unless a month is given (used by tests and a manual run). Clients with no client reviews and no fee that month are skipped.
export async function settlePmBonuses(db: Db, p: { organizationId: string; today: string; actorId: string; month?: string }) {
  if (!p.month && Number(p.today.slice(8, 10)) < SETTLE_FROM_DAY) return { month: null, earned: 0, notEarned: 0 };
  const month = p.month ?? prevMonth(p.today.slice(0, 7));
  if (!MONTH.test(month) || month >= p.today.slice(0, 7)) throw new ClientReviewError("Choose a month that has ended.");
  const setting = await db.pmBonusSetting.findUnique({ where: { organizationId: p.organizationId } });
  if (!setting || !setting.active || setting.percent.lte(0)) return { month, earned: 0, notEarned: 0 };
  const clients = await db.client.findMany({ where: { organizationId: p.organizationId, projectManagerId: { not: null } }, select: { id: true, name: true, currency: true, projectManagerId: true } });
  let earned = 0, notEarned = 0;
  for (const c of clients) {
    if (await db.pmMonthlyBonus.findUnique({ where: { clientId_month: { clientId: c.id, month } } })) continue;
    const reviews = await db.clientReview.findMany({ where: { clientId: c.id, weekStart: { startsWith: `${month}-` }, source: { in: CLIENT_SOURCES } }, select: { rating: true } });
    const base = await monthlyFee(db, { organizationId: p.organizationId, clientId: c.id, currency: c.currency, month });
    if (reviews.length === 0 && base.lte(0)) continue;
    const pm = await db.user.findFirst({ where: { id: c.projectManagerId!, organizationId: p.organizationId, userType: "EMPLOYEE", active: true }, select: { id: true, name: true } });
    const average = reviews.length ? round2(dec(reviews.reduce((n, r) => n + r.rating, 0)).div(reviews.length)) : dec(0);
    const reason = !pm ? "The project manager is not an active staff member."
      : reviews.length === 0 ? "The client gave no reviews for this month."
      : average.lt(setting.minAverage.toString()) ? `The client's reviews averaged ${average.toFixed(2)}, below the ${setting.minAverage.toString()} needed.`
      : base.lte(0) ? "No monthly fee was running for this client this month."
      : null;
    const amount = reason ? dec(0) : round2(base.mul(setting.percent.toString()).div(100));
    const common = { organizationId: p.organizationId, clientId: c.id, month, projectManagerId: pm?.id ?? c.projectManagerId, reviews: reviews.length, average: average.toString(), minAverage: setting.minAverage.toString(), base: base.toString(), percent: setting.percent.toString(), currency: c.currency };
    try {
      await db.$transaction(async (tx) => {
        const row = await tx.pmMonthlyBonus.create({ data: { ...common, status: reason ? "NOT_EARNED" : "EARNED", reason, amount: amount.toString() } });
        if (reason) return;
        const entry = await tx.commissionEntry.create({ data: {
          organizationId: p.organizationId, userId: pm!.id, kind: "BONUS", clientId: c.id, currency: c.currency, base: base.toString(), ratePercent: setting.percent.toString(), amount: amount.toString(),
          note: `Project manager bonus, ${c.name}, ${monthLabel(month)}: client reviews averaged ${average.toFixed(2)} of 5 (${reviews.length} review${reviews.length === 1 ? "" : "s"})`, createdById: p.actorId,
        } });
        await tx.pmMonthlyBonus.update({ where: { id: row.id }, data: { entryId: entry.id } });
      });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") continue; // another run already worked this client out
      throw e;
    }
    if (reason) notEarned++; else earned++;
    const msg = reason ? `No project manager bonus for ${c.name}, ${monthLabel(month)}: ${reason}` : `Project manager bonus earned for ${c.name}, ${monthLabel(month)}: ${formatMoney(amount, c.currency)}`;
    if (pm) await notifyMany(db, [pm.id], { kind: "pm.bonus", title: msg, link: reason ? `/clients/${c.id}?tab=delivery` : "/me/commissions", dedupeKey: `pm-bonus:${c.id}:${month}` });
    await notifyMany(db, (await usersWithPermission(db, p.organizationId, "commissions.approve")).filter((u) => u !== pm?.id), { kind: "pm.bonus", title: msg, link: "/finance/commissions", dedupeKey: `pm-bonus-approver:${c.id}:${month}` });
  }
  return { month, earned, notEarned };
}

export { firstName };
