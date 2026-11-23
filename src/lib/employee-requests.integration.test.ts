// Employee applications to HR against hifi_one_test: validation, who may answer, withdrawal, HR's list and counts, and who may see
// the attached files, and sharing with the line manager (HR's Required Changes, item 6): the "Private, HR only" tick,
// grievances always private, the manager's comment for HR, and who may read what.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { cancelRequest, noteAsManager, requestCounts, requestsForHr, requestsForManager, reviewRequest, submitRequest } from "./employee-requests";
import { authorizeOwner, type FileActor } from "./file-access";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });

let org: string;
let emp: string;
let noProfile: string;
let boss: string;
let hr: string;
let hr2: string;

const actor = (id: string, perms: string[] = []): FileActor => ({ id, organizationId: org, userType: "EMPLOYEE", clientId: null, vendorId: null, permissions: new Set(perms) });

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "EmployeeRequest","StoredFile","EmployeeProfile","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Requests Org" } })).id;
  const mk = async (name: string, no: string, managerId?: string) => (await db.user.create({ data: { organizationId: org, name, email: `${no}@x.example`, passwordHash: "x", userType: "EMPLOYEE", managerId } })).id;
  boss = await mk("Boss", "B1");
  hr = await mk("HR One", "H1");
  hr2 = await mk("HR Two", "H2");
  emp = await mk("Emp", "E1", boss);
  noProfile = await mk("New Joiner", "N1", boss);
  for (const u of [emp, hr, hr2, boss]) await db.employeeProfile.create({ data: { organizationId: org, userId: u, employeeNo: `EMP-${u.slice(-6)}` } });
});
afterAll(() => db.$disconnect());

const base = () => ({ organizationId: org, userId: emp, type: "SALARY_CERTIFICATE", subject: "Salary certificate for the bank", body: "I need a salary certificate for a car loan application at HBL, by Friday if possible." });

describe("writing an application", () => {
  it("validates the type, subject and body, and needs an HR record", async () => {
    await expect(submitRequest(db, { ...base(), type: "HOLIDAY" })).rejects.toThrow(/what the application is about/);
    await expect(submitRequest(db, { ...base(), subject: "ab" })).rejects.toThrow(/short subject/);
    await expect(submitRequest(db, { ...base(), subject: "x".repeat(121) })).rejects.toThrow(/at most 120/);
    await expect(submitRequest(db, { ...base(), body: "too short" })).rejects.toThrow(/Write the application/);
    await expect(submitRequest(db, { ...base(), body: "x".repeat(4001) })).rejects.toThrow(/at most 4000/);
    await expect(submitRequest(db, { ...base(), userId: noProfile })).rejects.toThrow(/HR record/);
  });
  it("stores it as SUBMITTED, trimmed", async () => {
    const r = await submitRequest(db, { ...base(), subject: "  Salary certificate for the bank  " });
    expect(r.status).toBe("SUBMITTED");
    expect(r.subject).toBe("Salary certificate for the bank");
    expect(r.handledById).toBeNull();
  });
  it("caps open applications at ten", async () => {
    for (let i = 0; i < 9; i++) await submitRequest(db, { ...base(), type: "OTHER", subject: `Filler ${i}` });
    await expect(submitRequest(db, { ...base(), type: "OTHER", subject: "Eleventh" })).rejects.toThrow(/ten open/);
    await db.employeeRequest.deleteMany({ where: { userId: emp, subject: { startsWith: "Filler" } } });
  });
});

