// Transparent work-time and activity tracking. The rules are the product here:
//  - Nothing is recorded until an administrator enables the policy AND the employee has accepted the current version of it.
//  - Only counts and durations are stored: active and idle seconds, number of key presses and clicks, names of applications.
//    Never what was typed, window titles, page addresses, or pointer positions.
//  - Breaks and times outside the configured working hours are not recorded.
//  - Screenshots only come from an enrolled desktop agent, only when the policy allows them, only inside working hours, never during
//    a break, no faster than the policy interval; the employee can see and dispute their own, and every view by someone else is logged.
//  - A browser tab cannot see other applications, so the web tracker measures activity in the Hifi One tab only and says so.
import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { StorageProvider } from "./storage";
import { newStorageKey } from "./storage";

export class MonitorError extends Error {}
type Db = PrismaClient;

export const BUCKET_MS = 5 * 60_000;
export const STALE_MS = 10 * 60_000; // an open session with no signal for this long is treated as ended at its last signal
export const BUCKET_RETENTION_DAYS = 180;
export const MAX_SHOT_BYTES = 1_500_000;
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const floorBucket = (d: Date) => new Date(Math.floor(d.getTime() / BUCKET_MS) * BUCKET_MS);

// ---------- policy ----------
export type PolicyPatch = Partial<{
  enabled: boolean; policyText: string; trackActivity: boolean; trackApps: boolean; screenshots: boolean; screenshotIntervalMin: number; idleThresholdMin: number;
  timezone: string; workStart: string; workEnd: string; workDays: string; retentionDays: number;
}>;
const COLLECTION_FIELDS = ["enabled", "policyText", "trackActivity", "trackApps", "screenshots", "screenshotIntervalMin", "idleThresholdMin", "timezone", "workStart", "workEnd", "workDays", "retentionDays"] as const;

export async function getPolicy(db: Db, organizationId: string) {
  return (await db.monitoringPolicy.findUnique({ where: { organizationId } })) ?? db.monitoringPolicy.create({ data: { organizationId } });
}

export async function savePolicy(db: Db, p: { organizationId: string; patch: PolicyPatch; actorId: string }) {
  const cur = await getPolicy(db, p.organizationId);
  const x = { ...cur, ...p.patch };
  if (x.policyText.length > 8000) throw new MonitorError("The policy text is too long.");
  if (!Number.isInteger(x.screenshotIntervalMin) || x.screenshotIntervalMin < 5 || x.screenshotIntervalMin > 120) throw new MonitorError("The screenshot interval must be between 5 and 120 minutes.");
  if (!Number.isInteger(x.idleThresholdMin) || x.idleThresholdMin < 1 || x.idleThresholdMin > 30) throw new MonitorError("The idle threshold must be between 1 and 30 minutes.");
  if (!Number.isInteger(x.retentionDays) || x.retentionDays < 1 || x.retentionDays > 365) throw new MonitorError("Retention must be between 1 and 365 days.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(x.workStart) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(x.workEnd) || x.workEnd <= x.workStart) throw new MonitorError("Working hours need a start before the end, like 09:00 to 18:00.");
  if (!/^[0-6](,[0-6])*$/.test(x.workDays)) throw new MonitorError("Choose working days.");
  try { new Intl.DateTimeFormat("en", { timeZone: x.timezone }); } catch { throw new MonitorError("That time zone is not recognised (for example Asia/Karachi)."); }
  if (x.enabled && x.policyText.trim().length < 50) throw new MonitorError("Write the policy people will read (at least a short paragraph) before turning monitoring on. They must be told what is collected, when, who can see it and how long it is kept.");
  if (x.screenshots && !x.enabled) throw new MonitorError("Screenshots only work while monitoring is on.");
  const changed = COLLECTION_FIELDS.some((f) => f in p.patch && p.patch[f] !== cur[f]);
  const { organizationId, version, updatedAt, updatedById, ...fields } = x; void organizationId; void version; void updatedAt; void updatedById;
  return db.monitoringPolicy.update({ where: { organizationId: p.organizationId }, data: { ...fields, ...(changed ? { version: { increment: 1 } } : {}), updatedById: p.actorId } });
}

export async function acknowledge(db: Db, p: { userId: string; version: number }) {
  await db.policyAck.upsert({ where: { userId_version: { userId: p.userId, version: p.version } }, update: {}, create: { userId: p.userId, version: p.version } });
}
export async function hasAccepted(db: Db, userId: string, version: number) {
  return (await db.policyAck.count({ where: { userId, version } })) > 0;
}

export function localParts(date: Date, timeZone: string) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  const get = (t: string) => f.find((x) => x.type === t)?.value ?? "";
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const hh = get("hour") === "24" ? "00" : get("hour");
  return { dow, hm: `${hh}:${get("minute")}` };
}
export function withinSchedule(policy: { timezone: string; workStart: string; workEnd: string; workDays: string }, date: Date) {
  const { dow, hm } = localParts(date, policy.timezone);
  return policy.workDays.split(",").map(Number).includes(dow) && hm >= policy.workStart && hm < policy.workEnd;
}

