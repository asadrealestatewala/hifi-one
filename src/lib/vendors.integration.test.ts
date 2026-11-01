// Vendor and procurement integration tests against hifi_one_test.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  VendorError, acceptDelivery, apply, approveBill, createOpportunity, createVendor, decideApplication, issueWorkOrder, markDelivered, payBill, postBill,
  rejectBill, setVendorStatus, submitBill, vendorLedger,
} from "./vendors";
import { trialBalance } from "./accounting";
import { statementCsv } from "./ledger-csv";
import { loadVendorStatementDoc } from "./pdf-data";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });

let org: string;
let direct: string;
let bank: string;
let vendorA: string;
let vendorB: string;
let opp: string;
const staff = "staff-1";
const today = "2026-10-12";

beforeAll(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE "VendorBill","WorkOrder","VendorApplication","VendorOpportunity","Vendor","ClientInvite","JournalLine","JournalEntry","BankAccount","Account","NumberSequence","Organization" CASCADE',
  );
  org = (await db.organization.create({ data: { name: "Vendor Test Org" } })).id;
  const mk = (code: string, name: string, type: string, systemKey?: string) => db.account.create({ data: { organizationId: org, code, name, type, systemKey } });
  direct = (await mk("5000", "Direct labor", "DIRECT_COST")).id;
  await mk("2000", "AP", "LIABILITY", "ACCOUNTS_PAYABLE");
  const cash = await mk("1100", "Bank USD", "ASSET");
  bank = (await db.bankAccount.create({ data: { organizationId: org, internalName: "USD", bankName: "B", accountHolder: "H", accountNumber: "1234", currency: "USD", ledgerAccountId: cash.id } })).id;
  vendorA = (await createVendor(db, { organizationId: org, name: "Alpha Studio", currency: "USD", paymentTermsDays: 30 })).id;
  vendorB = (await createVendor(db, { organizationId: org, name: "Beta Dev", currency: "USD", paymentTermsDays: 30 })).id;
  opp = (await createOpportunity(db, { organizationId: org, title: "Build a website", scope: "Marketing site with CMS", currency: "USD", budgetMin: "1000", budgetMax: "3000", deadline: "2026-10-31", createdById: staff })).id;
});
afterAll(async () => {
  await db.$disconnect();
});

describe("vendor onboarding and applications", () => {
  it("assigns codes, refuses duplicate names, and only approved vendors can apply", async () => {
    expect((await db.vendor.findMany({ orderBy: { code: "asc" } })).map((v) => v.code)).toEqual(["V-0001", "V-0002"]);
    await expect(createVendor(db, { organizationId: org, name: "alpha studio", currency: "USD", paymentTermsDays: 30 })).rejects.toThrow(/already exists/);
    await expect(apply(db, { vendorId: vendorA, opportunityId: opp, quote: "2000", today })).rejects.toThrow(/approved vendors/);
    await setVendorStatus(db, { organizationId: org, vendorId: vendorA, status: "APPROVED" });
    await setVendorStatus(db, { organizationId: org, vendorId: vendorB, status: "APPROVED" });
  });

  it("applying never awards: one application per vendor, deadline enforced, work order needs approval", async () => {
    const app = await apply(db, { vendorId: vendorA, opportunityId: opp, quote: "2000", proposal: "We can do it", today });
    expect(app.status).toBe("SUBMITTED");
    await expect(apply(db, { vendorId: vendorA, opportunityId: opp, quote: "1900", today })).rejects.toThrow(/already applied/);
    await expect(apply(db, { vendorId: vendorB, opportunityId: opp, quote: "1800", today: "2026-11-05" })).rejects.toThrow(/deadline/);
    await expect(issueWorkOrder(db, { organizationId: org, issuedById: staff, applicationId: app.id })).rejects.toThrow(/Approve the application/);
    expect(await db.workOrder.count()).toBe(0);
    await decideApplication(db, { organizationId: org, id: app.id, deciderId: staff, status: "APPROVED" });
  });

  it("issuing a work order from an approved application is idempotent, even when concurrent", async () => {
    const app = await db.vendorApplication.findFirstOrThrow({ where: { vendorId: vendorA } });
    const wos = await Promise.all([1, 2, 3].map(() => issueWorkOrder(db, { organizationId: org, issuedById: staff, applicationId: app.id })));
    expect(new Set(wos.map((w) => w.id)).size).toBe(1);
    expect(await db.workOrder.count()).toBe(1);
    expect(wos[0].amount.toString()).toBe("2000");
    expect(wos[0].vendorId).toBe(vendorA);
  });
});

