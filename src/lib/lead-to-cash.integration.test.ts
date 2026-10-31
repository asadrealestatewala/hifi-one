// One test of the whole agency revenue chain across modules: lead → client → quotation → invoice → payments →
// commission. After every step the books must agree with themselves: debits equal credits per currency, and the
// receivable account equals what clients still owe on their invoices.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { issueInvoice, recordPayment, trialBalance } from "./accounting";
import { accrueCommissions, approveEntry, payEntry, setRule } from "./commissions";
import { convertLead } from "./conversion";
import { convertQuoteToInvoice, createQuote, decideQuote, sendQuote } from "./sales";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, sales: string, boss: string, bank: string, won: string, ar: string;

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "CommissionEntry","CommissionRule","LeadActivity","Lead","PipelineStage","QuoteLine","Quote","PaymentAllocation","Payment","InvoiceLine","Invoice","JournalLine","JournalEntry","NumberSequence","BankAccount","Account","Client","User","CompanyProfile","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Flow Org" } })).id;
  await db.companyProfile.create({ data: { organizationId: org, isDefault: true, legalName: "Flow Org" } });
  const mk = (code: string, name: string, type: string, systemKey?: string) => db.account.create({ data: { organizationId: org, code, name, type, systemKey } });
  ar = (await mk("1200", "Receivable", "ASSET", "AR")).id;
  await mk("2100", "Advances", "LIABILITY", "CUSTOMER_ADVANCES"); await mk("2200", "Tax", "LIABILITY", "TAX_PAYABLE"); await mk("4000", "Revenue", "REVENUE", "REVENUE_SERVICE");
  await mk("6020", "Commissions", "OPEX", "PAYROLL_EXPENSE"); await mk("2500", "Payroll payable", "LIABILITY", "PAYROLL_PAYABLE");
  const cash = await mk("1100", "Bank USD", "ASSET");
  bank = (await db.bankAccount.create({ data: { organizationId: org, internalName: "USD", bankName: "B", accountHolder: "H", accountNumber: "1", currency: "USD", isDefault: true, ledgerAccountId: cash.id } })).id;
  sales = (await db.user.create({ data: { organizationId: org, email: "sam@flow.test", name: "Sam Sales", passwordHash: "x" } })).id;
  boss = (await db.user.create({ data: { organizationId: org, email: "bea@flow.test", name: "Bea Boss", passwordHash: "x" } })).id;
  await db.pipelineStage.create({ data: { organizationId: org, name: "New", sortOrder: 1 } });
  won = (await db.pipelineStage.create({ data: { organizationId: org, name: "Closed Won", sortOrder: 9, isWon: true } })).id;
});
afterAll(async () => { await db.$disconnect(); });

// The books agree with themselves and with the invoices
async function invariants() {
  const rows = await trialBalance(db, org);
  for (const cur of new Set(rows.map((r) => r.currency))) {
    const mine = rows.filter((r) => r.currency === cur);
    expect(mine.reduce((a, r) => a + Number(r.debit), 0)).toBeCloseTo(mine.reduce((a, r) => a + Number(r.credit), 0), 2);
  }
  const arLines = await db.journalLine.aggregate({ where: { accountId: ar }, _sum: { debit: true, credit: true } });
  const arBalance = Number(arLines._sum.debit ?? 0) - Number(arLines._sum.credit ?? 0);
  const open = await db.invoice.findMany({ where: { organizationId: org, status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] } } });
  const owed = open.reduce((a, i) => a + Number(i.total.sub(i.amountPaid).sub(i.creditedAmount)), 0);
  expect(arBalance).toBeCloseTo(owed, 2);
}

describe("lead to cash", () => {
  it("carries one deal through every module with the books in balance at each step", async () => {
    // CRM: the agent's lead is won and becomes a client
    const stageNew = await db.pipelineStage.findFirstOrThrow({ where: { organizationId: org, name: "New" } });
    const lead = await db.lead.create({ data: { organizationId: org, name: "Nadia Khan", company: "Zara Foods", email: "nadia@zara.test", stageId: stageNew.id, assignedToId: sales, createdById: sales, currency: "USD" } });
    await setRule(db, { organizationId: org, userId: sales, ratePercent: "10", active: true, actorId: boss });
    const conv = await convertLead(db, { organizationId: org, leadId: lead.id, actorId: sales, wonStageId: won });
    expect(conv.alreadyConverted).toBe(false);
    expect((await convertLead(db, { organizationId: org, leadId: lead.id, actorId: sales, wonStageId: won })).clientId).toBe(conv.clientId);
    expect(await db.client.count({ where: { organizationId: org } })).toBe(1);

    // Sales: a quotation is sent, accepted in the portal and turned into one draft invoice
    const q = await createQuote(db, { organizationId: org, clientId: conv.clientId, currency: "USD", taxRate: "10", createdById: sales, lines: [{ description: "Social media retainer", quantity: "1", unitPrice: "2000" }] });
    await sendQuote(db, { organizationId: org, quoteId: q.id });
    await decideQuote(db, { organizationId: org, quoteId: q.id, decision: "ACCEPT", byUserId: "portal-user", via: "PORTAL", clientId: conv.clientId, today: new Date().toISOString().slice(0, 10) });
    const { invoiceId } = await convertQuoteToInvoice(db, { organizationId: org, quoteId: q.id, actorId: boss });
    expect((await convertQuoteToInvoice(db, { organizationId: org, quoteId: q.id, actorId: boss })).invoiceId).toBe(invoiceId);
    await invariants();

    // Finance: issuing posts revenue and tax against the receivable
    const inv = await issueInvoice(db, { organizationId: org, invoiceId, actorId: boss });
    expect(inv.total.toString()).toBe("2200");
    await invariants();

    // Two payments; the first is retried (double click) and must count once
    const pay = (amount: string, key: string) => recordPayment(db, { organizationId: org, actorId: boss, clientId: conv.clientId, bankAccountId: bank, amount, date: new Date(), method: "BANK_TRANSFER", idempotencyKey: key });
    await pay("1100", "flow-1");
    await pay("1100", "flow-1");
    expect((await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status).toBe("PARTIALLY_PAID");
    await invariants();
    await pay("1100", "flow-2");
    expect((await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status).toBe("PAID");
    expect(await db.payment.count({ where: { organizationId: org } })).toBe(2);
    await invariants();

    // Commission: 10% of the tax-free share of each payment (1000 each), once per payment, to the agent who won it
    expect((await accrueCommissions(db, { organizationId: org, actorId: boss })).created).toBe(2);
    expect((await accrueCommissions(db, { organizationId: org, actorId: boss })).created).toBe(0);
    const entries = await db.commissionEntry.findMany({ where: { organizationId: org } });
    expect(entries.map((e) => [e.userId, e.amount.toString()])).toEqual([[sales, "100"], [sales, "100"]]);

    // Denied: the agent cannot approve their own commission; a manager can, then pay it
    await expect(approveEntry(db, { organizationId: org, entryId: entries[0].id, approverId: sales })).rejects.toThrow(/own commission/);
    await approveEntry(db, { organizationId: org, entryId: entries[0].id, approverId: boss });
    await payEntry(db, { organizationId: org, entryId: entries[0].id, bankAccountId: bank, actorId: boss });
    await invariants();
  });
});