// Everything that records data goes through this gate.
async function gate(db: Db, organizationId: string, userId: string) {
  const policy = await getPolicy(db, organizationId);
  if (!policy.enabled) throw new MonitorError("Time tracking is not switched on for your organization.");
  if (!(await hasAccepted(db, userId, policy.version))) throw new MonitorError("Please read and accept the monitoring policy first.");
  return policy;
}

// ---------- sessions ----------
async function closeStale(db: Db, userId: string, now: Date) {
  const stale = await db.workSession.findMany({ where: { userId, endedAt: null, lastBeatAt: { lt: new Date(now.getTime() - STALE_MS) } } });
  for (const s of stale) {
    await db.workSession.update({ where: { id: s.id }, data: { endedAt: s.lastBeatAt } });
    await db.workBreak.updateMany({ where: { sessionId: s.id, endedAt: null }, data: { endedAt: s.lastBeatAt } });
  }
}

export async function startSession(db: Db, p: { organizationId: string; userId: string; source?: "WEB" | "AGENT"; projectId?: string | null; taskId?: string | null; note?: string; now?: Date }) {
  const now = p.now ?? new Date();
  await gate(db, p.organizationId, p.userId);
  await closeStale(db, p.userId, now);
  const open = await db.workSession.findFirst({ where: { userId: p.userId, endedAt: null } });
  if (open) return open; // clocking in twice (or two tabs) never creates a second session
  if (p.projectId && !(await db.project.findFirst({ where: { id: p.projectId, organizationId: p.organizationId } }))) throw new MonitorError("Unknown project.");
  if (p.taskId && !(await db.task.findFirst({ where: { id: p.taskId, project: { organizationId: p.organizationId } } }))) throw new MonitorError("Unknown task.");
  return db.workSession.create({ data: { organizationId: p.organizationId, userId: p.userId, source: p.source ?? "WEB", projectId: p.projectId || null, taskId: p.taskId || null, note: p.note?.slice(0, 300) || null, startedAt: now, lastBeatAt: now } });
}

async function mine(db: Db, userId: string, sessionId: string) {
  const s = await db.workSession.findFirst({ where: { id: sessionId, userId } });
  if (!s) throw new MonitorError("Session not found.");
  return s;
}

export async function endSession(db: Db, p: { userId: string; sessionId: string; now?: Date }) {
  const now = p.now ?? new Date();
  const s = await mine(db, p.userId, p.sessionId);
  if (s.endedAt) return s;
  await db.workBreak.updateMany({ where: { sessionId: s.id, endedAt: null }, data: { endedAt: now } });
  return db.workSession.update({ where: { id: s.id }, data: { endedAt: now } });
}

export async function startBreak(db: Db, p: { userId: string; sessionId: string; now?: Date }) {
  const s = await mine(db, p.userId, p.sessionId);
  if (s.endedAt) throw new MonitorError("This session has ended.");
  const open = await db.workBreak.findFirst({ where: { sessionId: s.id, endedAt: null } });
  return open ?? db.workBreak.create({ data: { sessionId: s.id, startedAt: p.now ?? new Date() } });
}
export async function endBreak(db: Db, p: { userId: string; sessionId: string; now?: Date }) {
  const s = await mine(db, p.userId, p.sessionId);
  await db.workBreak.updateMany({ where: { sessionId: s.id, endedAt: null }, data: { endedAt: p.now ?? new Date() } });
  await db.workSession.update({ where: { id: s.id }, data: { lastBeatAt: p.now ?? new Date() } });
}

