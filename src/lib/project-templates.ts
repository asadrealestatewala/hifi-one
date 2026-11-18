// Project templates: a reusable plan of team roles, milestones and tasks (with subtasks, estimates, labels and due dates
// counted in days from the project start). Applying one copies the plan into a project and assigns tasks to the people
// chosen for each role. Free of Next.js imports so it can be tested against the database.
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { RECURRENCES } from "./task-rules";

type Db = PrismaClient;
type Tx = Prisma.TransactionClient;

const text = (max: number) => z.string().trim().min(1).max(max);
const offset = z.coerce.number().int().min(0).max(730);
export const templateTaskSchema = z.object({
  title: text(200),
  description: z.string().trim().max(2000).optional().default(""),
  day: offset.optional(), // due this many days after the project start (0 = the start day); empty = no due date
  hours: z.coerce.number().positive().max(999).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  role: z.string().trim().max(60).optional().default(""), // assigned to whoever fills this role
  milestone: z.string().trim().max(120).optional().default(""), // a milestone name in this template
  clientVisible: z.boolean().default(false),
  repeat: z.enum(RECURRENCES).optional(),
  labels: z.array(z.string().trim().min(1).max(24)).max(6).default([]),
  subtasks: z.array(text(200)).max(20).default([]),
  checklist: z.array(text(200)).max(50).default([]), // steps ticked off inside the task
});
export const templateBodySchema = z.object({
  roles: z.array(text(60)).max(12).default([]),
  milestones: z.array(z.object({ name: text(120), day: offset.optional() })).max(20).default([]),
  tasks: z.array(templateTaskSchema).max(150).default([]),
}).superRefine((b, ctx) => {
  const ms = new Set(b.milestones.map((m) => m.name));
  if (ms.size !== b.milestones.length) ctx.addIssue({ code: "custom", message: "Two milestones have the same name." });
  const roles = new Set(b.roles);
  if (roles.size !== b.roles.length) ctx.addIssue({ code: "custom", message: "Two roles have the same name." });
  b.tasks.forEach((t, i) => {
    if (t.milestone && !ms.has(t.milestone)) ctx.addIssue({ code: "custom", message: `Task ${i + 1} (${t.title}) points at a milestone that isn't in the template.` });
    if (t.role && !roles.has(t.role)) ctx.addIssue({ code: "custom", message: `Task ${i + 1} (${t.title}) uses the role "${t.role}", which isn't in the template's roles.` });
  });
});
export type TemplateBody = z.infer<typeof templateBodySchema>;
export type TemplateTask = z.infer<typeof templateTaskSchema>;
export type TemplateResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseTemplateBody(raw: unknown): TemplateResult<TemplateBody> {
  const r = templateBodySchema.safeParse(raw);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: r.error.issues[0]?.message ?? "The template is not valid." };
}

const DAY = 86_400_000;
const addDays = (start: string, n: number) => new Date(new Date(`${start}T00:00:00Z`).getTime() + n * DAY).toISOString().slice(0, 10);

