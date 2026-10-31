import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { authorizeOwner, type FileActor } from "./file-access";
import { ApplicationError, submitApplication, updateApplication } from "./job-applications";
import { CaptureError } from "./lead-capture";
import { sameSite } from "./same-site";
import { submitContact, WEBSITE_SOURCE_NAME, websiteLeadSource } from "./site-forms";
import { MemoryStorage } from "./storage";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, hrManager: string, hrViewer: string, sales: string, outsider: string;
const storage = new MemoryStorage();
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
const inbox = (id: string) => db.notification.findMany({ where: { userId: id }, orderBy: { createdAt: "asc" } });
const actor = (id: string, perms: string[]): FileActor => ({ id, organizationId: org, userType: "EMPLOYEE", clientId: null, vendorId: null, permissions: new Set(perms) });
const apply = (over: Record<string, unknown> = {}, cv: { name: string; bytes: Buffer } | null = { name: "cv.pdf", bytes: PDF }) =>
  submitApplication(db, storage, { scanner: null, cv, input: { jobId: 28, name: "Ayesha Khan", email: "Ayesha@Mail.test", phone: "+92 300 1234567", ...over } });

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "JobApplication","StoredFile","Notification","LeadActivity","Lead","LeadSource","Contact","PipelineStage","RolePermission","Permission","UserRole","Role","User","Organization" CASCADE');
  // The first organization owns the website; a later one must never receive its leads or applications
  org = (await db.organization.create({ data: { name: "Hifi", createdAt: new Date("2026-01-01") } })).id;
  const later = (await db.organization.create({ data: { name: "Later", createdAt: new Date("2026-06-01") } })).id;
  await db.pipelineStage.create({ data: { organizationId: org, name: "New", sortOrder: 1 } });
  const perm = async (key: string) => (await db.permission.create({ data: { key, description: key } })).id;
  const [hrManage, hrView, crmAll] = [await perm("hr.manage"), await perm("hr.view"), await perm("crm.view_all")];
  const role = (key: string, ids: string[]) => db.role.create({ data: { organizationId: org, key, name: key, permissions: { create: ids.map((permissionId) => ({ permissionId })) } } }).then((r) => r.id);
  const user = (email: string, roleId?: string, o = org) => db.user.create({ data: { organizationId: o, email, name: email, passwordHash: "x", ...(roleId ? { roles: { create: { roleId } } } : {}) } }).then((u) => u.id);
  hrManager = await user("hr@h.test", await role("HR", [hrManage, hrView]));
  hrViewer = await user("viewer@h.test", await role("VIEW", [hrView]));
  sales = await user("sales@h.test", await role("SALES", [crmAll]));
  outsider = await user("x@later.test", undefined, later);
});
afterAll(async () => { await db.$disconnect(); });

