import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  MonitorError, acknowledge, agentPolicy, authenticateDevice, createEnrollmentCode, decideCorrection, deleteScreenshot, disputeScreenshot, endBreak, endSession, enrollDevice,
  getPolicy, heartbeat, ingestAgent, localParts, openScreenshot, purgeMonitoring, requestCorrection, revokeDevice, savePolicy, startBreak, startSession, storeScreenshot, summarize, withinSchedule,
} from "./monitoring";
import { MemoryStorage } from "./storage";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const storage = new MemoryStorage();
let org: string, other: string, ann: string, bob: string, hr: string;
// Monday 12 Oct 2026, 10:00 in Karachi (UTC+5)
const T = (hhmm: string, day = "2026-10-12") => new Date(`${day}T${hhmm}:00.000Z`);
const WORK = T("05:00");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(400, 7)]);
const text = "We record when you are active, idle, or on a break, counts of key presses and clicks (never what you type), and application names. Screenshots every ten minutes during working hours. HR can see reports; screenshots are logged. Kept for 30 days.";

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "TimesheetCorrection","MonitoringAccess","Screenshot","EnrollmentCode","MonitorDevice","AppCategory","AppUsage","ActivityBucket","WorkBreak","WorkSession","PolicyAck","MonitoringPolicy","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Mon Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other" } })).id;
  const u = (e: string) => db.user.create({ data: { organizationId: org, email: e, name: e, passwordHash: "x" } }).then((x) => x.id);
  ann = await u("ann@m.test"); bob = await u("bob@m.test"); hr = await u("hr@m.test");
});
afterAll(async () => { await db.$disconnect(); });

const enable = (patch = {}) => savePolicy(db, { organizationId: org, actorId: hr, patch: { enabled: true, policyText: text, ...patch } });

describe("policy", () => {
  it("is off by default and cannot be turned on without a written policy", async () => {
    expect((await getPolicy(db, org)).enabled).toBe(false);
    await expect(savePolicy(db, { organizationId: org, actorId: hr, patch: { enabled: true } })).rejects.toThrow(/Write the policy/);
    await expect(savePolicy(db, { organizationId: org, actorId: hr, patch: { enabled: true, policyText: text, workStart: "18:00", workEnd: "09:00" } })).rejects.toThrow(/Working hours/);
    await expect(savePolicy(db, { organizationId: org, actorId: hr, patch: { screenshots: true } })).rejects.toThrow(/only work while monitoring is on/);
    await expect(savePolicy(db, { organizationId: org, actorId: hr, patch: { timezone: "Mars/Base" } })).rejects.toThrow(/time zone/);
    await expect(savePolicy(db, { organizationId: org, actorId: hr, patch: { screenshotIntervalMin: 1 } })).rejects.toThrow(/interval/);
  });
  it("raises the version whenever what is collected changes, so everyone must accept again", async () => {
    const a = await enable();
    const b = await savePolicy(db, { organizationId: org, actorId: hr, patch: { trackApps: true } });
    expect(b.version).toBe(a.version + 1);
    const c = await savePolicy(db, { organizationId: org, actorId: hr, patch: { trackApps: true } });
    expect(c.version).toBe(b.version);
  });
  it("knows working hours in the policy's own time zone", () => {
    const p = { timezone: "Asia/Karachi", workStart: "09:00", workEnd: "18:00", workDays: "1,2,3,4,5" };
    expect(localParts(WORK, "Asia/Karachi")).toEqual({ dow: 1, hm: "10:00" });
    expect(withinSchedule(p, WORK)).toBe(true);
    expect(withinSchedule(p, T("14:00"))).toBe(false); // 19:00 local
    expect(withinSchedule(p, T("05:00", "2026-10-11"))).toBe(false); // Sunday
  });
});

