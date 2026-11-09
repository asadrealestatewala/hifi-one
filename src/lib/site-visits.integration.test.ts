// Site visit requests against hifi_one_test: validation, overlap rules, who may decide, cancellation and the day view.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { VisitError, cancelSiteVisit, decideSiteVisit, describeVisit, pendingForApprover, requestSiteVisit, visitsOn } from "./site-visits";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const TODAY = "2026-11-10";

let org: string;
let otherOrg: string;
let emp: string;
let boss: string;
let hr: string;
let client: string;
let foreignClient: string;

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "SiteVisitRequest","LeaveRequest","LeaveType","Client","EmployeeProfile","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Visits Org" } })).id;
  otherOrg = (await db.organization.create({ data: { name: "Other" } })).id;
  const mk = async (name: string, no: string, managerId?: string) => (await db.user.create({ data: { organizationId: org, name, email: `${no}@x.example`, passwordHash: "x", userType: "EMPLOYEE", managerId } })).id;
  boss = await mk("Boss", "B1");
  hr = await mk("HR", "H1");
  emp = await mk("Emp", "E1", boss);
  client = (await db.client.create({ data: { organizationId: org, name: "Acme Motors" } })).id;
  foreignClient = (await db.client.create({ data: { organizationId: otherOrg, name: "Elsewhere" } })).id;
  const type = await db.leaveType.create({ data: { organizationId: org, name: "Annual", daysPerYear: 10 } });
  await db.leaveRequest.create({ data: { userId: emp, leaveTypeId: type.id, startDate: "2026-11-20", endDate: "2026-11-20", days: 1, status: "APPROVED" } });
});
afterAll(() => db.$disconnect());

const base = () => ({ organizationId: org, userId: emp, today: TODAY, purpose: "Demo of Velocity ERP at the showroom" });

describe("asking", () => {
  it("validates kind, dates, times, place, purpose and client", async () => {
    await expect(requestSiteVisit(db, { ...base(), kind: "HOLIDAY", startDate: TODAY })).rejects.toThrow(/what kind/);
    await expect(requestSiteVisit(db, { ...base(), kind: "SITE_VISIT", startDate: "2026-13-01", location: "x" })).rejects.toThrow(/valid dates/);
    await expect(requestSiteVisit(db, { ...base(), kind: "SITE_VISIT", startDate: "2026-11-12", endDate: "2026-11-11", location: "x" })).rejects.toThrow(/before the start/);
    await expect(requestSiteVisit(db, { ...base(), kind: "SITE_VISIT", startDate: "2026-10-01", location: "x" })).rejects.toThrow(/at most 7 days/);
    await expect(requestSiteVisit(db, { ...base(), kind: "SITE_VISIT", startDate: TODAY, startTime: "25:00", location: "x" })).rejects.toThrow(/HH:MM/);
    await expect(requestSiteVisit(db, { ...base(), kind: "SITE_VISIT", startDate: TODAY, startTime: "14:00", endTime: "10:00", location: "x" })).rejects.toThrow(/after the start time/);
    await expect(requestSiteVisit(db, { ...base(), kind: "SITE_VISIT", startDate: TODAY })).rejects.toThrow(/where/);
    await expect(requestSiteVisit(db, { ...base(), kind: "WORK_FROM_HOME", startDate: TODAY, purpose: "ok" })).rejects.toThrow(/why/);
    await expect(requestSiteVisit(db, { ...base(), kind: "SITE_VISIT", startDate: TODAY, location: "x", clientId: foreignClient })).rejects.toThrow(/Unknown client/);
    await expect(requestSiteVisit(db, { ...base(), kind: "SITE_VISIT", startDate: "2026-11-20", location: "x" })).rejects.toThrow(/approved leave/);
  });
  it("creates a visit, allows two part-day visits on one day, and blocks whole-day overlaps", async () => {
    const a = await requestSiteVisit(db, { ...base(), kind: "SITE_VISIT", startDate: "2026-11-12", startTime: "10:00", endTime: "12:00", location: "DHA Phase 5", clientId: client });
    expect(a.status).toBe("PENDING");
    expect(describeVisit({ ...a, client: { name: "Acme Motors" } })).toBe("Site or client visit · Acme Motors · DHA Phase 5 · 10:00–12:00");
    await requestSiteVisit(db, { ...base(), kind: "SITE_VISIT", startDate: "2026-11-12", startTime: "14:00", endTime: "16:00", location: "Gulberg" });
    await expect(requestSiteVisit(db, { ...base(), kind: "SITE_VISIT", startDate: "2026-11-12", startTime: "11:00", endTime: "15:00", location: "Johar" })).rejects.toThrow(/overlaps/);
    await expect(requestSiteVisit(db, { ...base(), kind: "FIELD_WORK", startDate: "2026-11-11", endDate: "2026-11-13", location: "Saddar" })).rejects.toThrow(/overlaps/);
    const wfh = await requestSiteVisit(db, { ...base(), kind: "WORK_FROM_HOME", startDate: "2026-11-16", endDate: "2026-11-17", purpose: "Internet work at the office" });
    expect(wfh.location).toBeNull();
    expect(wfh.endDate).toBe("2026-11-17");
  });
});

