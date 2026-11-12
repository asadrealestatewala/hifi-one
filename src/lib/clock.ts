// One clock for attendance and activity tracking. Attendance (AttendanceRecord) is the record payroll and HR use;
// the work session (WorkSession) carries the activity tracker. Every clock action on any screen or on mobile goes through here,
// so the two can never disagree. A work session is only ever opened when monitoring is switched on AND the person
// has accepted the current policy; otherwise only attendance is recorded.
import type { PrismaClient } from "@prisma/client";
import { clockIn, clockOut, endBreak, startBreak } from "./hr";
import * as mon from "./monitoring";

export type MonitoringState = "ON" | "OFF" | "NEEDS_CONSENT";

export async function monitoringState(db: PrismaClient, organizationId: string, userId: string): Promise<MonitoringState> {
  const policy = await mon.getPolicy(db, organizationId);
  if (!policy.enabled) return "OFF";
  return (await mon.hasAccepted(db, userId, policy.version)) ? "ON" : "NEEDS_CONSENT";
}

export async function clockInAll(db: PrismaClient, p: { organizationId: string; userId: string; timeZone: string; workMode: "OFFICE" | "REMOTE"; projectId?: string | null; note?: string; now?: Date }) {
  const open = await db.attendanceRecord.findFirst({ where: { userId: p.userId, clockOut: null } });
  // Throws HrError when an old session is unclosed; attendance is never started twice.
  const attendance = open && open.workDate === (await todayOf(p)) ? open : await clockIn(db, { userId: p.userId, timeZone: p.timeZone, workMode: p.workMode, now: p.now });
  const state = await monitoringState(db, p.organizationId, p.userId);
  const session = state === "ON" ? await mon.startSession(db, { organizationId: p.organizationId, userId: p.userId, projectId: p.projectId, note: p.note, now: p.now }) : null;
  return { attendance, session, monitoring: state };
}
async function todayOf(p: { timeZone: string; now?: Date }) {
  const { dateInZone } = await import("./hr-rules");
  return dateInZone(p.now ?? new Date(), p.timeZone);
}

async function openSession(db: PrismaClient, userId: string) {
  return db.workSession.findFirst({ where: { userId, endedAt: null } });
}

export async function clockOutAll(db: PrismaClient, p: { userId: string; now?: Date }) {
  const s = await openSession(db, p.userId);
  if (s) await mon.endSession(db, { userId: p.userId, sessionId: s.id, now: p.now });
  const hasAttendance = await db.attendanceRecord.findFirst({ where: { userId: p.userId, clockOut: null } });
  if (hasAttendance) await clockOut(db, { userId: p.userId, now: p.now });
  else if (!s) await clockOut(db, { userId: p.userId, now: p.now }); // raises the usual "not clocked in"
}

export async function breakStartAll(db: PrismaClient, p: { userId: string; now?: Date }) {
  await startBreak(db, { userId: p.userId, now: p.now });
  const s = await openSession(db, p.userId);
  if (s) await mon.startBreak(db, { userId: p.userId, sessionId: s.id, now: p.now });
}

export async function breakEndAll(db: PrismaClient, p: { userId: string; now?: Date }) {
  await endBreak(db, { userId: p.userId, now: p.now });
  const s = await openSession(db, p.userId);
  if (s) await mon.endBreak(db, { userId: p.userId, sessionId: s.id, now: p.now });
}
