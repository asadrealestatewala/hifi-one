// Vendors and procurement. Formal flow, with a human decision at each step (applying never awards):
// Opportunity -> Application -> Approved -> Work order -> Delivered -> Accepted -> Bill -> Approved -> Posted -> Paid.
// Free of Next.js imports so it can be tested against the database.
import { Prisma, type PrismaClient } from "@prisma/client";
import { LedgerError, dec, type DraftLine } from "./ledger-math";
import { postJournal } from "./accounting";

export class VendorError extends Error {}
type Tx = Prisma.TransactionClient;
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;

async function seq(tx: Tx, organizationId: string, key: string, prefix: string, pad: number) {
  const s = await tx.numberSequence.upsert({
    where: { organizationId_key: { organizationId, key } },
    create: { organizationId, key, next: 2 },
    update: { next: { increment: 1 } },
  });
  return `${prefix}-${String(s.next - 1).padStart(pad, "0")}`;
}

export async function createVendor(
  db: PrismaClient,
  p: { organizationId: string; name: string; email?: string; phone?: string; country?: string; currency: string; categories?: string; paymentTermsDays: number },
) {
  if (p.name.trim().length < 2) throw new VendorError("Vendor name is required.");
  if (await db.vendor.findFirst({ where: { organizationId: p.organizationId, name: { equals: p.name.trim(), mode: "insensitive" } } })) {
    throw new VendorError("A vendor with this name already exists.");
  }
  return db.$transaction(async (tx) => {
    const code = await seq(tx, p.organizationId, "VENDOR", "V", 4);
    return tx.vendor.create({
      data: {
        organizationId: p.organizationId, code, name: p.name.trim(), email: p.email?.trim().toLowerCase() || null, phone: p.phone || null,
        country: p.country || null, currency: p.currency, categories: p.categories || null, paymentTermsDays: p.paymentTermsDays,
      },
    });
  });
}

export async function setVendorStatus(db: PrismaClient, p: { organizationId: string; vendorId: string; status: "APPROVED" | "SUSPENDED" }) {
  const v = await db.vendor.findFirst({ where: { id: p.vendorId, organizationId: p.organizationId } });
  if (!v) throw new VendorError("Vendor not found.");
  return db.vendor.update({ where: { id: v.id }, data: { status: p.status } });
}

export async function createOpportunity(
  db: PrismaClient,
  p: { organizationId: string; title: string; scope: string; skills?: string; budgetMin?: string; budgetMax?: string; currency: string; deadline?: string; createdById: string },
) {
  if (p.title.trim().length < 3 || p.scope.trim().length < 5) throw new VendorError("Enter a title and a scope.");
  for (const v of [p.budgetMin, p.budgetMax]) if (v && !MONEY.test(v)) throw new VendorError("Budget amounts must be positive numbers.");
  if (p.budgetMin && p.budgetMax && Number(p.budgetMin) > Number(p.budgetMax)) throw new VendorError("The minimum budget cannot exceed the maximum.");
  return db.vendorOpportunity.create({
    data: {
      organizationId: p.organizationId, title: p.title.trim(), scope: p.scope.trim(), skills: p.skills || null, budgetMin: p.budgetMin || null,
      budgetMax: p.budgetMax || null, currency: p.currency, deadline: p.deadline || null, createdById: p.createdById,
    },
  });
}