// Two editable starting points the owner asked for. Added only when someone presses "Add starter templates".
export const STARTER_TEMPLATES: { name: string; description: string; body: TemplateBody }[] = [
  {
    name: "Social media retainer",
    description: "One month of organic social media for a client: plan, approval, captions, designs, posting and the monthly report.",
    body: {
      roles: ["Account manager", "Content writer", "Graphic designer"],
      milestones: [{ name: "Month plan approved", day: 5 }, { name: "First posts live", day: 10 }, { name: "Monthly report sent", day: 30 }],
      tasks: [
        { title: "Kick-off call with the client", description: "Goals for the month, offers to push, tone of voice.", day: 1, hours: 1, priority: "HIGH", role: "Account manager", milestone: "", clientVisible: true, labels: [], subtasks: [], checklist: [] },
        { title: "Collect brand assets and page access", description: "", day: 2, hours: 1, priority: "HIGH", role: "Account manager", milestone: "", clientVisible: true, labels: [], subtasks: ["Logo, fonts and brand colours", "Facebook and Instagram page access", "Posts that worked well before"], checklist: [] },
        { title: "Prepare the month's content calendar", description: "", day: 4, hours: 4, priority: "HIGH", role: "Content writer", milestone: "Month plan approved", clientVisible: false, labels: ["Copy"], subtasks: [], checklist: [] },
        { title: "Client approves the content calendar", description: "", day: 5, hours: 0.5, priority: "HIGH", role: "Account manager", milestone: "Month plan approved", clientVisible: true, labels: [], subtasks: [], checklist: [] },
        { title: "Write captions for the month", description: "", day: 7, hours: 6, priority: "MEDIUM", role: "Content writer", milestone: "", clientVisible: false, labels: ["Copy"], subtasks: [], checklist: [] },
        { title: "Design the month's posts", description: "", day: 9, hours: 12, priority: "MEDIUM", role: "Graphic designer", milestone: "", clientVisible: false, labels: ["Design"], subtasks: [], checklist: ["Brand colours and fonts used", "Logo placed", "Feed and story sizes exported", "Spelling checked against the captions"] },
        { title: "Schedule the posts", description: "", day: 10, hours: 2, priority: "MEDIUM", role: "Account manager", milestone: "First posts live", clientVisible: false, labels: [], subtasks: [], checklist: ["Only client-approved posts scheduled", "Dates and times match the calendar", "Links and tags checked"] },
        { title: "Reply to comments and messages", description: "", day: 11, hours: 2, priority: "MEDIUM", role: "Account manager", milestone: "", clientVisible: false, repeat: "WEEKLY", labels: [], subtasks: [], checklist: [] },
        { title: "Monthly performance report", description: "Reach, engagement, best posts and next month's ideas.", day: 29, hours: 3, priority: "HIGH", role: "Account manager", milestone: "Monthly report sent", clientVisible: true, labels: [], subtasks: [], checklist: [] },
      ],
    },
  },
  {
    name: "Ads campaign",
    description: "A three-week paid ads campaign: access, plan and approval, copy and creatives, launch, weekly optimisation and the results report.",
    body: {
      roles: ["Account manager", "Ads specialist", "Content writer", "Graphic designer"],
      milestones: [{ name: "Campaign plan approved", day: 4 }, { name: "Ads live", day: 8 }, { name: "Final report", day: 21 }],
      tasks: [
        { title: "Kick-off: goals, offer and budget", description: "", day: 1, hours: 1, priority: "HIGH", role: "Account manager", milestone: "", clientVisible: true, labels: [], subtasks: [], checklist: [] },
        { title: "Ad account and tracking access", description: "", day: 2, hours: 2, priority: "HIGH", role: "Ads specialist", milestone: "", clientVisible: true, labels: ["Ads"], subtasks: ["Business Manager access", "Pixel and Conversions API check", "Payment method on the ad account"], checklist: [] },
        { title: "Audience and budget plan", description: "", day: 3, hours: 3, priority: "HIGH", role: "Ads specialist", milestone: "Campaign plan approved", clientVisible: false, labels: ["Ads"], subtasks: [], checklist: [] },
        { title: "Client approves the campaign plan", description: "", day: 4, hours: 0.5, priority: "HIGH", role: "Account manager", milestone: "Campaign plan approved", clientVisible: true, labels: [], subtasks: [], checklist: [] },
        { title: "Write ad copy variations", description: "", day: 5, hours: 3, priority: "MEDIUM", role: "Content writer", milestone: "", clientVisible: false, labels: ["Copy"], subtasks: [], checklist: [] },
        { title: "Design ad creatives", description: "", day: 6, hours: 6, priority: "MEDIUM", role: "Graphic designer", milestone: "", clientVisible: false, labels: ["Design"], subtasks: [], checklist: [] },
        { title: "Build the campaigns", description: "", day: 7, hours: 4, priority: "HIGH", role: "Ads specialist", milestone: "", clientVisible: false, labels: ["Ads"], subtasks: [], checklist: [] },
        { title: "Launch and check delivery", description: "", day: 8, hours: 1, priority: "HIGH", role: "Ads specialist", milestone: "Ads live", clientVisible: false, labels: ["Ads"], subtasks: [], checklist: ["Ads approved by Meta", "Pixel and conversions firing", "Budgets and schedule match the plan", "Links and UTM tags work"] },
        { title: "Optimise the campaigns", description: "Budgets, audiences, pause losers, scale winners.", day: 10, hours: 2, priority: "MEDIUM", role: "Ads specialist", milestone: "", clientVisible: false, repeat: "WEEKLY", labels: ["Ads"], subtasks: [], checklist: [] },
        { title: "Mid-campaign update to the client", description: "", day: 14, hours: 1, priority: "MEDIUM", role: "Account manager", milestone: "", clientVisible: true, labels: [], subtasks: [], checklist: [] },
        { title: "Final results report", description: "", day: 21, hours: 3, priority: "HIGH", role: "Account manager", milestone: "Final report", clientVisible: true, labels: [], subtasks: [], checklist: [] },
      ],
    },
  },
];

