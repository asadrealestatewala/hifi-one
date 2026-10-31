import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createDraftInvoice, issueInvoice, recordPayment } from "./accounting";
import { reportPdf } from "./pdf";
import { companyFrom } from "./pdf-data";
import { DEFAULT_DOC_CONFIG } from "./pdf";
import { REPORTS, buildReport, isReportKey, reportCsv } from "./report-tables";
import { ALL_PERMISSIONS, ROLE_DEFS } from "./permissions";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string;

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "PaymentAllocation","Payment","InvoiceLine","Invoice","JournalLine","JournalEntry","NumberSequence","BankAccount","Account","Lead","PipelineStage","Client","CompanyProfile","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Report Org" } })).id;
  const mk = (code: string, name: string, type: string, systemKey?: string) => db.account.create({ data: { organizationId: org, code, name, type, systemKey } });
  await mk("1200", "Receivable", "ASSET", "AR"); await mk("2100", "Advances", "LIABILITY", "CUSTOMER_ADVANCES"); await mk("2200", "Tax", "LIABILITY", "TAX_PAYABLE"); await mk("4000", "Service Revenue", "REVENUE", "REVENUE_SERVICE");
  const cash = await mk("1100", "Bank", "ASSET");
  const bank = await db.bankAccount.create({ data: { organizationId: org, internalName: "Main", bankName: "B", accountHolder: "H", accountNumber: "1", currency: "USD", isDefault: true, ledgerAccountId: cash.id } });
  const client = await db.client.create({ data: { organizationId: org, name: "=SUM(1) Acme", currency: "USD" } });
  const d = await createDraftInvoice(db, { organizationId: org, clientId: client.id, currency: "USD", taxRate: "0", createdById: "x", lines: [{ description: "Work", quantity: "1", unitPrice: "800" }] });
  const inv = await issueInvoice(db, { organizationId: org, invoiceId: d.id, actorId: "x" });
  await recordPayment(db, { organizationId: org, actorId: "x", clientId: client.id, bankAccountId: bank.id, amount: "300", date: new Date(), method: "BANK_TRANSFER", idempotencyKey: "rt-1", invoiceIds: [inv.id] });
});
afterAll(async () => { await db.$disconnect(); });

const range = { from: "2000-01-01", to: "2100-01-01" };

describe("downloadable reports", () => {
  it("matches the ledger: revenue, aging and cash for the same data", async () => {
    const pl = await buildReport(db, "pl", { organizationId: org, ...range });
    expect(pl.sections[0].totals?.[2]).toBe("800.00");
    const ar = await buildReport(db, "aging", { organizationId: org, ...range });
    expect(ar.sections[0].rows[0].at(-1)).toBe("500.00");
    expect(ar.sections[1].rows[0][1]).toBe("=SUM(1) Acme");
    const cash = await buildReport(db, "cash", { organizationId: org, ...range });
    expect(cash.sections[0].rows[0].slice(2)).toEqual(["0.00", "300.00", "0.00", "300.00"]);
  });

  it("defuses spreadsheet formulas in CSV and produces a real PDF", async () => {
    const t = await buildReport(db, "aging", { organizationId: org, ...range });
    const csv = reportCsv(t);
    expect(csv).toContain("'=SUM(1)");
    expect(csv).not.toMatch(/,=SUM/);
    const pdf = await reportPdf({ ...t, company: companyFrom({ legalName: "Report Org" }), config: DEFAULT_DOC_CONFIG, generatedBy: "Tester" });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1500);
  });

  it("gives other organizations nothing, and an empty period says so", async () => {
    const other = (await db.organization.create({ data: { name: "Other" } })).id;
    const t = await buildReport(db, "pl", { organizationId: other, ...range });
    expect(t.sections).toHaveLength(0);
    expect(t.notes[0]).toMatch(/No postings/);
  });

  it("is limited by permission: sales roles cannot download finance reports", () => {
    expect(isReportKey("pl")).toBe(true);
    expect(isReportKey("../etc")).toBe(false);
    const holds = (role: string, perm: string) => { const d = ROLE_DEFS.find((r) => r.key === role)!; return d.permissions === "ALL" || (d.permissions as string[]).includes(perm); };
    expect(holds("SALES_AGENT", REPORTS.pl.permission)).toBe(false);
    expect(holds("SALES_AGENT", REPORTS.leads.permission)).toBe(true);
    expect(holds("SALES_AGENT", REPORTS.workforce.permission)).toBe(false);
    expect(holds("INTERN", REPORTS.leads.permission)).toBe(false);
    expect(ALL_PERMISSIONS).toContain(REPORTS.workforce.permission);
  });
});
