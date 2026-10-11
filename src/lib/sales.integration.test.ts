import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  SalesError, addMonths, cancelQuote, convertQuoteToInvoice, createContract, createQuote, createSubscription, decideQuote, expireContracts, expireQuotes,
  generateDueInvoices, periodStart, sendQuote, setContractStatus, setSubscriptionStatus,
} from "./sales";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, otherOrg: string, client: string, client2: string;
const actor = "actor-1";
const lines = [{ description: "Work", quantity: "2", unitPrice: "500" }];

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "SubscriptionInvoice","Subscription","QuoteLine","Quote","Contract","InvoiceLine","Invoice","NumberSequence","Client","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Sales Org" } })).id;
  otherOrg = (await db.organization.create({ data: { name: "Other" } })).id;
  client = (await db.client.create({ data: { organizationId: org, name: "Acme", currency: "USD" } })).id;
  client2 = (await db.client.create({ data: { organizationId: org, name: "Beta", currency: "USD" } })).id;
});
afterAll(async () => { await db.$disconnect(); });

const mkQuote = (over: Partial<Parameters<typeof createQuote>[1]> = {}) =>
  createQuote(db, { organizationId: org, clientId: client, currency: "USD", taxRate: "10", createdById: actor, lines, ...over });

describe("dates", () => {
  it("adds months without drifting off the end of short months", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(periodStart("2026-01-31", "MONTHLY", 2)).toBe("2026-03-31");
    expect(periodStart("2026-01-31", "MONTHLY", 13)).toBe("2027-02-28");
    expect(periodStart("2026-11-15", "QUARTERLY", 1)).toBe("2027-02-15");
    expect(periodStart("2024-02-29", "ANNUAL", 1)).toBe("2025-02-28");
  });
});

describe("quotes", () => {
  it("computes totals exactly and numbers quotes in sequence", async () => {
    const a = await mkQuote();
    const b = await mkQuote();
    expect(a.total.toString()).toBe("1100");
    expect(a.taxAmount.toString()).toBe("100");
    expect(a.number).toMatch(/^QT-\d{6}$/);
    expect(b.number).not.toBe(a.number);
    expect(a.status).toBe("DRAFT");
  });

  it("rejects bad input", async () => {
    await expect(mkQuote({ lines: [] })).rejects.toThrow(SalesError);
    await expect(mkQuote({ lines: [{ description: "", quantity: "1", unitPrice: "5" }] })).rejects.toThrow(SalesError);
    await expect(mkQuote({ lines: [{ description: "x", quantity: "0", unitPrice: "5" }] })).rejects.toThrow(/greater than zero/);
    await expect(mkQuote({ lines: [{ description: "x", quantity: "1", unitPrice: "0" }] })).rejects.toThrow(/total/);
    await expect(mkQuote({ validUntil: "soon" })).rejects.toThrow(SalesError);
    await expect(mkQuote({ currency: "EUR" })).rejects.toThrow(SalesError);
    await expect(mkQuote({ clientId: "nope" })).rejects.toThrow(/Unknown client/);
  });

  it("goes draft -> sent -> accepted -> invoiced and creates a draft invoice with the same figures", async () => {
    const q = await mkQuote({ notes: "Hello" });
    await sendQuote(db, { organizationId: org, quoteId: q.id });
    await decideQuote(db, { organizationId: org, quoteId: q.id, decision: "ACCEPT", byUserId: "cu", via: "PORTAL", clientId: client, today: "2026-10-11" });
    const r = await convertQuoteToInvoice(db, { organizationId: org, quoteId: q.id, actorId: actor });
    expect(r.already).toBe(false);
    const inv = await db.invoice.findUniqueOrThrow({ where: { id: r.invoiceId }, include: { lines: true } });
    expect(inv.status).toBe("DRAFT");
    expect(inv.total.toString()).toBe("1100");
    expect(inv.lines).toHaveLength(1);
    expect(inv.notes).toContain(q.number);
    const after = await db.quote.findUniqueOrThrow({ where: { id: q.id } });
    expect(after.status).toBe("INVOICED");
    expect(after.decidedVia).toBe("PORTAL");
  });

  it("converting twice, even at the same time, creates exactly one invoice", async () => {
    const q = await mkQuote();
    await sendQuote(db, { organizationId: org, quoteId: q.id });
    await decideQuote(db, { organizationId: org, quoteId: q.id, decision: "ACCEPT", byUserId: "u", via: "STAFF", today: "2026-10-11" });
    const before = await db.invoice.count({ where: { organizationId: org } });
    const rs = await Promise.all([1, 2, 3].map(() => convertQuoteToInvoice(db, { organizationId: org, quoteId: q.id, actorId: actor })));
    expect(new Set(rs.map((r) => r.invoiceId)).size).toBe(1);
    expect(await db.invoice.count({ where: { organizationId: org } })).toBe(before + 1);
  });

  it("only an accepted quote converts", async () => {
    const q = await mkQuote();
    await expect(convertQuoteToInvoice(db, { organizationId: org, quoteId: q.id, actorId: actor })).rejects.toThrow(/accepted/);
    await sendQuote(db, { organizationId: org, quoteId: q.id });
    await expect(convertQuoteToInvoice(db, { organizationId: org, quoteId: q.id, actorId: actor })).rejects.toThrow(/accepted/);
  });

  it("a decision can be made once; the first one wins under concurrency", async () => {
    const q = await mkQuote();
    await sendQuote(db, { organizationId: org, quoteId: q.id });
    const rs = await Promise.allSettled([
      decideQuote(db, { organizationId: org, quoteId: q.id, decision: "ACCEPT", byUserId: "a", via: "PORTAL", clientId: client, today: "2026-10-11" }),
      decideQuote(db, { organizationId: org, quoteId: q.id, decision: "DECLINE", byUserId: "a", via: "PORTAL", clientId: client, today: "2026-10-11" }),
    ]);
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(["ACCEPTED", "DECLINED"]).toContain((await db.quote.findUniqueOrThrow({ where: { id: q.id } })).status);
  });

  it("another client cannot decide a quote; drafts cannot be decided", async () => {
    const q = await mkQuote();
    await expect(decideQuote(db, { organizationId: org, quoteId: q.id, decision: "ACCEPT", byUserId: "x", via: "PORTAL", clientId: client, today: "2026-10-11" })).rejects.toThrow(/draft/);
    await sendQuote(db, { organizationId: org, quoteId: q.id });
    await expect(decideQuote(db, { organizationId: org, quoteId: q.id, decision: "ACCEPT", byUserId: "x", via: "PORTAL", clientId: client2, today: "2026-10-11" })).rejects.toThrow(/not found/);
    await expect(sendQuote(db, { organizationId: otherOrg, quoteId: q.id })).rejects.toThrow(/not found/);
  });

  it("an expired quote cannot be accepted", async () => {
    const q = await mkQuote({ validUntil: "2026-10-01" });
    await sendQuote(db, { organizationId: org, quoteId: q.id });
    await expect(decideQuote(db, { organizationId: org, quoteId: q.id, decision: "ACCEPT", byUserId: "x", via: "PORTAL", clientId: client, today: "2026-10-11" })).rejects.toThrow(/expired/);
    expect((await db.quote.findUniqueOrThrow({ where: { id: q.id } })).status).toBe("EXPIRED");
    expect(await expireQuotes(db, org, "2026-10-11")).toBe(0);
  });

  it("an invoiced or cancelled quote cannot be cancelled again", async () => {
    const q = await mkQuote();
    await cancelQuote(db, { organizationId: org, quoteId: q.id });
    await expect(cancelQuote(db, { organizationId: org, quoteId: q.id })).rejects.toThrow(/cancelled/);
    await expect(sendQuote(db, { organizationId: org, quoteId: q.id })).rejects.toThrow(SalesError);
  });
});