// One signal from the browser tracker (about every 30 seconds): seconds actually active and idle since the last one, plus counts.
export async function heartbeat(db: Db, p: { organizationId: string; userId: string; sessionId: string; activeSeconds: number; idleSeconds: number; keys: number; clicks: number; now?: Date }) {
  const now = p.now ?? new Date();
  const policy = await gate(db, p.organizationId, p.userId);
  const s = await mine(db, p.userId, p.sessionId);
  if (s.endedAt) throw new MonitorError("This session has ended.");
  const nums = [p.activeSeconds, p.idleSeconds, p.keys, p.clicks];
  if (nums.some((n) => !Number.isFinite(n) || n < 0 || !Number.isInteger(n))) throw new MonitorError("Invalid activity figures.");
  const elapsed = Math.max(0, Math.round((now.getTime() - s.lastBeatAt.getTime()) / 1000));
  // A browser cannot honestly report more seconds than have passed. Anything beyond that is cut, not trusted.
  const room = Math.min(elapsed + 5, 300);
  const active = Math.min(p.activeSeconds, room);
  const idle = Math.min(p.idleSeconds, Math.max(0, room - active));
  const onBreak = (await db.workBreak.count({ where: { sessionId: s.id, endedAt: null } })) > 0;
  const record = policy.trackActivity && !onBreak && withinSchedule(policy, now) && active + idle > 0;
  if (record) {
    const start = floorBucket(new Date(now.getTime() - 1000));
    const keys = Math.min(p.keys, active * 20), clicks = Math.min(p.clicks, active * 20);
    await db.activityBucket.upsert({
      where: { userId_bucketStart_source: { userId: p.userId, bucketStart: start, source: "WEB" } },
      update: { activeSeconds: { increment: active }, idleSeconds: { increment: idle }, keyCount: { increment: keys }, clickCount: { increment: clicks } },
      create: { organizationId: p.organizationId, userId: p.userId, bucketStart: start, activeSeconds: active, idleSeconds: idle, keyCount: keys, clickCount: clicks, source: "WEB" },
    });
  }
  await db.workSession.update({ where: { id: s.id }, data: { lastBeatAt: now } });
  return { recorded: record, onBreak, outsideHours: !withinSchedule(policy, now) };
}

// ---------- summaries ----------
const dayRange = (day: string) => ({ from: new Date(`${day}T00:00:00.000Z`), to: new Date(`${day}T23:59:59.999Z`) });
const minutes = (ms: number) => Math.max(0, Math.round(ms / 60000));