export async function addStarterTemplates(db: Db, p: { organizationId: string; byUserId: string }): Promise<string[]> {
  const added: string[] = [];
  for (const t of STARTER_TEMPLATES) {
    const exists = await db.projectTemplate.findFirst({ where: { organizationId: p.organizationId, name: t.name }, select: { id: true } });
    if (exists) continue;
    await db.projectTemplate.create({ data: { organizationId: p.organizationId, name: t.name, description: t.description, body: t.body as unknown as Prisma.InputJsonValue, createdById: p.byUserId } });
    added.push(t.name);
  }
  return added;
}

// Who and what a template starts with: the service plans whose won leads use it, the default project manager, and a default
// person per role. Unknown plans and anyone who isn't active staff in the organization are dropped, never kept.
export type TemplateDefaults = { planIds: string[]; defaultManagerId: string | null; roleDefaults: Record<string, string> };
export async function cleanDefaults(db: Db, organizationId: string, roles: string[], d: Partial<TemplateDefaults>): Promise<TemplateDefaults> {
  const planIds = [...new Set((d.planIds ?? []).map(String).filter(Boolean))].slice(0, 50);
  const plans = planIds.length ? new Set((await db.servicePlan.findMany({ where: { organizationId, id: { in: planIds } }, select: { id: true } })).map((x) => x.id)) : new Set<string>();
  const people = [d.defaultManagerId ?? "", ...Object.values(d.roleDefaults ?? {})].map(String).filter(Boolean);
  const staff = people.length ? new Set((await db.user.findMany({ where: { organizationId, id: { in: people }, active: true, userType: "EMPLOYEE" }, select: { id: true } })).map((u) => u.id)) : new Set<string>();
  const roleDefaults: Record<string, string> = {};
  for (const [role, uid] of Object.entries(d.roleDefaults ?? {})) if (roles.includes(role) && staff.has(String(uid))) roleDefaults[role] = String(uid);
  return { planIds: planIds.filter((x) => plans.has(x)), defaultManagerId: d.defaultManagerId && staff.has(d.defaultManagerId) ? d.defaultManagerId : null, roleDefaults };
}

