// Project templates against hifi_one_test: starters, saving, applying a plan to a new project, and turning a project back
// into a template. Each organization only ever sees and uses its own templates, labels and people.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { addStarterTemplates, applyTemplate, parseTemplateBody, saveTemplate, STARTER_TEMPLATES, templateFromProject, type TemplateBody } from "./project-templates";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, boss: string, writer: string, designer: string, gone: string, stranger: string;
const mkUser = (o: string, name: string, active = true) => db.user.create({ data: { organizationId: o, email: `${name}@tpl.test`, name, passwordHash: "x", userType: "EMPLOYEE", active } }).then((u) => u.id);
let n = 0;
const mkProject = (o = org, manager = boss) => db.project.create({ data: { organizationId: o, number: `T-${++n}`, name: `Project ${n}`, managerId: manager, members: { create: [{ userId: manager, role: "Project manager" }] } } }).then((p) => p.id);

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "ProjectTemplate","TaskLabel","Milestone","Task","ProjectMember","Project","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Template Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other" } })).id;
  boss = await mkUser(org, "boss");
  writer = await mkUser(org, "writer");
  designer = await mkUser(org, "designer");
  gone = await mkUser(org, "gone", false);
  stranger = await mkUser(other, "stranger");
});
beforeEach(async () => { await db.projectTemplate.deleteMany(); await db.taskLabel.deleteMany(); });
afterAll(async () => { await db.$disconnect(); });

const parsed = parseTemplateBody({
  roles: ["Content writer", "Graphic designer", "Ads specialist"],
  milestones: [{ name: "Plan approved", day: 5 }, { name: "Live" }],
  tasks: [
    { title: "Write captions", day: 3, hours: 4, role: "Content writer", milestone: "Plan approved", labels: ["Copy"], subtasks: ["Week 1", "Week 2"], clientVisible: true },
    { title: "Design posts", day: 7, hours: 6, role: "Graphic designer", labels: ["design"], repeat: "WEEKLY" },
    { title: "Launch ads", role: "Ads specialist", milestone: "Live" },
  ],
});
if (!parsed.ok) throw new Error(parsed.error);
const body: TemplateBody = parsed.value;

