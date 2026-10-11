import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { CatalogError, addFeature, archiveCategory, createCategory, createPlan, removeFeature, removePlanPrice, resolvePlanLines, setPlanPrice, updatePlan } from "./catalog";
import { createQuote } from "./sales";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, client: string, cat: string, plan: string;

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "QuoteLine","Quote","PlanFeature","PlanPrice","ServicePlan","ServiceCategory","NumberSequence","Client","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Cat Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other" } })).id;
  client = (await db.client.create({ data: { organizationId: org, name: "Acme", currency: "USD" } })).id;
  cat = (await createCategory(db, { organizationId: org, name: "Social" })).id;
  plan = (await createPlan(db, { organizationId: org, categoryId: cat, name: "Growth", billingInterval: "MONTHLY" })).id;
});
afterAll(async () => { await db.$disconnect(); });

describe("catalog editing", () => {
  it("validates categories, brings archived ones back, keeps organizations apart", async () => {
    await expect(createCategory(db, { organizationId: org, name: " " })).rejects.toThrow(CatalogError);
    await expect(createCategory(db, { organizationId: org, name: "Social" })).rejects.toThrow(/already exists/);
    const c = await createCategory(db, { organizationId: org, name: "Video" });
    await archiveCategory(db, { organizationId: org, categoryId: c.id, active: false });
    expect((await createCategory(db, { organizationId: org, name: "Video" })).id).toBe(c.id);
    await expect(archiveCategory(db, { organizationId: other, categoryId: c.id, active: false })).rejects.toThrow(CatalogError);
    expect((await createCategory(db, { organizationId: other, name: "Social" })).organizationId).toBe(other);
  });

  it("validates plans and refuses inactive or foreign categories", async () => {
    await expect(createPlan(db, { organizationId: org, categoryId: cat, name: "", billingInterval: "MONTHLY" })).rejects.toThrow(CatalogError);
    await expect(createPlan(db, { organizationId: org, categoryId: cat, name: "X", billingInterval: "DAILY" })).rejects.toThrow(CatalogError);
    await expect(createPlan(db, { organizationId: other, categoryId: cat, name: "X", billingInterval: "MONTHLY" })).rejects.toThrow(/active category/);
  });

  it("every change bumps the plan version", async () => {
    const v = async () => (await db.servicePlan.findUniqueOrThrow({ where: { id: plan } })).version;
    const v0 = await v();
    await setPlanPrice(db, { organizationId: org, planId: plan, currency: "USD", amount: "500", setupFee: "100" });
    await addFeature(db, { organizationId: org, planId: plan, text: "12 posts a month" });
    await updatePlan(db, { organizationId: org, planId: plan, name: "Growth", billingInterval: "MONTHLY", isPopular: true, isPublic: true, active: true });
    expect(await v()).toBe(v0 + 3);
    const f = await db.planFeature.findFirstOrThrow({ where: { planId: plan } });
    await removeFeature(db, { organizationId: org, planId: plan, featureId: f.id });
    expect(await v()).toBe(v0 + 4);
    await removeFeature(db, { organizationId: org, planId: plan, featureId: f.id }); // already gone: no bump
    expect(await v()).toBe(v0 + 4);
  });

  it("validates prices and rejects other organizations", async () => {
    await expect(setPlanPrice(db, { organizationId: org, planId: plan, currency: "USD", amount: "0" })).rejects.toThrow(CatalogError);
    await expect(setPlanPrice(db, { organizationId: org, planId: plan, currency: "EUR", amount: "5" })).rejects.toThrow(CatalogError);
    await expect(setPlanPrice(db, { organizationId: org, planId: plan, currency: "USD", amount: "5", setupFee: "x" })).rejects.toThrow(CatalogError);
    await expect(setPlanPrice(db, { organizationId: other, planId: plan, currency: "USD", amount: "5" })).rejects.toThrow(/not found/);
    await expect(updatePlan(db, { organizationId: other, planId: plan, name: "Hack", billingInterval: "MONTHLY" })).rejects.toThrow(/not found/);
  });
});

describe("quotes from catalog plans", () => {
  it("fills in the plan price in the quote currency and adds a setup-fee line", async () => {
    const lines = await resolvePlanLines(db, { organizationId: org, currency: "USD", lines: [{ planId: plan, description: "", quantity: "", unitPrice: "" }] });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ description: "Growth", quantity: "1", unitPrice: "500", planId: plan });
    expect(lines[1]).toMatchObject({ description: "Setup fee: Growth", unitPrice: "100" });
    const q = await createQuote(db, { organizationId: org, clientId: client, currency: "USD", taxRate: "0", createdById: "u", lines });
    expect(q.total.toString()).toBe("600");
    const stored = await db.quoteLine.findMany({ where: { quoteId: q.id } });
    expect(stored.every((l) => l.planId === plan && l.planVersion !== null)).toBe(true);
  });

  it("refuses a plan with no price in that currency instead of converting", async () => {
    await expect(resolvePlanLines(db, { organizationId: org, currency: "PKR", lines: [{ planId: plan, description: "", quantity: "", unitPrice: "" }] })).rejects.toThrow(/no PKR price/);
    await setPlanPrice(db, { organizationId: org, planId: plan, currency: "PKR", amount: "140000" });
    await removePlanPrice(db, { organizationId: org, planId: plan, currency: "PKR" });
    await expect(resolvePlanLines(db, { organizationId: org, currency: "PKR", lines: [{ planId: plan, description: "", quantity: "", unitPrice: "" }] })).rejects.toThrow(/no PKR price/);
  });

  it("lets a typed price and quantity override the plan, and passes custom lines through", async () => {
    const lines = await resolvePlanLines(db, { organizationId: org, currency: "USD", lines: [
      { planId: plan, description: "Growth (3 brands)", quantity: "3", unitPrice: "450" },
      { description: "Custom work", quantity: "1", unitPrice: "75" },
    ] });
    expect(lines[0]).toMatchObject({ description: "Growth (3 brands)", quantity: "3", unitPrice: "450" });
    expect(lines.at(-1)).toMatchObject({ description: "Custom work", unitPrice: "75" });
    expect(lines.at(-1)?.planId).toBeUndefined();
  });

  it("refuses archived plans and plans from another organization", async () => {
    const p2 = (await createPlan(db, { organizationId: org, categoryId: cat, name: "Old", billingInterval: "MONTHLY" })).id;
    await setPlanPrice(db, { organizationId: org, planId: p2, currency: "USD", amount: "10" });
    await updatePlan(db, { organizationId: org, planId: p2, name: "Old", billingInterval: "MONTHLY", active: false });
    await expect(resolvePlanLines(db, { organizationId: org, currency: "USD", lines: [{ planId: p2, description: "", quantity: "", unitPrice: "" }] })).rejects.toThrow(/no longer available/);
    await expect(resolvePlanLines(db, { organizationId: other, currency: "USD", lines: [{ planId: plan, description: "", quantity: "", unitPrice: "" }] })).rejects.toThrow(/no longer available/);
  });
});
