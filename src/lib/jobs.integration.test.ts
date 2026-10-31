import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { runJobs } from "./jobs";
import { createSubscription } from "./sales";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, fin: string, client: string, clientUser: string, dev: string, project: string;
const NOW = new Date("2026-10-17T08:00:00.000Z");
const inbox = (id: string) => db.notification.findMany({ where: { userId: id }, orderBy: { createdAt: "asc" } });

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "JobRun","Notification","SubscriptionInvoice","Subscription","Quote","Contract","Task","Project","InvoiceLine","Invoice","NumberSequence","Client","UserRole","RolePermission","Role","Permission","User","CompanyProfile","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Jobs Org" } })).id;
  other = (await db.organization.create({ data: { name: "Quiet Org" } })).id;
  await db.companyProfile.create({ data: { organizationId: org, isDefault: true, legalName: "Jobs Org", timezone: "Asia/Karachi" } });
  const perm = await db.permission.create({ data: { key: "finance.post", description: "x" } });
  const view = await db.permission.create({ data: { key: "finance.view", description: "x" } });
  const role = await db.role.create({ data: { organizationId: org, key: "FIN", name: "Finance" } });
  await db.rolePermission.createMany({ data: [{ roleId: role.id, permissionId: perm.id }, { roleId: role.id, permissionId: view.id }] });
  fin = (await db.user.create({ data: { organizationId: org, email: "fin@j.test", name: "Fin", passwordHash: "x", roles: { create: { roleId: role.id } } } })).id;
  dev = (await db.user.create({ data: { organizationId: org, email: "dev@j.test", name: "Dev", passwordHash: "x" } })).id;
  client = (await db.client.create({ data: { organizationId: org, name: "Acme", currency: "USD" } })).id;
  clientUser = (await db.user.create({ data: { organizationId: org, email: "c@j.test", name: "Client", userType: "CLIENT", clientId: client, passwordHash: "x" } })).id;
  project = (await db.project.create({ data: { organizationId: org, number: "P1", name: "Site", managerId: fin } })).id;
});
afterAll(async () => { await db.$disconnect(); });

describe("scheduled jobs", () => {
  it("bills a due subscription as a draft once, tells finance, and a rerun the same day does nothing", async () => {
    await createSubscription(db, { organizationId: org, clientId: client, name: "Social retainer", currency: "USD", amount: "500", taxRate: "0", interval: "MONTHLY", startDate: "2026-10-01", createdById: fin });
    const first = await runJobs(db, { now: NOW, only: ["subscription_billing"] });
    expect(first.find((r) => r.organizationId === org)).toMatchObject({ status: "OK", summary: "1 draft invoice created" });
    expect((await db.invoice.findMany({ where: { organizationId: org } })).map((i) => i.status)).toEqual(["DRAFT"]);
    expect((await inbox(fin)).map((n) => n.kind)).toEqual(["billing.drafts"]);
    const again = await runJobs(db, { now: NOW, only: ["subscription_billing"] });
    expect(again.find((r) => r.organizationId === org)?.status).toBe("SKIPPED");
    expect(await db.invoice.count({ where: { organizationId: org } })).toBe(1);
    const forced = await runJobs(db, { now: NOW, only: ["subscription_billing"], force: true });
    expect(forced.find((r) => r.organizationId === org)?.summary).toBe("0 draft invoices created");
  });

  it("expires old quotations and contracts", async () => {
    await db.quote.create({ data: { organizationId: org, number: "QT-1", clientId: client, currency: "USD", status: "SENT", validUntil: "2026-10-01" } });
    await db.contract.create({ data: { organizationId: org, clientId: client, title: "Old", status: "ACTIVE", endDate: "2026-09-30" } });
    const r = await runJobs(db, { now: NOW, only: ["expiry_sweep"] });
    expect(r.find((x) => x.organizationId === org)?.summary).toBe("1 quotation and 1 contract expired");
  });

  it("reminds finance and the client about an overdue invoice once a week, and the client three days before due", async () => {
    await db.invoice.create({ data: { organizationId: org, clientId: client, currency: "USD", number: "INV-9", status: "ISSUED", total: "300", dueDate: new Date("2026-10-10T00:00:00Z") } });
    await db.invoice.create({ data: { organizationId: org, clientId: client, currency: "USD", number: "INV-10", status: "ISSUED", total: "200", dueDate: new Date("2026-10-20T00:00:00Z") } });
    await db.notification.deleteMany({});
    await runJobs(db, { now: NOW, only: ["invoice_reminders"] });
    await runJobs(db, { now: NOW, only: ["invoice_reminders"], force: true });
    expect((await inbox(fin)).map((n) => n.title)).toEqual(["Overdue: INV-9 (Acme)"]);
    expect((await inbox(clientUser)).map((n) => n.kind).sort()).toEqual(["invoice.due_soon", "invoice.overdue"]);
    expect(await inbox(dev)).toHaveLength(0);
  });

  it("reminds assignees about tasks due tomorrow, once", async () => {
    await db.task.create({ data: { projectId: project, title: "Ship banners", assigneeId: dev, dueDate: new Date("2026-10-18T00:00:00Z") } });
    await db.task.create({ data: { projectId: project, title: "Far away", assigneeId: dev, dueDate: new Date("2026-11-30T00:00:00Z") } });
    await runJobs(db, { now: NOW, only: ["task_reminders"] });
    await runJobs(db, { now: NOW, only: ["task_reminders"], force: true });
    expect((await inbox(dev)).map((n) => n.title)).toEqual(["Due tomorrow: Ship banners"]);
  });

  it("records every run, and one organization's jobs do not touch another's", async () => {
    const runs = await db.jobRun.findMany({ where: { organizationId: org } });
    expect(runs.length).toBeGreaterThan(4);
    expect(runs.every((r) => r.status === "OK")).toBe(true);
    const quiet = await db.invoice.count({ where: { organizationId: other } });
    expect(quiet).toBe(0);
    expect((await db.jobRun.findMany({ where: { organizationId: other, key: "subscription_billing" } })).every((r) => r.summary === "0 draft invoices created")).toBe(true);
  });

  it("refuses a second runner while one is in progress, and recovers a stuck run", async () => {
    await db.jobRun.create({ data: { organizationId: org, key: "monitoring_purge", runDate: "2026-10-17", status: "RUNNING", startedAt: NOW } });
    const blocked = await runJobs(db, { now: new Date(NOW.getTime() + 60_000), only: ["monitoring_purge"], force: true, organizationId: org });
    expect(blocked[0]).toMatchObject({ status: "SKIPPED", summary: "Another run is in progress" });
    const later = await runJobs(db, { now: new Date(NOW.getTime() + 45 * 60_000), only: ["monitoring_purge"], force: true, organizationId: org });
    expect(later[0].status).toBe("OK");
    expect((await db.jobRun.findMany({ where: { organizationId: org, key: "monitoring_purge", error: "Timed out" } })).length).toBe(1);
  });
});
