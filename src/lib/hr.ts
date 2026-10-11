// HR service: attendance, leave and employee creation. Free of Next.js imports so it can be
// tested directly against the database. Each rule is enforced here, not in the UI.
import { Prisma, type PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { dateInZone, isDateString, leaveRemaining, rangesOverlap, workingDays } from "./hr-rules";

export class HrError extends Error {}

// ----- Attendance -----

export async function clockIn(db: PrismaClient, p: { userId: string; timeZone: string; workMode: "OFFICE" | "REMOTE"; now?: Date }) {
  const now = p.now ?? new Date();
  // Never assume someone is still working: an unclosed session must be corrected by HR first.
  const open = await db.attendanceRecord.findFirst({ where: { userId: p.userId, clockOut: null } });
  if (open) throw new HrError(`You still have an open session from ${open.workDate}. Ask HR to correct it before clocking in again.`);
  const workDate = dateInZone(now, p.timeZone);
  try {
    return await db.attendanceRecord.create({ data: { userId: p.userId, workDate, clockIn: now, workMode: p.workMode } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new HrError("You have already clocked in today.");
    throw e;
  }
}

export async function clockOut(db: PrismaClient, p: { userId: string; now?: Date }) {
  const now = p.now ?? new Date();
  return db.$transaction(async (tx) => {
    const rec = await tx.attendanceRecord.findFirst({ where: { userId: p.userId, clockOut: null } });
    if (!rec) throw new HrError("You are not clocked in.");
    await tx.breakRecord.updateMany({ where: { attendanceId: rec.id, endAt: null }, data: { endAt: now } });
    return tx.attendanceRecord.update({ where: { id: rec.id }, data: { clockOut: now } });
  });
}

export async function startBreak(db: PrismaClient, p: { userId: string; now?: Date }) {
  const rec = await db.attendanceRecord.findFirst({ where: { userId: p.userId, clockOut: null }, include: { breaks: true } });
  if (!rec) throw new HrError("Clock in before starting a break.");
  if (rec.breaks.some((b) => !b.endAt)) throw new HrError("A break is already running.");
  return db.breakRecord.create({ data: { attendanceId: rec.id, startAt: p.now ?? new Date() } });
}

export async function endBreak(db: PrismaClient, p: { userId: string; now?: Date }) {
  const rec = await db.attendanceRecord.findFirst({ where: { userId: p.userId, clockOut: null }, include: { breaks: true } });
  const open = rec?.breaks.find((b) => !b.endAt);
  if (!rec || !open) throw new HrError("No break is running.");
  return db.breakRecord.update({ where: { id: open.id }, data: { endAt: p.now ?? new Date() } });
}

// HR correction of a forgotten clock-out. Always records who corrected it.
export async function correctClockOut(db: PrismaClient, p: { recordId: string; clockOut: Date; correctedById: string; note: string }) {
  const rec = await db.attendanceRecord.findUnique({ where: { id: p.recordId } });
  if (!rec) throw new HrError("Attendance record not found.");
  if (p.clockOut <= rec.clockIn) throw new HrError("Clock-out must be after clock-in.");
  if (!p.note.trim()) throw new HrError("A reason is required for a correction.");
  await db.breakRecord.updateMany({ where: { attendanceId: rec.id, endAt: null }, data: { endAt: p.clockOut } });
  return db.attendanceRecord.update({
    where: { id: rec.id }, data: { clockOut: p.clockOut, correctedById: p.correctedById, note: p.note.trim() },
  });
}

// ----- Leave -----

async function usedDays(tx: Pick<PrismaClient, "leaveRequest">, userId: string, typeId: string, year: string, excludeId?: string) {
  const rows = await tx.leaveRequest.findMany({
    where: { userId, leaveTypeId: typeId, startDate: { startsWith: year }, status: { in: ["APPROVED", "PENDING"] }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { days: true, status: true },
  });
  const sum = (s: string) => rows.filter((r) => r.status === s).reduce((a, r) => a + Number(r.days), 0);
  return { approved: sum("APPROVED"), pending: sum("PENDING") };
}

export async function leaveBalances(db: PrismaClient, organizationId: string, userId: string, year: string) {
  const types = await db.leaveType.findMany({ where: { organizationId, active: true }, orderBy: { name: "asc" } });
  return Promise.all(
    types.map(async (t) => {
      const u = await usedDays(db, userId, t.id, year);
      return { type: t, allowance: Number(t.daysPerYear), ...u, ...leaveRemaining(Number(t.daysPerYear), u.approved, u.pending) };
    }),
  );
}

export async function requestLeave(
  db: PrismaClient,
  p: { organizationId: string; userId: string; leaveTypeId: string; startDate: string; endDate: string; reason?: string; holidays?: string[] },
) {
  if (!isDateString(p.startDate) || !isDateString(p.endDate)) throw new HrError("Enter valid dates.");
  if (p.endDate < p.startDate) throw new HrError("The end date cannot be before the start date.");
  if (p.startDate.slice(0, 4) !== p.endDate.slice(0, 4)) throw new HrError("Split requests that cross into a new year.");
  const days = workingDays(p.startDate, p.endDate, p.holidays);
  if (days === 0) throw new HrError("That range has no working days.");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${p.userId} FOR UPDATE`; // serialise this person's requests
    const type = await tx.leaveType.findFirst({ where: { id: p.leaveTypeId, organizationId: p.organizationId, active: true } });
    if (!type) throw new HrError("Unknown leave type.");
    const existing = await tx.leaveRequest.findMany({ where: { userId: p.userId, status: { in: ["PENDING", "APPROVED"] } } });
    if (existing.some((r) => rangesOverlap({ start: r.startDate, end: r.endDate }, { start: p.startDate, end: p.endDate }))) {
      throw new HrError("This overlaps with another leave request.");
    }
    if (type.paid) {
      const u = await usedDays(tx, p.userId, type.id, p.startDate.slice(0, 4));
      if (days > Number(type.daysPerYear) - u.approved - u.pending) throw new HrError(`Not enough ${type.name} balance for ${days} day(s).`);
    }
    return tx.leaveRequest.create({
      data: { userId: p.userId, leaveTypeId: type.id, startDate: p.startDate, endDate: p.endDate, days, reason: p.reason?.trim() || null },
    });
  });
}

export async function decideLeave(
  db: PrismaClient,
  p: { requestId: string; approverId: string; approve: boolean; note?: string; canApproveAll: boolean },
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "LeaveRequest" WHERE id = ${p.requestId} FOR UPDATE`;
    const req = await tx.leaveRequest.findUnique({ where: { id: p.requestId }, include: { leaveType: true } });
    if (!req) throw new HrError("Request not found.");
    if (req.status !== "PENDING") throw new HrError("This request has already been decided.");
    if (req.userId === p.approverId) throw new HrError("You cannot approve your own leave.");
    const requester = await tx.user.findUniqueOrThrow({ where: { id: req.userId }, select: { managerId: true } });
    if (!p.canApproveAll && requester.managerId !== p.approverId) throw new HrError("Only the employee's manager or HR can decide this request.");
    if (p.approve && req.leaveType.paid) {
      const u = await usedDays(tx, req.userId, req.leaveTypeId, req.startDate.slice(0, 4), req.id);
      if (Number(req.days) > Number(req.leaveType.daysPerYear) - u.approved - u.pending) throw new HrError("The balance is no longer sufficient.");
    }
    return tx.leaveRequest.update({
      where: { id: req.id },
      data: { status: p.approve ? "APPROVED" : "REJECTED", approverId: p.approverId, decidedAt: new Date(), decisionNote: p.note?.trim() || null },
    });
  });
}

export async function cancelLeave(db: PrismaClient, p: { requestId: string; userId: string; today: string }) {
  const req = await db.leaveRequest.findFirst({ where: { id: p.requestId, userId: p.userId } });
  if (!req) throw new HrError("Request not found.");
  if (req.status === "PENDING" || (req.status === "APPROVED" && req.startDate > p.today)) {
    return db.leaveRequest.update({ where: { id: req.id }, data: { status: "CANCELLED" } });
  }
  throw new HrError("This request can no longer be cancelled.");
}

// ----- Employees -----

export async function createEmployee(
  db: PrismaClient,
  p: {
    organizationId: string; name: string; email: string; password: string; roleKey: string; designation?: string;
    employmentType?: string; workLocation?: string; joinDate?: Date | null; managerId?: string | null; departmentId?: string | null; branchId?: string | null;
  },
) {
  if (p.password.length < 10) throw new HrError("Use a password of at least 10 characters.");
  const email = p.email.trim().toLowerCase();
  if (await db.user.findUnique({ where: { email } })) throw new HrError("A user with this email already exists.");
  const role = await db.role.findFirst({ where: { organizationId: p.organizationId, key: p.roleKey } });
  if (!role || ["CLIENT", "VENDOR", "BUSINESS_PARTNER", "INVESTOR"].includes(role.key)) throw new HrError("Choose an employee role.");
  const passwordHash = await bcrypt.hash(p.password, 12);
  return db.$transaction(async (tx) => {
    const seq = await tx.numberSequence.upsert({
      where: { organizationId_key: { organizationId: p.organizationId, key: "EMP" } },
      create: { organizationId: p.organizationId, key: "EMP", next: 2 },
      update: { next: { increment: 1 } },
    });
    const user = await tx.user.create({
      data: {
        organizationId: p.organizationId, email, name: p.name.trim(), passwordHash, userType: "EMPLOYEE",
        managerId: p.managerId ?? null, departmentId: p.departmentId ?? null, branchId: p.branchId ?? null,
        roles: { create: { roleId: role.id } },
      },
    });
    await tx.employeeProfile.create({
      data: {
        organizationId: p.organizationId, userId: user.id, employeeNo: `E-${String(seq.next - 1).padStart(4, "0")}`,
        designation: p.designation || null, employmentType: p.employmentType ?? "FULL_TIME", workLocation: p.workLocation ?? "OFFICE",
        joinDate: p.joinDate ?? null, departmentId: p.departmentId ?? null,
      },
    });
    return user;
  });
}
