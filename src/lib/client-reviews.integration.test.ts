import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { recordReview } from "./delivery";
import { createEngagement } from "./engagements";
import {
  ClientReviewError, DEFAULT_REVIEW_AREAS, areaAnswers, issueReviewLink, reviewAreasFor, setReviewAreas, lastWeekStart, monthlyFee, openPortalReviews, reviewByToken, sendWeeklyReviewRequests, setPmBonus, settlePmBonuses, submitClientReview, weekLabel,
} from "./client-reviews";
import { acceptInvite, createInvite } from "./portal";
import { LedgerError } from "./ledger-math";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, pm: string, designer: string, approver: string, outsider: string, client: string, quiet: string, idle: string, otherClient: string, portalUser: string;

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "ClientReviewRequest","PmMonthlyBonus","PmBonusSetting","ClientReview","ReviewRebateTier","CommissionEntry","Notification","EmailMessage","Engagement","ProjectMember","Project","ClientInvite","UserRole","RolePermission","Role","Permission","Client","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Review Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other" } })).id;
  const u = async (n: string, o = org) => (await db.user.create({ data: { organizationId: o, email: `${n}@rv.test`, name: n, passwordHash: "x" } })).id;
  [pm, designer, approver, outsider] = [await u("naghma"), await u("sana"), await u("finance"), await u("outsider")];
  const perm = await db.permission.create({ data: { key: "commissions.approve", description: "x" } });
  const role = await db.role.create({ data: { organizationId: org, key: "FIN", name: "Finance" } });
  await db.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
  await db.userRole.create({ data: { userId: approver, roleId: role.id } });
  client = (await db.client.create({ data: { organizationId: org, name: "HB Elan", currency: "PKR", phone: "+923336177901", projectManagerId: pm } })).id;
  quiet = (await db.client.create({ data: { organizationId: org, name: "Quiet Co", email: "owner@quiet.test", currency: "PKR", projectManagerId: pm } })).id;
  idle = (await db.client.create({ data: { organizationId: org, name: "Idle Co", currency: "PKR" } })).id;
  otherClient = (await db.client.create({ data: { organizationId: other, name: "Elsewhere", currency: "PKR" } })).id;
  const project = await db.project.create({ data: { organizationId: org, number: "P-1", name: "HB Elan social", clientId: client, managerId: pm } });
  await db.projectMember.create({ data: { projectId: project.id, userId: designer } });
  await createEngagement(db, { organizationId: org, clientId: client, actorId: pm, kind: "RETAINER", name: "Social and ads", amount: "75000", interval: "MONTHLY", startDate: "2026-11-13", quotas: [] });
  await db.engagement.updateMany({ where: { clientId: client }, data: { endDate: "2027-02-12" } }); // the 3-month term
  await createEngagement(db, { organizationId: org, clientId: quiet, actorId: pm, kind: "RETAINER", name: "Quiet retainer", amount: "30000", interval: "QUARTERLY", startDate: "2026-10-01", quotas: [] });
  portalUser = (await db.user.create({ data: { organizationId: org, name: "Babar", passwordHash: "x", userType: "CLIENT", clientId: client } })).id;
});
afterAll(async () => { await db.$disconnect(); });