describe("the website contact form", () => {
  it("creates one built-in lead source on first use and reuses it", async () => {
    const a = await websiteLeadSource(db, org);
    const b = await websiteLeadSource(db, org);
    expect(a.id).toBe(b.id);
    expect(a).toMatchObject({ name: WEBSITE_SOURCE_NAME, assignMode: "NONE", active: true });
  });

  it("turns a message into a CRM lead with the topic, and tells the people who see all leads", async () => {
    await submitContact(db, { name: "Omar Farooq", email: "omar@biz.test", phone: "", company: "Biz LLC", topic: "Websites", plan: "Professional Website", message: "We need a new site", page_url: "https://hifimarketing.co/site/contact?plan=x", utm_source: "google" });
    const lead = await db.lead.findFirstOrThrow({ where: { organizationId: org, email: "omar@biz.test" } });
    expect(lead).toMatchObject({ name: "Omar Farooq", company: "Biz LLC", source: `Website: ${WEBSITE_SOURCE_NAME}`, utmSource: "google", landingUrl: "https://hifimarketing.co/site/contact?plan=x" });
    expect(lead.notes).toBe("Topic: Websites · Plan: Professional Website\n\nWe need a new site");
    expect((await inbox(sales)).map((n) => n.kind)).toEqual(["lead.unassigned"]);
    expect(await db.lead.count({ where: { organizationId: { not: org } } })).toBe(0);
  });

  it("adds a second message from the same person to their open lead", async () => {
    await submitContact(db, { name: "Omar Farooq", email: "OMAR@biz.test", message: "Any update on our quote?" });
    expect(await db.lead.count({ where: { organizationId: org, email: "omar@biz.test" } })).toBe(1);
  });

  it("refuses incomplete messages with the field to fix", async () => {
    await expect(submitContact(db, { name: "", email: "a@b.test", message: "hello there" })).rejects.toMatchObject({ field: "name" });
    await expect(submitContact(db, { name: "Al", email: "", message: "hello there" })).rejects.toMatchObject({ field: "email" });
    await expect(submitContact(db, { name: "Al", email: "not-an-email", message: "hello there" })).rejects.toMatchObject({ field: "email" });
    await expect(submitContact(db, { name: "Al", email: "a@b.test", message: "hi" })).rejects.toMatchObject({ field: "message" });
  });

  it("stores nothing for a bot that fills the hidden field", async () => {
    const before = await db.lead.count();
    await submitContact(db, { name: "Bot", email: "bot@spam.test", message: "Buy now cheap", website_url: "http://spam.test" });
    expect(await db.lead.count()).toBe(before);
  });

  it("stops taking messages when the source is switched off in lead capture settings", async () => {
    await db.leadSource.updateMany({ where: { organizationId: org, name: WEBSITE_SOURCE_NAME }, data: { active: false } });
    await expect(submitContact(db, { name: "Late", email: "late@x.test", message: "hello there" })).rejects.toThrow(CaptureError);
    await db.leadSource.updateMany({ where: { organizationId: org, name: WEBSITE_SOURCE_NAME }, data: { active: true } });
  });
});