describe("nothing is recorded without consent", () => {
  it("refuses to start tracking until the person accepts the current policy version", async () => {
    await expect(startSession(db, { organizationId: org, userId: ann, now: WORK })).rejects.toThrow(/accept the monitoring policy/);
    const pol = await getPolicy(db, org);
    await acknowledge(db, { userId: ann, version: pol.version });
    expect((await startSession(db, { organizationId: org, userId: ann, now: WORK })).endedAt).toBeNull();
  });
  it("a new policy version blocks everyone again until they accept it", async () => {
    await savePolicy(db, { organizationId: org, actorId: hr, patch: { retentionDays: 14 } });
    const s = await db.workSession.findFirstOrThrow({ where: { userId: ann, endedAt: null } });
    await expect(heartbeat(db, { organizationId: org, userId: ann, sessionId: s.id, activeSeconds: 10, idleSeconds: 0, keys: 1, clicks: 1, now: T("05:00:30".slice(0, 5)) })).rejects.toThrow(/accept/);
    await acknowledge(db, { userId: ann, version: (await getPolicy(db, org)).version });
  });
  it("tracking does nothing at all while the policy is switched off", async () => {
    await savePolicy(db, { organizationId: org, actorId: hr, patch: { enabled: false } });
    await expect(startSession(db, { organizationId: org, userId: bob, now: WORK })).rejects.toThrow(/not switched on/);
    await enable();
    await acknowledge(db, { userId: ann, version: (await getPolicy(db, org)).version });
  });
});

describe("sessions and activity", () => {
  it("clocking in twice returns the same session", async () => {
    const a = await startSession(db, { organizationId: org, userId: ann, now: WORK });
    const b = await startSession(db, { organizationId: org, userId: ann, now: WORK });
    expect(b.id).toBe(a.id);
  });

  it("stores counts only, caps impossible figures, ignores breaks and out-of-hours", async () => {
    const s = await db.workSession.findFirstOrThrow({ where: { userId: ann, endedAt: null } });
    await db.workSession.update({ where: { id: s.id }, data: { lastBeatAt: new Date(WORK.getTime() + 60_000) } });
    const r = await heartbeat(db, { organizationId: org, userId: ann, sessionId: s.id, activeSeconds: 25, idleSeconds: 5, keys: 100, clicks: 40, now: new Date(WORK.getTime() + 90_000) });
    expect(r.recorded).toBe(true);
    // a browser claiming 3,000 seconds in 30 is cut to what time allows
    await heartbeat(db, { organizationId: org, userId: ann, sessionId: s.id, activeSeconds: 3000, idleSeconds: 0, keys: 9_999_999, clicks: 0, now: new Date(WORK.getTime() + 120_000) });
    const bucket = await db.activityBucket.findFirstOrThrow({ where: { userId: ann } });
    expect(bucket.activeSeconds).toBeLessThanOrEqual(25 + 35);
    expect(bucket.keyCount).toBeLessThanOrEqual(bucket.activeSeconds * 20);
    expect(Object.keys(bucket).sort()).toEqual(["activeSeconds", "bucketStart", "clickCount", "id", "idleSeconds", "keyCount", "organizationId", "source", "userId"]); // no content columns exist

    await startBreak(db, { userId: ann, sessionId: s.id, now: new Date(WORK.getTime() + 150_000) });
    const before = (await db.activityBucket.findFirstOrThrow({ where: { userId: ann } })).activeSeconds;
    const onBreak = await heartbeat(db, { organizationId: org, userId: ann, sessionId: s.id, activeSeconds: 20, idleSeconds: 0, keys: 5, clicks: 5, now: new Date(WORK.getTime() + 180_000) });
    expect(onBreak.recorded).toBe(false);
    expect((await db.activityBucket.findFirstOrThrow({ where: { userId: ann } })).activeSeconds).toBe(before);
    await endBreak(db, { userId: ann, sessionId: s.id, now: new Date(WORK.getTime() + 200_000) });

    const night = T("15:00"); // 20:00 local
    await db.workSession.update({ where: { id: s.id }, data: { lastBeatAt: new Date(night.getTime() - 30_000) } });
    const out = await heartbeat(db, { organizationId: org, userId: ann, sessionId: s.id, activeSeconds: 20, idleSeconds: 0, keys: 5, clicks: 5, now: night });
    expect(out.recorded).toBe(false);
    expect(out.outsideHours).toBe(true);
  });

  it("only the owner can touch a session", async () => {
    const s = await db.workSession.findFirstOrThrow({ where: { userId: ann, endedAt: null } });
    await expect(endSession(db, { userId: bob, sessionId: s.id })).rejects.toThrow(/not found/);
    await expect(heartbeat(db, { organizationId: org, userId: bob, sessionId: s.id, activeSeconds: 1, idleSeconds: 0, keys: 0, clicks: 0 })).rejects.toThrow();
  });

  it("an abandoned session is counted only up to its last signal", async () => {
    const s = await db.workSession.findFirstOrThrow({ where: { userId: ann, endedAt: null } });
    await db.workSession.update({ where: { id: s.id }, data: { startedAt: T("04:00"), lastBeatAt: T("05:30") } });
    const [row] = await summarize(db, { organizationId: org, userIds: [ann], from: "2026-10-12", to: "2026-10-12", now: T("09:00") });
    expect(row.attendanceMinutes).toBe(90); // 04:00 to 05:30, not to "now"
    await endSession(db, { userId: ann, sessionId: s.id, now: T("05:30") });
  });

  it("summaries add up tracked, break and attendance time per person", async () => {
    const s = await startSession(db, { organizationId: org, userId: bob, now: T("06:00") }).catch(async () => { await acknowledge(db, { userId: bob, version: (await getPolicy(db, org)).version }); return startSession(db, { organizationId: org, userId: bob, now: T("06:00") }); });
    await startBreak(db, { userId: bob, sessionId: s.id, now: T("06:30") });
    await endBreak(db, { userId: bob, sessionId: s.id, now: T("06:45") });
    await endSession(db, { userId: bob, sessionId: s.id, now: T("07:00") });
    const [row] = await summarize(db, { organizationId: org, userIds: [bob], from: "2026-10-12", to: "2026-10-12" });
    expect(row.attendanceMinutes).toBe(60);
    expect(row.breakMinutes).toBe(15);
  });
});