export async function saveTemplate(db: Db, p: { organizationId: string; id?: string; name: string; description: string; body: unknown; byUserId: string; defaults?: Partial<TemplateDefaults> }): Promise<TemplateResult<{ id: string; name: string }>> {
  const name = p.name.trim().slice(0, 80);
  if (name.length < 2) return { ok: false, error: "Give the template a name." };
  const body = parseTemplateBody(p.body);
  if (!body.ok) return body;
  const clash = await db.projectTemplate.findFirst({ where: { organizationId: p.organizationId, name: { equals: name, mode: "insensitive" }, ...(p.id ? { id: { not: p.id } } : {}) }, select: { id: true } });
  if (clash) return { ok: false, error: `There is already a template called ${name}.` };
  const defaults = p.defaults ? await cleanDefaults(db, p.organizationId, body.value.roles, p.defaults) : null;
  const data = { name, description: p.description.trim().slice(0, 500) || null, body: body.value as unknown as Prisma.InputJsonValue, ...(defaults ? { ...defaults, roleDefaults: defaults.roleDefaults as Prisma.InputJsonValue } : {}) };
  if (p.id) {
    const t = await db.projectTemplate.findFirst({ where: { id: p.id, organizationId: p.organizationId }, select: { id: true } });
    if (!t) return { ok: false, error: "Template not found." };
    const u = await db.projectTemplate.update({ where: { id: t.id }, data, select: { id: true, name: true } });
    return { ok: true, value: u };
  }
  const c = await db.projectTemplate.create({ data: { ...data, organizationId: p.organizationId, createdById: p.byUserId }, select: { id: true, name: true } });
  return { ok: true, value: c };
}