export async function apply(db: PrismaClient, p: { vendorId: string; opportunityId: string; quote: string; proposal?: string; today: string }) {
  if (!MONEY.test(p.quote) || Number(p.quote) <= 0) throw new VendorError("Enter your quotation amount.");
  const vendor = await db.vendor.findUnique({ where: { id: p.vendorId } });
  if (!vendor || vendor.status !== "APPROVED") throw new VendorError("Only approved vendors can apply.");
  const opp = await db.vendorOpportunity.findFirst({ where: { id: p.opportunityId, organizationId: vendor.organizationId } });
  if (!opp || opp.status !== "OPEN") throw new VendorError("This opportunity is not open.");
  if (opp.deadline && opp.deadline < p.today) throw new VendorError("The application deadline has passed.");
  try {
    return await db.vendorApplication.create({ data: { opportunityId: opp.id, vendorId: vendor.id, quoteAmount: p.quote, proposal: p.proposal?.trim() || null } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new VendorError("You have already applied to this opportunity.");
    throw e;
  }
}

export async function decideApplication(db: PrismaClient, p: { organizationId: string; id: string; deciderId: string; status: "SHORTLISTED" | "APPROVED" | "REJECTED" }) {
  const a = await db.vendorApplication.findUnique({ where: { id: p.id }, include: { opportunity: true } });
  if (!a || a.opportunity.organizationId !== p.organizationId) throw new VendorError("Application not found.");
  return db.vendorApplication.update({ where: { id: a.id }, data: { status: p.status, decidedById: p.deciderId } });
}

// Awarding is a deliberate step: an approved application is turned into a work order by a person.
export async function issueWorkOrder(
  db: PrismaClient,
  p: { organizationId: string; issuedById: string; applicationId?: string; vendorId?: string; title?: string; amount?: string; projectId?: string },
) {
  return db.$transaction(async (tx) => {
    let vendorId = p.vendorId;
    let amount = p.amount;
    let title = p.title;
    let currency: string | undefined;
    if (p.applicationId) {
      await tx.$queryRaw`SELECT id FROM "VendorApplication" WHERE id = ${p.applicationId} FOR UPDATE`;
      const app = await tx.vendorApplication.findUnique({ where: { id: p.applicationId }, include: { opportunity: true } });
      if (!app || app.opportunity.organizationId !== p.organizationId) throw new VendorError("Application not found.");
      if (app.status !== "APPROVED") throw new VendorError("Approve the application before issuing a work order.");
      const existing = await tx.workOrder.findUnique({ where: { applicationId: app.id } });
      if (existing) return existing; // already issued: idempotent
      vendorId = app.vendorId;
      amount = amount || app.quoteAmount.toString();
      title = title || app.opportunity.title;
      currency = app.opportunity.currency;
    }
    const vendor = vendorId ? await tx.vendor.findFirst({ where: { id: vendorId, organizationId: p.organizationId } }) : null;
    if (!vendor || vendor.status !== "APPROVED") throw new VendorError("Choose an approved vendor.");
    if (!amount || !MONEY.test(amount) || Number(amount) <= 0) throw new VendorError("Enter a work order amount.");
    if (!title || title.trim().length < 3) throw new VendorError("Enter a title.");
    const number = await seq(tx, p.organizationId, "WO", "WO", 5);
    return tx.workOrder.create({
      data: {
        organizationId: p.organizationId, number, vendorId: vendor.id, applicationId: p.applicationId ?? null, projectId: p.projectId || null,
        title: title.trim(), amount, currency: currency ?? vendor.currency, issuedById: p.issuedById,
      },
    });
  });
}

export async function markDelivered(db: PrismaClient, p: { vendorId: string; workOrderId: string }) {
  const wo = await db.workOrder.findFirst({ where: { id: p.workOrderId, vendorId: p.vendorId } });
  if (!wo) throw new VendorError("Work order not found.");
  if (wo.status !== "ISSUED") throw new VendorError("Only an issued work order can be marked delivered.");
  return db.workOrder.update({ where: { id: wo.id }, data: { status: "DELIVERED" } });
}

export async function acceptDelivery(db: PrismaClient, p: { organizationId: string; workOrderId: string; accepterId: string; accept: boolean }) {
  const wo = await db.workOrder.findFirst({ where: { id: p.workOrderId, organizationId: p.organizationId } });
  if (!wo) throw new VendorError("Work order not found.");
  if (wo.status !== "DELIVERED") throw new VendorError("The vendor has not marked this work as delivered.");
  // Rejecting sends it back to the vendor to fix
  return db.workOrder.update({ where: { id: wo.id }, data: p.accept ? { status: "ACCEPTED", acceptedById: p.accepterId } : { status: "ISSUED" } });
}

export async function submitBill(db: PrismaClient, p: { organizationId: string; vendorId: string; workOrderId: string; amount: string; reference?: string }) {
  if (!MONEY.test(p.amount) || Number(p.amount) <= 0) throw new VendorError("Enter the bill amount.");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "WorkOrder" WHERE id = ${p.workOrderId} FOR UPDATE`; // serialise bills against one work order
    const wo = await tx.workOrder.findFirst({ where: { id: p.workOrderId, vendorId: p.vendorId, organizationId: p.organizationId } });
    if (!wo) throw new VendorError("Work order not found.");
    if (wo.status !== "ACCEPTED") throw new VendorError("You can bill only after the delivery has been accepted.");
    const billed = await tx.vendorBill.aggregate({ where: { workOrderId: wo.id, status: { not: "REJECTED" } }, _sum: { amount: true } });
    const remaining = wo.amount.sub(billed._sum.amount ?? 0);
    if (dec(p.amount).gt(remaining)) throw new VendorError(`This exceeds the work order. ${remaining.toString()} ${wo.currency} is still billable.`);
    const number = await seq(tx, p.organizationId, "VB", "VB", 6);
    return tx.vendorBill.create({
      data: { organizationId: p.organizationId, number, vendorId: p.vendorId, workOrderId: wo.id, vendorReference: p.reference?.trim() || null, amount: p.amount, currency: wo.currency },
    });
  });
}

async function lockBill(tx: Tx, organizationId: string, id: string) {
  await tx.$queryRaw`SELECT id FROM "VendorBill" WHERE id = ${id} FOR UPDATE`;
  const b = await tx.vendorBill.findFirst({ where: { id, organizationId } });
  if (!b) throw new VendorError("Bill not found.");
  return b;
}

export async function approveBill(db: PrismaClient, p: { organizationId: string; id: string; approverId: string; expenseAccountId: string }) {
  return db.$transaction(async (tx) => {
    const b = await lockBill(tx, p.organizationId, p.id);
    if (b.status !== "SUBMITTED") throw new VendorError("Only a submitted bill can be approved.");
    const acct = await tx.account.findFirst({ where: { id: p.expenseAccountId, organizationId: p.organizationId, active: true } });
    if (!acct || !["OPEX", "DIRECT_COST", "OTHER_EXPENSE"].includes(acct.type)) throw new VendorError("Choose an expense account.");
    return tx.vendorBill.update({ where: { id: b.id }, data: { status: "APPROVED", approvedById: p.approverId, expenseAccountId: acct.id } });
  });
}

export async function rejectBill(db: PrismaClient, p: { organizationId: string; id: string; note: string }) {
  if (!p.note.trim()) throw new VendorError("A reason is required.");
  return db.$transaction(async (tx) => {
    const b = await lockBill(tx, p.organizationId, p.id);
    if (!["SUBMITTED", "APPROVED"].includes(b.status)) throw new VendorError("This bill can no longer be rejected.");
    return tx.vendorBill.update({ where: { id: b.id }, data: { status: "REJECTED", decisionNote: p.note.trim() } });
  });
}

async function systemAccount(tx: Tx, organizationId: string, systemKey: string) {
  const a = await tx.account.findFirst({ where: { organizationId, systemKey, active: true } });
  if (!a) throw new LedgerError(`Chart of accounts is missing the ${systemKey} account.`);
  return a;
}

export async function postBill(db: PrismaClient, p: { organizationId: string; id: string; actorId: string }) {
  return db.$transaction(async (tx) => {
    const b = await lockBill(tx, p.organizationId, p.id);
    if (b.status === "POSTED" || b.status === "PAID") return b;
    if (b.status !== "APPROVED" || !b.expenseAccountId) throw new VendorError("Approve the bill before posting it.");
    const ap = await systemAccount(tx, p.organizationId, "ACCOUNTS_PAYABLE");
    const lines: DraftLine[] = [
      { accountId: b.expenseAccountId, debit: b.amount, memo: b.number },
      { accountId: ap.id, credit: b.amount, vendorId: b.vendorId, memo: `${b.number} ${b.vendorReference ?? ""}`.trim() },
    ];
    const entry = await postJournal(tx, {
      organizationId: p.organizationId, date: new Date(), memo: `Vendor bill ${b.number}`, currency: b.currency, sourceType: "VENDOR_BILL",
      sourceId: b.id, idempotencyKey: `vendor-bill-post:${b.id}`, postedById: p.actorId, lines,
    });
    return tx.vendorBill.update({ where: { id: b.id }, data: { status: "POSTED", journalEntryId: entry.id } });
  });
}

export async function payBill(db: PrismaClient, p: { organizationId: string; id: string; bankAccountId: string; actorId: string }) {
  return db.$transaction(async (tx) => {
    const b = await lockBill(tx, p.organizationId, p.id);
    if (b.status === "PAID") return b;
    if (b.status !== "POSTED") throw new VendorError("Post the bill before paying it.");
    const bank = await tx.bankAccount.findFirst({ where: { id: p.bankAccountId, organizationId: p.organizationId, active: true } });
    if (!bank?.ledgerAccountId) throw new VendorError("Choose an active bank account linked to the ledger.");
    if (bank.currency !== b.currency) throw new VendorError(`This bill is in ${b.currency}; choose a ${b.currency} bank account.`);
    const ap = await systemAccount(tx, p.organizationId, "ACCOUNTS_PAYABLE");
    const entry = await postJournal(tx, {
      organizationId: p.organizationId, date: new Date(), memo: `Payment of vendor bill ${b.number}`, currency: b.currency, sourceType: "VENDOR_PAYMENT",
      sourceId: b.id, idempotencyKey: `vendor-bill-pay:${b.id}`, postedById: p.actorId,
      lines: [{ accountId: ap.id, debit: b.amount, vendorId: b.vendorId }, { accountId: bank.ledgerAccountId, credit: b.amount }],
    });
    return tx.vendorBill.update({ where: { id: b.id }, data: { status: "PAID", paymentEntryId: entry.id } });
  });
}

// What we owe this vendor, line by line (bills credit, payments debit), per currency.
export async function vendorLedger(db: PrismaClient, organizationId: string, vendorId: string) {
  const ap = await db.account.findFirst({ where: { organizationId, systemKey: "ACCOUNTS_PAYABLE" } });
  if (!ap) return [];
  const lines = await db.journalLine.findMany({
    where: { vendorId, accountId: ap.id, entry: { organizationId } },
    orderBy: [{ entry: { createdAt: "asc" } }, { id: "asc" }],
    include: { entry: true },
  });
  const run = new Map<string, Prisma.Decimal>();
  return lines.map((l) => {
    const cur = l.entry.currency;
    const bal = (run.get(cur) ?? dec(0)).add(l.credit).sub(l.debit);
    run.set(cur, bal);
    return { date: l.entry.createdAt, number: l.entry.number, description: l.entry.memo ?? "", billed: l.credit, paid: l.debit, balance: bal, currency: cur };
  });
}
