// pendingApprovals against hifi_one_test: who sees what, and that nobody sees what they may not decide.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { pendingApprovals, summarise } from "./approvals";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });

let org: string;
let hr: string, manager: string, mine: string, theirs: string;
let leaveType: string;

const asUser = (id: string, perms: string[]) => ({ id, organizationId: org, permissions: new Set(perms) });
const keys = async (u: { id: string; organizationId: string; permissions: Set<string> }) => (await summarise(await pendingApprovals(db, u))).groups.map((g) => g.key);

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "ExpenseVoucher","SiteVisitRequest","EmployeeRequest","LeaveRequest","LeaveType","EmployeeProfile","CompanyProfile","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Approve Org" } })).id;
  await db.companyProfile.create({ data: { organizationId: org, isDefault: true, legalName: "Approve Org", timezone: "Asia/Karachi" } });
  const mk = async (name: string, managerId?: string) =>
    (await db.user.create({ data: { organizationId: org, name, email: `${name.toLowerCase()}@x.example`, passwordHash: "x", userType: "EMPLOYEE", managerId } })).id;
  hr = await mk("Hr");
  manager = await mk("Manager");
  mine = await mk("Mine", manager);
  theirs = await mk("Theirs");
  leaveType = (await db.leaveType.create({ data: { organizationId: org, name: "Annual", daysPerYear: 20, paid: true } })).id;
  for (const userId of [mine, theirs]) {
    await db.leaveRequest.create({ data: { userId, leaveTypeId: leaveType, startDate: "2026-12-01", endDate: "2026-12-02", days: 2, status: "PENDING" } });
  }
});

afterAll(async () => { await db.$disconnect(); });

describe("pendingApprovals", () => {
  it("shows nothing to someone who decides nothing", async () => {
    expect(await keys(asUser(mine, ["self.leave"]))).toEqual([]);
  });

  it("shows HR every leave request", async () => {
    const groups = await pendingApprovals(db, asUser(hr, ["leave.approve", "attendance.view_all"]));
    expect(groups.find((g) => g.key === "leave")?.count).toBe(2);
  });

  it("shows a manager only their own reports' leave", async () => {
    const groups = await pendingApprovals(db, asUser(manager, ["leave.approve"]));
    const leave = groups.find((g) => g.key === "leave")!;
    expect(leave.count).toBe(1);
    expect(leave.rows[0].who).toBe("Mine");
  });

  it("never shows a person their own request to decide", async () => {
    await db.leaveRequest.create({ data: { userId: manager, leaveTypeId: leaveType, startDate: "2026-12-05", endDate: "2026-12-05", days: 1, status: "PENDING" } });
    const groups = await pendingApprovals(db, asUser(manager, ["leave.approve", "attendance.view_all"]));
    expect(groups.find((g) => g.key === "leave")?.rows.map((r) => r.who)).not.toContain("Manager");
  });

  it("adds a kind only when the permission is held", async () => {
    await db.employeeRequest.create({ data: { organizationId: org, userId: mine, type: "ADVANCE", subject: "Salary advance", body: "Please." } });
    expect(await keys(asUser(hr, ["leave.approve", "attendance.view_all"]))).not.toContain("requests");
    expect(await keys(asUser(hr, ["leave.approve", "attendance.view_all", "hr.manage"]))).toContain("requests");
  });

  it("counts every row but shows only the first few", async () => {
    for (let i = 0; i < 8; i++) {
      await db.employeeRequest.create({ data: { organizationId: org, userId: theirs, type: "OTHER", subject: `Ask ${i}`, body: "x" } });
    }
    const g = (await pendingApprovals(db, asUser(hr, ["hr.manage"]))).find((x) => x.key === "requests")!;
    expect(g.count).toBe(9);
    expect(g.rows.length).toBe(4);
  });

  it("leaves out anything already decided", async () => {
    await db.leaveRequest.updateMany({ where: { userId: theirs }, data: { status: "APPROVED" } });
    const groups = await pendingApprovals(db, asUser(hr, ["leave.approve", "attendance.view_all"]));
    expect(groups.find((g) => g.key === "leave")?.rows.map((r) => r.who)).not.toContain("Theirs");
  });

  it("keeps one organization's approvals out of another's", async () => {
    const other = (await db.organization.create({ data: { name: "Elsewhere" } })).id;
    const stranger = { id: hr, organizationId: other, permissions: new Set(["leave.approve", "attendance.view_all", "hr.manage"]) };
    expect(await keys(stranger)).toEqual([]);
  });
});