describe("delivery, billing and payment", () => {
  let woId: string;
  let billId: string;

  it("vendors cannot touch each other's work, and bills need accepted delivery", async () => {
    woId = (await db.workOrder.findFirstOrThrow()).id;
    await expect(markDelivered(db, { vendorId: vendorB, workOrderId: woId })).rejects.toThrow(/not found/);
    await expect(submitBill(db, { organizationId: org, vendorId: vendorA, workOrderId: woId, amount: "100" })).rejects.toThrow(/accepted/);
    await markDelivered(db, { vendorId: vendorA, workOrderId: woId });
    await expect(submitBill(db, { organizationId: org, vendorId: vendorA, workOrderId: woId, amount: "100" })).rejects.toThrow(/accepted/);
    await acceptDelivery(db, { organizationId: org, workOrderId: woId, accepterId: staff, accept: true });
  });

  it("concurrent bills can never exceed the work order amount", async () => {
    const results = await Promise.allSettled(
      [1, 2].map(() => submitBill(db, { organizationId: org, vendorId: vendorA, workOrderId: woId, amount: "1500", reference: "INV-A" })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1); // 1500 + 1500 > 2000
    const bill = await db.vendorBill.findFirstOrThrow();
    billId = bill.id;
    await expect(submitBill(db, { organizationId: org, vendorId: vendorB, workOrderId: woId, amount: "10" })).rejects.toThrow(/not found/);
    await expect(submitBill(db, { organizationId: org, vendorId: vendorA, workOrderId: woId, amount: "600" })).rejects.toThrow(/exceeds/);
  });

  it("approval picks an expense account; posting records expense and a payable for that vendor without moving cash", async () => {
    await expect(approveBill(db, { organizationId: org, id: billId, approverId: staff, expenseAccountId: "nope" })).rejects.toThrow(/expense account/);
    await expect(postBill(db, { organizationId: org, id: billId, actorId: staff })).rejects.toThrow(/Approve/);
    await approveBill(db, { organizationId: org, id: billId, approverId: staff, expenseAccountId: direct });
    await Promise.all([1, 2, 3].map(() => postBill(db, { organizationId: org, id: billId, actorId: staff })));
    expect(await db.journalEntry.count({ where: { sourceType: "VENDOR_BILL", sourceId: billId } })).toBe(1);
    const tb = await trialBalance(db, org);
    expect(Number(tb.find((r) => r.code === "5000")!.debit)).toBe(1500);
    expect(tb.find((r) => r.code === "1100")).toBeUndefined();
    const led = await vendorLedger(db, org, vendorA);
    expect(led.at(-1)!.balance.toString()).toBe("1500"); // we owe the vendor
    expect((await vendorLedger(db, org, vendorB)).length).toBe(0);
  });

  it("payment settles the payable once and the vendor ledger reaches zero", async () => {
    await Promise.all([1, 2].map(() => payBill(db, { organizationId: org, id: billId, bankAccountId: bank, actorId: staff })));
    expect(await db.journalEntry.count({ where: { sourceType: "VENDOR_PAYMENT", sourceId: billId } })).toBe(1);
    const led = await vendorLedger(db, org, vendorA);
    expect(led.at(-1)!.balance.toString()).toBe("0");
    const tb = await trialBalance(db, org);
    const dr = tb.reduce((a, r) => a + Number(r.debit), 0);
    const cr = tb.reduce((a, r) => a + Number(r.credit), 0);
    expect(dr).toBe(cr);
  });

  it("the vendor statement download lists only that vendor's bill and payment with exact amounts", async () => {
    const doc = await loadVendorStatementDoc(db, { organizationId: org, vendorId: vendorA });
    expect(doc?.rows.map((r) => [r.debit, r.credit, r.balance])).toEqual([["1500", "0", "1500"], ["0", "1500", "0"]]);
    const csv = statementCsv(doc!, "vendor");
    expect(csv.split("\r\n")[0]).toBe("Date,Document,Description,Billed,Paid,Due to you,Currency");
    expect(csv.trim().split("\r\n")).toHaveLength(3);
    expect(csv).not.toContain("Credit held");
    // another vendor sees nothing of vendor A, and another organization gets no document
    expect((await loadVendorStatementDoc(db, { organizationId: org, vendorId: vendorB }))?.rows).toEqual([]);
    expect(await loadVendorStatementDoc(db, { organizationId: "other-org", vendorId: vendorA })).toBeNull();
  });

  it("rejecting a bill frees the billable amount and needs a reason", async () => {
    const b = await submitBill(db, { organizationId: org, vendorId: vendorA, workOrderId: woId, amount: "500" });
    await expect(rejectBill(db, { organizationId: org, id: b.id, note: " " })).rejects.toThrow(/reason/);
    await rejectBill(db, { organizationId: org, id: b.id, note: "Wrong reference" });
    const again = await submitBill(db, { organizationId: org, vendorId: vendorA, workOrderId: woId, amount: "500" });
    expect(again.status).toBe("SUBMITTED");
    await expect(rejectBill(db, { organizationId: org, id: billId, note: "late" })).rejects.toThrow(VendorError);
  });
});
