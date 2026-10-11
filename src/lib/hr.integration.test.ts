// Integration tests for HR rules against the hifi_one_test database (see accounting.integration.test.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  HrError, cancelLeave, clockIn, clockOut, correctClockOut, createEmployee, decideLeave, endBreak, leaveBalances, requestLeave, startBreak,
} from "./hr";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });

let org: string;
let annual: string;
let unpaid: string;
let emp: string;
let boss: string;
let other: string;

beforeAll(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE "BreakRecord","AttendanceRecord","LeaveRequest","LeaveType","EmployeeProfile","NumberSequence","UserRole","RolePermission","Session","AuditLog","User","Role","Organization" CASCADE',
  );
  org = (await db.organization.create({ data: { name: "HR Test Org" } })).id;
  await db.role.create({ data: { organizationId: org, key: "SALES_AGENT", name: "Sales Agent" } });
  await db.role.create({ data: { organizationId: org, key: "CLIENT", name: "Client" } });
  annual = (await db.leaveType.create({ data: { organizationId: org, name: "Annual", daysPerYear: 10 } })).id;
  unpaid = (await db.leaveType.create({ data: { organizationId: org, name: "Unpaid", daysPerYear: 0, paid: false } })).id;
  boss = (await createEmployee(db, { organizationId: org, name: "Boss", email: "boss@x.example", password: "long-enough-pw-1", roleKey: "SALES_AGENT" })).id;
  other = (await createEmployee(db, { organizationId: org, name: "Other", email: "other@x.example", password: "long-enough-pw-2", roleKey: "SALES_AGENT" })).id;
  emp = (await createEmployee(db, { organizationId: org, name: "Emp", email: "emp@x.example", password: "long-enough-pw-3", roleKey: "SALES_AGENT", managerId: boss })).id;
});
afterAll(async () => { await db.$disconnect(); });

describe("employees", () => {
  it("assigns sequential employee numbers and refuses duplicate emails, weak passwords and external roles", async () => {
    const nos = (await db.employeeProfile.findMany({ orderBy: { employeeNo: "asc" } })).map((p) => p.employeeNo);
    expect(nos).toEqual(["E-0001", "E-0002", "E-0003"]);
    await expect(createEmployee(db, { organizationId: org, name: "D", email: "EMP@x.example", password: "long-enough-pw-9", roleKey: "SALES_AGENT" })).rejects.toThrow(/already exists/);
    await expect(createEmployee(db, { organizationId: org, name: "D", email: "d@x.example", password: "short", roleKey: "SALES_AGENT" })).rejects.toThrow(/10 characters/);
    await expect(createEmployee(db, { organizationId: org, name: "D", email: "d@x.example", password: "long-enough-pw-9", roleKey: "CLIENT" })).rejects.toThrow(/employee role/);
  });
});

describe("attendance", () => {
  const t = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 12, h, m));
  it("clock in, break, clock out; second clock-in the same day is refused", async () => {
    await clockIn(db, { userId: emp, timeZone: "UTC", workMode: "OFFICE", now: t(9) });
    await expect(clockIn(db, { userId: emp, timeZone: "UTC", workMode: "OFFICE", now: t(9, 5) })).rejects.toThrow(/open session/);
    await startBreak(db, { userId: emp, now: t(12) });
    await expect(startBreak(db, { userId: emp, now: t(12, 1) })).rejects.toThrow(/already running/);
    await endBreak(db, { userId: emp, now: t(12, 30) });
    const rec = await clockOut(db, { userId: emp, now: t(17) });
    expect(rec.clockOut).toEqual(t(17));
    await expect(clockOut(db, { userId: emp })).rejects.toThrow(/not clocked in/);
    await expect(clockIn(db, { userId: emp, timeZone: "UTC", workMode: "OFFICE", now: t(18) })).rejects.toThrow(/already clocked in today/);
  });
  it("a forgotten clock-out blocks the next day until HR corrects it, with an audit trail", async () => {
    await clockIn(db, { userId: other, timeZone: "UTC", workMode: "REMOTE", now: t(9) });
    const next = new Date(t(9).getTime() + 86400000);
    await expect(clockIn(db, { userId: other, timeZone: "UTC", workMode: "REMOTE", now: next })).rejects.toThrow(/open session/);
    const rec = await db.attendanceRecord.findFirstOrThrow({ where: { userId: other } });
    await expect(correctClockOut(db, { recordId: rec.id, clockOut: t(8), correctedById: boss, note: "x" })).rejects.toThrow(/after clock-in/);
    await expect(correctClockOut(db, { recordId: rec.id, clockOut: t(17), correctedById: boss, note: " " })).rejects.toThrow(/reason/);
    const fixed = await correctClockOut(db, { recordId: rec.id, clockOut: t(17), correctedById: boss, note: "Forgot to clock out" });
    expect(fixed.correctedById).toBe(boss);
    await clockIn(db, { userId: other, timeZone: "UTC", workMode: "REMOTE", now: next });
  });
});

describe("leave", () => {
  it("counts working days, enforces balance and blocks overlaps", async () => {
    const r = await requestLeave(db, { organizationId: org, userId: emp, leaveTypeId: annual, startDate: "2026-11-02", endDate: "2026-11-06" });
    expect(Number(r.days)).toBe(5);
    await expect(requestLeave(db, { organizationId: org, userId: emp, leaveTypeId: annual, startDate: "2026-11-05", endDate: "2026-11-09" })).rejects.toThrow(/overlaps/);
    await expect(requestLeave(db, { organizationId: org, userId: emp, leaveTypeId: annual, startDate: "2026-12-01", endDate: "2026-12-14" })).rejects.toThrow(/balance/);
    await expect(requestLeave(db, { organizationId: org, userId: emp, leaveTypeId: annual, startDate: "2026-12-12", endDate: "2026-12-13" })).rejects.toThrow(/no working days/);
    await expect(requestLeave(db, { organizationId: org, userId: emp, leaveTypeId: annual, startDate: "2026-12-30", endDate: "2027-01-05" })).rejects.toThrow(/new year/);
  });

  it("only the manager or HR decides, never the employee; approved days reduce the balance once", async () => {
    const req = await db.leaveRequest.findFirstOrThrow({ where: { userId: emp } });
    await expect(decideLeave(db, { requestId: req.id, approverId: emp, approve: true, canApproveAll: true })).rejects.toThrow(/own leave/);
    await expect(decideLeave(db, { requestId: req.id, approverId: other, approve: true, canApproveAll: false })).rejects.toThrow(/manager or HR/);
    const results = await Promise.allSettled([
      decideLeave(db, { requestId: req.id, approverId: boss, approve: true, canApproveAll: false }),
      decideLeave(db, { requestId: req.id, approverId: boss, approve: true, canApproveAll: false }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const bal = (await leaveBalances(db, org, emp, "2026")).find((b) => b.type.id === annual)!;
    expect(bal.approved).toBe(5);
    expect(bal.remaining).toBe(5);
  });

  it("unpaid leave is not limited by an allowance, and approved future leave can be cancelled", async () => {
    const r = await requestLeave(db, { organizationId: org, userId: emp, leaveTypeId: unpaid, startDate: "2026-12-07", endDate: "2026-12-11" });
    expect(r.status).toBe("PENDING");
    const c = await cancelLeave(db, { requestId: r.id, userId: emp, today: "2026-10-12" });
    expect(c.status).toBe("CANCELLED");
    await expect(cancelLeave(db, { requestId: r.id, userId: other, today: "2026-10-12" })).rejects.toThrow(HrError);
  });
});
