// Project automations against hifi_one_test: a milestone closes (with a draft invoice for finance) when its last task is done,
// and a won lead starts its client's project from the template linked to its service plan, once.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { changeTaskStatus } from "./tasks";
import { projectForWonLead } from "./project-automations";
import { cleanDefaults, saveTemplate } from "./project-templates";
import { convertLead } from "./conversion";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, boss: string, finance: string, writer: string, gone: string, stranger: string, client: string, project: string, internal: string;
let plan: string, otherPlan: string, foreignPlan: string, won: string, stage: string;
const mkUser = (o: string, name: string, active = true) => db.user.create({ data: { organizationId: o, email: `${name}@auto.test`, name, passwordHash: "x", userType: "EMPLOYEE", active } }).then((u) => u.id);

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "Notification","LeadActivity","Lead","PipelineStage","PlanPrice","PlanFeature","ServicePlan","ServiceCategory","ProjectTemplate","TaskChecklistItem","Milestone","Task","ProjectMember","Project","InvoiceLine","Invoice","NumberSequence","Client","UserRole","RolePermission","Role","Permission","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Auto Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other" } })).id;
  boss = await mkUser(org, "boss"); finance = await mkUser(org, "finance"); writer = await mkUser(org, "writer"); gone = await mkUser(org, "gone", false); stranger = await mkUser(other, "stranger");
  const perm = await db.permission.create({ data: { key: "finance.post", description: "x" } });
  const role = await db.role.create({ data: { organizationId: org, key: "FIN", name: "Finance", permissions: { create: [{ permissionId: perm.id }] } } });
  await db.userRole.create({ data: { userId: finance, roleId: role.id } });
  client = (await db.client.create({ data: { organizationId: org, name: "Acme", currency: "USD" } })).id;
  project = (await db.project.create({ data: { organizationId: org, number: "A-1", name: "Acme retainer", clientId: client, managerId: boss, currency: "USD", members: { create: [{ userId: boss }, { userId: writer }] } } })).id;
  internal = (await db.project.create({ data: { organizationId: org, number: "A-2", name: "Internal", managerId: boss, currency: "USD" } })).id;
  const cat = await db.serviceCategory.create({ data: { organizationId: org, name: "Social media" } });
  plan = (await db.servicePlan.create({ data: { organizationId: org, categoryId: cat.id, name: "Social Starter" } })).id;
  otherPlan = (await db.servicePlan.create({ data: { organizationId: org, categoryId: cat.id, name: "Website" } })).id;
  const ocat = await db.serviceCategory.create({ data: { organizationId: other, name: "X" } });
  foreignPlan = (await db.servicePlan.create({ data: { organizationId: other, categoryId: ocat.id, name: "Foreign" } })).id;
  stage = (await db.pipelineStage.create({ data: { organizationId: org, name: "New", sortOrder: 1 } })).id;
  won = (await db.pipelineStage.create({ data: { organizationId: org, name: "Closed Won", sortOrder: 9, isWon: true } })).id;
});
beforeEach(async () => { await db.notification.deleteMany(); });
afterAll(async () => { await db.$disconnect(); });

const milestone = (projectId: string, over: Record<string, unknown> = {}) => db.milestone.create({ data: { projectId, name: "Month plan", ...over } });
const task = (projectId: string, milestoneId: string, title: string) => db.task.create({ data: { projectId, milestoneId, title, status: "IN_PROGRESS" } });
const move = (projectId: string, taskId: string, status: string, actorId = writer) => changeTaskStatus(db, { projectId, taskId, status, actorId });

