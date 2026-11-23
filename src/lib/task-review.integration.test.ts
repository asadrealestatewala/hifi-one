// Review records, Approve / Revision needed, the response clock, and issues inside a task, against hifi_one_test.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { approveTask, officeMinutesBetween, requestRevision, runReviewEscalations } from "./task-review";
import { reportIssue, resolveIssue } from "./task-issues";
import { changeTaskStatus } from "./tasks";
import { calendarFrom } from "./working-calendar";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, otherOrg: string, pm: string, dev: string, owner: string, hr: string, outsider: string, project: string;
const inbox = (id: string) => db.notification.findMany({ where: { userId: id }, orderBy: { createdAt: "asc" } });
// Tuesday 24 Nov 2026; 11:00 AM in Karachi = 06:00 UTC
const T = (hhmmUtc: string) => new Date(`2026-11-24T${hhmmUtc}:00.000Z`);

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "Notification","TaskReview","TaskIssue","TaskComment","Task","ProjectMember","Project","WorkingCalendar","PublicHoliday","UserRole","RolePermission","Role","Permission","User","CompanyProfile","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Review Org" } })).id;
  otherOrg = (await db.organization.create({ data: { name: "Other Org" } })).id;
  await db.companyProfile.create({ data: { organizationId: org, isDefault: true, legalName: "Review Org", timezone: "Asia/Karachi" } });
  const exec = await db.permission.create({ data: { key: "dashboard.executive", description: "x" } });
  const hrPerm = await db.permission.create({ data: { key: "hr.manage", description: "x" } });
  const ceo = await db.role.create({ data: { organizationId: org, key: "CEO", name: "CEO", permissions: { create: { permissionId: exec.id } } } });
  const hrRole = await db.role.create({ data: { organizationId: org, key: "HR", name: "HR", permissions: { create: { permissionId: hrPerm.id } } } });
  pm = (await db.user.create({ data: { organizationId: org, email: "pm@r.test", name: "Pia PM", passwordHash: "x" } })).id;
  dev = (await db.user.create({ data: { organizationId: org, email: "dev@r.test", name: "Dev Doe", passwordHash: "x" } })).id;
  owner = (await db.user.create({ data: { organizationId: org, email: "ceo@r.test", name: "Owner", passwordHash: "x", roles: { create: { roleId: ceo.id } } } })).id;
  hr = (await db.user.create({ data: { organizationId: org, email: "hr@r.test", name: "Hana HR", passwordHash: "x", roles: { create: { roleId: hrRole.id } } } })).id;
  outsider = (await db.user.create({ data: { organizationId: otherOrg, email: "o@r.test", name: "Other", passwordHash: "x" } })).id;
  project = (await db.project.create({ data: { organizationId: org, number: "P1", name: "Site", managerId: pm } })).id;
});
afterAll(async () => { await db.$disconnect(); });

const task = (title: string) => db.task.create({ data: { projectId: project, title, assigneeId: dev, status: "IN_PROGRESS" } });
const send = (id: string, at: Date) => changeTaskStatus(db, { projectId: project, taskId: id, status: "REVIEW", actorId: dev, now: at });