describe("HR answers", () => {
  it("only another person answers, declining needs a reason, and an answered application is final", async () => {
    const r = (await db.employeeRequest.findFirst({ where: { userId: emp, status: "SUBMITTED" } }))!;
    await expect(reviewRequest(db, { organizationId: org, requestId: r.id, reviewerId: emp, decision: "APPROVED" })).rejects.toThrow(/own application/);
    await expect(reviewRequest(db, { organizationId: org, requestId: r.id, reviewerId: hr, decision: "DECLINED" })).rejects.toThrow(/Say why/);
    await expect(reviewRequest(db, { organizationId: "other-org", requestId: r.id, reviewerId: hr, decision: "APPROVED" })).rejects.toThrow(/not found/);
    const inReview = await reviewRequest(db, { organizationId: org, requestId: r.id, reviewerId: hr, decision: "IN_REVIEW" });
    expect(inReview.status).toBe("IN_REVIEW");
    expect(inReview.handledById).toBe(hr);
    expect(inReview.handledAt).toBeNull();
    await expect(reviewRequest(db, { organizationId: org, requestId: r.id, reviewerId: hr2, decision: "IN_REVIEW" })).rejects.toThrow(/already being reviewed/);
    const done = await reviewRequest(db, { organizationId: org, requestId: r.id, reviewerId: hr2, decision: "APPROVED", note: "Collect it from the front desk on Thursday." });
    expect(done.status).toBe("APPROVED");
    expect(done.handledById).toBe(hr2);
    expect(done.handledAt).not.toBeNull();
    expect(done.responseNote).toMatch(/front desk/);
    await expect(reviewRequest(db, { organizationId: org, requestId: r.id, reviewerId: hr, decision: "DECLINED", note: "Changed my mind" })).rejects.toThrow(/already been answered/);
    await expect(cancelRequest(db, { requestId: r.id, userId: emp })).rejects.toThrow(/cannot be withdrawn/);
  });
  it("the employee withdraws an open application; nobody else can", async () => {
    const r = await submitRequest(db, { ...base(), type: "EQUIPMENT", subject: "Second monitor", body: "A second monitor would help with the design reviews I do all day." });
    await expect(cancelRequest(db, { requestId: r.id, userId: hr })).rejects.toThrow(/not found/);
    expect((await cancelRequest(db, { requestId: r.id, userId: emp })).status).toBe("CANCELLED");
  });
  it("lists open applications oldest first, filters by status and type, and counts", async () => {
    const a = await submitRequest(db, { ...base(), type: "GRIEVANCE", subject: "Older grievance", body: "I would like to raise a concern about how shifts are being allocated in my team." });
    await new Promise((r) => setTimeout(r, 5));
    const b = await submitRequest(db, { ...base(), type: "ADVANCE", subject: "Newer advance", body: "Requesting a salary advance of one month for a family medical expense." });
    const open = await requestsForHr(db, org, { status: "OPEN" });
    expect(open.map((r) => r.id)).toEqual([a.id, b.id]);
    expect((await requestsForHr(db, org, { status: "OPEN", type: "ADVANCE" })).map((r) => r.id)).toEqual([b.id]);
    expect((await requestsForHr(db, org, { status: "APPROVED" })).length).toBe(1);
    const all = await requestsForHr(db, org, { status: "ALL" });
    expect(all.slice(0, 2).map((r) => r.id)).toEqual([a.id, b.id]); // open ones first
    const c = await requestCounts(db, org);
    expect(c).toMatchObject({ open: 2, submitted: 2, inReview: 0, approved: 1, cancelled: 1, declined: 0, all: 4 });
  });
});

describe("attachments", () => {
  it("are read by the employee and HR, added by the employee only while open, and by the manager only when shared with them", async () => {
    const open = (await db.employeeRequest.findFirst({ where: { userId: emp, status: "SUBMITTED", type: "ADVANCE" } }))!;
    const closed = (await db.employeeRequest.findFirst({ where: { userId: emp, status: "APPROVED" } }))!;
    expect(await authorizeOwner(db, actor(emp), "EMPLOYEE_REQUEST", open.id, "read")).toBe(true);
    expect(await authorizeOwner(db, actor(emp), "EMPLOYEE_REQUEST", open.id, "upload")).toBe(true);
    expect(await authorizeOwner(db, actor(emp), "EMPLOYEE_REQUEST", closed.id, "upload")).toBe(false);
    expect(await authorizeOwner(db, actor(emp), "EMPLOYEE_REQUEST", closed.id, "read")).toBe(true);
    expect(await authorizeOwner(db, actor(hr, ["hr.manage"]), "EMPLOYEE_REQUEST", open.id, "read")).toBe(true);
    expect(await authorizeOwner(db, actor(hr, ["hr.manage"]), "EMPLOYEE_REQUEST", closed.id, "delete")).toBe(true);
    expect(open.managerId).toBe(boss);
    expect(await authorizeOwner(db, actor(boss, ["leave.approve", "hr.view"]), "EMPLOYEE_REQUEST", open.id, "read")).toBe(true);
    expect(await authorizeOwner(db, actor(boss, ["leave.approve", "hr.view"]), "EMPLOYEE_REQUEST", open.id, "upload")).toBe(false);
    expect(await authorizeOwner(db, actor(hr2, ["leave.approve"]), "EMPLOYEE_REQUEST", open.id, "read")).toBe(false); // another manager
    expect(await authorizeOwner(db, actor(hr2, ["hr.view_sensitive"]), "EMPLOYEE_REQUEST", open.id, "read")).toBe(false);
    expect(await authorizeOwner(db, { ...actor(emp), userType: "CLIENT" }, "EMPLOYEE_REQUEST", open.id, "read")).toBe(false);
    expect(await authorizeOwner(db, actor(hr, ["hr.manage"]), "EMPLOYEE_REQUEST", "nope", "read")).toBe(false);
  });
});

