// Task checklists against hifi_one_test: adding and ticking items, the Done rule, recurring copies, and saved checklists
// that stay inside their organization.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { addChecklistItems, applySavedChecklist, deleteSavedChecklist, listChecklist, MAX_CHECKLIST_ITEMS, removeChecklistItem, saveChecklist, splitItems, tickChecklistItem } from "./task-checklists";
import { changeTaskStatus } from "./tasks";
import { applyTemplate, parseTemplateBody, templateFromProject } from "./project-templates";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, boss: string, project: string;

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "ChecklistTemplate","TaskChecklistItem","ProjectTemplate","TaskLabel","Milestone","Task","ProjectMember","Project","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Checklist Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other" } })).id;
  boss = (await db.user.create({ data: { organizationId: org, name: "boss", email: "boss@cl.test", passwordHash: "x", userType: "EMPLOYEE" } })).id;
  project = (await db.project.create({ data: { organizationId: org, number: "CL-1", name: "P", managerId: boss, members: { create: [{ userId: boss }] } } })).id;
});
beforeEach(async () => { await db.checklistTemplate.deleteMany(); await db.task.deleteMany(); });
afterAll(async () => { await db.$disconnect(); });
const task = (over: Record<string, unknown> = {}) => db.task.create({ data: { projectId: project, title: "Design posts", ...over } }).then((t) => t.id);

