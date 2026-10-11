// Integration tests against a real PostgreSQL (the separate hifi_one_test database).
// Run `npm run db:start` first. They truncate that database, never the development one.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { cancelInvoice, clientStatement, createDraftInvoice, issueInvoice, recordPayment, trialBalance } from "./accounting";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });

let org: string;
let client: string;
let bank: string;
const actor = "actor-1";

async function reset() {
  await db.$executeRawUnsafe(
    'TRUNCATE "PaymentAllocation","Payment","InvoiceLine","Invoice","JournalLine","JournalEntry","NumberSequence","BankAccount","Account","Client","CompanyProfile","Organization" CASCADE',
  );
}

async function newInvoice(amount: string, taxRate = "0") {
  const d = await createDraftInvoice(db, {
    organizationId: org, clientId: client, currency: "USD", taxRate, createdById: actor,
    lines: [{ description: "Service", quantity: "1", unitPrice: amount }],
  });
  return issueInvoice(db, { organizationId: org, invoiceId: d.id, actorId: actor });
}

const tbBalanced = async () => {
  const rows = await trialBalance(db, org);
  const dr = rows.reduce((a, r) => a + Number(r.debit), 0);
  const cr = rows.reduce((a, r) => a + Number(r.credit), 0);
  return { dr, cr };
};

