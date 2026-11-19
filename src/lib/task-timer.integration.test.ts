// Task timer against hifi_one_test: one timer per person, stopping saves a time entry through logTime's rules, long timers need hours typed.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { currentTimer, dateIn, discardTimer, elapsedHours, startTimer, stopTimer } from "./task-timer";
import { deleteTaskFamilies } from "./task-bulk";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const TZ = "Asia/Karachi";
const at = (iso: string) => new Date(iso);

let org: string, ana: string, outsider: string, proj: string, closed: string, design: string, copy: string, done: string, shut: string;

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "TaskTimer","TimeEntry","Task","ProjectMember","Project","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Timer Org" } })).id;
  const mk = (name: string) => db.user.create({ data: { organizationId: org, name, email: `${name}@timer.test`, passwordHash: "x", userType: "EMPLOYEE" } }).then((u) => u.id);
  ana = await mk("ana"); outsider = await mk("outsider");
  const boss = await mk("boss");
  proj = (await db.project.create({ data: { organizationId: org, number: "T-1", name: "Site", managerId: boss, members: { create: [{ userId: boss }, { userId: ana, hourlyCost: "1000" }] } } })).id;
  closed = (await db.project.create({ data: { organizationId: org, number: "T-2", name: "Old", managerId: boss, status: "COMPLETED", members: { create: [{ userId: ana }] } } })).id;
  design = (await db.task.create({ data: { projectId: proj, title: "Design" } })).id;
  copy = (await db.task.create({ data: { projectId: proj, title: "Copy" } })).id;
  done = (await db.task.create({ data: { projectId: proj, title: "Done", status: "DONE" } })).id;
  shut = (await db.task.create({ data: { projectId: closed, title: "Shut" } })).id;
});
beforeEach(async () => { await db.taskTimer.deleteMany({}); await db.timeEntry.deleteMany({}); });
afterAll(async () => { await db.$disconnect(); });

describe("elapsedHours and dateIn", () => {
  it("rounds to the minute with at least one minute, and dates in the company zone", () => {
    expect(elapsedHours(at("2026-11-19T04:00:00Z"), at("2026-11-19T05:30:20Z"))).toBe("1.50"); // 90 minutes
    expect(elapsedHours(at("2026-11-19T04:00:00Z"), at("2026-11-19T04:00:05Z"))).toBe("0.02");
    expect(dateIn(at("2026-11-18T20:30:00Z"), TZ)).toBe("2026-11-19"); // 1:30 AM in Karachi
  });
});

describe("task timer", () => {
  it("starts on a task, refuses a second one, and stopping saves the time to the log", async () => {
    await startTimer(db, { organizationId: org, userId: ana, taskId: design, now: at("2026-11-19T04:00:00Z") });
    expect((await currentTimer(db, { organizationId: org, userId: ana }))).toMatchObject({ taskId: design, task: "Design", project: "Site" });
    await expect(startTimer(db, { organizationId: org, userId: ana, taskId: copy })).rejects.toThrow('running on "Design"');
    await expect(startTimer(db, { organizationId: org, userId: ana, taskId: design })).rejects.toThrow("already running on this task");
    const r = await stopTimer(db, { organizationId: org, userId: ana, now: at("2026-11-19T06:15:00Z"), timeZone: TZ });
    expect(r.entry).toMatchObject({ taskId: design, userId: ana, workDate: "2026-11-19", projectId: proj });
    expect(r.entry.hours.toString()).toBe("2.25");
    expect(r.entry.hourlyCost?.toString()).toBe("1000"); // the member's cost rate, as with typed entries
    expect(await currentTimer(db, { organizationId: org, userId: ana })).toBeNull();
    await expect(stopTimer(db, { organizationId: org, userId: ana, timeZone: TZ })).rejects.toThrow("No timer is running");
  });

  it("uses the hours the person typed, and needs them when the timer ran very long", async () => {
    await startTimer(db, { organizationId: org, userId: ana, taskId: design, now: at("2026-11-18T05:00:00Z") });
    await expect(stopTimer(db, { organizationId: org, userId: ana, now: at("2026-11-19T04:00:00Z"), timeZone: TZ })).rejects.toThrow("Type the hours");
    expect(await currentTimer(db, { organizationId: org, userId: ana })).not.toBeNull(); // still running, nothing saved
    const r = await stopTimer(db, { organizationId: org, userId: ana, hours: "3.5", note: "Logo", now: at("2026-11-19T04:00:00Z"), timeZone: TZ });
    expect(r.entry).toMatchObject({ workDate: "2026-11-18", note: "Logo" }); // the day it started
    expect(r.entry.hours.toString()).toBe("3.5");
  });

  it("keeps the timer running when the time log refuses the entry", async () => {
    await db.timeEntry.create({ data: { organizationId: org, projectId: proj, userId: ana, workDate: "2026-11-19", hours: "23" } });
    await startTimer(db, { organizationId: org, userId: ana, taskId: design, now: at("2026-11-19T04:00:00Z") });
    await expect(stopTimer(db, { organizationId: org, userId: ana, now: at("2026-11-19T06:00:00Z"), timeZone: TZ })).rejects.toThrow("more than 24 hours");
    expect((await currentTimer(db, { organizationId: org, userId: ana }))?.taskId).toBe(design);
    await expect(stopTimer(db, { organizationId: org, userId: ana, hours: "abc", timeZone: TZ, now: at("2026-11-19T06:00:00Z") })).rejects.toThrow("between 0 and 24");
  });

  it("discards without saving", async () => {
    await startTimer(db, { organizationId: org, userId: ana, taskId: copy });
    await discardTimer(db, { organizationId: org, userId: ana });
    expect(await db.timeEntry.count()).toBe(0);
    await expect(discardTimer(db, { organizationId: org, userId: ana })).rejects.toThrow("No timer");
  });

  it("refuses people off the team, done tasks, closed projects and other organizations' tasks", async () => {
    await expect(startTimer(db, { organizationId: org, userId: outsider, taskId: design })).rejects.toThrow("Only people on the project");
    await expect(startTimer(db, { organizationId: org, userId: ana, taskId: done })).rejects.toThrow("done");
    await expect(startTimer(db, { organizationId: org, userId: ana, taskId: shut })).rejects.toThrow("closed");
    const other = (await db.organization.create({ data: { name: "Other" } })).id;
    await expect(startTimer(db, { organizationId: other, userId: ana, taskId: design })).rejects.toThrow("Task not found");
  });

  it("drops a running timer when its task is deleted", async () => {
    const temp = (await db.task.create({ data: { projectId: proj, title: "Temp" } })).id;
    await startTimer(db, { organizationId: org, userId: ana, taskId: temp });
    await db.$transaction((tx) => deleteTaskFamilies(tx, proj, [temp]));
    expect(await currentTimer(db, { organizationId: org, userId: ana })).toBeNull();
  });
});