export async function summarize(db: Db, p: { organizationId: string; userIds?: string[]; from: string; to: string; now?: Date }) {
  const now = p.now ?? new Date();
  const from = dayRange(p.from).from, to = dayRange(p.to).to;
  const uf = p.userIds ? { userId: { in: p.userIds } } : {};
  const [sessions, buckets, apps, shots, cats, fixes] = await Promise.all([
    db.workSession.findMany({ where: { organizationId: p.organizationId, ...uf, startedAt: { lte: to }, OR: [{ endedAt: null }, { endedAt: { gte: from } }] }, include: { breaks: true } }),
    db.activityBucket.findMany({ where: { organizationId: p.organizationId, ...uf, bucketStart: { gte: from, lte: to } } }),
    db.appUsage.findMany({ where: { organizationId: p.organizationId, ...uf, day: { gte: p.from, lte: p.to } } }),
    db.screenshot.groupBy({ by: ["userId"], where: { organizationId: p.organizationId, ...uf, capturedAt: { gte: from, lte: to }, deletedAt: null }, _count: true, _sum: { size: true } }),
    db.appCategory.findMany({ where: { organizationId: p.organizationId } }),
    db.timesheetCorrection.findMany({ where: { organizationId: p.organizationId, ...uf, day: { gte: p.from, lte: p.to }, status: "APPROVED" } }),
  ]);
  const cat = (name: string) => cats.find((c) => name.toLowerCase().includes(c.pattern.toLowerCase()))?.category ?? "UNCATEGORIZED";
  const ids = new Set<string>([...sessions.map((s) => s.userId), ...buckets.map((b) => b.userId), ...apps.map((a) => a.userId), ...(p.userIds ?? [])]);
  return [...ids].map((userId) => {
    let attendanceMs = 0, breakMs = 0;
    for (const s of sessions.filter((x) => x.userId === userId)) {
      const end = s.endedAt ?? (now.getTime() - s.lastBeatAt.getTime() > STALE_MS ? s.lastBeatAt : now);
      const a = Math.max(s.startedAt.getTime(), from.getTime()), b = Math.min(end.getTime(), to.getTime());
      if (b > a) attendanceMs += b - a;
      for (const br of s.breaks) {
        const bs = Math.max(br.startedAt.getTime(), a), be = Math.min((br.endedAt ?? end).getTime(), b);
        if (be > bs) breakMs += be - bs;
      }
    }
    const bs = buckets.filter((b) => b.userId === userId);
    const active = bs.reduce((x, b) => x + b.activeSeconds, 0), idle = bs.reduce((x, b) => x + b.idleSeconds, 0);
    const byApp = new Map<string, number>();
    for (const a of apps.filter((x) => x.userId === userId)) byApp.set(a.name, (byApp.get(a.name) ?? 0) + a.seconds);
    const topApps = [...byApp].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, seconds]) => ({ name, seconds, category: cat(name) }));
    const shot = shots.find((x) => x.userId === userId);
    return {
      userId, attendanceMinutes: minutes(attendanceMs), breakMinutes: minutes(breakMs), activeMinutes: Math.round(active / 60), idleMinutes: Math.round(idle / 60),
      trackedMinutes: Math.round((active + idle) / 60), keys: bs.reduce((x, b) => x + b.keyCount, 0), clicks: bs.reduce((x, b) => x + b.clickCount, 0), topApps,
      screenshots: shot?._count ?? 0, screenshotBytes: shot?._sum.size ?? 0, correctedMinutes: fixes.filter((f) => f.userId === userId).reduce((x, f) => x + f.requestedMinutes, 0),
    };
  });
}

// ---------- corrections ----------
export async function requestCorrection(db: Db, p: { organizationId: string; userId: string; day: string; requestedMinutes: number; reason: string; today: string }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.day) || Number.isNaN(Date.parse(p.day))) throw new MonitorError("Enter a valid date.");
  if (p.day > p.today) throw new MonitorError("You cannot correct a day that has not happened.");
  if (!Number.isInteger(p.requestedMinutes) || p.requestedMinutes < 0 || p.requestedMinutes > 1440) throw new MonitorError("Enter minutes between 0 and 1440.");
  if (p.reason.trim().length < 5) throw new MonitorError("Say why the day needs correcting.");
  if (await db.timesheetCorrection.findFirst({ where: { userId: p.userId, day: p.day, status: "PENDING" } })) throw new MonitorError("You already have a pending request for that day.");
  return db.timesheetCorrection.create({ data: { organizationId: p.organizationId, userId: p.userId, day: p.day, requestedMinutes: p.requestedMinutes, reason: p.reason.trim().slice(0, 500) } });
}
export async function decideCorrection(db: Db, p: { organizationId: string; id: string; deciderId: string; approve: boolean; note?: string }) {
  const c = await db.timesheetCorrection.findFirst({ where: { id: p.id, organizationId: p.organizationId } });
  if (!c) throw new MonitorError("Request not found.");
  if (c.userId === p.deciderId) throw new MonitorError("You cannot decide your own correction request.");
  const r = await db.timesheetCorrection.updateMany({ where: { id: c.id, status: "PENDING" }, data: { status: p.approve ? "APPROVED" : "REJECTED", decidedById: p.deciderId, decidedAt: new Date(), decisionNote: p.note?.slice(0, 300) || null } });
  if (r.count === 0) throw new MonitorError("This request has already been decided.");
}

