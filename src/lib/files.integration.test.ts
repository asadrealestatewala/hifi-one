// File storage against hifi_one_test: validation, access follows the record, signed links, deletion and retention.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { FileError, deleteFile, listFiles, openFile, purgeDeleted, saveFile, signDownload, verifyDownload } from "./files";
import { LocalDiskStorage, MemoryStorage, newStorageKey } from "./storage";
import type { FileActor } from "./file-access";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const storage = new MemoryStorage();

const pdf = (n = 1) => Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(40, n)]);
let org: string;
let otherOrg: string;
let voucher: string;
let bill: string;
let otherBill: string;
let vendorA: string;
let vendorB: string;
let draft: string;
let inReview: string;
let acme: string;
let other: string;
let empUser: string;

const actor = (over: Partial<FileActor> & { perms?: string[] }): FileActor => ({
  id: "u", organizationId: org, userType: "EMPLOYEE", clientId: null, vendorId: null, permissions: new Set(over.perms ?? []), ...over,
});
const submitter = () => actor({ id: "sub-1" });
const reviewer = () => actor({ id: "rev-1", perms: ["expenses.review", "expenses.view", "expenses.approve"] });

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "StoredFile","VendorBill","WorkOrder","Vendor","ContentItem","Client","ExpenseVoucher","EmployeeProfile","Account","NumberSequence","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Files Org" } })).id;
  otherOrg = (await db.organization.create({ data: { name: "Other Org" } })).id;
  const acct = await db.account.create({ data: { organizationId: org, code: "6010", name: "Hosting", type: "OPEX" } });
  voucher = (await db.expenseVoucher.create({ data: { organizationId: org, number: "VCH-1", date: "2026-10-01", payee: "X", description: "d", expenseAccountId: acct.id, currency: "USD", amount: "10", submittedById: "sub-1" } })).id;
  vendorA = (await db.vendor.create({ data: { organizationId: org, code: "V-1", name: "A", currency: "USD" } })).id;
  vendorB = (await db.vendor.create({ data: { organizationId: org, code: "V-2", name: "B", currency: "USD" } })).id;
  const wo = (v: string, n: string) => db.workOrder.create({ data: { organizationId: org, number: n, vendorId: v, title: "t", amount: "100", currency: "USD", status: "ACCEPTED" } });
  const woA = await wo(vendorA, "WO-1");
  const woB = await wo(vendorB, "WO-2");
  bill = (await db.vendorBill.create({ data: { organizationId: org, number: "VB-1", vendorId: vendorA, workOrderId: woA.id, amount: "50", currency: "USD" } })).id;
  otherBill = (await db.vendorBill.create({ data: { organizationId: org, number: "VB-2", vendorId: vendorB, workOrderId: woB.id, amount: "50", currency: "USD" } })).id;
  acme = (await db.client.create({ data: { organizationId: org, name: "Acme" } })).id;
  other = (await db.client.create({ data: { organizationId: org, name: "Other Co" } })).id;
  const mkContent = (title: string, status: string) => db.contentItem.create({ data: { organizationId: org, clientId: acme, platform: "INSTAGRAM", title, copy: "c", status, createdById: "author" } });
  draft = (await mkContent("Draft", "DRAFT")).id;
  inReview = (await mkContent("In review", "CLIENT_REVIEW")).id;
  empUser = (await db.user.create({ data: { id: "emp-user-1", organizationId: org, name: "Emp One", email: "emp-user-1@files.test", passwordHash: "x" } })).id;
  await db.employeeProfile.create({ data: { organizationId: org, userId: empUser, employeeNo: "E-1" } });
});
afterAll(async () => {
  await db.$disconnect();
});