describe("weekly review forms", () => {
  it("knows last week and labels it", () => {
    expect(lastWeekStart("2026-11-16")).toBe("2026-11-09");
    expect(lastWeekStart("2026-11-22")).toBe("2026-11-09");
    expect(weekLabel("2026-11-09")).toBe("9 to 15 Nov 2026");
    expect(weekLabel("2026-11-30")).toBe("30 Nov to 6 Dec 2026");
  });

  it("the Monday run makes one form per active service client, emails those with an email, and does nothing the second time", async () => {
    const r = await sendWeeklyReviewRequests(db, { organizationId: org, today: "2026-11-23" });
    expect(r).toMatchObject({ weekStart: "2026-11-16", created: 2 });
    const rows = await db.clientReviewRequest.findMany({ where: { organizationId: org }, orderBy: { clientId: "asc" } });
    expect(rows.map((x) => x.clientId).sort()).toEqual([client, quiet].sort());
    expect(rows.find((x) => x.clientId === client)!.sentTo).toBeNull(); // no email on file: portal or a copied link instead
    expect(rows.find((x) => x.clientId === quiet)!.sentTo).toBe("owner@quiet.test");
    expect((await sendWeeklyReviewRequests(db, { organizationId: org, today: "2026-11-23" })).created).toBe(0);
  });

  it("a link works once, without signing in, saves the week's review and tells the PM, the project team and the approvers (not others)", async () => {
    const { token } = await issueReviewLink(db, { organizationId: org, clientId: client, weekStart: "2026-11-09" });
    const info = await reviewByToken(db, token);
    expect(info).toMatchObject({ clientName: "HB Elan", weekStart: "2026-11-09", projectManager: "naghma" });
    await expect(submitClientReview(db, { token, rating: 5, review: "" })).rejects.toThrow(/short comment/);
    const review = await submitClientReview(db, { token, rating: 5, review: "Lovely reels this week" });
    expect(review).toMatchObject({ source: "CLIENT_LINK", reviewerId: null, rating: 5, weekStart: "2026-11-09" });
    await expect(submitClientReview(db, { token, rating: 1, review: "Changed my mind" })).rejects.toThrow(/already reviewed/);
    expect(await reviewByToken(db, token)).toBeNull();
    const told = (await db.notification.findMany({ where: { kind: "client.review" } })).map((x) => x.userId).sort();
    expect(told).toEqual([pm, designer, approver].sort());
  });

  it("a new link replaces the old one, links expire, unknown links fail, and a reviewed week cannot get a link", async () => {
    const first = await issueReviewLink(db, { organizationId: org, clientId: client, weekStart: "2026-11-23" });
    const second = await issueReviewLink(db, { organizationId: org, clientId: client, weekStart: "2026-11-23" });
    expect(await reviewByToken(db, first.token)).toBeNull();
    expect(await reviewByToken(db, second.token)).not.toBeNull();
    await expect(submitClientReview(db, { token: second.token, rating: 5, review: "Late", now: new Date(Date.now() + 15 * 86_400_000) })).rejects.toThrow(ClientReviewError);
    await expect(submitClientReview(db, { token: "nope", rating: 5, review: "Hello there" })).rejects.toThrow(/not valid/);
    await expect(issueReviewLink(db, { organizationId: org, clientId: client, weekStart: "2026-11-09" })).rejects.toThrow(/already reviewed/);
    await expect(issueReviewLink(db, { organizationId: org, clientId: client, weekStart: "2026-11-10" })).rejects.toThrow(/Monday/);
    await expect(issueReviewLink(db, { organizationId: other, clientId: client, weekStart: "2026-11-30" })).rejects.toThrow(/not found/);
  });

  it("the client's portal user can answer an open week; another client's portal user cannot", async () => {
    const open = await openPortalReviews(db, client, new Date("2026-11-25T00:00:00Z"));
    expect(open.map((o) => o.weekStart)).toEqual(["2026-11-23", "2026-11-16"]);
    await expect(submitClientReview(db, { requestId: open[1].id, clientId: otherClient, userId: outsider, rating: 5, review: "Not mine" })).rejects.toThrow(/not valid/);
    const r = await submitClientReview(db, { requestId: open[1].id, clientId: client, userId: portalUser, rating: 4, review: "Good, a bit slow on DMs" });
    expect(r).toMatchObject({ source: "PORTAL", reviewerId: portalUser, rating: 4 });
    expect((await openPortalReviews(db, client, new Date("2026-11-25T00:00:00Z"))).map((o) => o.weekStart)).toEqual(["2026-11-23"]);
  });
});

