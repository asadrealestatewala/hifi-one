import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { EngagementError, createEngagement, logUsage, quotaSummary, recurringRevenue, setClientType, setEngagementStatus, setPlanQuota, setProjectManager, voidUsage } from "./engagements";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, client: string, usd: string, pm: string, plan: string, otherClient: string;
const today = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "QuotaUsage","EngagementQuota","Engagement","PlanQuota","PlanPrice","ServicePlan","ServiceCategory","Client","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Eng Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other Org" } })).id;
  client = (await db.client.create({ data: { organizationId: org, name: "Acme", currency: "USD" } })).id;
  usd = (await db.client.create({ data: { organizationId: org, name: "Beta", currency: "GBP" } })).id;
  otherClient = (await db.client.create({ data: { organizationId: other, name: "Zed", currency: "USD" } })).id;
  pm = (await db.user.create({ data: { organizationId: org, name: "Pia PM", email: "pia@x.test", userType: "EMPLOYEE", passwordHash: "x" } })).id;
  const cat = await db.serviceCategory.create({ data: { organizationId: org, name: "Digital" } });
  plan = (await db.servicePlan.create({ data: { organizationId: org, categoryId: cat.id, name: "Growth", billingInterval: "MONTHLY", prices: { create: [{ currency: "USD", amount: "1500" }] } } })).id;
});
afterAll(async () => { await db.$disconnect(); });

describe("client type and project manager", () => {
  it("sets the type, validates it, and keeps organizations apart", async () => {
    await setClientType(db, { organizationId: org, clientId: client, clientType: "SAAS" });
    expect((await db.client.findUniqueOrThrow({ where: { id: client } })).clientType).toBe("SAAS");
    await expect(setClientType(db, { organizationId: org, clientId: client, clientType: "NOPE" })).rejects.toThrow(EngagementError);
    await expect(setClientType(db, { organizationId: org, clientId: otherClient, clientType: "SAAS" })).rejects.toThrow(/not found/);
  });
  it("allocates only an active employee of the same organization", async () => {
    await setProjectManager(db, { organizationId: org, clientId: client, userId: pm });
    expect((await db.client.findUniqueOrThrow({ where: { id: client } })).projectManagerId).toBe(pm);
    await expect(setProjectManager(db, { organizationId: other, clientId: otherClient, userId: pm })).rejects.toThrow(/active staff/);
    await setProjectManager(db, { organizationId: org, clientId: client, userId: null });
  });
});

describe("plan quotas and retainers", () => {
  it("builds a retainer from a plan with its quotas and price", async () => {
    await setPlanQuota(db, { organizationId: org, planId: plan, key: "REEL", quantity: 8 });
    await setPlanQuota(db, { organizationId: org, planId: plan, key: "AD_CAMPAIGN_META", quantity: 2 });
    await expect(setPlanQuota(db, { organizationId: org, planId: plan, key: "FAX", quantity: 1 })).rejects.toThrow(EngagementError);
    await expect(setPlanQuota(db, { organizationId: other, planId: plan, key: "REEL", quantity: 1 })).rejects.toThrow(/not found/);
    const e = await createEngagement(db, { organizationId: org, clientId: client, actorId: pm, kind: "RETAINER", planId: plan, startDate: today });
    expect(e.amount.toString()).toBe("1500");
    expect(e.currency).toBe("USD");
    const q = await db.engagementQuota.findMany({ where: { engagementId: e.id } });
    expect(q.map((x) => `${x.key}:${x.quantity}:${x.period}`).sort()).toEqual(["AD_CAMPAIGN_META:2:MONTH", "REEL:8:MONTH"]);
    await setPlanQuota(db, { organizationId: org, planId: plan, key: "REEL", quantity: 12 }); // later plan changes do not rewrite what the client bought
    expect((await db.engagementQuota.findFirstOrThrow({ where: { engagementId: e.id, key: "REEL" } })).quantity).toBe(8);
  });
  it("needs a price when the plan has none in the client's currency", async () => {
    await expect(createEngagement(db, { organizationId: org, clientId: usd, actorId: pm, kind: "RETAINER", planId: plan, startDate: today })).rejects.toThrow(/no price in GBP/);
    const e = await createEngagement(db, { organizationId: org, clientId: usd, actorId: pm, kind: "RETAINER", planId: plan, amount: "900", interval: "QUARTERLY", startDate: today });
    expect(e.amount.toString()).toBe("900");
  });
  it("refuses a client from another organization", async () => {
    await expect(createEngagement(db, { organizationId: org, clientId: otherClient, actorId: pm, kind: "RETAINER", name: "X", amount: "10", startDate: today })).rejects.toThrow(/not found/);
  });
});

