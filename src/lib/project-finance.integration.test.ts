import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ProjectError, addMilestone, assignTaskToMilestone, billMilestone, deleteTime, logTime, projectProfitability, setMemberRate, setMilestoneStatus } from "./project-finance";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, client: string, project: string, internal: string;
const TODAY = "2026-10-11";

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "TimeEntry","Milestone","Task","ProjectMember","Project","VendorBill","WorkOrder","Vendor","ExpenseVoucher","InvoiceLine","Invoice","NumberSequence","Client","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Proj Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other" } })).id;
  client = (await db.client.create({ data: { organizationId: org, name: "Acme", currency: "USD" } })).id;
  project = (await db.project.create({ data: { organizationId: org, number: "PRJ-1", name: "Site", clientId: client, managerId: "mgr", currency: "USD", budgetAmount: "5000", members: { create: [{ userId: "mgr" }, { userId: "dev", hourlyCost: "20" }, { userId: "norate" }] } } })).id;
  internal = (await db.project.create({ data: { organizationId: org, number: "PRJ-2", name: "Internal", managerId: "mgr", currency: "USD" } })).id;
});
afterAll(async () => { await db.$disconnect(); });

describe("milestones", () => {
  it("validates input and only bills projects that have a client", async () => {
    await expect(addMilestone(db, { organizationId: org, projectId: project, name: " " })).rejects.toThrow(ProjectError);
    await expect(addMilestone(db, { organizationId: org, projectId: project, name: "M", dueDate: "soon" })).rejects.toThrow(ProjectError);
    await expect(addMilestone(db, { organizationId: org, projectId: project, name: "M", amount: "0" })).rejects.toThrow(ProjectError);
    await expect(addMilestone(db, { organizationId: org, projectId: internal, name: "M", amount: "100" })).rejects.toThrow(/client/);
    await expect(addMilestone(db, { organizationId: other, projectId: project, name: "M" })).rejects.toThrow(/not found/);
  });

  it("cannot be finished while tasks are open; billing a finished milestone makes one linked draft invoice", async () => {
    const m = await addMilestone(db, { organizationId: org, projectId: project, name: "Design", amount: "1500", dueDate: "2026-11-01" });
    const t = await db.task.create({ data: { projectId: project, title: "Mockups" } });
    await assignTaskToMilestone(db, { organizationId: org, taskId: t.id, milestoneId: m.id });
    await expect(setMilestoneStatus(db, { organizationId: org, milestoneId: m.id, to: "DONE" })).rejects.toThrow(/not done/);
    await expect(billMilestone(db, { organizationId: org, milestoneId: m.id, actorId: "u" })).rejects.toThrow(/Finish/);
    await db.task.update({ where: { id: t.id }, data: { status: "DONE" } });
    await setMilestoneStatus(db, { organizationId: org, milestoneId: m.id, to: "DONE" });
    const rs = await Promise.all([1, 2, 3].map(() => billMilestone(db, { organizationId: org, milestoneId: m.id, actorId: "u" })));
    expect(new Set(rs.map((r) => r.invoiceId)).size).toBe(1);
    const inv = await db.invoice.findUniqueOrThrow({ where: { id: rs[0].invoiceId } });
    expect(inv.projectId).toBe(project);
    expect(inv.status).toBe("DRAFT");
    expect(inv.total.toString()).toBe("1500");
    expect(await db.invoice.count({ where: { projectId: project } })).toBe(1);
    await expect(setMilestoneStatus(db, { organizationId: org, milestoneId: m.id, to: "PENDING" })).rejects.toThrow(/invoiced/);
  });

  it("will not attach a task to another project's milestone", async () => {
    const m = await addMilestone(db, { organizationId: org, projectId: internal, name: "Other project" });
    const t = await db.task.create({ data: { projectId: project, title: "Stray" } });
    await expect(assignTaskToMilestone(db, { organizationId: org, taskId: t.id, milestoneId: m.id })).rejects.toThrow(/different project/);
  });
});