// ---------- devices (desktop agent) ----------
export async function createEnrollmentCode(db: Db, p: { organizationId: string; userId: string; createdById: string; now?: Date }) {
  const user = await db.user.findFirst({ where: { id: p.userId, organizationId: p.organizationId, userType: "EMPLOYEE", active: true } });
  if (!user) throw new MonitorError("Choose an active staff member.");
  const raw = crypto.randomBytes(5).toString("hex").toUpperCase();
  const code = `${raw.slice(0, 5)}-${raw.slice(5)}`;
  await db.enrollmentCode.create({ data: { userId: user.id, codeHash: sha(code), expiresAt: new Date((p.now ?? new Date()).getTime() + 3_600_000), createdById: p.createdById } });
  return code;
}

export async function enrollDevice(db: Db, p: { code: string; name: string; os?: string; version?: string; now?: Date }) {
  const now = p.now ?? new Date();
  const c = await db.enrollmentCode.findUnique({ where: { codeHash: sha(p.code.trim().toUpperCase()) } });
  if (!c || c.usedAt || c.expiresAt < now) throw new MonitorError("That enrolment code is not valid. Ask for a new one.");
  const user = await db.user.findFirst({ where: { id: c.userId, active: true, userType: "EMPLOYEE" } });
  if (!user) throw new MonitorError("That enrolment code is not valid. Ask for a new one.");
  const used = await db.enrollmentCode.updateMany({ where: { id: c.id, usedAt: null }, data: { usedAt: now } });
  if (used.count === 0) throw new MonitorError("That enrolment code is not valid. Ask for a new one.");
  const token = crypto.randomBytes(32).toString("hex");
  const device = await db.monitorDevice.create({ data: { organizationId: user.organizationId, userId: user.id, name: p.name.trim().slice(0, 80) || "Computer", os: p.os?.slice(0, 40) ?? null, agentVersion: p.version?.slice(0, 20) ?? null, tokenHash: sha(token), lastSeenAt: now } });
  return { token, device };
}

export async function authenticateDevice(db: Db, token: string | null | undefined, now = new Date()) {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const device = await db.monitorDevice.findUnique({ where: { tokenHash: sha(token) } });
  if (!device || device.revokedAt) return null;
  const user = await db.user.findFirst({ where: { id: device.userId, active: true, userType: "EMPLOYEE" } });
  if (!user) return null;
  await db.monitorDevice.update({ where: { id: device.id }, data: { lastSeenAt: now } });
  return { device, user };
}

export async function revokeDevice(db: Db, p: { organizationId: string; deviceId: string }) {
  const r = await db.monitorDevice.updateMany({ where: { id: p.deviceId, organizationId: p.organizationId, revokedAt: null }, data: { revokedAt: new Date() } });
  if (r.count === 0) throw new MonitorError("Device not found.");
}

// What the agent is allowed to do right now. The agent obeys this; the server enforces it again on every upload.
export async function agentPolicy(db: Db, d: { organizationId: string; userId: string }, now = new Date()) {
  const policy = await getPolicy(db, d.organizationId);
  const accepted = policy.enabled && (await hasAccepted(db, d.userId, policy.version));
  const open = accepted ? await db.workSession.findFirst({ where: { userId: d.userId, endedAt: null }, include: { breaks: { where: { endedAt: null } } } }) : null;
  return {
    active: accepted, reason: !policy.enabled ? "Monitoring is switched off." : !accepted ? "Waiting for you to accept the policy in Hifi One (My Time)." : null,
    version: policy.version, trackActivity: accepted && policy.trackActivity, trackApps: accepted && policy.trackApps, screenshots: accepted && policy.screenshots,
    screenshotIntervalMin: policy.screenshotIntervalMin, idleThresholdMin: policy.idleThresholdMin, inWorkingHours: withinSchedule(policy, now), onBreak: Boolean(open?.breaks.length),
    schedule: { timezone: policy.timezone, start: policy.workStart, end: policy.workEnd, days: policy.workDays },
  };
}

