// Project automations that run on their own:
// 1. A task sent to Review tells the project manager (events.ts taskMoved, already in place).
// 2. When the last open task of a milestone is done, the milestone is marked done; if it has a billing amount and the project
//    has a client, a DRAFT invoice is made for finance to review and issue (never issued or posted here). Reopening a task of
//    a done, not yet invoiced milestone puts the milestone back in progress.
// 3. When a lead is won and a project template is linked to the lead's service plan, the client's project is created from that
//    template, with the template's default manager and people. Each lead creates at most one project.
// Free of Next.js imports so it can be tested against the database.
import type { PrismaClient } from "@prisma/client";
import { billMilestone, ProjectError } from "./project-finance";
import { applyTemplate, parseTemplateBody, type ApplyResult } from "./project-templates";
import { notify, notifyMany, notifyPermission } from "./notifications";
import { projectMemberAdded } from "./events";

type Db = PrismaClient;

export type MilestoneAutomation =
  | { kind: "completed"; milestoneId: string; name: string; projectId: string; invoiceId: string | null; billingError?: string }
  | { kind: "reopened"; milestoneId: string; name: string; projectId: string };

// Runs after a task's status changed (changeTaskStatus). Returns what it did so the caller can audit it.
export async function milestoneAfterTaskMove(db: Db, p: { taskId: string; status: string; actorId: string }): Promise<MilestoneAutomation | null> {
  const task = await db.task.findUnique({ where: { id: p.taskId }, select: { milestoneId: true } });
  if (!task?.milestoneId) return null;
  const m = await db.milestone.findUnique({ where: { id: task.milestoneId }, include: { project: { select: { id: true, organizationId: true, name: true, number: true, managerId: true, clientId: true } } } });
  if (!m || m.invoiceId) return null;
  if (p.status !== "DONE") {
    if (m.status !== "DONE") return null;
    const r = await db.milestone.updateMany({ where: { id: m.id, status: "DONE", invoiceId: null }, data: { status: "IN_PROGRESS", completedAt: null } });
    return r.count ? { kind: "reopened", milestoneId: m.id, name: m.name, projectId: m.projectId } : null;
  }
  if (m.status === "DONE") return null;
  const open = await db.task.count({ where: { milestoneId: m.id, status: { not: "DONE" } } });
  if (open > 0) return null;
  // Only one of two people finishing the last tasks at the same moment completes it
  const done = await db.milestone.updateMany({ where: { id: m.id, status: { not: "DONE" } }, data: { status: "DONE", completedAt: new Date() } });
  if (!done.count) return null;
  const org = m.project.organizationId;
  let invoiceId: string | null = null, billingError: string | undefined;
  if (m.amount && m.project.clientId) {
    try {
      invoiceId = (await billMilestone(db, { organizationId: org, milestoneId: m.id, actorId: p.actorId })).invoiceId;
    } catch (e) {
      if (!(e instanceof ProjectError)) throw e;
      billingError = e.message; // the milestone stays done; finance can bill it by hand from the project
    }
  }
  const link = `/projects/${m.projectId}?tab=milestones`;
  if (m.project.managerId !== p.actorId) await notify(db, m.project.managerId, { kind: "milestone.done", title: `Milestone done: ${m.name}`, body: `${m.project.name}: every task in it is finished.${invoiceId ? " A draft invoice is waiting for finance." : ""}`, link, dedupeKey: `milestone-done:${m.id}` });
  if (invoiceId) await notifyPermission(db, org, "finance.post", { kind: "invoice.draft", title: `Draft invoice to review: ${m.project.name}`, body: `Milestone "${m.name}" is done. Check the amount and tax, then issue it.`, link: `/finance/invoices/${invoiceId}`, dedupeKey: `milestone-invoice:${m.id}` });
  return { kind: "completed", milestoneId: m.id, name: m.name, projectId: m.projectId, invoiceId, billingError };
}

