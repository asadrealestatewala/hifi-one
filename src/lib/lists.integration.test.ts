import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PAGE_SIZE } from "./paging";
import {
  LISTS, ListAccessError, auditParams, auditWhere, expenseParams, expenseWhere, exportCsvText, invoiceOutstanding, invoiceParams, invoiceWhere,
  leadParams, leadWhere, listExport, paymentParams, paymentWhere, quoteParams, quoteWhere, type ListActor, type ListKey,
} from "./lists";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string;
let otherOrg: string;
let agentId: string;
let managerId: string;

const actor = (id: string, perms: string[], organizationId = org): ListActor => ({ id, organizationId, permissions: new Set(perms) });
const lines = (csv: string) => csv.trimEnd().split("\r\n");

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "AuditLog","PaymentAllocation","Payment","InvoiceLine","Invoice","QuoteLine","Quote","ExpenseVoucher","BankAccount","Account","LeadActivity","Lead","PipelineStage","Client","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Lists Org" } })).id;
  otherOrg = (await db.organization.create({ data: { name: "Other Org" } })).id;
  managerId = (await db.user.create({ data: { organizationId: org, name: "Manager", passwordHash: "x" } })).id;
  agentId = (await db.user.create({ data: { organizationId: org, name: "Agent", passwordHash: "x" } })).id;
  const client = await db.client.create({ data: { organizationId: org, name: "=HYPERLINK(evil) Ltd", currency: "USD" } });
  const otherClient = await db.client.create({ data: { organizationId: otherOrg, name: "Other client", currency: "USD" } });
  // 70 open USD invoices of 100.00 with 10.00 paid, 5 open PKR invoices of 1000.00, 3 drafts, and invoices in another organization
  await db.invoice.createMany({ data: Array.from({ length: 70 }, (_, i) => ({ organizationId: org, clientId: client.id, currency: "USD", number: `INV-U${String(i).padStart(3, "0")}`, status: "ISSUED", subtotal: "100.00", taxAmount: "0", total: "100.00", amountPaid: "10.00" })) });
  await db.invoice.createMany({ data: Array.from({ length: 5 }, (_, i) => ({ organizationId: org, clientId: client.id, currency: "PKR", number: `INV-P${i}`, status: "OVERDUE", subtotal: "1000.00", taxAmount: "0", total: "1000.00", creditedAmount: "250.00" })) });
  await db.invoice.createMany({ data: Array.from({ length: 3 }, () => ({ organizationId: org, clientId: client.id, currency: "USD", status: "DRAFT", subtotal: "999.00", taxAmount: "0", total: "999.00" })) });
  await db.invoice.create({ data: { organizationId: otherOrg, clientId: otherClient.id, currency: "USD", number: "INV-X", status: "ISSUED", subtotal: "5000", taxAmount: "0", total: "5000" } });

  const bank = await db.bankAccount.create({ data: { organizationId: org, internalName: "Main", bankName: "B", accountHolder: "H", accountNumber: "1", currency: "USD" } });
  await db.payment.createMany({ data: Array.from({ length: 55 }, (_, i) => ({ organizationId: org, number: `RCT-${i}`, clientId: client.id, bankAccountId: bank.id, currency: "USD", amount: "25.50", date: new Date(Date.UTC(2026, 9, 1 + (i % 28))), idempotencyKey: `lists-${i}`, reference: i === 0 ? "-1+1" : null })) });

  const stage = await db.pipelineStage.create({ data: { organizationId: org, name: "New", sortOrder: 1 } });
  await db.lead.createMany({ data: Array.from({ length: 60 }, (_, i) => ({ organizationId: org, name: `Lead ${i}`, stageId: stage.id, assignedToId: i < 52 ? agentId : managerId, dealValue: "-150.00" })) });

  await db.quote.createMany({ data: Array.from({ length: 52 }, (_, i) => ({ organizationId: org, number: `QT-${i}`, clientId: client.id, currency: "USD", status: i % 2 ? "SENT" : "DRAFT", subtotal: "10", taxAmount: "0", total: "10" })) });

  const acct = await db.account.create({ data: { organizationId: org, code: "6000", name: "Ops", type: "OPEX" } });
  await db.expenseVoucher.createMany({ data: Array.from({ length: 54 }, (_, i) => ({ organizationId: org, number: `EXP-${i}`, date: "2026-10-01", payee: "Shop", description: "Paper", expenseAccountId: acct.id, currency: "PKR", amount: "12.34", submittedById: i < 51 ? agentId : managerId })) });

  await db.auditLog.createMany({ data: Array.from({ length: 53 }, (_, i) => ({ organizationId: org, actorId: managerId, action: "invoice.issue", entity: "Invoice", entityId: `e${i}`, before: { secret: "BEFORE-VALUE" }, after: { cnic: "12345-1234567-1" }, ip: "10.0.0.9" })) });
});
afterAll(async () => { await db.$disconnect(); });