describe("job applications from the careers pages", () => {
  it("saves the application and CV for HR and notifies HR managers only", async () => {
    await expect(apply()).resolves.toMatchObject({ ok: true, duplicate: false });
    const app = await db.jobApplication.findFirstOrThrow({ where: { organizationId: org } });
    expect(app).toMatchObject({ jobId: 28, jobTitle: "WordPress Developer", name: "Ayesha Khan", email: "ayesha@mail.test", phone: "+923001234567", status: "NEW", submissions: 1 });
    const cv = await db.storedFile.findUniqueOrThrow({ where: { id: app.cvFileId! } });
    expect(cv).toMatchObject({ ownerType: "JOB_APPLICATION", ownerId: app.id, contentType: "application/pdf", scanStatus: "UNSCANNED", category: "CV" });
    expect((await storage.get(cv.storageKey)).equals(PDF)).toBe(true);
    expect((await inbox(hrManager)).map((n) => n.kind)).toEqual(["application.new"]);
    expect(await inbox(hrViewer)).toEqual([]);
  });

  it("lets HR viewers read the CV, HR managers manage it, and nobody else see it", async () => {
    const app = await db.jobApplication.findFirstOrThrow({ where: { organizationId: org } });
    expect(await authorizeOwner(db, actor(hrViewer, ["hr.view"]), "JOB_APPLICATION", app.id, "read")).toBe(true);
    expect(await authorizeOwner(db, actor(hrViewer, ["hr.view"]), "JOB_APPLICATION", app.id, "delete")).toBe(false);
    expect(await authorizeOwner(db, actor(hrManager, ["hr.view", "hr.manage"]), "JOB_APPLICATION", app.id, "delete")).toBe(true);
    expect(await authorizeOwner(db, actor(sales, ["crm.view_all"]), "JOB_APPLICATION", app.id, "read")).toBe(false);
    expect(await authorizeOwner(db, { ...actor(outsider, ["hr.view"]), organizationId: "other" }, "JOB_APPLICATION", app.id, "read")).toBe(false);
  });

  it("updates the same application when the person applies again, replacing the CV", async () => {
    const first = await db.jobApplication.findFirstOrThrow({ where: { organizationId: org } });
    await expect(apply({ coverNote: "Updated CV attached" })).resolves.toMatchObject({ duplicate: true });
    const again = await db.jobApplication.findUniqueOrThrow({ where: { id: first.id } });
    expect(again.submissions).toBe(2);
    expect(again.coverNote).toBe("Updated CV attached");
    expect(again.cvFileId).not.toBe(first.cvFileId);
    expect((await db.storedFile.findUniqueOrThrow({ where: { id: first.cvFileId! } })).deletedAt).not.toBeNull();
    expect(await db.jobApplication.count()).toBe(1);
  });

  it("accepts a profile link instead of a CV, and refuses neither", async () => {
    await expect(apply({ email: "link@mail.test", profileUrl: "linkedin.com/in/someone" }, null)).resolves.toMatchObject({ ok: true });
    expect((await db.jobApplication.findFirstOrThrow({ where: { email: "link@mail.test" } })).profileUrl).toBe("https://linkedin.com/in/someone");
    await expect(apply({ email: "none@mail.test" }, null)).rejects.toMatchObject({ field: "cv" });
  });

  it("refuses an unknown role, bad details, and a CV that is not a real PDF or Word file", async () => {
    await expect(apply({ jobId: 99999 })).rejects.toThrow(/no longer open/);
    await expect(apply({ name: "" })).rejects.toMatchObject({ field: "name" });
    await expect(apply({ email: "nope" })).rejects.toMatchObject({ field: "email" });
    await expect(apply({ phone: "12" })).rejects.toMatchObject({ field: "phone" });
    await expect(apply({ profileUrl: "javascript:alert(1)" }, null)).rejects.toMatchObject({ field: "profileUrl" });
    await expect(apply({}, { name: "cv.pdf", bytes: Buffer.from("<html>not a pdf</html>") })).rejects.toMatchObject({ field: "cv" });
    await expect(apply({}, { name: "photo.png", bytes: Buffer.from("89504e470d0a1a0a0000", "hex") })).rejects.toMatchObject({ field: "cv" });
    await expect(apply({}, { name: "big.pdf", bytes: Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]) })).rejects.toMatchObject({ field: "cv" });
  });

  it("refuses a CV the virus scanner flags, and stores nothing", async () => {
    const before = await db.storedFile.count();
    await expect(submitApplication(db, storage, { scanner: async () => ({ status: "INFECTED", signature: "Eicar" }), cv: { name: "cv.pdf", bytes: PDF }, input: { jobId: 28, name: "Virus", email: "v@mail.test", phone: "03001234567" } })).rejects.toThrow(ApplicationError);
    expect(await db.storedFile.count()).toBe(before);
    expect(await db.jobApplication.count({ where: { email: "v@mail.test" } })).toBe(0);
  });

  it("lets only HR managers change the status and notes", async () => {
    const app = await db.jobApplication.findFirstOrThrow({ where: { email: "ayesha@mail.test" } });
    await expect(updateApplication(db, { id: hrViewer, organizationId: org, permissions: new Set(["hr.view"]) }, { id: app.id, status: "SHORTLISTED" })).rejects.toMatchObject({ status: 403 });
    await expect(updateApplication(db, { id: hrManager, organizationId: org, permissions: new Set(["hr.manage"]) }, { id: app.id, status: "MAYBE" })).rejects.toThrow(/valid status/);
    await expect(updateApplication(db, { id: outsider, organizationId: "other", permissions: new Set(["hr.manage"]) }, { id: app.id, status: "HIRED" })).rejects.toMatchObject({ status: 404 });
    const { after } = await updateApplication(db, { id: hrManager, organizationId: org, permissions: new Set(["hr.manage"]) }, { id: app.id, status: "SHORTLISTED", notes: "Strong portfolio" });
    expect(after).toMatchObject({ status: "SHORTLISTED", notes: "Strong portfolio", reviewedById: hrManager });
  });
});

describe("same-site check for the website forms", () => {
  const req = (h: Record<string, string>) => ({ headers: { get: (k: string) => h[k.toLowerCase()] ?? null } });
  it("accepts the site's own pages behind the proxy and refuses other websites", () => {
    expect(sameSite(req({ origin: "https://hifimarketing.co", host: "localhost:3000", "x-forwarded-host": "hifimarketing.co" }))).toBe(true);
    expect(sameSite(req({ origin: "http://localhost:3000", host: "localhost:3000" }))).toBe(true);
    expect(sameSite(req({ origin: "https://evil.test", host: "hifimarketing.co" }))).toBe(false);
    expect(sameSite(req({ origin: "null", host: "hifimarketing.co" }))).toBe(false);
    expect(sameSite(req({ host: "hifimarketing.co" }))).toBe(true);
  });
});