describe("rating each part of the scope", () => {
  it("uses the client type's default list until the client gets its own, and an empty list goes back to the default", async () => {
    expect(reviewAreasFor({ reviewAreas: [], clientType: "MARKETING" })).toHaveLength(10);
    expect(reviewAreasFor({ reviewAreas: [], clientType: "SOFTWARE" })).toEqual(DEFAULT_REVIEW_AREAS.OTHER);
    expect(await setReviewAreas(db, { organizationId: org, clientId: quiet, text: "  Reels \n\nAds\nReels\n" })).toEqual(["Reels", "Ads"]);
    await expect(setReviewAreas(db, { organizationId: org, clientId: quiet, text: Array.from({ length: 16 }, (_, i) => `Area ${i}`).join("\n") })).rejects.toThrow(/15 areas/);
    await expect(setReviewAreas(db, { organizationId: other, clientId: quiet, text: "Reels" })).rejects.toThrow(/not found/);
    expect(await setReviewAreas(db, { organizationId: org, clientId: idle, text: "" })).toEqual([]);
  });

  it("reads 1 to 5 per area, 0 or empty as not this week, and refuses anything else", () => {
    expect(areaAnswers(["A", "B", "C"], ["5", "0", ""])).toEqual([{ area: "A", rating: 5 }, { area: "B", rating: null }, { area: "C", rating: null }]);
    expect(() => areaAnswers(["A"], ["7"])).toThrow(/rating for "A"/);
  });

  it("the link shows the client's areas and stores each answer with the review", async () => {
    const { token } = await issueReviewLink(db, { organizationId: org, clientId: quiet, weekStart: "2026-10-26" });
    expect((await reviewByToken(db, token))!.areas).toEqual(["Reels", "Ads"]);
    const r = await submitClientReview(db, { token, rating: 4, review: "Ads were slow", areaRatings: ["5", "2"] });
    expect(r.areas).toEqual([{ area: "Reels", rating: 5 }, { area: "Ads", rating: 2 }]);
    const hb = await issueReviewLink(db, { organizationId: org, clientId: client, weekStart: "2026-10-26" });
    expect((await reviewByToken(db, hb.token))!.areas[6]).toBe("Online store management");
  });
});

