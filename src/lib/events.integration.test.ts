import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { contactsAssigned, invoiceIssued, leadAssigned, paymentReceived, payrollPaid, quoteDecided, vendorBillChanged } from "./events";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, otherOrg: string, client: string, vendor: string, stage: string, bank: string;
let manager: string, agent: string, clientUser: string, otherClientUser: string, vendorUser: string;

const user = async (o: string, name: string, extra: Record<string, string> = {}) =>
  (await db.user.create({ data: { organizationId: o, email: `${name}-${Math.random()}@test.local`, name, passwordHash: "x", ...extra } })).id;
const inbox = (userId: string) => db.notification.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "Notification","PaymentAllocation","Payment","BankAccount","Invoice","Quote","Lead","PipelineStage","PayrollItem","PayrollRun","VendorBill","WorkOrder","Vendor","Client","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Events Org" } })).id;
  otherOrg = (await db.organization.create({ data: { name: "Other Org" } })).id;
  client = (await db.client.create({ data: { organizationId: org, name: "Acme", currency: "USD" } })).id;
  const otherClient = (await db.client.create({ data: { organizationId: org, name: "Beta", currency: "USD" } })).id;
  vendor = (await db.vendor.create({ data: { organizationId: org, code: "VND-1", name: "Print Co" } })).id;
  stage = (await db.pipelineStage.create({ data: { organizationId: org, name: "New", sortOrder: 1 } })).id;
  bank = (await db.bankAccount.create({ data: { organizationId: org, internalName: "Main", bankName: "Bank", accountHolder: "Hifi", accountNumber: "1", currency: "USD" } })).id;
  manager = await user(org, "Manager");
  agent = await user(org, "Agent");
  clientUser = await user(org, "Client person", { userType: "CLIENT", clientId: client });
  otherClientUser = await user(org, "Other client person", { userType: "CLIENT", clientId: otherClient });
  vendorUser = await user(org, "Vendor person", { userType: "VENDOR", vendorId: vendor });
});
beforeEach(async () => { await db.notification.deleteMany({}); });
afterAll(async () => { await db.$disconnect(); });

describe("lead and contact assignment", () => {
  it("tells the new owner once, and nobody when people assign to themselves", async () => {
    const lead = await db.lead.create({ data: { organizationId: org, name: "Zara Foods", stageId: stage } });
    await leadAssigned(db, { organizationId: org, leadId: lead.id, toUserId: agent, byUserId: manager });
    await leadAssigned(db, { organizationId: org, leadId: lead.id, toUserId: agent, byUserId: manager });
    await leadAssigned(db, { organizationId: org, leadId: lead.id, toUserId: manager, byUserId: manager });
    const got = await inbox(agent);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ kind: "lead.assigned", link: `/leads/${lead.id}` });
    expect(await inbox(manager)).toHaveLength(0);
  });

  it("ignores a lead from another organization", async () => {
    const lead = await db.lead.create({ data: { organizationId: org, name: "Hidden", stageId: stage } });
    await leadAssigned(db, { organizationId: otherOrg, leadId: lead.id, toUserId: agent, byUserId: manager });
    expect(await inbox(agent)).toHaveLength(0);
  });

  it("sums a bulk assignment into one message", async () => {
    await contactsAssigned(db, { toUserId: agent, byUserId: manager, count: 7, batchKey: "b1" });
    await contactsAssigned(db, { toUserId: agent, byUserId: manager, count: 0, batchKey: "b2" });
    const got = await inbox(agent);
    expect(got).toHaveLength(1);
    expect(got[0].title).toBe("7 contacts assigned to you");
  });
});