// Turns a running project into a template: its team roles, milestones and top-level tasks with their subtasks, due dates as
// days from the project start (or from the earliest date in it), estimates, labels and repeat settings. Assignees become roles
// only where the person has a role on the team; nothing about clients, money or files is copied.
export async function templateFromProject(db: Db, p: { organizationId: string; projectId: string }): Promise<TemplateResult<TemplateBody>> {
  const project = await db.project.findFirst({ where: { id: p.projectId, organizationId: p.organizationId }, include: { members: true, milestones: { orderBy: { sortOrder: "asc" } }, tasks: { orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }], include: { checklist: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { text: true } } } } } });
  if (!project) return { ok: false, error: "Project not found." };
  const labels = new Map((await db.taskLabel.findMany({ where: { organizationId: p.organizationId }, select: { id: true, name: true } })).map((l) => [l.id, l.name]));
  const dates = [project.startDate?.toISOString().slice(0, 10), ...project.tasks.map((t) => t.dueDate?.toISOString().slice(0, 10)), ...project.milestones.map((m) => m.dueDate ?? undefined)].filter(Boolean) as string[];
  const start = project.startDate?.toISOString().slice(0, 10) ?? dates.sort()[0] ?? null;
  const dayOf = (d: string | null | undefined) => (d && start ? Math.max(0, Math.min(730, Math.round((new Date(`${d}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / DAY))) : undefined);
  const roleOf = new Map(project.members.filter((m) => m.role && m.role.trim()).map((m) => [m.userId, m.role!.trim().slice(0, 60)]));
  const milestoneName = new Map(project.milestones.map((m) => [m.id, m.name.slice(0, 120)]));
  const top = project.tasks.filter((t) => !t.parentId).slice(0, 150);
  const body = {
    roles: [...new Set(roleOf.values())].slice(0, 12),
    milestones: [...new Map(project.milestones.map((m) => [m.name.slice(0, 120), { name: m.name.slice(0, 120), day: dayOf(m.dueDate) }])).values()].slice(0, 20),
    tasks: top.map((t) => ({
      title: t.title, description: t.description ?? "", day: dayOf(t.dueDate?.toISOString().slice(0, 10)), hours: t.estimatedHours ? Number(t.estimatedHours) : undefined,
      priority: t.priority, role: t.assigneeId ? roleOf.get(t.assigneeId) ?? "" : "", milestone: t.milestoneId ? milestoneName.get(t.milestoneId) ?? "" : "",
      clientVisible: t.clientVisible, repeat: t.recurrence ?? undefined, labels: t.labelIds.map((id) => labels.get(id)).filter(Boolean).slice(0, 6) as string[],
      subtasks: project.tasks.filter((s) => s.parentId === t.id).map((s) => s.title).slice(0, 20),
      checklist: [...new Set(t.checklist.map((c) => c.text.slice(0, 200)))].slice(0, 50),
    })),
  };
  return parseTemplateBody(body);
}

export type ApplyResult = { tasks: number; milestones: number; assigned: Map<string, number>; labelsCreated: string[]; joined: Map<string, string> };

// Copies a template into a project that was just created, inside the caller's transaction. Each role is filled by the person
// chosen for it (they join the team with that role); tasks for an unfilled role stay unassigned. Labels are matched by name
// and created when the organization doesn't have them yet.
export async function applyTemplate(tx: Tx, p: { organizationId: string; projectId: string; body: TemplateBody; start: string; roleAssignees: Record<string, string>; byUserId: string }): Promise<ApplyResult> {
  const b = p.body;
  // Only people who are active staff in this organization can fill a role
  const wanted = [...new Set(Object.values(p.roleAssignees).filter(Boolean))];
  const staff = new Set((await tx.user.findMany({ where: { id: { in: wanted }, organizationId: p.organizationId, active: true, userType: "EMPLOYEE" }, select: { id: true } })).map((u) => u.id));
  const who = (role: string) => (role && staff.has(p.roleAssignees[role]) ? p.roleAssignees[role] : null);
  const current = new Map((await tx.projectMember.findMany({ where: { projectId: p.projectId } })).map((m) => [m.userId, m]));
  const joined = new Map<string, string>(); // people who joined the team through a role, with that role
  for (const role of b.roles) {
    const userId = who(role);
    if (!userId) continue;
    const m = current.get(userId);
    if (!m) {
      await tx.projectMember.create({ data: { projectId: p.projectId, userId, role } });
      current.set(userId, { projectId: p.projectId, userId, role, hourlyCost: null });
      joined.set(userId, role);
    } else if (!m.role) { await tx.projectMember.update({ where: { projectId_userId: { projectId: p.projectId, userId } }, data: { role } }); m.role = role; }
  }
  const milestoneId = new Map<string, string>();
  for (const [i, m] of b.milestones.entries()) {
    const row = await tx.milestone.create({ data: { projectId: p.projectId, name: m.name, dueDate: m.day === undefined ? null : addDays(p.start, m.day), sortOrder: i } });
    milestoneId.set(m.name, row.id);
  }
  const names = [...new Set(b.tasks.flatMap((t) => t.labels))];
  const existing = new Map((await tx.taskLabel.findMany({ where: { organizationId: p.organizationId }, select: { id: true, name: true } })).map((l) => [l.name.toLowerCase(), l.id]));
  const labelsCreated: string[] = [];
  for (const n of names) if (!existing.has(n.toLowerCase())) { const l = await tx.taskLabel.create({ data: { organizationId: p.organizationId, name: n } }); existing.set(n.toLowerCase(), l.id); labelsCreated.push(n); }
  const assigned = new Map<string, number>();
  let count = 0;
  for (const t of b.tasks) {
    const assigneeId = who(t.role);
    const due = t.day === undefined ? null : new Date(`${addDays(p.start, t.day)}T00:00:00.000Z`);
    const task = await tx.task.create({ data: {
      projectId: p.projectId, title: t.title, description: t.description || null, priority: t.priority, assigneeId, dueDate: due,
      estimatedHours: t.hours === undefined ? null : String(t.hours), clientVisible: t.clientVisible, recurrence: t.repeat ?? null,
      milestoneId: t.milestone ? milestoneId.get(t.milestone) ?? null : null, labelIds: t.labels.map((n) => existing.get(n.toLowerCase())!).filter(Boolean), createdById: p.byUserId,
    } });
    count++;
    if (t.checklist.length) await tx.taskChecklistItem.createMany({ data: t.checklist.map((text, i) => ({ taskId: task.id, text, sortOrder: i })) });
    for (const s of t.subtasks) { await tx.task.create({ data: { projectId: p.projectId, parentId: task.id, title: s, assigneeId, dueDate: due, priority: t.priority, createdById: p.byUserId } }); count++; }
    if (assigneeId) assigned.set(assigneeId, (assigned.get(assigneeId) ?? 0) + 1 + t.subtasks.length);
  }
  return { tasks: count, milestones: b.milestones.length, assigned, labelsCreated, joined };
}