describe("storage", () => {
  it("only accepts server-generated keys and never overwrites", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hifi-files-"));
    const disk = new LocalDiskStorage(dir);
    const key = newStorageKey();
    await disk.put(key, Buffer.from("one"));
    expect((await disk.get(key)).toString()).toBe("one");
    await expect(disk.put(key, Buffer.from("two"))).rejects.toThrow();
    for (const bad of ["../x", "2026/10/../../x", "/etc/passwd", "2026/10/abc", "..\\..\\x"]) await expect(disk.get(bad)).rejects.toThrow(/Invalid storage key/);
    await disk.delete(key);
    await expect(disk.get(key)).rejects.toThrow();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("expense receipts", () => {
  it("the submitter can attach receipts while the voucher is open; strangers cannot", async () => {
    const f = await saveFile(db, storage, { actor: submitter(), ownerType: "EXPENSE", ownerId: voucher, name: "receipt.pdf", bytes: pdf() });
    expect(f.contentType).toBe("application/pdf");
    expect(f.sha256).toHaveLength(64);
    await expect(saveFile(db, storage, { actor: actor({ id: "stranger" }), ownerType: "EXPENSE", ownerId: voucher, name: "x.pdf", bytes: pdf() })).rejects.toThrow(/cannot add files/);
    expect(await listFiles(db, actor({ id: "stranger" }), "EXPENSE", voucher)).toEqual([]);
    expect((await listFiles(db, submitter(), "EXPENSE", voucher)).length).toBe(1);
    expect((await listFiles(db, reviewer(), "EXPENSE", voucher)).length).toBe(1);
  });
  it("invalid files are refused before anything is stored", async () => {
    const before = storage.files.size;
    await expect(saveFile(db, storage, { actor: submitter(), ownerType: "EXPENSE", ownerId: voucher, name: "evil.html", bytes: Buffer.from("<script>") })).rejects.toThrow(FileError);
    await expect(saveFile(db, storage, { actor: submitter(), ownerType: "EXPENSE", ownerId: voucher, name: "fake.pdf", bytes: Buffer.from("not a pdf") })).rejects.toThrow(/do not match/);
    await expect(saveFile(db, storage, { actor: submitter(), ownerType: "NOTHING", ownerId: voucher, name: "a.pdf", bytes: pdf() })).rejects.toThrow(/Unknown record/);
    expect(storage.files.size).toBe(before);
  });
  it("a file you may not read looks like one that does not exist", async () => {
    const f = (await listFiles(db, submitter(), "EXPENSE", voucher))[0];
    expect(await openFile(db, storage, actor({ id: "stranger" }), f.id)).toBeNull();
    expect(await openFile(db, storage, actor({ id: "x", organizationId: otherOrg, perms: ["expenses.view"] }), f.id)).toBeNull(); // another organization
    const ok = await openFile(db, storage, reviewer(), f.id);
    expect(ok!.bytes.subarray(0, 4).toString()).toBe("%PDF");
  });
  it("after the voucher is posted the submitter can no longer add or remove receipts", async () => {
    await db.expenseVoucher.update({ where: { id: voucher }, data: { status: "POSTED" } });
    await expect(saveFile(db, storage, { actor: submitter(), ownerType: "EXPENSE", ownerId: voucher, name: "late.pdf", bytes: pdf(2) })).rejects.toThrow(/cannot add files/);
    const f = (await listFiles(db, submitter(), "EXPENSE", voucher))[0];
    await expect(deleteFile(db, submitter(), f.id)).rejects.toThrow(/cannot remove/);
    await db.expenseVoucher.update({ where: { id: voucher }, data: { status: "SUBMITTED" } });
  });
});

describe("vendor bills", () => {
  it("a vendor reaches only its own bills", async () => {
    const vA = actor({ id: "va", userType: "VENDOR", vendorId: vendorA });
    const vB = actor({ id: "vb", userType: "VENDOR", vendorId: vendorB });
    const f = await saveFile(db, storage, { actor: vA, ownerType: "VENDOR_BILL", ownerId: bill, name: "invoice.pdf", bytes: pdf(3) });
    await expect(saveFile(db, storage, { actor: vA, ownerType: "VENDOR_BILL", ownerId: otherBill, name: "x.pdf", bytes: pdf() })).rejects.toThrow(/cannot add files/);
    expect(await openFile(db, storage, vB, f.id)).toBeNull();
    expect(await openFile(db, storage, vA, f.id)).not.toBeNull();
    expect(await openFile(db, storage, actor({ perms: ["vendors.view"] }), f.id)).not.toBeNull();
    expect(await openFile(db, storage, actor({ id: "client-user", userType: "CLIENT", clientId: acme }), f.id)).toBeNull();
  });
  it("a vendor cannot change files once the bill is approved", async () => {
    await db.vendorBill.update({ where: { id: bill }, data: { status: "APPROVED" } });
    await expect(saveFile(db, storage, { actor: actor({ id: "va", userType: "VENDOR", vendorId: vendorA }), ownerType: "VENDOR_BILL", ownerId: bill, name: "x.pdf", bytes: pdf(4) })).rejects.toThrow(/cannot add files/);
  });
});

describe("content media", () => {
  it("clients see media only once content reaches client review, and only their own", async () => {
    const staff = actor({ id: "designer", perms: ["content.manage", "content.view"] });
    const f = await saveFile(db, storage, { actor: staff, ownerType: "CONTENT", ownerId: draft, name: "reel.mp4", bytes: Buffer.concat([Buffer.alloc(4), Buffer.from("ftyp"), Buffer.alloc(30)]) });
    const g = await saveFile(db, storage, { actor: staff, ownerType: "CONTENT", ownerId: inReview, name: "post.png", bytes: Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(20)]) }).catch((e) => e);
    // in client review the copy is locked, so staff cannot add media either
    expect(g).toBeInstanceOf(FileError);
    const client = (clientId: string) => actor({ id: `c-${clientId}`, userType: "CLIENT", clientId });
    expect(await openFile(db, storage, client(acme), f.id)).toBeNull(); // draft: hidden from the client
    await db.contentItem.update({ where: { id: draft }, data: { status: "CLIENT_REVIEW" } });
    expect(await openFile(db, storage, client(acme), f.id)).not.toBeNull();
    expect(await openFile(db, storage, client(other), f.id)).toBeNull(); // another client
  });
});

describe("employee documents", () => {
  it("only the employee and sensitive-data HR can read them; the employee can add their own", async () => {
    const self = actor({ id: empUser });
    const f = await saveFile(db, storage, { actor: self, ownerType: "EMPLOYEE", ownerId: empUser, name: "passport.pdf", bytes: pdf(5), category: "Identity", expiresOn: "2030-01-01" });
    expect(f.expiresOn).toBe("2030-01-01");
    expect(await openFile(db, storage, actor({ id: "manager", perms: ["hr.view", "leave.approve"] }), f.id)).toBeNull();
    expect(await openFile(db, storage, actor({ id: "hr", perms: ["hr.view_sensitive"] }), f.id)).not.toBeNull();
    await expect(saveFile(db, storage, { actor: actor({ id: "colleague" }), ownerType: "EMPLOYEE", ownerId: empUser, name: "x.pdf", bytes: pdf() })).rejects.toThrow(/cannot add files/);
    await expect(saveFile(db, storage, { actor: self, ownerType: "EMPLOYEE", ownerId: empUser, name: "x.pdf", bytes: pdf(6), expiresOn: "soon" })).rejects.toThrow(/expiry/);
  });
  it("only HR can delete employee documents, and deletion is soft until the retention purge", async () => {
    const f = (await listFiles(db, actor({ perms: ["hr.view_sensitive"] }), "EMPLOYEE", empUser))[0];
    await expect(deleteFile(db, actor({ id: "colleague" }), f.id)).rejects.toThrow(/cannot remove/);
    await deleteFile(db, actor({ id: "hr", perms: ["hr.manage"] }), f.id);
    expect(await openFile(db, storage, actor({ perms: ["hr.view_sensitive"] }), f.id)).toBeNull();
    expect(storage.files.has(f.storageKey)).toBe(true); // bytes still there
    expect(await purgeDeleted(db, storage, 30)).toBe(0); // too recent
    expect(await purgeDeleted(db, storage, 30, new Date(Date.now() + 31 * 86400000))).toBe(1);
    expect(storage.files.has(f.storageKey)).toBe(false);
    expect(await db.storedFile.count({ where: { id: f.id } })).toBe(0);
  });
});

describe("signed download links", () => {
  const secret = "test-secret-test-secret-test-secret-1";
  it("work for the named person until they expire", () => {
    const t = signDownload("file1", "user1", secret, 600, 1_000_000);
    expect(verifyDownload(t, secret, 1_000_000 + 599_000)).toEqual({ fileId: "file1", userId: "user1" });
    expect(verifyDownload(t, secret, 1_000_000 + 601_000)).toBeNull();
  });
  it("fail when altered or signed with another secret", () => {
    const t = signDownload("file1", "user1", secret, 600, 1_000_000);
    expect(verifyDownload(t, "another-secret-another-secret-123456", 1_000_000)).toBeNull();
    const [p, s] = t.split(".");
    const forged = Buffer.from(Buffer.from(p, "base64url").toString().replace("user1", "user2")).toString("base64url") + "." + s;
    expect(verifyDownload(forged, secret, 1_000_000)).toBeNull();
    expect(verifyDownload("garbage", secret)).toBeNull();
    expect(verifyDownload("", secret)).toBeNull();
  });
});