describe("list filters and figures", () => {
  it("counts and totals cover every record, not only the first page", async () => {
    const finance = actor(managerId, ["finance.view"]);
    const where = invoiceWhere(finance, invoiceParams({}));
    expect(await db.invoice.count({ where })).toBe(78);
    expect(await db.invoice.count({ where: invoiceWhere(finance, invoiceParams({ status: "ISSUED" })) })).toBe(70);
    expect(70).toBeGreaterThan(PAGE_SIZE);
    // Outstanding per currency, never mixed, excluding drafts and other organizations: 70 × 90.00 and 5 × 750.00
    const owed = await invoiceOutstanding(db, finance);
    expect([...owed.keys()].sort()).toEqual(["PKR", "USD"]);
    expect(owed.get("USD")!.toFixed(2)).toBe("6300.00");
    expect(owed.get("PKR")!.toFixed(2)).toBe("3750.00");
    // Page 2 holds the rest
    const p2 = invoiceParams({ page: "2", status: "ISSUED" });
    const rows = await db.invoice.findMany({ where: invoiceWhere(finance, p2), orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: p2.page.skip, take: p2.page.take });
    expect(rows).toHaveLength(20);
  });

  it("filters payments by search and dates, leads by owner, expenses by submitter", async () => {
    const finance = actor(managerId, ["finance.view"]);
    expect(await db.payment.count({ where: paymentWhere(finance, paymentParams({})) })).toBe(55);
    expect(await db.payment.count({ where: paymentWhere(finance, paymentParams({ from: "2026-10-01", to: "2026-10-01" })) })).toBe(2);
    expect(await db.payment.count({ where: paymentWhere(finance, paymentParams({ q: "RCT-5" })) })).toBe(6);
    // An agent sees only leads assigned to them; crm.view_all sees all
    expect(await db.lead.count({ where: leadWhere(actor(agentId, ["crm.view"]), leadParams({})) })).toBe(52);
    expect(await db.lead.count({ where: leadWhere(actor(managerId, ["crm.view", "crm.view_all"]), leadParams({})) })).toBe(60);
    expect(await db.expenseVoucher.count({ where: expenseWhere(actor(agentId, ["self.expense"]), expenseParams({})) })).toBe(51);
    expect(await db.expenseVoucher.count({ where: expenseWhere(actor(agentId, ["self.expense", "expenses.view"]), expenseParams({})) })).toBe(54);
    expect(await db.quote.count({ where: quoteWhere(actor(managerId, ["quotes.view"]), quoteParams({ status: "SENT" })) })).toBe(26);
    expect(await db.auditLog.count({ where: auditWhere(actor(managerId, ["audit.view"]), auditParams({ q: "issue" })) })).toBe(53);
    // Search wildcards are literal
    expect(await db.invoice.count({ where: invoiceWhere(finance, invoiceParams({ q: "%" })) })).toBe(0);
  });

  it("refuses every list builder to a person without the list's permission", async () => {
    const nobody = actor(agentId, ["self.attendance"]);
    expect(() => invoiceWhere(nobody, invoiceParams({}))).toThrow(ListAccessError);
    expect(() => paymentWhere(nobody, paymentParams({}))).toThrow(ListAccessError);
    expect(() => leadWhere(nobody, leadParams({}))).toThrow(ListAccessError);
    expect(() => quoteWhere(nobody, quoteParams({}))).toThrow(ListAccessError);
    expect(() => expenseWhere(nobody, expenseParams({}))).toThrow(ListAccessError);
    expect(() => auditWhere(nobody, auditParams({}))).toThrow(ListAccessError);
    await expect(invoiceOutstanding(db, nobody)).rejects.toThrow(ListAccessError);
  });
});