describe("task checklists", () => {
  it("adds items in order, skips repeats and blanks, and keeps to the limit", async () => {
    const t = await task();
    expect(splitItems(" Logo placed \n\n Spelling   checked\n")).toEqual(["Logo placed", "Spelling checked"]);
    expect(await addChecklistItems(db, { taskId: t, texts: ["Logo placed", "Spelling checked", "logo placed"] })).toEqual({ ok: true, value: { added: 2 } });
    expect(await addChecklistItems(db, { taskId: t, texts: ["SPELLING CHECKED"] })).toEqual({ ok: true, value: { added: 0 } });
    expect(await addChecklistItems(db, { taskId: t, texts: ["   "] })).toEqual({ ok: false, error: "Write the checklist item first." });
    expect((await addChecklistItems(db, { taskId: t, texts: Array.from({ length: MAX_CHECKLIST_ITEMS }, (_, i) => `step ${i}`) })).ok).toBe(false);
    expect((await listChecklist(db, t)).map((i) => i.text)).toEqual(["Logo placed", "Spelling checked"]);
  });

  it("records who ticked an item, and blocks Done until every item is ticked", async () => {
    const t = await task({ status: "IN_PROGRESS" });
    await addChecklistItems(db, { taskId: t, texts: ["One", "Two"] });
    const [one, two] = await listChecklist(db, t);
    await tickChecklistItem(db, { taskId: t, itemId: one.id, done: true, userId: boss });
    expect((await listChecklist(db, t))[0]).toMatchObject({ done: true, doneById: boss });
    await expect(changeTaskStatus(db, { projectId: project, taskId: t, status: "DONE", actorId: boss })).rejects.toThrow("1 checklist item is not ticked yet.");
    await tickChecklistItem(db, { taskId: t, itemId: two.id, done: true, userId: boss });
    await changeTaskStatus(db, { projectId: project, taskId: t, status: "DONE", actorId: boss });
    // A Done task's checklist is locked until it is reopened
    expect(await tickChecklistItem(db, { taskId: t, itemId: one.id, done: false, userId: boss })).toMatchObject({ ok: false, error: expect.stringMatching(/task is done/) });
    expect((await addChecklistItems(db, { taskId: t, texts: ["Three"] })).ok).toBe(false);
    expect((await removeChecklistItem(db, { taskId: t, itemId: one.id })).ok).toBe(false);
    await changeTaskStatus(db, { projectId: project, taskId: t, status: "IN_PROGRESS", actorId: boss });
    expect(await tickChecklistItem(db, { taskId: t, itemId: one.id, done: false, userId: boss })).toMatchObject({ ok: true });
    expect((await listChecklist(db, t))[0]).toMatchObject({ done: false, doneById: null, doneAt: null });
    expect(await removeChecklistItem(db, { taskId: t, itemId: one.id })).toEqual({ ok: true, value: { text: "One" } });
    expect(await tickChecklistItem(db, { taskId: await task(), itemId: two.id, done: true, userId: boss })).toEqual({ ok: false, error: "Checklist item not found." }); // an item of another task
  });

  it("gives the next occurrence of a repeating task the same checklist, unticked, and its labels", async () => {
    const t = await task({ status: "IN_PROGRESS", recurrence: "WEEKLY", dueDate: new Date("2026-12-01T00:00:00Z"), labelIds: ["lbl1"] });
    await addChecklistItems(db, { taskId: t, texts: ["Reply to comments", "Reply to messages"] });
    for (const i of await listChecklist(db, t)) await tickChecklistItem(db, { taskId: t, itemId: i.id, done: true, userId: boss });
    const r = await changeTaskStatus(db, { projectId: project, taskId: t, status: "DONE", actorId: boss });
    expect(r.next).not.toBeNull();
    expect(r.next!.labelIds).toEqual(["lbl1"]);
    expect((await listChecklist(db, r.next!.id)).map((i) => [i.text, i.done])).toEqual([["Reply to comments", false], ["Reply to messages", false]]);
  });

  it("saves checklists per organization and adds them to tasks; another organization can't use or delete them", async () => {
    const t = await task();
    expect(await saveChecklist(db, { organizationId: org, name: "Post QA", items: [], byUserId: boss })).toMatchObject({ ok: false });
    const s = await saveChecklist(db, { organizationId: org, name: " Post  QA ", items: ["Logo placed", "logo placed", "Spelling checked"], byUserId: boss });
    expect(s).toMatchObject({ ok: true, value: { name: "Post QA" } });
    expect(await saveChecklist(db, { organizationId: org, name: "post qa", items: ["x"], byUserId: boss })).toEqual({ ok: false, error: "There is already a saved checklist called post qa." });
    if (!s.ok) return;
    expect((await db.checklistTemplate.findUnique({ where: { id: s.value.id } }))!.items).toEqual(["Logo placed", "Spelling checked"]);
    await addChecklistItems(db, { taskId: t, texts: ["Spelling checked"] });
    expect(await applySavedChecklist(db, { organizationId: org, templateId: s.value.id, taskId: t })).toEqual({ ok: true, value: { name: "Post QA", added: 1 } });
    expect(await applySavedChecklist(db, { organizationId: other, templateId: s.value.id, taskId: t })).toEqual({ ok: false, error: "Saved checklist not found." });
    expect(await deleteSavedChecklist(db, { organizationId: other, id: s.value.id })).toEqual({ ok: false, error: "Saved checklist not found." });
    expect(await deleteSavedChecklist(db, { organizationId: org, id: s.value.id })).toEqual({ ok: true, value: { name: "Post QA" } });
    expect(await listChecklist(db, t)).toHaveLength(2); // the task keeps its items
  });

  it("copies checklists from a project template into tasks, and back into a template", async () => {
    const b = parseTemplateBody({ tasks: [{ title: "Launch ads", checklist: ["Ads approved", "Pixel firing"] }, { title: "Report" }] });
    if (!b.ok) throw new Error(b.error);
    await db.$transaction((tx) => applyTemplate(tx, { organizationId: org, projectId: project, body: b.value, start: "2026-12-01", roleAssignees: {}, byUserId: boss }));
    const launch = await db.task.findFirst({ where: { projectId: project, title: "Launch ads" } });
    expect((await listChecklist(db, launch!.id)).map((i) => i.text)).toEqual(["Ads approved", "Pixel firing"]);
    const back = await templateFromProject(db, { organizationId: org, projectId: project });
    expect(back.ok && back.value.tasks.find((x) => x.title === "Launch ads")!.checklist).toEqual(["Ads approved", "Pixel firing"]);
    expect(back.ok && back.value.tasks.find((x) => x.title === "Report")!.checklist).toEqual([]);
  });
});