beforeAll(async () => {
  await reset();
  org = (await db.organization.create({ data: { name: "Test Org" } })).id;
  await db.companyProfile.create({ data: { organizationId: org, isDefault: true, legalName: "Test Org" } });
  const mk = (code: string, name: string, type: string, systemKey?: string) =>
    db.account.create({ data: { organizationId: org, code, name, type, systemKey } });
  await mk("1200", "AR", "ASSET", "AR");
  await mk("2100", "Advances", "LIABILITY", "CUSTOMER_ADVANCES");
  await mk("2200", "Tax payable", "LIABILITY", "TAX_PAYABLE");
  await mk("4000", "Revenue", "REVENUE", "REVENUE_SERVICE");
  const cash = await mk("1100", "Bank USD", "ASSET");
  bank = (
    await db.bankAccount.create({
      data: {
        organizationId: org, internalName: "Main USD", bankName: "B", accountHolder: "H", accountNumber: "123456",
        currency: "USD", isDefault: true, ledgerAccountId: cash.id,
      },
    })
  ).id;
  client = (await db.client.create({ data: { organizationId: org, name: "Acme", currency: "USD" } })).id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("invoice issue", () => {
  it("posts a balanced entry and freezes company and bank snapshots", async () => {
    const inv = await newInvoice("1000", "5");
    expect(inv.status).toBe("ISSUED");
    expect(inv.total.toString()).toBe("1050");
    expect(inv.number).toMatch(/^INV-\d{6}$/);
    expect((inv.bankSnapshot as { accountNumber: string }).accountNumber).toBe("123456");
    const { dr, cr } = await tbBalanced();
    expect(dr).toBe(cr);
  });

  it("issuing the same invoice concurrently posts exactly one journal entry", async () => {
    const d = await createDraftInvoice(db, {
      organizationId: org, clientId: client, currency: "USD", taxRate: "0", createdById: actor,
      lines: [{ description: "X", quantity: "1", unitPrice: "200" }],
    });
    const results = await Promise.all(
      [1, 2, 3].map(() => issueInvoice(db, { organizationId: org, invoiceId: d.id, actorId: actor })),
    );
    expect(new Set(results.map((r) => r.number)).size).toBe(1);
    const entries = await db.journalEntry.count({ where: { sourceType: "INVOICE", sourceId: d.id } });
    expect(entries).toBe(1);
  });
});

describe("payments", () => {
  it("partial payment updates invoice, ledger and bank, and is not counted as revenue", async () => {
    const inv = await newInvoice("500");
    const before = await trialBalance(db, org);
    const revBefore = Number(before.find((r) => r.code === "4000")!.credit);
    const pay = await recordPayment(db, {
      organizationId: org, actorId: actor, clientId: client, bankAccountId: bank, amount: "200",
      date: new Date(), method: "BANK_TRANSFER", idempotencyKey: "pay-partial-1", invoiceIds: [inv.id],
    });
    expect(pay.unallocated.toString()).toBe("0");
    const after = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after.status).toBe("PARTIALLY_PAID");
    expect(after.amountPaid.toString()).toBe("200");
    const tb = await trialBalance(db, org);
    expect(Number(tb.find((r) => r.code === "4000")!.credit)).toBe(revBefore); // revenue unchanged
    expect(Number(tb.find((r) => r.code === "1100")!.debit)).toBeGreaterThanOrEqual(200);
    const { dr, cr } = await tbBalanced();
    expect(dr).toBe(cr);
  });

  it("retrying the same payment key does not duplicate it", async () => {
    const before = await db.payment.count();
    const again = await recordPayment(db, {
      organizationId: org, actorId: actor, clientId: client, bankAccountId: bank, amount: "200",
      date: new Date(), method: "BANK_TRANSFER", idempotencyKey: "pay-partial-1",
    });
    expect(again.number).toBeDefined();
    expect(await db.payment.count()).toBe(before);
  });

  it("concurrent payments never over-allocate an invoice; extra becomes an advance", async () => {
    const inv = await newInvoice("150");
    const pays = await Promise.all(
      ["c1", "c2"].map((k) =>
        recordPayment(db, {
          organizationId: org, actorId: actor, clientId: client, bankAccountId: bank, amount: "100",
          date: new Date(), method: "BANK_TRANSFER", idempotencyKey: `conc-${k}`, invoiceIds: [inv.id],
        }),
      ),
    );
    const allocated = pays.reduce((a, p) => a + (100 - Number(p.unallocated)), 0);
    expect(allocated).toBe(150);
    const final = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(final.status).toBe("PAID");
    expect(final.amountPaid.toString()).toBe("150");
    expect(pays.reduce((a, p) => a + Number(p.unallocated), 0)).toBe(50);
  });

  it("client statement running balance reconciles with the AR control account", async () => {
    const st = await clientStatement(db, org, client);
    const last = st.rows[st.rows.length - 1];
    const tb = await trialBalance(db, org);
    const ar = tb.find((r) => r.code === "1200")!;
    expect(Number(last.balance)).toBe(Number(ar.debit) - Number(ar.credit));
  });
});

describe("integrity", () => {
  it("cancelling an unpaid invoice reverses it instead of editing history", async () => {
    const inv = await newInvoice("75");
    const cancelled = await cancelInvoice(db, { organizationId: org, invoiceId: inv.id, actorId: actor });
    expect(cancelled.status).toBe("CANCELLED");
    const original = await db.journalEntry.findUniqueOrThrow({ where: { id: inv.journalEntryId! } });
    expect(original.status).toBe("REVERSED");
    expect(await db.journalEntry.count({ where: { reversalOfId: original.id } })).toBe(1);
    const { dr, cr } = await tbBalanced();
    expect(dr).toBe(cr);
  });

  it("refuses to cancel an invoice that has payments", async () => {
    const inv = await newInvoice("60");
    await recordPayment(db, {
      organizationId: org, actorId: actor, clientId: client, bankAccountId: bank, amount: "10",
      date: new Date(), method: "CASH", idempotencyKey: "pay-before-cancel", invoiceIds: [inv.id],
    });
    await expect(cancelInvoice(db, { organizationId: org, invoiceId: inv.id, actorId: actor })).rejects.toThrow(/payments/);
  });

  it("the database refuses to edit or delete posted journal lines", async () => {
    await expect(db.journalLine.updateMany({ data: { memo: "tampered" } })).rejects.toThrow();
    await expect(db.journalLine.deleteMany({})).rejects.toThrow();
  });

  it("the database refuses an unbalanced-style line (both debit and credit)", async () => {
    const acc = await db.account.findFirstOrThrow({ where: { organizationId: org } });
    const e = await db.journalEntry.findFirstOrThrow({ where: { organizationId: org } });
    await expect(
      db.journalLine.create({ data: { entryId: e.id, accountId: acc.id, debit: 5, credit: 5 } }),
    ).rejects.toThrow();
  });
});

describe("lead conversion", () => {
  async function wonLead(name: string, email: string, dealValue: string) {
    const stage = await db.pipelineStage.upsert({
      where: { organizationId_name: { organizationId: org, name: "Closed Won" } },
      update: {}, create: { organizationId: org, name: "Closed Won", sortOrder: 9, isWon: true },
    });
    const first = await db.pipelineStage.upsert({
      where: { organizationId_name: { organizationId: org, name: "New" } },
      update: {}, create: { organizationId: org, name: "New", sortOrder: 0 },
    });
    const lead = await db.lead.create({
      data: { organizationId: org, name, email, dealValue, currency: "USD", stageId: first.id },
    });
    return { lead, stage };
  }

  it("concurrent conversions create one client and one draft invoice", async () => {
    const { convertLead } = await import("./conversion");
    const { lead, stage } = await wonLead("Dana Lead", "dana@newco.example", "900");
    const results = await Promise.all(
      [1, 2, 3].map(() => convertLead(db, { organizationId: org, leadId: lead.id, actorId: actor, wonStageId: stage.id })),
    );
    expect(new Set(results.map((r) => r.clientId)).size).toBe(1);
    expect(results.filter((r) => !r.alreadyConverted)).toHaveLength(1);
    expect(await db.invoice.count({ where: { clientId: results[0].clientId } })).toBe(1);
    const inv = await db.invoice.findFirstOrThrow({ where: { clientId: results[0].clientId } });
    expect(inv.status).toBe("DRAFT"); // never issued automatically
    expect(inv.number).toBeNull();
    const after = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.stageId).toBe(stage.id);
  });

  it("links an existing client instead of duplicating it", async () => {
    const { convertLead } = await import("./conversion");
    const { lead, stage } = await wonLead("Someone", "someone@acme.example", "100");
    await db.lead.update({ where: { id: lead.id }, data: { company: "Acme" } }); // existing client is named Acme
    const before = await db.client.count();
    const r = await convertLead(db, { organizationId: org, leadId: lead.id, actorId: actor, wonStageId: stage.id });
    expect(await db.client.count()).toBe(before);
    expect(r.clientId).toBe(client);
  });

  it("creates no invoice when there is no deal value", async () => {
    const { convertLead } = await import("./conversion");
    const { lead, stage } = await wonLead("No Value", "novalue@x.example", "0");
    const r = await convertLead(db, { organizationId: org, leadId: lead.id, actorId: actor, wonStageId: stage.id });
    expect(r.invoiceId).toBeNull();
  });
});