describe("sharing with the manager", () => {
  it("goes to the line manager unless marked Private, HR only; a complaint is always private", async () => {
    await db.$executeRawUnsafe('TRUNCATE "EmployeeRequest" CASCADE');
    const shared = await submitRequest(db, { ...base(), type: "EQUIPMENT", subject: "New laptop" });
    const priv = await submitRequest(db, { ...base(), type: "ADVANCE", subject: "Salary advance", hrOnly: true });
    const complaint = await submitRequest(db, { ...base(), type: "GRIEVANCE", subject: "About my manager" });
    expect([shared.hrOnly, shared.managerId]).toEqual([false, boss]);
    expect([priv.hrOnly, priv.managerId]).toEqual([true, null]);
    expect([complaint.hrOnly, complaint.managerId]).toEqual([true, null]);
    const list = await requestsForManager(db, org, boss);
    expect(list.open.map((r) => r.subject)).toEqual(["New laptop"]);
    expect((await requestsForManager(db, org, hr)).open).toEqual([]); // not their team
    expect(await authorizeOwner(db, actor(boss, ["leave.approve"]), "EMPLOYEE_REQUEST", priv.id, "read")).toBe(false);
    expect(await authorizeOwner(db, actor(boss, ["leave.approve"]), "EMPLOYEE_REQUEST", complaint.id, "read")).toBe(false);
  });

  it("is not shared when nobody, an inactive person or the employee themselves is set as manager", async () => {
    await db.user.update({ where: { id: boss }, data: { active: false } });
    expect((await submitRequest(db, { ...base(), subject: "Manager left" })).managerId).toBeNull();
    await db.user.update({ where: { id: boss }, data: { active: true } });
    await db.user.update({ where: { id: hr2 }, data: { managerId: hr2 } });
    expect((await submitRequest(db, { ...base(), userId: hr2, subject: "Self managed" })).managerId).toBeNull();
    expect((await submitRequest(db, { ...base(), userId: hr, subject: "No manager" })).managerId).toBeNull();
  });

  it("lets only that manager comment for HR, only while open, and HR still decides", async () => {
    const shared = (await db.employeeRequest.findFirst({ where: { subject: "New laptop" } }))!;
    const priv = (await db.employeeRequest.findFirst({ where: { subject: "Salary advance" } }))!;
    const noted = await noteAsManager(db, { organizationId: org, requestId: shared.id, managerId: boss, note: "I support this; the old one is broken." });
    expect(noted.managerNote).toBe("I support this; the old one is broken.");
    expect(noted.status).toBe("SUBMITTED");
    await expect(noteAsManager(db, { organizationId: org, requestId: shared.id, managerId: hr, note: "Me too" })).rejects.toThrow("not found");
    await expect(noteAsManager(db, { organizationId: org, requestId: priv.id, managerId: boss, note: "Let me see" })).rejects.toThrow("not found");
    await expect(noteAsManager(db, { organizationId: org, requestId: shared.id, managerId: boss, note: " " })).rejects.toThrow("Write your comment");
    await reviewRequest(db, { organizationId: org, requestId: shared.id, reviewerId: hr, decision: "APPROVED" });
    await expect(noteAsManager(db, { organizationId: org, requestId: shared.id, managerId: boss, note: "Late note" })).rejects.toThrow("already answered");
    const after = await requestsForManager(db, org, boss);
    expect(after.answered.map((r) => [r.subject, r.status])).toEqual([["New laptop", "APPROVED"]]);
  });
});