describe("review records", () => {
  it("records when work was sent and when the manager approved it", async () => {
    const t = await task("Hero banner");
    await send(t.id, T("06:00"));
    await approveTask(db, { projectId: project, taskId: t.id, actorId: pm, now: T("06:03"), comment: "Looks good" });
    const [r] = await db.taskReview.findMany({ where: { taskId: t.id } });
    expect(r).toMatchObject({ submittedById: dev, respondedById: pm, outcome: "APPROVED", comment: "Looks good" });
    expect(r.respondedAt!.getTime() - r.submittedAt.getTime()).toBe(3 * 60_000);
    expect((await db.task.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("DONE");
    expect((await db.taskComment.findMany({ where: { taskId: t.id } })).map((c) => c.body)).toEqual(["Approved: Looks good"]);
  });

  it("sends work back with a required comment, counts revisions, and a resubmission opens a new review", async () => {
    const t = await task("Caption");
    await send(t.id, T("06:00"));
    await expect(requestRevision(db, { projectId: project, taskId: t.id, actorId: pm, comment: " " })).rejects.toThrow("Write what needs to change.");
    const r = await requestRevision(db, { projectId: project, taskId: t.id, actorId: pm, comment: "Shorter please", now: T("06:02") });
    expect(r.revision).toBe(1);
    const after = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(after).toMatchObject({ status: "IN_PROGRESS", revisionCount: 1 });
    await send(t.id, T("06:30"));
    const reviews = await db.taskReview.findMany({ where: { taskId: t.id }, orderBy: { submittedAt: "asc" } });
    expect(reviews.map((x) => [x.outcome, x.comment])).toEqual([["REVISION", "Shorter please"], [null, null]]);
    expect((await db.taskComment.findMany({ where: { taskId: t.id } })).map((c) => c.body)).toEqual(["Revision needed: Shorter please"]);
  });

  it("refuses to approve or send back a task that is not in review", async () => {
    const t = await task("Not yet");
    await expect(approveTask(db, { projectId: project, taskId: t.id, actorId: pm })).rejects.toThrow("not waiting for review");
    await expect(requestRevision(db, { projectId: project, taskId: t.id, actorId: pm, comment: "Again" })).rejects.toThrow("not waiting for review");
  });

  it("marks a review the sender took back, and one closed by a status change", async () => {
    const t = await task("Taken back");
    await send(t.id, T("06:00"));
    await changeTaskStatus(db, { projectId: project, taskId: t.id, status: "IN_PROGRESS", actorId: dev, now: T("06:01") });
    await send(t.id, T("06:05"));
    await changeTaskStatus(db, { projectId: project, taskId: t.id, status: "TODO", actorId: pm, now: T("06:06") });
    expect((await db.taskReview.findMany({ where: { taskId: t.id }, orderBy: { submittedAt: "asc" } })).map((x) => x.outcome)).toEqual(["WITHDRAWN", "MOVED"]);
  });
});

describe("response clock", () => {
  const CAL = calendarFrom(null, "Asia/Karachi"); // 9:00 to 18:30, Monday to Friday
  it("counts only office minutes on working days", () => {
    expect(officeMinutesBetween(T("06:00"), T("06:07"), CAL)).toBe(7);
    // 6:25 PM to 9:03 AM next day: 5 minutes before closing and 3 after opening
    expect(officeMinutesBetween(T("13:25"), new Date("2026-11-25T04:03:00.000Z"), CAL)).toBe(8);
    // Friday 6:28 PM to Monday 9:02 AM
    expect(officeMinutesBetween(new Date("2026-11-27T13:28:00.000Z"), new Date("2026-11-30T04:02:00.000Z"), CAL)).toBe(4);
    expect(officeMinutesBetween(T("06:00"), T("06:07"), CAL, ["2026-11-24"])).toBe(0);
  });

  it("tells owners, HR and the manager once when work waits longer than the response time", async () => {
    const t = await task("Waiting one");
    await send(t.id, T("06:00"));
    expect(await runReviewEscalations(db, { now: T("06:04"), organizationId: org })).toBe(0);
    expect(await runReviewEscalations(db, { now: T("06:05"), organizationId: org })).toBe(1);
    expect(await runReviewEscalations(db, { now: T("06:20"), organizationId: org })).toBe(0);
    for (const who of [owner, hr, pm]) expect((await inbox(who)).filter((n) => n.kind === "task.review_waiting").map((n) => n.title)).toEqual(["Waiting 5 m for review: Waiting one"]);
    expect((await inbox(dev)).some((n) => n.kind === "task.review_waiting")).toBe(false);
    expect(await inbox(outsider)).toHaveLength(0);
  });

  it("uses the response time from Working calendar, and never escalates an answered review", async () => {
    await db.workingCalendar.create({ data: { organizationId: org, reviewResponseMinutes: 15 } });
    const t = await task("Slow one");
    await send(t.id, T("07:00"));
    const escalated = async () => (await db.taskReview.findFirstOrThrow({ where: { taskId: t.id } })).escalatedAt;
    await runReviewEscalations(db, { now: T("07:10"), organizationId: org });
    expect(await escalated()).toBeNull();
    await approveTask(db, { projectId: project, taskId: t.id, actorId: pm, now: T("07:12") });
    await runReviewEscalations(db, { now: T("07:30"), organizationId: org });
    expect(await escalated()).toBeNull();
  });
});

describe("issues inside a task", () => {
  it("records the issue with its time and tells the manager and owners, not the reporter", async () => {
    const t = await task("Logo");
    const at = T("08:00");
    const issue = await reportIssue(db, { organizationId: org, projectId: project, taskId: t.id, actorId: dev, body: "Client has not sent the logo", now: at });
    expect(issue).toMatchObject({ status: "OPEN", reportedById: dev });
    expect(issue.createdAt.toISOString()).toBe(at.toISOString());
    expect((await inbox(pm)).filter((n) => n.kind === "task.issue").map((n) => n.body)).toEqual(["Dev Doe: Client has not sent the logo"]);
    expect((await inbox(owner)).some((n) => n.kind === "task.issue")).toBe(true);
    expect((await inbox(dev)).some((n) => n.kind === "task.issue")).toBe(false);
  });

  it("is resolved only by the project manager, with a note, and the reporter hears", async () => {
    const issue = await db.taskIssue.findFirstOrThrow({ where: { status: "OPEN" } });
    await expect(resolveIssue(db, { organizationId: org, issueId: issue.id, actorId: dev, canManageAll: false, resolution: "done" })).rejects.toThrow("Only the project manager");
    await expect(resolveIssue(db, { organizationId: org, issueId: issue.id, actorId: pm, canManageAll: false, resolution: " " })).rejects.toThrow("Write how it was solved");
    await resolveIssue(db, { organizationId: org, issueId: issue.id, actorId: pm, canManageAll: false, resolution: "Logo received by email" });
    expect(await db.taskIssue.findUniqueOrThrow({ where: { id: issue.id } })).toMatchObject({ status: "RESOLVED", resolvedById: pm, resolution: "Logo received by email" });
    expect((await inbox(dev)).filter((n) => n.kind === "task.issue_resolved").map((n) => n.body)).toEqual(["Logo received by email"]);
    await expect(resolveIssue(db, { organizationId: org, issueId: issue.id, actorId: pm, canManageAll: false, resolution: "again" })).rejects.toThrow("already resolved");
  });

  it("keeps organizations apart and refuses empty issues", async () => {
    const t = await task("Guarded");
    await expect(reportIssue(db, { organizationId: otherOrg, projectId: project, taskId: t.id, actorId: outsider, body: "Sneaky" })).rejects.toThrow("Task not found");
    await expect(reportIssue(db, { organizationId: org, projectId: project, taskId: t.id, actorId: dev, body: "x" })).rejects.toThrow("Write what the problem is");
    const issue = await reportIssue(db, { organizationId: org, projectId: project, taskId: t.id, actorId: dev, body: "Real one" });
    await expect(resolveIssue(db, { organizationId: otherOrg, issueId: issue.id, actorId: outsider, canManageAll: true, resolution: "closed" })).rejects.toThrow("Issue not found");
  });
});