describe("single service orders", () => {
  it("prices quantity times unit, is one-time, and has a total quota", async () => {
    const e = await createEngagement(db, { organizationId: org, clientId: client, actorId: pm, kind: "SINGLE_SERVICE", serviceKey: "AD_CAMPAIGN_GOOGLE", quantity: 2, unitPrice: "250.50", startDate: today });
    expect(e.amount.toString()).toBe("501");
    expect(e.interval).toBe("ONE_TIME");
    expect(e.name).toBe("2 × Ad campaigns: Google");
    await expect(createEngagement(db, { organizationId: org, clientId: client, actorId: pm, kind: "SINGLE_SERVICE", serviceKey: "AD_CAMPAIGN_GOOGLE", quantity: 0, unitPrice: "1", startDate: today })).rejects.toThrow(/how many/);
    await expect(createEngagement(db, { organizationId: org, clientId: client, actorId: pm, kind: "SINGLE_SERVICE", serviceKey: "AD_CAMPAIGN_GOOGLE", quantity: 1, unitPrice: "-5", startDate: today })).rejects.toThrow(/price/);
  });
});

describe("quota usage", () => {
  it("counts a month for retainers, flags overage, ignores voided rows, and a different month does not count", async () => {
    const e = await db.engagement.findFirstOrThrow({ where: { clientId: client, kind: "RETAINER" } });
    await logUsage(db, { organizationId: org, engagementId: e.id, key: "AD_CAMPAIGN_META", quantity: 2, actorId: pm });
    const extra = await logUsage(db, { organizationId: org, engagementId: e.id, key: "AD_CAMPAIGN_META", quantity: 1, actorId: pm });
    await logUsage(db, { organizationId: org, engagementId: e.id, key: "AD_CAMPAIGN_META", quantity: 5, period: "2020-01", actorId: pm });
    let line = (await quotaSummary(db, org, e.id)).find((l) => l.key === "AD_CAMPAIGN_META")!;
    expect(line).toMatchObject({ limit: 2, used: 3, remaining: 0, over: 1 });
    await voidUsage(db, { organizationId: org, usageId: extra.id });
    line = (await quotaSummary(db, org, e.id)).find((l) => l.key === "AD_CAMPAIGN_META")!;
    expect(line).toMatchObject({ used: 2, over: 0 });
    await expect(voidUsage(db, { organizationId: other, usageId: extra.id })).rejects.toThrow(/not found/);
  });
  it("refuses a service outside the engagement, bad numbers, another organization, and inactive engagements", async () => {
    const e = await db.engagement.findFirstOrThrow({ where: { clientId: client, kind: "RETAINER" } });
    await expect(logUsage(db, { organizationId: org, engagementId: e.id, key: "SEO_BLOG", quantity: 1, actorId: pm })).rejects.toThrow(/not part/);
    await expect(logUsage(db, { organizationId: org, engagementId: e.id, key: "REEL", quantity: 0, actorId: pm })).rejects.toThrow(/whole number/);
    await expect(logUsage(db, { organizationId: other, engagementId: e.id, key: "REEL", quantity: 1, actorId: pm })).rejects.toThrow(/not found/);
    await setEngagementStatus(db, { organizationId: org, engagementId: e.id, status: "PAUSED" });
    await expect(logUsage(db, { organizationId: org, engagementId: e.id, key: "REEL", quantity: 1, actorId: pm })).rejects.toThrow(/active/);
    await setEngagementStatus(db, { organizationId: org, engagementId: e.id, status: "ACTIVE" });
  });
  it("counts a single-service order across all months", async () => {
    const e = await db.engagement.findFirstOrThrow({ where: { clientId: client, kind: "SINGLE_SERVICE" } });
    await logUsage(db, { organizationId: org, engagementId: e.id, key: "AD_CAMPAIGN_GOOGLE", quantity: 1, period: "2020-01", actorId: pm });
    expect((await quotaSummary(db, org, e.id))[0]).toMatchObject({ limit: 2, used: 1, remaining: 1 });
  });
});

describe("MRR and ARR", () => {
  it("counts only active recurring engagements, per currency, and excludes one-time orders", async () => {
    // USD: retainer 1500 monthly. GBP: 900 quarterly. One-time 501 USD must not count.
    const r = await recurringRevenue(db, org);
    expect(r).toEqual([{ currency: "GBP", mrr: "300", arr: "3600", engagements: 1 }, { currency: "USD", mrr: "1500", arr: "18000", engagements: 1 }]);
    const e = await db.engagement.findFirstOrThrow({ where: { clientId: client, kind: "RETAINER" } });
    await setEngagementStatus(db, { organizationId: org, engagementId: e.id, status: "PAUSED" });
    expect((await recurringRevenue(db, org)).map((x) => x.currency)).toEqual(["GBP"]);
    await setEngagementStatus(db, { organizationId: org, engagementId: e.id, status: "ENDED", endDate: "2020-01-01" });
    expect((await db.engagement.findUniqueOrThrow({ where: { id: e.id } })).endDate).toBe("2020-01-01");
    expect(await recurringRevenue(db, other)).toEqual([]);
  });
});