describe("deciding", () => {
  it("manager and HR may decide, not the requester, and a rejection needs a reason", async () => {
    const [first, second] = await db.siteVisitRequest.findMany({ where: { userId: emp, startDate: "2026-11-12" }, orderBy: { createdAt: "asc" } });
    expect((await pendingForApprover(db, org, boss, false)).map((r) => r.id)).toContain(first.id);
    expect(await pendingForApprover(db, org, hr, false)).toEqual([]);
    expect((await pendingForApprover(db, org, hr, true)).length).toBe(3);
    await expect(decideSiteVisit(db, { organizationId: org, requestId: first.id, approverId: emp, approve: true, canDecideAll: true })).rejects.toThrow(/own request/);
    await expect(decideSiteVisit(db, { organizationId: org, requestId: first.id, approverId: hr, approve: true, canDecideAll: false })).rejects.toThrow(/manager or HR/);
    await expect(decideSiteVisit(db, { organizationId: org, requestId: first.id, approverId: boss, approve: false, canDecideAll: false })).rejects.toThrow(/Say why/);
    const ok = await decideSiteVisit(db, { organizationId: org, requestId: first.id, approverId: boss, approve: true, canDecideAll: false });
    expect(ok.status).toBe("APPROVED");
    await expect(decideSiteVisit(db, { organizationId: org, requestId: first.id, approverId: boss, approve: true, canDecideAll: false })).rejects.toThrow(/already been decided/);
    const no = await decideSiteVisit(db, { organizationId: org, requestId: second.id, approverId: hr, approve: false, note: "Clash with the team meeting", canDecideAll: true });
    expect(no.status).toBe("REJECTED");
    const day = await visitsOn(db, org, "2026-11-12");
    expect(day.map((v) => v.id)).toEqual([first.id]);
    expect(day[0].client?.name).toBe("Acme Motors");
  });
  it("the employee can cancel a pending or future approved request, but not a past one", async () => {
    const past = await requestSiteVisit(db, { ...base(), kind: "FIELD_WORK", startDate: "2026-11-05", location: "Clifton", purpose: "Recorded after the fact" });
    await decideSiteVisit(db, { organizationId: org, requestId: past.id, approverId: hr, approve: true, canDecideAll: true });
    await expect(cancelSiteVisit(db, { requestId: past.id, userId: emp, today: TODAY })).rejects.toThrow(VisitError);
    const wfh = (await db.siteVisitRequest.findFirst({ where: { userId: emp, kind: "WORK_FROM_HOME" } }))!;
    expect((await cancelSiteVisit(db, { requestId: wfh.id, userId: emp, today: TODAY })).status).toBe("CANCELLED");
    await expect(cancelSiteVisit(db, { requestId: wfh.id, userId: boss, today: TODAY })).rejects.toThrow(/not found/);
  });
});
