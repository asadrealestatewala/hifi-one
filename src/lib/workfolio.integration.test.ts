import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { MonitorError, acknowledge, dockState, endSession, getPolicy, liveStatus, savePolicy, startBreak, startSession, storeBrowserScreenshot } from "./monitoring";
import { MemoryStorage } from "./storage";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const storage = new MemoryStorage();
let org: string, ann: string, bob: string, hr: string;
const T = (hhmm: string, day = "2026-10-12") => new Date(`${day}T${hhmm}:00.000Z`); // 05:00Z is 10:00 in Karachi
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(400, 9)]);
const text = "We record when you are active, idle, or on a break, and take a snapshot of your screen at the interval below only while you choose to share it and are clocked in. HR can see reports; screenshots are limited to named roles and every view is logged for you to read.";

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "MonitoringAccess","Screenshot","WorkBreak","WorkSession","PolicyAck","MonitoringPolicy","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Workfolio Org" } })).id;
  const u = (e: string) => db.user.create({ data: { organizationId: org, email: e, name: e, passwordHash: "x" } }).then((x) => x.id);
  ann = await u("ann@w.test"); bob = await u("bob@w.test"); hr = await u("hr@w.test");
});
afterAll(async () => { await db.$disconnect(); });

describe("Workfolio browser screen sharing", () => {
  it("offers nothing until snapshots are on, the person consented and they are clocked in", async () => {
    expect((await dockState(db, { organizationId: org, userId: ann }, T("05:00"))).reason).toMatch(/switched off/);
    await savePolicy(db, { organizationId: org, actorId: hr, patch: { enabled: true, policyText: text, screenshots: true, screenshotIntervalMin: 10 } });
    expect((await dockState(db, { organizationId: org, userId: ann }, T("05:00"))).reason).toMatch(/Accept the monitoring policy/);
    await acknowledge(db, { userId: ann, version: (await getPolicy(db, org)).version });
    expect((await dockState(db, { organizationId: org, userId: ann }, T("05:00"))).reason).toMatch(/Clock in/);
    await expect(storeBrowserScreenshot(db, storage, { organizationId: org, userId: ann }, JPEG, T("05:00"))).rejects.toThrow(/Clock in/);
  });

  it("takes snapshots only inside a work session, at the interval, and not on breaks", async () => {
    await startSession(db, { organizationId: org, userId: ann, now: T("05:00") });
    const s0 = await dockState(db, { organizationId: org, userId: ann }, T("05:00"));
    expect(s0.available).toBe(true);
    expect(s0.intervalMin).toBe(10);
    const first = await storeBrowserScreenshot(db, storage, { organizationId: org, userId: ann }, JPEG, T("05:00"));
    expect(first.deviceId).toBeNull();
    await expect(storeBrowserScreenshot(db, storage, { organizationId: org, userId: ann }, JPEG, T("05:03"))).rejects.toThrow(/Too soon/);
    const s1 = await dockState(db, { organizationId: org, userId: ann }, T("05:03"));
    expect(new Date(s1.nextDueAt!).toISOString()).toBe(T("05:10").toISOString());
    await storeBrowserScreenshot(db, storage, { organizationId: org, userId: ann }, JPEG, T("05:10"));
    await expect(storeBrowserScreenshot(db, storage, { organizationId: org, userId: ann }, JPEG, T("14:00", "2026-10-12"))).rejects.toThrow(/Outside working hours/);
    await expect(storeBrowserScreenshot(db, storage, { organizationId: org, userId: ann }, Buffer.from("not an image".repeat(40)), T("05:30"))).rejects.toThrow(MonitorError);
    await startBreak(db, { userId: ann, sessionId: (await db.workSession.findFirstOrThrow({ where: { userId: ann, endedAt: null } })).id, now: T("05:25") });
    await expect(storeBrowserScreenshot(db, storage, { organizationId: org, userId: ann }, JPEG, T("05:30"))).rejects.toThrow(/break/);
    expect((await dockState(db, { organizationId: org, userId: ann }, T("05:30"))).onBreak).toBe(true);
  });

  it("refuses a person who never accepted the policy, and ends with the work session", async () => {
    await expect(startSession(db, { organizationId: org, userId: bob, now: T("05:00") })).rejects.toThrow(/accept/);
    await expect(storeBrowserScreenshot(db, storage, { organizationId: org, userId: bob }, JPEG, T("05:00"))).rejects.toThrow(MonitorError);
    await endSession(db, { userId: ann, sessionId: (await db.workSession.findFirstOrThrow({ where: { userId: ann, endedAt: null } })).id });
    expect((await dockState(db, { organizationId: org, userId: ann }, T("05:40"))).available).toBe(false);
  });

  it("shows managers who is working and when each last shared, without screenshots themselves", async () => {
    await startSession(db, { organizationId: org, userId: ann, now: new Date() });
    const live = await liveStatus(db, org, [ann, bob]);
    expect(live.get(ann)?.state).toBe("WORKING");
    expect(live.get(ann)?.lastSnapshotAt).not.toBeNull();
    expect(live.get(bob)).toMatchObject({ state: "OFFLINE", lastSnapshotAt: null });
  });
});
