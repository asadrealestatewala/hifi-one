// Proof of payment on a recorded payment: finance staff only, never the client's portal, never another organization.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { authorizeOwner, type FileActor } from "./file-access";
import { deleteFile, FileError, listFiles, saveFile } from "./files";
import { MemoryStorage } from "./storage";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const storage = new MemoryStorage();
let org: string, other: string, staff: string, client: string, payment: string;

const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(300, 32), Buffer.from("\n%%EOF")]);
const actor = (over: Partial<FileActor> = {}): FileActor => ({ id: staff, organizationId: org, userType: "EMPLOYEE", clientId: null, vendorId: null, permissions: new Set(["finance.view", "finance.post"]), ...over });

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "StoredFile","PaymentAllocation","Payment","BankAccount","Client","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Proof Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other Org" } })).id;
  staff = (await db.user.create({ data: { organizationId: org, email: "f@proof.test", name: "Fin", passwordHash: "x" } })).id;
  client = (await db.client.create({ data: { organizationId: org, name: "Biztrack UK" } })).id;
  const bank = await db.bankAccount.create({ data: { organizationId: org, internalName: "Meezan", bankName: "Meezan Bank", accountHolder: "Hifi", accountNumber: "0833", currency: "PKR" } });
  payment = (await db.payment.create({ data: { organizationId: org, number: "RCT-000001", clientId: client, bankAccountId: bank.id, currency: "PKR", amount: "45000", date: new Date("2026-11-14"), idempotencyKey: "proof-test-1" } })).id;
});
afterAll(async () => { await db.$disconnect(); });

describe("proof of payment", () => {
  it("finance staff who post payments can attach and list it", async () => {
    const f = await saveFile(db, storage, { actor: actor(), ownerType: "PAYMENT", ownerId: payment, name: "transfer.pdf", bytes: PDF, category: "Proof of payment", scanner: null });
    expect(f.ownerType).toBe("PAYMENT");
    expect((await listFiles(db, actor(), "PAYMENT", payment)).map((x) => x.id)).toEqual([f.id]);
  });
  it("view-only finance can see it but not add or remove", async () => {
    const viewer = actor({ id: "viewer", permissions: new Set(["finance.view"]) });
    expect(await authorizeOwner(db, viewer, "PAYMENT", payment, "read")).toBe(true);
    expect(await authorizeOwner(db, viewer, "PAYMENT", payment, "upload")).toBe(false);
    await expect(saveFile(db, storage, { actor: viewer, ownerType: "PAYMENT", ownerId: payment, name: "x.pdf", bytes: PDF, scanner: null })).rejects.toThrow(FileError);
    const [f] = await listFiles(db, actor(), "PAYMENT", payment);
    await expect(deleteFile(db, viewer, f.id)).rejects.toThrow(FileError);
  });
  it("is denied to the client, to staff without finance access and to another organization", async () => {
    expect(await authorizeOwner(db, actor({ userType: "CLIENT", clientId: client, permissions: new Set(["finance.view", "finance.post"]) }), "PAYMENT", payment, "read")).toBe(false);
    expect(await authorizeOwner(db, actor({ permissions: new Set(["crm.view"]) }), "PAYMENT", payment, "read")).toBe(false);
    expect(await authorizeOwner(db, actor({ organizationId: other }), "PAYMENT", payment, "read")).toBe(false);
    expect(await authorizeOwner(db, actor(), "PAYMENT", "no-such-payment", "upload")).toBe(false);
  });
});