describe("corrections", () => {
  it("need a reason, one pending per day, and someone else's decision", async () => {
    await expect(requestCorrection(db, { organizationId: org, userId: ann, day: "2026-10-12", requestedMinutes: 480, reason: "x", today: "2026-10-13" })).rejects.toThrow(/why/);
    await expect(requestCorrection(db, { organizationId: org, userId: ann, day: "2026-12-01", requestedMinutes: 480, reason: "Worked offline", today: "2026-10-13" })).rejects.toThrow(/not happened/);
    const c = await requestCorrection(db, { organizationId: org, userId: ann, day: "2026-10-12", requestedMinutes: 480, reason: "Worked offline at a client site", today: "2026-10-13" });
    await expect(requestCorrection(db, { organizationId: org, userId: ann, day: "2026-10-12", requestedMinutes: 400, reason: "Another try for the same day", today: "2026-10-13" })).rejects.toThrow(/pending/);
    await expect(decideCorrection(db, { organizationId: org, id: c.id, deciderId: ann, approve: true })).rejects.toThrow(/your own/);
    await decideCorrection(db, { organizationId: org, id: c.id, deciderId: hr, approve: true });
    await expect(decideCorrection(db, { organizationId: org, id: c.id, deciderId: hr, approve: false })).rejects.toThrow(/already/);
    const [row] = await summarize(db, { organizationId: org, userIds: [ann], from: "2026-10-12", to: "2026-10-12" });
    expect(row.correctedMinutes).toBe(480);
  });
});

