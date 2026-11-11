import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createDraftInvoice, issueInvoice, recordPayment } from "./accounting";
import { CommissionError, accrueCommissions, productRates, setCampaignRate, setProductRate } from "./commissions";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, agent: string, mgr: string, boss: string, bank: string, digital: string, product: string, c1: string, c2: string, sub: string;
let n = 0;
const wait = () => new Promise((r) => setTimeout(r, 25));

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "ProductCommissionRate","SubscriptionInvoice","Subscription","Prospect","SaasProduct","CampaignCommissionRate","Campaign","CommissionEntry","CommissionRule","Lead","PipelineStage","PaymentAllocation","Payment","InvoiceLine","Invoice","JournalLine","JournalEntry","NumberSequence","BankAccount","Account","Client","User","CompanyProfile","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Rate Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other" } })).id;
  const mk = (code: string, name: string, type: string, systemKey?: string) => db.account.create({ data: { organizationId: org, code, name, type, systemKey } });
  await mk("1200", "AR", "ASSET", "AR"); await mk("2100", "Advances", "LIABILITY", "CUSTOMER_ADVANCES"); await mk("2200", "Tax", "LIABILITY", "TAX_PAYABLE"); await mk("4000", "Revenue", "REVENUE", "REVENUE_SERVICE");
  const cash = await mk("1100", "Bank USD", "ASSET");
  bank = (await db.bankAccount.create({ data: { organizationId: org, internalName: "USD", bankName: "B", accountHolder: "H", accountNumber: "1", currency: "USD", isDefault: true, ledgerAccountId: cash.id } })).id;
  boss = (await db.user.create({ data: { organizationId: org, email: "b@r.test", name: "Bea Boss", passwordHash: "x" } })).id;
  mgr = (await db.user.create({ data: { organizationId: org, email: "m@r.test", name: "Max Manager", passwordHash: "x" } })).id;
  agent = (await db.user.create({ data: { organizationId: org, email: "a@r.test", name: "Ann Agent", passwordHash: "x", managerId: mgr } })).id;
  digital = (await db.campaign.create({ data: { organizationId: org, name: "Digital Marketing" } })).id;
  product = (await db.saasProduct.create({ data: { organizationId: org, code: "AGENTIFY", name: "Agentify ERP", businessLabel: "Real estate agency" } })).id;
  c1 = (await db.client.create({ data: { organizationId: org, name: "Subscriber", currency: "USD" } })).id;
  c2 = (await db.client.create({ data: { organizationId: org, name: "Other product-less", currency: "USD" } })).id;
  const stage = await db.pipelineStage.create({ data: { organizationId: org, name: "Won", sortOrder: 1, isWon: true } });
  const l1 = await db.lead.create({ data: { organizationId: org, stageId: stage.id, name: "L1", assignedToId: agent, clientId: c1, campaignId: digital, convertedAt: new Date() } });
  await db.lead.create({ data: { organizationId: org, stageId: stage.id, name: "L2", assignedToId: agent, clientId: c2, campaignId: digital, convertedAt: new Date() } });
  await db.prospect.create({ data: { organizationId: org, placeId: "manual:1", name: "Subscriber Realty", productId: product, leadId: l1.id } });
  sub = (await db.subscription.create({ data: { organizationId: org, clientId: c1, name: "Agentify monthly", currency: "USD", amount: "100", startDate: "2026-11-01" } })).id;
});
afterAll(async () => { await db.$disconnect(); });