describe("CSV exports", () => {
  it("export every matching row beyond the page cap, with exact decimals and currency", async () => {
    const csv = await exportCsvText(listExport(db, "invoices", actor(managerId, ["finance.view"]), new URLSearchParams("status=ISSUED")));
    const l = lines(csv);
    expect(l[0]).toBe("Number,Client,Status,Issue date,Due date,Currency,Total,Paid,Credited,Outstanding");
    expect(l).toHaveLength(71);
    expect(l[1]).toContain(",USD,100.00,10.00,0.00,90.00");
    expect(csv).not.toContain("INV-X");
    // Payments: more than one page, and a formula-looking reference is defused
    const pay = lines(await exportCsvText(listExport(db, "payments", actor(managerId, ["finance.view"]), new URLSearchParams())));
    expect(pay).toHaveLength(56);
    expect(pay.some((r) => r.includes(",'-1+1,"))).toBe(true);
  });

  it("defuse formulas in names, keep negative amounts as numbers", async () => {
    const inv = await exportCsvText(listExport(db, "invoices", actor(managerId, ["finance.view"]), new URLSearchParams()));
    expect(inv).toContain("'=HYPERLINK(evil) Ltd");
    expect(inv).not.toMatch(/,=HYPERLINK/);
    const leads = lines(await exportCsvText(listExport(db, "leads", actor(managerId, ["crm.view", "crm.view_all"]), new URLSearchParams())));
    expect(leads).toHaveLength(61);
    expect(leads[1]).toContain(",-150.00,");
  });

  it("apply the person's record scope and the same filters as the screen", async () => {
    const agentLeads = lines(await exportCsvText(listExport(db, "leads", actor(agentId, ["crm.view"]), new URLSearchParams())));
    expect(agentLeads).toHaveLength(53);
    const mine = lines(await exportCsvText(listExport(db, "expenses", actor(agentId, ["self.expense"]), new URLSearchParams())));
    expect(mine).toHaveLength(52);
    expect(mine[1]).toContain(",Agent,Shop,Paper,SUBMITTED,PKR,12.34");
    const quotes = lines(await exportCsvText(listExport(db, "quotes", actor(managerId, ["quotes.view"]), new URLSearchParams("status=DRAFT"))));
    expect(quotes).toHaveLength(27);
  });

  it("never include audit before/after values or IP addresses", async () => {
    const csv = await exportCsvText(listExport(db, "audit", actor(managerId, ["audit.view"]), new URLSearchParams()));
    expect(lines(csv)).toHaveLength(54);
    expect(csv).not.toContain("BEFORE-VALUE");
    expect(csv).not.toContain("12345-1234567-1");
    expect(csv).not.toContain("10.0.0.9");
    expect(lines(csv)[1]).toMatch(/,Manager,invoice\.issue,Invoice,e\d+$/);
  });

  it("are refused, before reading anything, to a person without the list's permission", () => {
    for (const key of Object.keys(LISTS) as ListKey[]) {
      const wrong = Object.values(LISTS).map((l) => l.permission).filter((p) => p !== LISTS[key].permission);
      expect(() => listExport(db, key, actor(agentId, wrong), new URLSearchParams()), key).toThrow(ListAccessError);
    }
  });

  it("give another organization none of these records", async () => {
    const csv = await exportCsvText(listExport(db, "invoices", actor(managerId, ["finance.view"], otherOrg), new URLSearchParams()));
    expect(lines(csv)).toHaveLength(2);
    expect(csv).toContain("INV-X");
  });
});