const safeAppName = (s: string) => s.replace(/[\\/:*?"<>|\r\n\0]+/g, " ").trim().slice(0, 80);

export async function ingestAgent(db: Db, d: { organizationId: string; userId: string }, p: { buckets?: { start: string; active: number; idle: number; keys?: number; clicks?: number }[]; apps?: { name: string; seconds: number }[]; now?: Date }) {
  const now = p.now ?? new Date();
  const policy = await gate(db, d.organizationId, d.userId);
  await closeStale(db, d.userId, now);
  let session = await db.workSession.findFirst({ where: { userId: d.userId, endedAt: null } });
  session = session
    ? await db.workSession.update({ where: { id: session.id }, data: { lastBeatAt: now } })
    : await db.workSession.create({ data: { organizationId: d.organizationId, userId: d.userId, source: "AGENT", startedAt: now, lastBeatAt: now } });
  const onBreak = (await db.workBreak.count({ where: { sessionId: session.id, endedAt: null } })) > 0;
  let accepted = 0, dropped = 0;
  if (policy.trackActivity && !onBreak) {
    for (const b of (p.buckets ?? []).slice(0, 300)) {
      const t = new Date(b.start);
      const ok = !Number.isNaN(t.getTime()) && t <= now && now.getTime() - t.getTime() < 48 * 3_600_000 && [b.active, b.idle].every((n) => Number.isInteger(n) && n >= 0 && n <= 300) && b.active + b.idle <= 300 && withinSchedule(policy, t);
      if (!ok) { dropped++; continue; }
      const keys = Math.min(Math.max(0, Math.floor(b.keys ?? 0)), b.active * 20), clicks = Math.min(Math.max(0, Math.floor(b.clicks ?? 0)), b.active * 20);
      await db.activityBucket.upsert({
        where: { userId_bucketStart_source: { userId: d.userId, bucketStart: floorBucket(t), source: "AGENT" } },
        update: { activeSeconds: { increment: b.active }, idleSeconds: { increment: b.idle }, keyCount: { increment: keys }, clickCount: { increment: clicks } },
        create: { organizationId: d.organizationId, userId: d.userId, bucketStart: floorBucket(t), activeSeconds: b.active, idleSeconds: b.idle, keyCount: keys, clickCount: clicks, source: "AGENT" },
      });
      accepted++;
    }
  }
  if (policy.trackApps && !onBreak && withinSchedule(policy, now)) {
    const day = now.toISOString().slice(0, 10);
    for (const a of (p.apps ?? []).slice(0, 100)) {
      const name = safeAppName(a.name);
      if (!name || !Number.isInteger(a.seconds) || a.seconds <= 0 || a.seconds > 300) { dropped++; continue; }
      await db.appUsage.upsert({ where: { userId_day_name: { userId: d.userId, day, name } }, update: { seconds: { increment: a.seconds } }, create: { organizationId: d.organizationId, userId: d.userId, day, name, seconds: a.seconds } });
      accepted++;
    }
  }
  return { accepted, dropped, onBreak };
}

// ---------- screenshots ----------
const isPng = (b: Buffer) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const isJpeg = (b: Buffer) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

export async function storeScreenshot(db: Db, storage: StorageProvider, d: { organizationId: string; userId: string; deviceId: string }, p: { bytes: Buffer; capturedAt?: Date; now?: Date }) {
  const now = p.now ?? new Date();
  const policy = await gate(db, d.organizationId, d.userId);
  if (!policy.screenshots) throw new MonitorError("Screenshots are not enabled in the policy.");
  if (!withinSchedule(policy, now)) throw new MonitorError("Outside working hours: screenshots are not accepted.");
  const open = await db.workSession.findFirst({ where: { userId: d.userId, endedAt: null }, include: { breaks: { where: { endedAt: null } } } });
  if (open?.breaks.length) throw new MonitorError("You are on a break: screenshots are not accepted.");
  if (p.bytes.length > MAX_SHOT_BYTES || p.bytes.length < 200) throw new MonitorError("That image is the wrong size.");
  const type = isPng(p.bytes) ? "image/png" : isJpeg(p.bytes) ? "image/jpeg" : null;
  if (!type) throw new MonitorError("Only PNG or JPEG images are accepted.");
  const last = await db.screenshot.findFirst({ where: { userId: d.userId, deletedAt: null }, orderBy: { capturedAt: "desc" } });
  if (last && now.getTime() - last.capturedAt.getTime() < policy.screenshotIntervalMin * 60_000 - 30_000) throw new MonitorError("Too soon after the previous screenshot.");
  const key = newStorageKey(now);
  await storage.put(key, p.bytes);
  return db.screenshot.create({ data: { organizationId: d.organizationId, userId: d.userId, deviceId: d.deviceId, capturedAt: p.capturedAt && p.capturedAt <= now ? p.capturedAt : now, storageKey: key, contentType: type, size: p.bytes.length, sha256: crypto.createHash("sha256").update(p.bytes).digest("hex") } });
}

export async function openScreenshot(db: Db, storage: StorageProvider, viewer: { id: string; organizationId: string; permissions: ReadonlySet<string> }, id: string) {
  const s = await db.screenshot.findFirst({ where: { id, organizationId: viewer.organizationId, deletedAt: null } });
  if (!s) return null;
  const own = s.userId === viewer.id;
  if (!own && !viewer.permissions.has("monitoring.screenshots")) return null; // looks exactly like a screenshot that does not exist
  const bytes = await storage.get(s.storageKey);
  if (!own) await db.monitoringAccess.create({ data: { organizationId: viewer.organizationId, viewerId: viewer.id, subjectId: s.userId, what: "SCREENSHOT", targetId: s.id } });
  return { bytes, contentType: s.contentType };
}

export async function disputeScreenshot(db: Db, p: { organizationId: string; userId: string; id: string; note: string }) {
  if (p.note.trim().length < 5) throw new MonitorError("Say what is wrong with this screenshot.");
  const r = await db.screenshot.updateMany({ where: { id: p.id, organizationId: p.organizationId, userId: p.userId, deletedAt: null }, data: { disputed: true, disputeNote: p.note.trim().slice(0, 500) } });
  if (r.count === 0) throw new MonitorError("Screenshot not found.");
}

export async function deleteScreenshot(db: Db, storage: StorageProvider, p: { organizationId: string; id: string }) {
  const s = await db.screenshot.findFirst({ where: { id: p.id, organizationId: p.organizationId, deletedAt: null } });
  if (!s) throw new MonitorError("Screenshot not found.");
  await storage.delete(s.storageKey);
  await db.screenshot.update({ where: { id: s.id }, data: { deletedAt: new Date() } });
}

// Removes what the policy says should no longer be kept. Run it daily (npm run monitoring:purge).
export async function purgeMonitoring(db: Db, storage: StorageProvider, now = new Date()) {
  let shots = 0;
  const policies = await db.monitoringPolicy.findMany();
  for (const pol of policies) {
    const old = await db.screenshot.findMany({ where: { organizationId: pol.organizationId, deletedAt: null, capturedAt: { lt: new Date(now.getTime() - pol.retentionDays * 86400000) } } });
    for (const s of old) { await storage.delete(s.storageKey); await db.screenshot.update({ where: { id: s.id }, data: { deletedAt: now } }); shots++; }
  }
  const cut = new Date(now.getTime() - BUCKET_RETENTION_DAYS * 86400000);
  const b = await db.activityBucket.deleteMany({ where: { bucketStart: { lt: cut } } });
  const a = await db.appUsage.deleteMany({ where: { day: { lt: cut.toISOString().slice(0, 10) } } });
  return { screenshots: shots, buckets: b.count, appUsage: a.count };
}

export async function logReportAccess(db: Db, p: { organizationId: string; viewerId: string; subjectIds: string[] }) {
  const others = p.subjectIds.filter((id) => id !== p.viewerId);
  if (others.length) await db.monitoringAccess.createMany({ data: others.map((subjectId) => ({ organizationId: p.organizationId, viewerId: p.viewerId, subjectId, what: "REPORT" })) });
}