describe("milestone automation", () => {
  it("closes the milestone when its last task is done and drafts one invoice for finance, never issued", async () => {
    const m = await milestone(project, { amount: "1200" });
    const a = await task(project, m.id, "Calendar"), b = await task(project, m.id, "Approval");
    expect((await move(project, a.id, "DONE")).milestone).toBeNull(); // one task still open
    const r = await move(project, b.id, "DONE");
    expect(r.milestone).toMatchObject({ kind: "completed", milestoneId: m.id });
    const after = await db.milestone.findUniqueOrThrow({ where: { id: m.id } });
    expect(after.status).toBe("DONE");
    const inv = await db.invoice.findUniqueOrThrow({ where: { id: after.invoiceId! } });
    expect(inv).toMatchObject({ status: "DRAFT", projectId: project, clientId: client });
    expect(inv.total.toString()).toBe("1200");
    const notes = await db.notification.findMany({ select: { userId: true, kind: true } });
    expect(notes).toEqual(expect.arrayContaining([{ userId: boss, kind: "milestone.done" }, { userId: finance, kind: "invoice.draft" }]));
    expect(notes.some((n) => n.userId === writer)).toBe(false); // not the person who finished it, nor anyone without finance rights
    // Invoiced milestones never move again: reopening a task leaves it alone
    expect((await move(project, b.id, "IN_PROGRESS")).milestone).toBeNull();
    expect((await db.milestone.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("DONE");
  });

  it("closes a milestone with no amount (or no client) without an invoice, and reopens it when a task is reopened", async () => {
    const m = await milestone(project);
    const t = await task(project, m.id, "Report");
    expect((await move(project, t.id, "DONE")).milestone).toMatchObject({ kind: "completed", invoiceId: null });
    expect((await move(project, t.id, "IN_PROGRESS")).milestone).toMatchObject({ kind: "reopened" });
    expect(await db.milestone.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ status: "IN_PROGRESS", completedAt: null });
    const mi = await milestone(internal, { amount: "500" }); // internal project: nobody to bill
    const ti = await task(internal, mi.id, "Internal work");
    expect((await move(internal, ti.id, "DONE")).milestone).toMatchObject({ kind: "completed", invoiceId: null });
    expect(await db.invoice.count({ where: { projectId: internal } })).toBe(0);
  });
});

describe("won deal starts a project", () => {
  const body = { roles: ["Content writer"], milestones: [{ name: "Plan", day: 3 }], tasks: [{ title: "Write captions", day: 2, role: "Content writer", milestone: "Plan" }, { title: "Kick-off" }] };
  const newLead = (planId: string | null, name: string) => db.lead.create({ data: { organizationId: org, name, company: `${name} Ltd`, stageId: stage, planId, currency: "PKR" } });
  const win = async (leadId: string) => { await convertLead(db, { organizationId: org, leadId, actorId: boss, wonStageId: won }); return projectForWonLead(db, { organizationId: org, leadId, actorId: boss, today: "2026-12-01" }); };

  it("keeps only this organization's plans and active staff as a template's usual people", async () => {
    const d = await cleanDefaults(db, org, ["Content writer"], { planIds: [plan, foreignPlan, "nope"], defaultManagerId: stranger, roleDefaults: { "Content writer": writer, "Designer": writer, "x": gone } });
    expect(d).toEqual({ planIds: [plan], defaultManagerId: null, roleDefaults: { "Content writer": writer } });
  });

  it("creates the client's project from the linked template once, with its manager and people", async () => {
    const t = await saveTemplate(db, { organizationId: org, name: "Social", description: "", body, byUserId: boss, defaults: { planIds: [plan], defaultManagerId: writer, roleDefaults: { "Content writer": writer } } });
    expect(t.ok).toBe(true);
    const lead = await newLead(plan, "Bistro");
    const r = await win(lead.id);
    expect(r).toMatchObject({ template: "Social", managerId: writer, name: "Bistro Ltd: Social Starter" });
    const pr = await db.project.findUniqueOrThrow({ where: { id: r!.projectId }, include: { members: true, milestones: true } });
    expect(pr).toMatchObject({ sourceLeadId: lead.id, currency: "PKR", managerId: writer });
    expect(pr.clientId).toBe((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).clientId);
    expect(pr.startDate!.toISOString().slice(0, 10)).toBe("2026-12-01");
    expect(pr.milestones.map((m) => [m.name, m.dueDate])).toEqual([["Plan", "2026-12-04"]]);
    expect(pr.members.map((m) => [m.userId, m.role])).toEqual([[writer, "Project manager"]]); // the manager already fills the role
    expect((await db.task.findFirstOrThrow({ where: { projectId: pr.id, title: "Write captions" } })).assigneeId).toBe(writer);
    // A second approval, or a retry, makes nothing
    expect(await projectForWonLead(db, { organizationId: org, leadId: lead.id, actorId: boss, today: "2026-12-02" })).toBeNull();
    expect(await db.project.count({ where: { sourceLeadId: lead.id } })).toBe(1);
  });

  it("does nothing without a linked template, for an archived template, or for another organization's lead", async () => {
    expect(await win((await newLead(otherPlan, "Garage")).id)).toBeNull();
    expect(await win((await newLead(null, "No plan")).id)).toBeNull();
    const archived = await saveTemplate(db, { organizationId: org, name: "Web", description: "", body, byUserId: boss, defaults: { planIds: [otherPlan] } });
    if (archived.ok) await db.projectTemplate.update({ where: { id: archived.value.id }, data: { archivedAt: new Date() } });
    expect(await win((await newLead(otherPlan, "Salon")).id)).toBeNull();
    const lead = await newLead(plan, "Cafe");
    await convertLead(db, { organizationId: org, leadId: lead.id, actorId: boss, wonStageId: won });
    expect(await projectForWonLead(db, { organizationId: other, leadId: lead.id, actorId: stranger, today: "2026-12-01" })).toBeNull();
  });

  it("falls back to whoever approved the win when the usual manager has left", async () => {
    await db.projectTemplate.updateMany({ where: { organizationId: org, name: "Social" }, data: { defaultManagerId: gone } });
    const r = await win((await newLead(plan, "Bakery")).id);
    expect(r?.managerId).toBe(boss);
  });
});