describe("project templates", () => {
  it("adds the two starter templates once per organization", async () => {
    expect(await addStarterTemplates(db, { organizationId: org, byUserId: boss })).toEqual(STARTER_TEMPLATES.map((t) => t.name));
    expect(await addStarterTemplates(db, { organizationId: org, byUserId: boss })).toEqual([]);
    expect(await addStarterTemplates(db, { organizationId: other, byUserId: stranger })).toHaveLength(2); // the other org gets its own
    expect(await db.projectTemplate.count({ where: { organizationId: org } })).toBe(2);
  });

  it("saves a template, refuses a name already used (any case) and an invalid plan, and never edits another org's", async () => {
    const a = await saveTemplate(db, { organizationId: org, name: "Retainer", description: "", body, byUserId: boss });
    expect(a.ok).toBe(true);
    expect(await saveTemplate(db, { organizationId: org, name: "retainer", description: "", body, byUserId: boss })).toEqual({ ok: false, error: "There is already a template called retainer." });
    expect((await saveTemplate(db, { organizationId: org, name: "Broken", description: "", body: { roles: ["A"], tasks: [{ title: "x", role: "B" }] }, byUserId: boss })).ok).toBe(false);
    expect((await saveTemplate(db, { organizationId: org, name: "x", description: "", body, byUserId: boss })).ok).toBe(false);
    if (!a.ok) return;
    expect((await saveTemplate(db, { organizationId: org, id: a.value.id, name: "Retainer v2", description: "Monthly", body, byUserId: boss })).ok).toBe(true);
    expect(await saveTemplate(db, { organizationId: other, id: a.value.id, name: "Stolen", description: "", body, byUserId: stranger })).toEqual({ ok: false, error: "Template not found." });
    expect((await db.projectTemplate.findUnique({ where: { id: a.value.id } }))!.name).toBe("Retainer v2");
  });

  it("applies a plan: people join with their roles, tasks go to them, dates count from the start, labels are made once", async () => {
    await db.taskLabel.create({ data: { organizationId: org, name: "Design" } });
    const projectId = await mkProject();
    const r = await db.$transaction((tx) => applyTemplate(tx, {
      organizationId: org, projectId, body, start: "2026-12-01", byUserId: boss,
      // the ads role is filled by someone inactive, so its task stays unassigned; boss already on the team keeps their role
      roleAssignees: { "Content writer": writer, "Graphic designer": designer, "Ads specialist": gone },
    }));
    expect(r.tasks).toBe(5); // 3 tasks + 2 subtasks
    expect(r.milestones).toBe(2);
    expect(r.labelsCreated).toEqual(["Copy"]); // "design" matched the existing Design label
    expect(Object.fromEntries(r.joined)).toEqual({ [writer]: "Content writer", [designer]: "Graphic designer" });
    expect(Object.fromEntries(r.assigned)).toEqual({ [writer]: 3, [designer]: 1 });
    const members = await db.projectMember.findMany({ where: { projectId }, orderBy: { userId: "asc" } });
    expect(members.map((m) => [m.userId, m.role]).sort()).toEqual([[boss, "Project manager"], [designer, "Graphic designer"], [writer, "Content writer"]].sort());
    const ms = await db.milestone.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" } });
    expect(ms.map((m) => [m.name, m.dueDate])).toEqual([["Plan approved", "2026-12-06"], ["Live", null]]);
    const tasks = await db.task.findMany({ where: { projectId } });
    const t = (title: string) => tasks.find((x) => x.title === title)!;
    expect(t("Write captions")).toMatchObject({ assigneeId: writer, milestoneId: ms[0].id, clientVisible: true });
    expect(t("Write captions").dueDate!.toISOString()).toBe("2026-12-04T00:00:00.000Z");
    expect(String(t("Write captions").estimatedHours)).toBe("4");
    expect(t("Week 1")).toMatchObject({ parentId: t("Write captions").id, assigneeId: writer });
    expect(t("Design posts")).toMatchObject({ assigneeId: designer, recurrence: "WEEKLY" });
    expect(t("Launch ads")).toMatchObject({ assigneeId: null, dueDate: null, milestoneId: ms[1].id });
    const labels = new Map((await db.taskLabel.findMany({ where: { organizationId: org } })).map((l) => [l.name, l.id]));
    expect(t("Write captions").labelIds).toEqual([labels.get("Copy")]);
    expect(t("Design posts").labelIds).toEqual([labels.get("Design")]);
  });

  it("never hands a role to someone from another organization", async () => {
    const projectId = await mkProject();
    const r = await db.$transaction((tx) => applyTemplate(tx, { organizationId: org, projectId, body, start: "2026-12-01", byUserId: boss, roleAssignees: { "Content writer": stranger } }));
    expect(r.joined.size).toBe(0);
    expect(await db.projectMember.count({ where: { projectId, userId: stranger } })).toBe(0);
    expect(await db.task.count({ where: { projectId, assigneeId: { not: null } } })).toBe(0);
  });

  it("turns a project back into a template with days from its start, and refuses another org's project", async () => {
    const projectId = await mkProject();
    await db.project.update({ where: { id: projectId }, data: { startDate: new Date("2026-12-01T00:00:00Z") } });
    await db.$transaction((tx) => applyTemplate(tx, { organizationId: org, projectId, body, start: "2026-12-01", byUserId: boss, roleAssignees: { "Content writer": writer, "Graphic designer": designer } }));
    const r = await templateFromProject(db, { organizationId: org, projectId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.roles.sort()).toEqual(["Content writer", "Graphic designer", "Project manager"]);
    expect(r.value.milestones).toEqual([{ name: "Plan approved", day: 5 }, { name: "Live" }]);
    const w = r.value.tasks.find((x) => x.title === "Write captions")!;
    expect(w).toMatchObject({ day: 3, hours: 4, role: "Content writer", milestone: "Plan approved", labels: ["Copy"], subtasks: ["Week 1", "Week 2"], clientVisible: true });
    expect(r.value.tasks.find((x) => x.title === "Launch ads")).toMatchObject({ role: "", milestone: "Live" });
    expect(r.value.tasks.some((x) => x.title === "Week 1")).toBe(false); // subtasks stay under their task
    expect(await templateFromProject(db, { organizationId: other, projectId })).toEqual({ ok: false, error: "Project not found." });
  });
});