async function payInvoice(clientId: string, subtotal: string, periodStart?: string) {
  const d = await createDraftInvoice(db, { organizationId: org, clientId, currency: "USD", taxRate: "0", createdById: boss, lines: [{ description: "Work", quantity: "1", unitPrice: subtotal }] });
  const inv = await issueInvoice(db, { organizationId: org, invoiceId: d.id, actorId: boss });
  if (periodStart) await db.subscriptionInvoice.create({ data: { subscriptionId: sub, periodStart, invoiceId: inv.id } });
  await recordPayment(db, { organizationId: org, actorId: boss, clientId, bankAccountId: bank, amount: subtotal, date: new Date(), method: "BANK_TRANSFER", idempotencyKey: `pr-${++n}`, invoiceIds: [inv.id] });
}
const last = (clientId: string, role: string) => db.commissionEntry.findFirstOrThrow({ where: { clientId, role }, orderBy: { createdAt: "desc" } });

describe("product commission rates", () => {
  it("validates and keeps organizations apart", async () => {
    await expect(setProductRate(db, { organizationId: org, productId: product, role: "CEO", ratePercent: "5", active: true, actorId: boss })).rejects.toThrow(CommissionError);
    await expect(setProductRate(db, { organizationId: org, productId: product, role: "SALES_AGENT", ratePercent: "60", active: true, actorId: boss })).rejects.toThrow(/between 0 and 50/);
    await expect(setProductRate(db, { organizationId: other, productId: product, role: "SALES_AGENT", ratePercent: "5", active: true, actorId: boss })).rejects.toThrow(/product/);
  });

  it("pays the product rate on the first subscription invoice only, never on renewals", async () => {
    await setCampaignRate(db, { organizationId: org, campaignId: digital, role: "SALES_AGENT", ratePercent: "3", active: true, actorId: boss });
    await setProductRate(db, { organizationId: org, productId: product, role: "SALES_AGENT", ratePercent: "10", active: true, actorId: boss });
    await setProductRate(db, { organizationId: org, productId: product, role: "SALES_MANAGER", ratePercent: "2", active: true, actorId: boss });
    expect([...(await productRates(db, org)).entries()]).toEqual([[product, { agent: "10", manager: "2" }]]);
    await wait(); await payInvoice(c1, "1000", "2026-11-01");
    await accrueCommissions(db, { organizationId: org, actorId: boss });
    await accrueCommissions(db, { organizationId: org, actorId: boss });
    expect((await last(c1, "SALES_AGENT")).amount.toString()).toBe("100");
    expect((await last(c1, "SALES_MANAGER")).amount.toString()).toBe("20");
    expect(await db.commissionEntry.count({ where: { clientId: c1 } })).toBe(2);
    // the renewal falls back to the campaign rate for the agent, and the manager gets nothing (no campaign manager rate)
    await wait(); await payInvoice(c1, "1000", "2026-12-01");
    await accrueCommissions(db, { organizationId: org, actorId: boss });
    expect((await last(c1, "SALES_AGENT")).amount.toString()).toBe("30");
    expect(await db.commissionEntry.count({ where: { clientId: c1, role: "SALES_MANAGER" } })).toBe(1);
  });

  it("does not apply to one-off invoices or to clients whose lead has no product", async () => {
    await wait(); await payInvoice(c1, "1000");
    await wait(); await payInvoice(c2, "1000");
    await accrueCommissions(db, { organizationId: org, actorId: boss });
    expect((await last(c1, "SALES_AGENT")).amount.toString()).toBe("30");
    expect((await last(c2, "SALES_AGENT")).amount.toString()).toBe("30");
  });

  it("a changed product rate only affects later payments", async () => {
    await wait(); await setProductRate(db, { organizationId: org, productId: product, role: "SALES_AGENT", ratePercent: "20", active: true, actorId: boss });
    const sub2 = await db.subscription.create({ data: { organizationId: org, clientId: c1, name: "Second", currency: "USD", amount: "100", startDate: "2026-11-02" } });
    sub = sub2.id;
    expect((await accrueCommissions(db, { organizationId: org, actorId: boss })).created).toBe(0);
    await wait(); await payInvoice(c1, "100", "2026-11-02");
    await accrueCommissions(db, { organizationId: org, actorId: boss });
    expect((await last(c1, "SALES_AGENT")).amount.toString()).toBe("20");
  });
});