describe("subscriptions", () => {
  const mk = (over: Partial<Parameters<typeof createSubscription>[1]> = {}) =>
    createSubscription(db, { organizationId: org, clientId: client, name: "Hosting", currency: "USD", amount: "100", taxRate: "0", interval: "MONTHLY", startDate: "2026-01-31", createdById: actor, ...over });

  it("validates input", async () => {
    await expect(mk({ amount: "0" })).rejects.toThrow(SalesError);
    await expect(mk({ interval: "WEEKLY" })).rejects.toThrow(SalesError);
    await expect(mk({ endDate: "2025-01-01" })).rejects.toThrow(SalesError);
    await expect(mk({ startDate: "tomorrow" })).rejects.toThrow(SalesError);
  });

  it("creates one draft invoice per due period and running again creates nothing", async () => {
    const s = await mk({ name: "Monthly plan" });
    const run1 = await generateDueInvoices(db, { organizationId: org, today: "2026-03-15", actorId: actor });
    const mine = run1.filter((r) => r.subscriptionId === s.id);
    expect(mine.map((r) => r.periodStart)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"].slice(0, 2));
    const run2 = await generateDueInvoices(db, { organizationId: org, today: "2026-03-15", actorId: actor });
    expect(run2.filter((r) => r.subscriptionId === s.id)).toHaveLength(0);
    const inv = await db.invoice.findUniqueOrThrow({ where: { id: mine[0].invoiceId }, include: { lines: true } });
    expect(inv.status).toBe("DRAFT");
    expect(inv.total.toString()).toBe("100");
    expect(inv.lines[0].description).toContain("Monthly plan (2026-01-31 to 2026-02-27)");
    expect((await db.subscription.findUniqueOrThrow({ where: { id: s.id } })).nextBillingDate).toBe("2026-03-31");
  });

  it("concurrent runs never double-bill a period", async () => {
    const s = await mk({ name: "Race", startDate: "2026-06-01" });
    await Promise.all([1, 2, 3, 4].map(() => generateDueInvoices(db, { organizationId: org, today: "2026-06-02", actorId: actor })));
    expect(await db.subscriptionInvoice.count({ where: { subscriptionId: s.id } })).toBe(1);
  });

  it("ends after the end date", async () => {
    const s = await mk({ name: "Short", startDate: "2026-07-01", endDate: "2026-08-31" });
    await generateDueInvoices(db, { organizationId: org, today: "2026-12-01", actorId: actor });
    const after = await db.subscription.findUniqueOrThrow({ where: { id: s.id } });
    expect(await db.subscriptionInvoice.count({ where: { subscriptionId: s.id } })).toBe(2);
    expect(after.status).toBe("ENDED");
    expect(after.nextBillingDate).toBeNull();
  });

  it("paused subscriptions are not billed, and resuming skips the missed periods", async () => {
    const s = await mk({ name: "Pausable", startDate: "2026-09-01" });
    await setSubscriptionStatus(db, { organizationId: org, subscriptionId: s.id, action: "PAUSE", today: "2026-09-10" });
    await generateDueInvoices(db, { organizationId: org, today: "2026-12-10", actorId: actor });
    expect(await db.subscriptionInvoice.count({ where: { subscriptionId: s.id } })).toBe(0);
    await setSubscriptionStatus(db, { organizationId: org, subscriptionId: s.id, action: "RESUME", today: "2026-12-10" });
    const r = await db.subscription.findUniqueOrThrow({ where: { id: s.id } });
    expect(r.status).toBe("ACTIVE");
    expect(r.nextBillingDate).toBe("2027-01-01");
    await expect(setSubscriptionStatus(db, { organizationId: org, subscriptionId: s.id, action: "RESUME", today: "2026-12-10" })).rejects.toThrow(SalesError);
  });

  it("a cancelled subscription is never billed", async () => {
    const s = await mk({ name: "Cancelled", startDate: "2026-05-01" });
    await setSubscriptionStatus(db, { organizationId: org, subscriptionId: s.id, action: "CANCEL", today: "2026-05-02" });
    await generateDueInvoices(db, { organizationId: org, today: "2026-12-10", actorId: actor });
    expect(await db.subscriptionInvoice.count({ where: { subscriptionId: s.id } })).toBe(0);
    await expect(setSubscriptionStatus(db, { organizationId: org, subscriptionId: s.id, action: "CANCEL", today: "2026-05-02" })).rejects.toThrow(/finished/);
  });

  it("does not bill another organization's subscriptions", async () => {
    const s = await mk({ name: "Mine", startDate: "2026-04-01" });
    const created = await generateDueInvoices(db, { organizationId: otherOrg, today: "2026-12-10", actorId: actor });
    expect(created).toHaveLength(0);
    expect(await db.subscriptionInvoice.count({ where: { subscriptionId: s.id } })).toBe(0);
  });
});

describe("contracts", () => {
  const mk = (over: Partial<Parameters<typeof createContract>[1]> = {}) => createContract(db, { organizationId: org, clientId: client, title: "MSA", createdById: actor, ...over });

  it("validates dates, notice and value", async () => {
    await expect(mk({ title: " " })).rejects.toThrow(SalesError);
    await expect(mk({ startDate: "2026-05-01", endDate: "2026-04-01" })).rejects.toThrow(SalesError);
    await expect(mk({ renewalNoticeDays: 999 })).rejects.toThrow(SalesError);
    await expect(mk({ value: "1000" })).rejects.toThrow(SalesError); // currency required
    expect((await mk({ value: "1000", currency: "USD" })).value?.toString()).toBe("1000");
  });

  it("follows the allowed status changes only", async () => {
    const c = await mk();
    await setContractStatus(db, { organizationId: org, contractId: c.id, to: "ACTIVE" });
    await expect(setContractStatus(db, { organizationId: org, contractId: c.id, to: "DRAFT" })).rejects.toThrow(SalesError);
    await setContractStatus(db, { organizationId: org, contractId: c.id, to: "TERMINATED" });
    await expect(setContractStatus(db, { organizationId: org, contractId: c.id, to: "ACTIVE" })).rejects.toThrow(SalesError);
    await expect(setContractStatus(db, { organizationId: otherOrg, contractId: c.id, to: "ACTIVE" })).rejects.toThrow(/not found/);
  });

  it("marks active contracts expired once the end date has passed", async () => {
    const c = await mk({ title: "Old", startDate: "2025-01-01", endDate: "2025-12-31" });
    await setContractStatus(db, { organizationId: org, contractId: c.id, to: "ACTIVE" });
    expect(await expireContracts(db, org, "2026-10-11")).toBeGreaterThanOrEqual(1);
    expect((await db.contract.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("EXPIRED");
  });
});
