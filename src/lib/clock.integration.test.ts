import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { breakEndAll, breakStartAll, clockInAll, clockOutAll, monitoringState } from "./clock";
import { acknowledge, getPolicy, savePolicy } from "./monitoring";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, ann: string, hr: string;
const Z = "Asia/Karachi";
const T = (hhmm: string) => new Date(`2026-10-12T${hhmm}:00.000Z`);
const text = "We record when you are active, idle or on a break, only while you are clocked in. HR can see reports; screenshots are limited to named roles and every view is logged for you to read.";

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "BreakRecord","AttendanceRecord","MonitoringAccess","Screenshot","WorkBreak","WorkSession","PolicyAck","MonitoringPolicy","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Clock Org" } })).id;
  const u = (e: string) => db.user.create({ data: { organizationId: org, email: e, name: e, passwordHash: "x" } }).then((x) => x.id);
  ann = await u("ann@c.test"); hr = await u("hr@c.test");
});
afterAll(async () => { await db.$disconnect(); });

describe("one clock for attendance and activity tracking", () => {
  it("records attendance only, and no work session, while monitoring is off", async () => {
    expect(await monitoringState(db, org, ann)).toBe("OFF");
    const r = await clockInAll(db, { organizationId: org, userId: ann, timeZone: Z, workMode: "OFFICE", now: T("04:00") });
    expect(r.session).toBeNull();
    expect(await db.workSession.count({ where: { userId: ann } })).toBe(0);
    await clockOutAll(db, { userId: ann, now: T("12:00") });
    expect((await db.attendanceRecord.findFirstOrThrow({ where: { userId: ann } })).clockOut).not.toBeNull();
  });

  it("records no activity session until the person has accepted the terms", async () => {
    await db.attendanceRecord.deleteMany({ where: { userId: ann } });
    await savePolicy(db, { organizationId: org, actorId: hr, patch: { enabled: true, policyText: text } });
    expect(await monitoringState(db, org, ann)).toBe("NEEDS_CONSENT");
    const r = await clockInAll(db, { organizationId: org, userId: ann, timeZone: Z, workMode: "OFFICE", now: T("04:00") });
    expect(r.monitoring).toBe("NEEDS_CONSENT");
    expect(r.session).toBeNull();
    expect(await db.workSession.count({ where: { userId: ann } })).toBe(0);
    await clockOutAll(db, { userId: ann, now: T("05:00") });
  });

  it("opens, breaks and closes both records together after acceptance", async () => {
    await db.attendanceRecord.deleteMany({ where: { userId: ann } });
    await acknowledge(db, { userId: ann, version: (await getPolicy(db, org)).version });
    expect(await monitoringState(db, org, ann)).toBe("ON");
    const r = await clockInAll(db, { organizationId: org, userId: ann, timeZone: Z, workMode: "REMOTE", now: T("04:00") });
    expect(r.session).not.toBeNull();
    await breakStartAll(db, { userId: ann, now: T("06:00") });
    expect(await db.breakRecord.count({ where: { endAt: null } })).toBe(1);
    expect(await db.workBreak.count({ where: { endedAt: null } })).toBe(1);
    await breakEndAll(db, { userId: ann, now: T("06:30") });
    expect(await db.breakRecord.count({ where: { endAt: null } })).toBe(0);
    expect(await db.workBreak.count({ where: { endedAt: null } })).toBe(0);
    await clockOutAll(db, { userId: ann, now: T("12:00") });
    expect((await db.workSession.findFirstOrThrow({ where: { userId: ann } })).endedAt).not.toBeNull();
    expect((await db.attendanceRecord.findFirstOrThrow({ where: { userId: ann } })).clockOut).not.toBeNull();
  });

  it("refuses to clock out someone who is not clocked in", async () => {
    await expect(clockOutAll(db, { userId: ann })).rejects.toThrow(/not clocked in/);
  });

  it("does not create a second session when clocked in twice", async () => {
    await db.attendanceRecord.deleteMany({ where: { userId: ann } });
    await clockInAll(db, { organizationId: org, userId: ann, timeZone: Z, workMode: "OFFICE", now: T("04:00") });
    await clockInAll(db, { organizationId: org, userId: ann, timeZone: Z, workMode: "OFFICE", now: T("04:01") });
    expect(await db.workSession.count({ where: { userId: ann, endedAt: null } })).toBe(1);
    expect(await db.attendanceRecord.count({ where: { userId: ann, clockOut: null } })).toBe(1);
  });
});
