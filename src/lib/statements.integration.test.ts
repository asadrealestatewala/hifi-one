// Statements must reconcile with the ledger and with the operational records they summarise.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createDraftInvoice, issueInvoice, recordPayment, trialBalance } from "./accounting";
import { approveVoucher, payVoucher, postVoucher, reviewVoucher, submitVoucher } from "./expenses";
import { registerAsset, runDepreciation } from "./assets";
import { loadExecutiveDashboard } from "./dashboard";
import { buildBalanceSheet, buildIncomeStatement, groupByCurrency, loadBalances, loadCashMovement, loadReceivablesAging } from "./statements";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });

let org: string;
let bank: string;
let client: string;
const actor = "actor-1";

beforeAll(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE "DepreciationEntry","Asset","ExpenseVoucher","Budget","PaymentAllocation","Payment","InvoiceLine","Invoice","JournalLine","JournalEntry","NumberSequence","BankAccount","Account","Client","CompanyProfile","Organization" CASCADE',
  );
  org = (await db.organization.create({ data: { name: "Statements Org" } })).id;
  await db.companyProfile.create({ data: { organizationId: org, isDefault: true, legalName: "Statements Org" } });
  const mk = (code: string, name: string, type: string, systemKey?: string) => db.account.create({ data: { organizationId: org, code, name, type, systemKey } });
  await mk("1200", "AR", "ASSET", "AR");
  await mk("2000", "AP", "LIABILITY", "ACCOUNTS_PAYABLE");
  await mk("2100", "Advances", "LIABILITY", "CUSTOMER_ADVANCES");
  await mk("2200", "Tax payable", "LIABILITY", "TAX_PAYABLE");
  await mk("4000", "Revenue", "REVENUE", "REVENUE_SERVICE");
  await mk("1500", "Fixed assets", "ASSET", "FIXED_ASSETS");
  await mk("1590", "Accum dep", "ASSET", "ACCUM_DEPRECIATION");
  await mk("6040", "Depreciation", "OPEX", "DEPRECIATION_EXPENSE");
  const opex = await mk("6010", "Hosting", "OPEX");
  const cash = await mk("1100", "Bank USD", "ASSET");
  bank = (await db.bankAccount.create({ data: { organizationId: org, internalName: "USD", bankName: "B", accountHolder: "H", accountNumber: "1234", currency: "USD", isDefault: true, ledgerAccountId: cash.id } })).id;
  client = (await db.client.create({ data: { organizationId: org, name: "Acme", currency: "USD" } })).id;

  // A realistic mix: invoice with tax, partial payment, an expense paid, an asset bought and depreciated
  const d = await createDraftInvoice(db, { organizationId: org, clientId: client, currency: "USD", taxRate: "10", createdById: actor, lines: [{ description: "Work", quantity: "1", unitPrice: "1000" }] });
  await issueInvoice(db, { organizationId: org, invoiceId: d.id, actorId: actor });
  await recordPayment(db, { organizationId: org, actorId: actor, clientId: client, bankAccountId: bank, amount: "400", date: new Date(), method: "BANK_TRANSFER", idempotencyKey: "st-1" });
  const v = await submitVoucher(db, { organizationId: org, submittedById: "emp", date: new Date().toISOString().slice(0, 10), payee: "Cloud", description: "Hosting", expenseAccountId: opex.id, currency: "USD", amount: "150" });
  await reviewVoucher(db, { organizationId: org, id: v.id, reviewerId: "rev" });
  await approveVoucher(db, { organizationId: org, id: v.id, approverId: "appr", canOverride: false });
  await postVoucher(db, { organizationId: org, id: v.id, actorId: "appr" });
  await payVoucher(db, { organizationId: org, id: v.id, bankAccountId: bank, actorId: "appr" });
  await registerAsset(db, { organizationId: org, actorId: actor, name: "Laptop", purchaseDate: new Date().toISOString().slice(0, 10), cost: "1200", currency: "USD", usefulLifeMonths: 12, payment: { kind: "BANK", bankAccountId: bank } });
  await runDepreciation(db, { organizationId: org, upTo: new Date().toISOString().slice(0, 7), actorId: actor });
});
afterAll(async () => {
  await db.$disconnect();
});

describe("statements reconcile with the ledger", () => {
  it("the balance sheet balances and equals the trial balance totals", async () => {
    const rows = await loadBalances(db, org, {});
    const usd = groupByCurrency(rows).get("USD")!;
    const bs = buildBalanceSheet(usd);
    expect(bs.balanced).toBe(true);
    const tb = await trialBalance(db, org);
    const dr = tb.reduce((s, r) => s + Number(r.debit), 0);
    const cr = tb.reduce((s, r) => s + Number(r.credit), 0);
    expect(dr).toBe(cr);
  });

  it("profit and loss uses recognised revenue, not cash: payment does not change it", async () => {
    const pl = buildIncomeStatement(groupByCurrency(await loadBalances(db, org, {})).get("USD")!);
    expect(pl.totals.revenue.toString()).toBe("1000"); // invoiced 1000 (+100 tax goes to the tax liability)
    // expenses: hosting 150 + depreciation 100 (1200 / 12 for the purchase month)
    expect(pl.totals.opex.toString()).toBe("250");
    expect(pl.totals.netProfit.toString()).toBe("750");
  });

  it("period filters work: a future period is empty, today's period has the activity", async () => {
    expect((await loadBalances(db, org, { from: "2999-01-01", to: "2999-12-31" })).length).toBe(0);
    const today = new Date().toISOString().slice(0, 10);
    expect((await loadBalances(db, org, { from: today, to: today })).length).toBeGreaterThan(0);
  });

  it("receivables aging reconciles to the AR control account", async () => {
    const aging = await loadReceivablesAging(db, org);
    const outstanding = aging.detail.reduce((s, i) => s + Number(i.outstanding), 0);
    expect(outstanding).toBe(700); // 1100 invoiced - 400 paid
    const ar = (await trialBalance(db, org)).find((r) => r.code === "1200")!;
    expect(Number(ar.debit) - Number(ar.credit)).toBe(outstanding);
  });

  it("cash movement ties to the bank ledger", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const [m] = await loadCashMovement(db, org, { from: today, to: today });
    // in: 400 payment; out: 150 expense + 1200 asset
    expect(m.inflow.toString()).toBe("400");
    expect(m.outflow.toString()).toBe("1350");
    expect(m.closing.toString()).toBe("-950");
    const bankRow = (await trialBalance(db, org)).find((r) => r.code === "1100")!;
    expect(Number(bankRow.debit) - Number(bankRow.credit)).toBe(-950);
  });

  it("the executive dashboard shows the same numbers as the ledger and reports", async () => {
    const d = await loadExecutiveDashboard(db, org);
    const usd = d.money.find((m) => m.currency === "USD")!;
    expect(Number(usd.revenue)).toBe(1000);
    expect(Number(usd.netProfit)).toBe(750);
    expect(Number(usd.cash)).toBe(-950);
    expect(Number(usd.receivables)).toBe(700);
    expect(Number(usd.payables)).toBe(0);
    expect(d.money.map((m) => m.currency)).toEqual(["USD"]); // never mixed with other currencies
  });
});