describe("desktop agent", () => {
  let token = "", deviceId = "";
  it("enrols once with a short-lived code, and the token only works while not revoked", async () => {
    const code = await createEnrollmentCode(db, { organizationId: org, userId: ann, createdById: hr, now: WORK });
    await expect(enrollDevice(db, { code: "WRONG-CODE", name: "PC", now: WORK })).rejects.toThrow(/not valid/);
    await expect(enrollDevice(db, { code, name: "PC", now: new Date(WORK.getTime() + 2 * 3_600_000) })).rejects.toThrow(/not valid/); // expired
    const fresh = await createEnrollmentCode(db, { organizationId: org, userId: ann, createdById: hr, now: WORK });
    const e = await enrollDevice(db, { code: fresh, name: "Ann's laptop", os: "Windows", version: "1.0", now: WORK });
    token = e.token; deviceId = e.device.id;
    await expect(enrollDevice(db, { code: fresh, name: "Second", now: WORK })).rejects.toThrow(/not valid/);
    expect((await authenticateDevice(db, token))?.user.id).toBe(ann);
    expect(await authenticateDevice(db, "0".repeat(64))).toBeNull();
    expect(await authenticateDevice(db, "short")).toBeNull();
    expect(JSON.stringify(await db.monitorDevice.findUniqueOrThrow({ where: { id: deviceId } }))).not.toContain(token); // only a hash is stored
  });

  it("tells the agent what it may do, and refuses data outside the policy", async () => {
    const d = (await authenticateDevice(db, token))!;
    const pol = await agentPolicy(db, { organizationId: org, userId: ann }, WORK);
    expect(pol.active).toBe(true);
    expect(pol.screenshots).toBe(false);
    await expect(storeScreenshot(db, storage, { organizationId: org, userId: ann, deviceId: d.device.id }, { bytes: PNG, now: WORK })).rejects.toThrow(/not enabled/);
    const r = await ingestAgent(db, { organizationId: org, userId: ann }, { buckets: [{ start: "2026-10-12T05:00:00Z", active: 200, idle: 50, keys: 300, clicks: 120 }, { start: "2026-10-12T05:05:00Z", active: 900, idle: 0 }, { start: "2026-10-12T15:00:00Z", active: 10, idle: 0 }], apps: [{ name: "C:\\Windows\\chrome.exe", seconds: 120 }, { name: "", seconds: 5 }], now: new Date(WORK.getTime() + 600_000) });
    expect(r.accepted).toBe(2); // one bucket and one app; the 900-second bucket, the out-of-hours bucket and the nameless app are dropped
    expect(r.dropped).toBe(3);
    const app = await db.appUsage.findFirstOrThrow({ where: { userId: ann } });
    expect(app.name).toBe("C Windows chrome.exe"); // path characters are stripped: only a name is kept
  });

  it("accepts screenshots only when allowed, in hours, not too often, and only real images", async () => {
    await savePolicy(db, { organizationId: org, actorId: hr, patch: { screenshots: true } });
    await acknowledge(db, { userId: ann, version: (await getPolicy(db, org)).version });
    const d = (await authenticateDevice(db, token))!.device;
    const ctx = { organizationId: org, userId: ann, deviceId: d.id };
    await expect(storeScreenshot(db, storage, ctx, { bytes: Buffer.from("<html>not an image</html>".repeat(30)), now: WORK })).rejects.toThrow(/PNG or JPEG/);
    await expect(storeScreenshot(db, storage, ctx, { bytes: PNG, now: T("15:00") })).rejects.toThrow(/Outside working hours/);
    const shot = await storeScreenshot(db, storage, ctx, { bytes: PNG, now: WORK });
    expect(shot.contentType).toBe("image/png");
    await expect(storeScreenshot(db, storage, ctx, { bytes: PNG, now: new Date(WORK.getTime() + 60_000) })).rejects.toThrow(/Too soon/);
    const s = await startSession(db, { organizationId: org, userId: ann, now: new Date(WORK.getTime() + 20 * 60_000) });
    await startBreak(db, { userId: ann, sessionId: s.id, now: new Date(WORK.getTime() + 20 * 60_000) });
    await expect(storeScreenshot(db, storage, ctx, { bytes: PNG, now: new Date(WORK.getTime() + 21 * 60_000) })).rejects.toThrow(/break/);
    await endSession(db, { userId: ann, sessionId: s.id, now: new Date(WORK.getTime() + 22 * 60_000) });
  });

  it("screenshots are visible to their owner, and to others only with permission, and every other view is logged", async () => {
    const shot = await db.screenshot.findFirstOrThrow({ where: { userId: ann } });
    const viewer = (id: string, ...perms: string[]) => ({ id, organizationId: org, permissions: new Set(perms) });
    expect(await openScreenshot(db, storage, viewer(ann), shot.id)).not.toBeNull();
    expect(await db.monitoringAccess.count()).toBe(0); // looking at your own is not logged
    expect(await openScreenshot(db, storage, viewer(bob), shot.id)).toBeNull();
    expect(await openScreenshot(db, storage, viewer(hr, "monitoring.view_team"), shot.id)).toBeNull(); // team reports alone do not unlock screenshots
    expect(await openScreenshot(db, storage, { ...viewer(hr, "monitoring.screenshots"), organizationId: other }, shot.id)).toBeNull();
    const seen = await openScreenshot(db, storage, viewer(hr, "monitoring.screenshots"), shot.id);
    expect(seen?.bytes.equals(PNG)).toBe(true);
    const log = await db.monitoringAccess.findMany();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ viewerId: hr, subjectId: ann, what: "SCREENSHOT", targetId: shot.id });
  });

  it("employees can dispute their own screenshots; HR can delete them; retention removes old ones", async () => {
    const shot = await db.screenshot.findFirstOrThrow({ where: { userId: ann } });
    await expect(disputeScreenshot(db, { organizationId: org, userId: bob, id: shot.id, note: "Not mine at all" })).rejects.toThrow(/not found/);
    await disputeScreenshot(db, { organizationId: org, userId: ann, id: shot.id, note: "Shows a private banking page" });
    expect((await db.screenshot.findUniqueOrThrow({ where: { id: shot.id } })).disputed).toBe(true);
    await deleteScreenshot(db, storage, { organizationId: org, id: shot.id });
    expect(await openScreenshot(db, storage, { id: ann, organizationId: org, permissions: new Set() }, shot.id)).toBeNull();
    const old = await db.screenshot.create({ data: { organizationId: org, userId: ann, capturedAt: new Date(Date.now() - 90 * 86400000), storageKey: "2026/01/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", contentType: "image/png", size: 10, sha256: "x" } });
    await storage.put("2026/01/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", PNG);
    const r = await purgeMonitoring(db, storage);
    expect(r.screenshots).toBe(1);
    expect((await db.screenshot.findUniqueOrThrow({ where: { id: old.id } })).deletedAt).not.toBeNull();
  });

  it("a revoked device or a deactivated person stops working immediately", async () => {
    await revokeDevice(db, { organizationId: org, deviceId: deviceId });
    expect(await authenticateDevice(db, token)).toBeNull();
    const c = await createEnrollmentCode(db, { organizationId: org, userId: bob, createdById: hr });
    const e = await enrollDevice(db, { code: c, name: "Bob PC" });
    expect(await authenticateDevice(db, e.token)).not.toBeNull();
    await db.user.update({ where: { id: bob }, data: { active: false } });
    expect(await authenticateDevice(db, e.token)).toBeNull();
    await expect(createEnrollmentCode(db, { organizationId: org, userId: bob, createdById: hr })).rejects.toThrow(MonitorError);
  });
});