describe("project manager monthly bonus", () => {
  it("validates the setting", async () => {
    await expect(setPmBonus(db, { organizationId: org, percent: "60", minAverage: "4.5", active: true, actorId: approver })).rejects.toThrow(/between 0 and 50/);
    await expect(setPmBonus(db, { organizationId: org, percent: "4", minAverage: "6", active: true, actorId: approver })).rejects.toThrow(/from 1 to 5/);
    await expect(setPmBonus(db, { organizationId: org, percent: "4", minAverage: "0.5", active: true, actorId: approver })).rejects.toThrow(/from 1 to 5/);
  });

  it("does nothing before the 8th, while switched off, or for a month that has not ended", async () => {
    expect(await settlePmBonuses(db, { organizationId: org, today: "2026-12-05", actorId: approver })).toEqual({ month: null, earned: 0, notEarned: 0 });
    expect((await settlePmBonuses(db, { organizationId: org, today: "2026-12-09", actorId: approver })).earned).toBe(0); // no setting yet
    expect(await db.pmMonthlyBonus.count()).toBe(0);
    await expect(settlePmBonuses(db, { organizationId: org, today: "2026-11-20", actorId: approver, month: "2026-11" })).rejects.toThrow(/ended/);
  });

  it("works out the monthly fee from retainers running that month, per month", async () => {
    expect((await monthlyFee(db, { organizationId: org, clientId: client, currency: "PKR", month: "2026-11" })).toString()).toBe("75000");
    expect((await monthlyFee(db, { organizationId: org, clientId: client, currency: "PKR", month: "2027-03" })).toString()).toBe("0");
    expect((await monthlyFee(db, { organizationId: org, clientId: quiet, currency: "PKR", month: "2026-11" })).toString()).toBe("10000");
  });

  it("pays 4% of the monthly fee when the client's own reviews average 4.5 or more; staff-recorded reviews do not count", async () => {
    await setPmBonus(db, { organizationId: org, percent: "4", minAverage: "4.5", active: true, actorId: approver });
    // November for HB Elan: client reviews 5 (link) and 4 (portal) = 4.5. A staff 1-star review is ignored.
    await recordReview(db, { organizationId: org, clientId: client, weekOf: "2026-11-02", rating: 1, review: "Staff note", reviewerId: approver });
    // Quiet Co: one client review of 4 in November
    const q = await issueReviewLink(db, { organizationId: org, clientId: quiet, weekStart: "2026-11-02" });
    await submitClientReview(db, { token: q.token, rating: 4, review: "Fine" });
    const r = await settlePmBonuses(db, { organizationId: org, today: "2026-12-08", actorId: approver });
    expect(r).toEqual({ month: "2026-11", earned: 1, notEarned: 1 });
    const hb = await db.pmMonthlyBonus.findUniqueOrThrow({ where: { clientId_month: { clientId: client, month: "2026-11" } } });
    expect([hb.status, hb.reviews, hb.average.toString(), hb.amount.toString(), hb.currency]).toEqual(["EARNED", 2, "4.5", "3000", "PKR"]);
    const entry = await db.commissionEntry.findUniqueOrThrow({ where: { id: hb.entryId! } });
    expect([entry.userId, entry.kind, entry.status, entry.amount.toString(), entry.clientId]).toEqual([pm, "BONUS", "EARNED", "3000", client]);
    const qb = await db.pmMonthlyBonus.findUniqueOrThrow({ where: { clientId_month: { clientId: quiet, month: "2026-11" } } });
    expect([qb.status, qb.entryId, qb.amount.toString()]).toEqual(["NOT_EARNED", null, "0"]);
    expect(qb.reason).toMatch(/averaged 4.00, below the 4.5/);
    // Idle Co has no PM; nothing is worked out for it
    expect(await db.pmMonthlyBonus.count({ where: { clientId: idle } })).toBe(0);
    expect(await db.notification.count({ where: { userId: pm, kind: "pm.bonus" } })).toBe(2);
    expect(await db.notification.count({ where: { userId: approver, kind: "pm.bonus" } })).toBe(2);
  });

  it("works each client and month out once", async () => {
    expect(await settlePmBonuses(db, { organizationId: org, today: "2026-12-20", actorId: approver })).toEqual({ month: "2026-11", earned: 0, notEarned: 0 });
    expect(await db.commissionEntry.count({ where: { userId: pm, kind: "BONUS", note: { startsWith: "Project manager bonus" } } })).toBe(1);
  });

  it("a month with a fee but no client reviews earns nothing, with the reason", async () => {
    await settlePmBonuses(db, { organizationId: org, today: "2027-01-10", actorId: approver });
    const dec = await db.pmMonthlyBonus.findUniqueOrThrow({ where: { clientId_month: { clientId: client, month: "2026-12" } } });
    expect([dec.status, dec.reason]).toEqual(["NOT_EARNED", "The client gave no reviews for this month."]);
  });
});

describe("portal invite by contact number", () => {
  it("needs an email or a number, normalizes the number and refuses one already in use", async () => {
    await expect(createInvite(db, { organizationId: org, clientId: client, createdById: pm })).rejects.toThrow(/email or contact number/);
    await expect(createInvite(db, { organizationId: org, clientId: client, phone: "12", createdById: pm })).rejects.toThrow(LedgerError);
    await expect(createInvite(db, { organizationId: other, clientId: client, phone: "+923336177901", createdById: pm })).rejects.toThrow(/Unknown client/);
    const token = await createInvite(db, { organizationId: org, clientId: client, phone: "0333 6177901", createdById: pm });
    const inv = await db.clientInvite.findFirstOrThrow({ where: { clientId: client } });
    expect([inv.email, inv.phone]).toEqual([null, "+923336177901"]);
    const user = await acceptInvite(db, { token, name: "Muhammad Babar", password: "a-long-password" });
    expect([user.email, user.phone, user.userType, user.clientId]).toEqual([null, "+923336177901", "CLIENT", client]);
    await expect(createInvite(db, { organizationId: org, clientId: client, phone: "+923336177901", createdById: pm })).rejects.toThrow(/already exists/);
  });
});
