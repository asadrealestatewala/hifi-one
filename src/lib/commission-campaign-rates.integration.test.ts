import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createDraftInvoice, issueInvoice, recordPayment } from "./accounting";
import { CommissionError, accrueCommissions, campaignRates, setCampaignRate, setRule } from "./commissions";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, agent: string, mgr: string, boss: string, bank: string, digital: string, erp: string, c1: string, c2: string;
let n = 0;
const wait = () => new Promise((r) => setTimeout(r, 25));

async function pay(clientId: string, subtotal: string) {
  const d = await createDraftInvoice(db, { organizationId: org, clientId, currency: "USD", taxRate: "0", createdById: boss, lines: [{ description: "Work", quantity: "1", unitPrice: subtotal }] });
  const inv = await issueInvoice(db, { organizationId: org, invoiceId: d.id, actorId: boss });
  await recordPayment(db, { organizationId: org, actorId: boss, clientId, bankAccountId: bank, amount: subtotal, date: new Date(), method: "BANK_TRANSFER", idempotencyKey: `cr-${++n}`, invoiceIds: [inv.id] });
}

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "CampaignCommissionRate","Campaign","CommissionEntry","CommissionRule","Lead","PipelineStage","PaymentAllocation","Payment","InvoiceLine","Invoice","JournalLine","JournalEntry","NumberSequence","BankAccount","Account","Client","User","CompanyProfile","Organization" CASCADE');
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
  erp = (await db.campaign.create({ data: { organizationId: org, name: "Agentify ERP" } })).id;
  c1 = (await db.client.create({ data: { organizationId: org, name: "Digital Client", currency: "USD" } })).id;
  c2 = (await db.client.create({ data: { organizationId: org, name: "ERP Client", currency: "USD" } })).id;
  const stage = await db.pipelineStage.create({ data: { organizationId: org, name: "Won", sortOrder: 1, isWon: true } });
  await db.lead.create({ data: { organizationId: org, stageId: stage.id, name: "L1", assignedToId: agent, clientId: c1, campaignId: digital, convertedAt: new Date() } });
  await db.lead.create({ data: { organizationId: org, stageId: stage.id, name: "L2", assignedToId: agent, clientId: c2, campaignId: erp, convertedAt: new Date() } });
});
afterAll(async () => { await db.$disconnect(); });

describe("campaign commission rates", () => {
  it("validates role, rate and campaign, and keeps organizations apart", async () => {
    await expect(setCampaignRate(db, { organizationId: org, campaignId: digital, role: "CEO", ratePercent: "3", active: true, actorId: boss })).rejects.toThrow(CommissionError);
    await expect(setCampaignRate(db, { organizationId: org, campaignId: digital, role: "SALES_AGENT", ratePercent: "60", active: true, actorId: boss })).rejects.toThrow(/between 0 and 50/);
    await expect(setCampaignRate(db, { organizationId: other, campaignId: digital, role: "SALES_AGENT", ratePercent: "3", active: true, actorId: boss })).rejects.toThrow(/campaign/);
  });

  it("shows only active rates of this organization to sales staff", async () => {
    await setCampaignRate(db, { organizationId: org, campaignId: digital, role: "SALES_AGENT", ratePercent: "3", active: true, actorId: boss });
    await setCampaignRate(db, { organizationId: org, campaignId: digital, role: "SALES_MANAGER", ratePercent: "1", active: true, actorId: boss });
    await setCampaignRate(db, { organizationId: org, campaignId: erp, role: "SALES_AGENT", ratePercent: "5", active: true, actorId: boss });
    expect(await campaignRates(db, org)).toEqual([
      { campaignId: erp, campaign: "Agentify ERP", category: null, agent: "5", manager: null },
      { campaignId: digital, campaign: "Digital Marketing", category: null, agent: "3", manager: "1" },
    ]);
    expect(await campaignRates(db, other)).toEqual([]);
    await setCampaignRate(db, { organizationId: org, campaignId: erp, role: "SALES_AGENT", ratePercent: "5", active: false, actorId: boss });
    expect((await campaignRates(db, org)).map((r) => r.campaign)).toEqual(["Digital Marketing"]);
    await setCampaignRate(db, { organizationId: org, campaignId: erp, role: "SALES_AGENT", ratePercent: "5", active: true, actorId: boss });
  });

  it("pays the agent and the manager the campaign's rates, once each, and nothing for payments before the rate", async () => {
    await wait(); await pay(c1, "1000"); // before... rates were set earlier, so this counts
    await accrueCommissions(db, { organizationId: org, actorId: boss });
    await accrueCommissions(db, { organizationId: org, actorId: boss });
    const rows = await db.commissionEntry.findMany({ where: { clientId: c1 }, orderBy: { role: "asc" } });
    expect(rows.map((r) => `${r.role}:${r.userId === agent ? "agent" : "mgr"}:${r.ratePercent}:${r.amount}:${r.campaignId === digital}`)).toEqual(["SALES_AGENT:agent:3:30:true", "SALES_MANAGER:mgr:1:10:true"]);
  });

  it("uses each campaign's own rate, and a campaign without a manager rate pays no manager", async () => {
    await wait(); await pay(c2, "2000");
    await accrueCommissions(db, { organizationId: org, actorId: boss });
    const rows = await db.commissionEntry.findMany({ where: { clientId: c2 } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: agent, role: "SALES_AGENT" });
    expect(rows[0].amount.toString()).toBe("100");
  });

  it("falls back to the personal rate when the campaign has no agent rate, and campaign rates win over it", async () => {
    await setRule(db, { organizationId: org, userId: agent, ratePercent: "20", active: true, actorId: boss });
    await setCampaignRate(db, { organizationId: org, campaignId: erp, role: "SALES_AGENT", ratePercent: "5", active: false, actorId: boss });
    await wait(); await pay(c2, "100");
    await accrueCommissions(db, { organizationId: org, actorId: boss });
    expect((await db.commissionEntry.findFirstOrThrow({ where: { clientId: c2 }, orderBy: { createdAt: "desc" } })).amount.toString()).toBe("20");
    await wait(); await pay(c1, "100");
    await accrueCommissions(db, { organizationId: org, actorId: boss });
    const latest = await db.commissionEntry.findMany({ where: { clientId: c1, role: "SALES_AGENT" }, orderBy: { createdAt: "desc" } });
    expect(latest[0].amount.toString()).toBe("3");
  });

  it("changing a campaign rate only affects later payments", async () => {
    await wait(); await setCampaignRate(db, { organizationId: org, campaignId: digital, role: "SALES_AGENT", ratePercent: "8", active: true, actorId: boss });
    const before = await db.commissionEntry.count({ where: { clientId: c1 } });
    expect((await accrueCommissions(db, { organizationId: org, actorId: boss })).created).toBe(0);
    expect(await db.commissionEntry.count({ where: { clientId: c1 } })).toBe(before);
    await wait(); await pay(c1, "100");
    await accrueCommissions(db, { organizationId: org, actorId: boss });
    expect((await db.commissionEntry.findFirstOrThrow({ where: { clientId: c1, role: "SALES_AGENT" }, orderBy: { createdAt: "desc" } })).amount.toString()).toBe("8");
  });
});
