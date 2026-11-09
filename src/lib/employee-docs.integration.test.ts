// Employee document requests and HR review against hifi_one_test.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { DocumentError, afterEmployeeUpload, cancelDocumentRequest, employeeDocOverview, myDocumentRequests, requestDocument, reviewEmployeeFile } from "./employee-docs";
import { listFiles, saveFile } from "./files";
import { MemoryStorage } from "./storage";
import type { FileActor } from "./file-access";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const storage = new MemoryStorage();
const pdf = (n = 1) => Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(40, n)]);

let org: string;
let emp: string;
let hr: string;
let manager: string;
const actor = (id: string, perms: string[] = []): FileActor => ({ id, organizationId: org, userType: "EMPLOYEE", clientId: null, vendorId: null, permissions: new Set(perms) });
const HR = ["hr.view", "hr.manage", "hr.view_sensitive"];

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "DocumentRequest","StoredFile","EmployeeProfile","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Docs Org" } })).id;
  const mk = async (name: string, no: string) => {
    const u = await db.user.create({ data: { organizationId: org, name, email: `${no}@x.example`, passwordHash: "x", userType: "EMPLOYEE" } });
    await db.employeeProfile.create({ data: { organizationId: org, userId: u.id, employeeNo: no } });
    return u.id;
  };
  emp = await mk("Emp", "E1");
  hr = await mk("HR", "H1");
  manager = await mk("Manager", "M1");
});
afterAll(() => db.$disconnect());

describe("requesting a document", () => {
  it("creates one open request per category and lists it for the employee", async () => {
    const r = await requestDocument(db, { organizationId: org, userId: emp, category: "Health or medical", note: "Fitness certificate", dueOn: "2026-11-20", requestedById: hr });
    expect(r.status).toBe("REQUESTED");
    await expect(requestDocument(db, { organizationId: org, userId: emp, category: "Health or medical", requestedById: hr })).rejects.toThrow(/already has an open request/);
    expect((await myDocumentRequests(db, org, emp)).map((x) => x.category)).toEqual(["Health or medical"]);
  });
  it("refuses unknown categories, bad dates and people without an HR record", async () => {
    await expect(requestDocument(db, { organizationId: org, userId: emp, category: "Secret", requestedById: hr })).rejects.toThrow(DocumentError);
    await expect(requestDocument(db, { organizationId: org, userId: emp, category: "Other", dueOn: "20-11-2026", requestedById: hr })).rejects.toThrow(/valid due date/);
    await expect(requestDocument(db, { organizationId: org, userId: "nobody", category: "Other", requestedById: hr })).rejects.toThrow(/no HR record/);
  });
  it("can be cancelled once, and shows as overdue after its due date", async () => {
    const r = await requestDocument(db, { organizationId: org, userId: emp, category: "Address proof", dueOn: "2026-11-01", requestedById: hr });
    const o = await employeeDocOverview(db, org, "2026-11-10");
    expect(o.overdue.map((x) => x.id)).toContain(r.id);
    await cancelDocumentRequest(db, { organizationId: org, requestId: r.id, byId: hr });
    await expect(cancelDocumentRequest(db, { organizationId: org, requestId: r.id, byId: hr })).rejects.toThrow(/already closed/);
    expect((await myDocumentRequests(db, org, emp)).some((x) => x.id === r.id)).toBe(false);
  });
});