describe("time", () => {
  const log = (over: Partial<Parameters<typeof logTime>[1]> = {}) => logTime(db, { organizationId: org, projectId: project, userId: "dev", workDate: "2026-10-05", hours: "4", today: TODAY, ...over });

  it("validates dates, hours and membership", async () => {
    await expect(log({ workDate: "2026-10-12" })).rejects.toThrow(/future/);
    await expect(log({ hours: "0" })).rejects.toThrow(ProjectError);
    await expect(log({ hours: "25" })).rejects.toThrow(ProjectError);
    await expect(log({ hours: "abc" })).rejects.toThrow(ProjectError);
    await expect(log({ userId: "stranger" })).rejects.toThrow(/on the project/);
    await expect(log({ taskId: "nope" })).rejects.toThrow(/not on this project/);
  });

  it("freezes the cost rate at the time of logging", async () => {
    const e = await log({ workDate: "2026-10-01", hours: "2" });
    expect(e.hourlyCost?.toString()).toBe("20");
    await setMemberRate(db, { organizationId: org, projectId: project, userId: "dev", hourlyCost: "30" });
    expect((await db.timeEntry.findUniqueOrThrow({ where: { id: e.id } })).hourlyCost?.toString()).toBe("20");
    expect((await log({ workDate: "2026-10-02", hours: "1" })).hourlyCost?.toString()).toBe("30");
    await setMemberRate(db, { organizationId: org, projectId: project, userId: "dev", hourlyCost: "20" });
  });

  it("never lets one person log more than 24 hours in a day, even concurrently", async () => {
    const rs = await Promise.allSettled([1, 2, 3].map(() => log({ workDate: "2026-09-01", hours: "10" })));
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    const sum = await db.timeEntry.aggregate({ where: { userId: "dev", workDate: "2026-09-01" }, _sum: { hours: true } });
    expect(Number(sum._sum.hours)).toBeLessThanOrEqual(24);
  });

  it("only owners or managers can delete an entry", async () => {
    const e = await log({ workDate: "2026-08-01", hours: "1" });
    await expect(deleteTime(db, { organizationId: org, entryId: e.id, actorId: "someone", isManager: false, today: TODAY })).rejects.toThrow(/your own/);
    await deleteTime(db, { organizationId: org, entryId: e.id, actorId: "mgr", isManager: true, today: TODAY });
    expect(await db.timeEntry.count({ where: { id: e.id } })).toBe(0);
  });
});

describe("profitability", () => {
  it("combines revenue, labour, expenses and vendor bills, and leaves other currencies out", async () => {
    const p = await db.project.create({ data: { organizationId: org, number: "PRJ-3", name: "Money", clientId: client, managerId: "mgr", currency: "USD", budgetAmount: "1000", members: { create: [{ userId: "dev", hourlyCost: "25" }, { userId: "norate" }] } } });
    const mkInv = (status: string, subtotal: string, currency = "USD") =>
      db.invoice.create({ data: { organizationId: org, clientId: client, projectId: p.id, status, currency, subtotal, total: subtotal } });
    await mkInv("ISSUED", "2000"); await mkInv("PAID", "500"); await mkInv("DRAFT", "9999"); await mkInv("CANCELLED", "777"); await mkInv("ISSUED", "100", "AED");
    await logTime(db, { organizationId: org, projectId: p.id, userId: "dev", workDate: "2026-10-01", hours: "8", today: TODAY });
    await logTime(db, { organizationId: org, projectId: p.id, userId: "norate", workDate: "2026-10-01", hours: "3", today: TODAY });
    const v = (status: string, amount: string, currency = "USD") =>
      db.expenseVoucher.create({ data: { organizationId: org, number: `V-${Math.random()}`, date: "2026-10-02", payee: "x", description: "x", expenseAccountId: "a", projectId: p.id, currency, amount, status, submittedById: "u" } });
    await v("POSTED", "150"); await v("PAID", "50"); await v("SUBMITTED", "400"); await v("REJECTED", "300"); await v("POSTED", "90", "GBP");
    const vendor = await db.vendor.create({ data: { organizationId: org, name: "Studio", code: "V-1" } });
    const wo = await db.workOrder.create({ data: { organizationId: org, number: "WO-1", vendorId: vendor.id, projectId: p.id, title: "Video", amount: "600", currency: "USD", status: "ACCEPTED" } });
    await db.vendorBill.create({ data: { organizationId: org, number: "VB-1", vendorId: vendor.id, workOrderId: wo.id, amount: "250", currency: "USD", status: "POSTED" } });
    await db.vendorBill.create({ data: { organizationId: org, number: "VB-2", vendorId: vendor.id, workOrderId: wo.id, amount: "999", currency: "USD", status: "SUBMITTED" } });

    const r = await projectProfitability(db, org, p.id);
    expect(r.revenue.toString()).toBe("2500");
    expect(r.labour.toString()).toBe("200"); // 8h x 25; the unrated 3h cost nothing and are flagged
    expect(r.entriesWithoutRate).toBe(1);
    expect(r.hours.toString()).toBe("11");
    expect(r.expenses.toString()).toBe("200");
    expect(r.vendor.toString()).toBe("250");
    expect(r.cost.toString()).toBe("650");
    expect(r.profit.toString()).toBe("1850");
    expect(r.margin?.toString()).toBe("74");
    expect(r.committed.toString()).toBe("350"); // 600 work order minus 250 already billed
    expect(r.budgetUsedPct?.toString()).toBe("100"); // (650 + 350) / 1000
    expect(r.excluded.map((e) => e.currency).sort()).toEqual(["AED", "GBP"]);
  });

  it("is zero and has no margin for an empty project, and respects organization", async () => {
    const r = await projectProfitability(db, org, internal);
    expect(r.revenue.toString()).toBe("0");
    expect(r.margin).toBeNull();
    await expect(projectProfitability(db, other, internal)).rejects.toThrow(/not found/);
  });
});
