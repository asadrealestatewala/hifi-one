// Task labels against hifi_one_test: the shared list, its limits, and what removing a label does to tasks.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createLabel, deleteLabel, listLabels, updateLabel, validLabelIds } from "./task-labels";
import { bulkEditTasks } from "./task-bulk";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, boss: string, member: string, project: string, otherProject: string;

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "TaskLabel","Task","ProjectMember","Project","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Label Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other" } })).id;
  boss = (await db.user.create({ data: { organizationId: org, name: "boss", email: "boss@label.test", passwordHash: "x", userType: "EMPLOYEE" } })).id;
  member = (await db.user.create({ data: { organizationId: org, name: "member", email: "m@label.test", passwordHash: "x", userType: "EMPLOYEE" } })).id;
  project = (await db.project.create({ data: { organizationId: org, number: "LB-1", name: "P", managerId: boss, members: { create: [{ userId: boss }, { userId: member }] } } })).id;
  const ob = (await db.user.create({ data: { organizationId: other, name: "ob", email: "ob@label.test", passwordHash: "x", userType: "EMPLOYEE" } })).id;
  otherProject = (await db.project.create({ data: { organizationId: other, number: "OX-1", name: "O", managerId: ob } })).id;
});
afterAll(async () => { await db.$disconnect(); });

describe("task labels", () => {
  it("keeps one list per organization with unique names and known colours", async () => {
    const design = await createLabel(db, { organizationId: org, name: "  Design ", color: "info" });
    expect(design).toMatchObject({ ok: true, value: { name: "Design", color: "info" } });
    expect(await createLabel(db, { organizationId: org, name: "design" })).toEqual({ ok: false, error: "There is already a label called design." });
    expect((await createLabel(db, { organizationId: org, name: "Copy", color: "pink" })).ok).toBe(false);
    expect((await createLabel(db, { organizationId: org, name: "" })).ok).toBe(false);
    expect((await createLabel(db, { organizationId: other, name: "Design" })).ok).toBe(true); // another org has its own list
    expect((await listLabels(db, org)).map((l) => l.name)).toEqual(["Design"]);
  });

  it("renames and recolours, refusing a clash", async () => {
    const copy = await createLabel(db, { organizationId: org, name: "Copy" });
    if (!copy.ok) throw new Error();
    expect(await updateLabel(db, { organizationId: org, id: copy.value.id, name: "Design", color: "primary" })).toMatchObject({ ok: false });
    expect(await updateLabel(db, { organizationId: org, id: copy.value.id, name: "Copywriting", color: "warning" })).toMatchObject({ ok: true, value: { name: "Copywriting", color: "warning" } });
    const foreign = (await listLabels(db, other))[0];
    expect(await updateLabel(db, { organizationId: org, id: foreign.id, name: "Mine now", color: "primary" })).toEqual({ ok: false, error: "Label not found." });
  });

  it("only lets a task carry this organization's labels", async () => {
    const mine = (await listLabels(db, org)).map((l) => l.id);
    const theirs = (await listLabels(db, other)).map((l) => l.id);
    expect(await validLabelIds(db, org, [...mine, ...theirs, mine[0], "nope"])).toEqual(mine);
  });

  it("adds and removes labels in bulk for the manager only, and removing a label clears it from tasks", async () => {
    const [copy, design] = await listLabels(db, org);
    const a = (await db.task.create({ data: { projectId: project, title: "a" } })).id;
    const b = (await db.task.create({ data: { projectId: project, title: "b", labelIds: [copy.id] } })).id;
    const foreignTask = (await db.task.create({ data: { projectId: otherProject, title: "x", labelIds: [design.id] } })).id;
    const boss_ = { id: boss, organizationId: org, permissions: new Set(["tasks.edit"]) };
    const r = await bulkEditTasks(db, { actor: boss_, taskIds: [a, b], change: { kind: "label", labelId: design.id, add: true } });
    expect(r.changed).toHaveLength(2);
    const denied = await bulkEditTasks(db, { actor: { id: member, organizationId: org, permissions: new Set(["tasks.edit"]) }, taskIds: [a], change: { kind: "label", labelId: design.id, add: false } });
    expect(denied.skipped[0].reason).toBe("Only the project manager can change this task.");
    await expect(bulkEditTasks(db, { actor: boss_, taskIds: [a], change: { kind: "label", labelId: (await listLabels(db, other))[0].id, add: true } })).rejects.toThrow("Label not found");
    const gone = await deleteLabel(db, { organizationId: org, id: design.id });
    expect(gone).toEqual({ ok: true, value: { name: design.name, tasks: 2 } });
    expect((await db.task.findUnique({ where: { id: a } }))!.labelIds).toEqual([]);
    expect((await db.task.findUnique({ where: { id: b } }))!.labelIds).toEqual([copy.id]);
    expect((await db.task.findUnique({ where: { id: foreignTask } }))!.labelIds).toEqual([design.id]); // another org's task is never touched
  });
});