export type WonProject = { projectId: string; number: string; name: string; template: string; managerId: string; applied: ApplyResult };

// Creates the client's project when a lead is won, if a template is linked to the lead's service plan. Safe to repeat: a lead
// that already has a project returns null.
export async function projectForWonLead(db: Db, p: { organizationId: string; leadId: string; actorId: string; today: string }): Promise<WonProject | null> {
  const lead = await db.lead.findFirst({ where: { id: p.leadId, organizationId: p.organizationId }, select: { id: true, number: true, name: true, company: true, planId: true, clientId: true, currency: true, plan: { select: { name: true } } } });
  if (!lead?.clientId || !lead.planId) return null;
  if (await db.project.findFirst({ where: { organizationId: p.organizationId, sourceLeadId: lead.id }, select: { id: true } })) return null;
  const template = await db.projectTemplate.findFirst({ where: { organizationId: p.organizationId, archivedAt: null, planIds: { has: lead.planId } }, orderBy: { name: "asc" } });
  if (!template) return null;
  const body = parseTemplateBody(template.body);
  if (!body.ok) return null;
  const client = await db.client.findFirst({ where: { id: lead.clientId, organizationId: p.organizationId }, select: { name: true } });
  const staff = async (id: string | null) => (id ? Boolean(await db.user.findFirst({ where: { id, organizationId: p.organizationId, active: true, userType: "EMPLOYEE" }, select: { id: true } })) : false);
  const managerId = (await staff(template.defaultManagerId)) ? template.defaultManagerId! : p.actorId;
  const roleDefaults = (template.roleDefaults ?? {}) as Record<string, string>;
  const name = `${client?.name ?? lead.company ?? lead.name}: ${lead.plan?.name ?? template.name}`.slice(0, 160);
  let created: { id: string; number: string } | null = null;
  let applied: ApplyResult | null = null;
  try {
    await db.$transaction(async (tx) => {
      const seq = await tx.numberSequence.upsert({ where: { organizationId_key: { organizationId: p.organizationId, key: "PRJ" } }, create: { organizationId: p.organizationId, key: "PRJ", next: 2 }, update: { next: { increment: 1 } } });
      const pr = await tx.project.create({ data: {
        organizationId: p.organizationId, number: `PRJ-${String(seq.next - 1).padStart(4, "0")}`, name, clientId: lead.clientId, managerId, currency: lead.currency,
        templateId: template.id, sourceLeadId: lead.id, startDate: new Date(`${p.today}T00:00:00.000Z`), scope: `Started automatically when lead L-${lead.number} was won.`,
        members: { create: [{ userId: managerId, role: "Project manager" }] },
      } });
      applied = await applyTemplate(tx, { organizationId: p.organizationId, projectId: pr.id, body: body.value, start: p.today, roleAssignees: roleDefaults, byUserId: p.actorId });
      created = { id: pr.id, number: pr.number };
    });
  } catch (e) {
    // Two approvals at the same moment: the unique sourceLeadId lets only one project through
    if ((e as { code?: string }).code === "P2002") return null;
    throw e;
  }
  const c = created as { id: string; number: string } | null, a = applied as ApplyResult | null;
  if (!c || !a) return null;
  await projectMemberAdded(db, { organizationId: p.organizationId, projectId: c.id, userId: managerId, byUserId: p.actorId, role: "Project manager" });
  for (const [uid, role] of a.joined) await projectMemberAdded(db, { organizationId: p.organizationId, projectId: c.id, userId: uid, byUserId: p.actorId, role });
  await notifyMany(db, [...a.assigned.keys()].filter((u) => u !== p.actorId), { kind: "task.assigned", title: `New tasks for you in ${name}`, body: c.number, link: "/me/tasks", dedupeKey: `won-project-tasks:${c.id}` });
  return { projectId: c.id, number: c.number, name, template: template.name, managerId, applied: a };
}