describe("uploading against a request and HR review", () => {
  it("the employee's upload answers the request, waits for review, then HR verifies it", async () => {
    const req = (await myDocumentRequests(db, org, emp)).find((r) => r.category === "Health or medical")!;
    const f = await saveFile(db, storage, { actor: actor(emp), ownerType: "EMPLOYEE", ownerId: emp, name: "fitness.pdf", bytes: pdf(1), scanner: null });
    const a = await afterEmployeeUpload(db, { fileId: f.id, actorId: emp, organizationId: org, requestId: req.id });
    expect(a.notifyHr).toBe(true);
    expect(a.file.reviewStatus).toBe("PENDING");
    expect(a.file.category).toBe("Health or medical");
    expect(a.request?.status).toBe("SUBMITTED");
    expect((await employeeDocOverview(db, org, "2026-11-10")).pendingFiles.map((x) => x.id)).toContain(f.id);

    await expect(reviewEmployeeFile(db, { organizationId: org, fileId: f.id, reviewerId: emp, verdict: "VERIFIED" })).rejects.toThrow(/own documents/);
    await expect(reviewEmployeeFile(db, { organizationId: org, fileId: f.id, reviewerId: hr, verdict: "REJECTED" })).rejects.toThrow(/Say why/);
    const v = await reviewEmployeeFile(db, { organizationId: org, fileId: f.id, reviewerId: hr, verdict: "VERIFIED" });
    expect(v.file.reviewStatus).toBe("VERIFIED");
    expect(v.request?.status).toBe("VERIFIED");
    expect((await employeeDocOverview(db, org, "2026-11-10")).pendingFiles).toHaveLength(0);
  });
  it("a rejection reopens the request so the employee can upload again", async () => {
    const req = await requestDocument(db, { organizationId: org, userId: emp, category: "Identity (CNIC or passport)", requestedById: hr });
    const f = await saveFile(db, storage, { actor: actor(emp), ownerType: "EMPLOYEE", ownerId: emp, name: "cnic.pdf", bytes: pdf(2), scanner: null });
    await afterEmployeeUpload(db, { fileId: f.id, actorId: emp, organizationId: org, requestId: req.id });
    const r = await reviewEmployeeFile(db, { organizationId: org, fileId: f.id, reviewerId: hr, verdict: "REJECTED", note: "Back side is missing" });
    expect(r.request?.status).toBe("REJECTED");
    expect(r.request?.decisionNote).toBe("Back side is missing");
    const f2 = await saveFile(db, storage, { actor: actor(emp), ownerType: "EMPLOYEE", ownerId: emp, name: "cnic-both.pdf", bytes: pdf(3), scanner: null });
    const a = await afterEmployeeUpload(db, { fileId: f2.id, actorId: emp, organizationId: org, requestId: req.id });
    expect(a.request?.status).toBe("SUBMITTED");
    expect(a.request?.fileId).toBe(f2.id);
    expect(a.request?.decisionNote).toBeNull();
  });
  it("an upload by HR on the employee's behalf counts as verified and closes the request", async () => {
    const req = await requestDocument(db, { organizationId: org, userId: emp, category: "Employment contract", requestedById: hr });
    const f = await saveFile(db, storage, { actor: actor(hr, HR), ownerType: "EMPLOYEE", ownerId: emp, name: "contract.pdf", bytes: pdf(4), scanner: null });
    const a = await afterEmployeeUpload(db, { fileId: f.id, actorId: hr, organizationId: org, requestId: req.id });
    expect(a.notifyHr).toBe(false);
    expect(a.file.reviewStatus).toBe("VERIFIED");
    expect(a.request?.status).toBe("VERIFIED");
  });
  it("a request cannot be answered with another person's file, and a manager without hr.view_sensitive sees nothing", async () => {
    const req = await requestDocument(db, { organizationId: org, userId: emp, category: "Bank details", requestedById: hr });
    const theirs = await saveFile(db, storage, { actor: actor(manager), ownerType: "EMPLOYEE", ownerId: manager, name: "mine.pdf", bytes: pdf(5), scanner: null });
    await expect(afterEmployeeUpload(db, { fileId: theirs.id, actorId: manager, organizationId: org, requestId: req.id })).rejects.toThrow(/Request not found/);
    expect(await listFiles(db, actor(manager, ["hr.view", "leave.approve"]), "EMPLOYEE", emp)).toEqual([]);
    expect((await listFiles(db, actor(hr, HR), "EMPLOYEE", emp)).length).toBeGreaterThan(0);
  });
});