describe("client portal news", () => {
  it("tells only the invoiced client's portal users about an issued invoice, never a draft", async () => {
    const draft = await db.invoice.create({ data: { organizationId: org, clientId: client, currency: "USD" } });
    await invoiceIssued(db, { organizationId: org, invoiceId: draft.id });
    expect(await inbox(clientUser)).toHaveLength(0);
    const inv = await db.invoice.create({ data: { organizationId: org, clientId: client, currency: "USD", number: "INV-000001", status: "ISSUED", total: "1200.50" } });
    await invoiceIssued(db, { organizationId: org, invoiceId: inv.id });
    await invoiceIssued(db, { organizationId: org, invoiceId: inv.id });
    const got = await inbox(clientUser);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ kind: "invoice.issued", title: "New invoice INV-000001", link: `/portal/invoices/${inv.id}` });
    expect(await inbox(otherClientUser)).toHaveLength(0);
  });

  it("tells the salesperson who won the client and the client about a payment, but not the person who recorded it", async () => {
    await db.lead.create({ data: { organizationId: org, name: "Acme lead", stageId: stage, clientId: client, assignedToId: agent, convertedAt: new Date() } });
    const pay = await db.payment.create({ data: { organizationId: org, number: "RCPT-000001", clientId: client, bankAccountId: bank, currency: "USD", amount: "500", date: new Date(), idempotencyKey: "k1" } });
    await paymentReceived(db, { organizationId: org, paymentId: pay.id, actorId: manager });
    expect((await inbox(agent)).map((n) => n.title)).toEqual(["Acme paid $500.00"]);
    expect(await inbox(clientUser)).toHaveLength(1);
    expect(await inbox(manager)).toHaveLength(0);
    await db.notification.deleteMany({});
    await paymentReceived(db, { organizationId: org, paymentId: pay.id, actorId: agent });
    expect(await inbox(agent)).toHaveLength(0);
  });
});

describe("quote decisions", () => {
  it("tells the person who made the quote when the client decides, and stays quiet for an undecided quote", async () => {
    const sent = await db.quote.create({ data: { organizationId: org, number: "QT-000001", clientId: client, currency: "USD", status: "SENT", createdById: agent } });
    await quoteDecided(db, { organizationId: org, quoteId: sent.id });
    expect(await inbox(agent)).toHaveLength(0);
    await db.quote.update({ where: { id: sent.id }, data: { status: "ACCEPTED" } });
    await quoteDecided(db, { organizationId: org, quoteId: sent.id });
    const got = await inbox(agent);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ kind: "quote.accepted", title: "Acme accepted quotation QT-000001" });
  });
});

describe("payroll and vendors", () => {
  it("tells each person on a paid run, and nobody before it is paid", async () => {
    const run = await db.payrollRun.create({ data: { organizationId: org, period: "2026-09", currency: "USD", status: "POSTED" } });
    const item = { workingDays: 22, unpaidDays: "0", basic: "100", allowance: "0", unpaidDeduction: "0", gross: "100", taxPercent: "0", tax: "0", net: "100" };
    await db.payrollItem.createMany({ data: [{ runId: run.id, userId: agent, ...item }, { runId: run.id, userId: manager, ...item }] });
    await payrollPaid(db, { organizationId: org, runId: run.id });
    expect(await inbox(agent)).toHaveLength(0);
    await db.payrollRun.update({ where: { id: run.id }, data: { status: "PAID" } });
    await payrollPaid(db, { organizationId: org, runId: run.id });
    await payrollPaid(db, { organizationId: org, runId: run.id });
    expect(await inbox(agent)).toHaveLength(1);
    expect((await inbox(manager))[0].title).toBe("Your salary for 2026-09 has been paid");
    expect(await inbox(clientUser)).toHaveLength(0);
  });

  it("tells the vendor once per bill status, and not about a bill still waiting", async () => {
    const wo = await db.workOrder.create({ data: { organizationId: org, number: "WO-1", vendorId: vendor, title: "Flyers", amount: "300", currency: "USD" } });
    const bill = await db.vendorBill.create({ data: { organizationId: org, number: "VB-1", vendorId: vendor, workOrderId: wo.id, amount: "300", currency: "USD" } });
    await vendorBillChanged(db, { organizationId: org, billId: bill.id });
    expect(await inbox(vendorUser)).toHaveLength(0);
    await db.vendorBill.update({ where: { id: bill.id }, data: { status: "APPROVED" } });
    await vendorBillChanged(db, { organizationId: org, billId: bill.id });
    await vendorBillChanged(db, { organizationId: org, billId: bill.id });
    await db.vendorBill.update({ where: { id: bill.id }, data: { status: "PAID" } });
    await vendorBillChanged(db, { organizationId: org, billId: bill.id });
    expect((await inbox(vendorUser)).map((n) => n.title)).toEqual(["Bill VB-1 was approved", "Bill VB-1 has been paid"]);
    expect(await inbox(clientUser)).toHaveLength(0);
  });
});
