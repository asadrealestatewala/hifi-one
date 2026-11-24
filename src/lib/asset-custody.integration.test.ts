// Company items in staff hands (HR's register) against hifi_one_test: record outside the books, issue, confirm, take back,
// write off, the equipment-request link, the exit check, and that none of it touches the ledger or depreciation.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { acknowledgeItem, issueItem, itemsHeldBy, recordItem, returnItem, updateItem, writeOffItem } from "./asset-custody";
import { disposeAsset, registerAsset, runDepreciation } from "./assets";
import { authorizeOwner, type FileActor } from "./file-access";
import { ROLE_DEFS } from "./permissions";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });

let org: string;
let otherOrg: string;
let emp: string;
let emp2: string;
let hr: string;
let leaver: string;
let bank: string;

beforeAll(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE "DepreciationEntry","AssetAssignment","Asset","EmployeeRequest","StoredFile","JournalLine","JournalEntry","BankAccount","Account","NumberSequence","EmployeeProfile","UserRole","User","Role","Organization" CASCADE',
  );
  org = (await db.organization.create({ data: { name: "Custody Org", baseCurrency: "PKR" } })).id;
  otherOrg = (await db.organization.create({ data: { name: "Other Org" } })).id;
  const mk = async (name: string, status = "ACTIVE") => {
    const u = await db.user.create({ data: { organizationId: org, name, email: `${name.toLowerCase()}@c.example`, passwordHash: "x", userType: "EMPLOYEE" } });
    await db.employeeProfile.create({ data: { organizationId: org, userId: u.id, employeeNo: `E-${name}`, status } });
    return u.id;
  };
  emp = await mk("Aamir");
  emp2 = await mk("Bushra");
  hr = await mk("Aqsa");
  leaver = await mk("Left", "EXITED");
  const acc = (code: string, name: string, type: string, systemKey?: string) => db.account.create({ data: { organizationId: org, code, name, type, systemKey } });
  await acc("1500", "Fixed assets", "ASSET", "FIXED_ASSETS");
  await acc("1590", "Accum depreciation", "ASSET", "ACCUM_DEPRECIATION");
  await acc("6040", "Depreciation", "OPEX", "DEPRECIATION_EXPENSE");
  await acc("2000", "AP", "LIABILITY", "ACCOUNTS_PAYABLE");
  const cash = await acc("1100", "Bank PKR", "ASSET");
  bank = (await db.bankAccount.create({ data: { organizationId: org, internalName: "PKR", bankName: "B", accountHolder: "H", accountNumber: "1", currency: "PKR", ledgerAccountId: cash.id } })).id;
});
afterAll(async () => {
  await db.$disconnect();
});

const sim = (extra: Partial<Parameters<typeof recordItem>[1]> = {}) =>
  recordItem(db, { organizationId: org, actorId: hr, name: "Jazz SIM", category: "SIM", serialNumber: "8992", currency: "PKR", ...extra });

describe("recording an item outside the books", () => {
  it("creates a register entry with no journal and validates input", async () => {
    const a = await sim();
    expect(a.number).toBe("AST-0001");
    expect(a.inBooks).toBe(false);
    expect(a.condition).toBe("NEW");
    expect(a.purchaseEntryId).toBeNull();
    expect(await db.journalEntry.count({ where: { organizationId: org } })).toBe(0);
    await expect(sim({ name: "x" })).rejects.toThrow(/name/);
    await expect(sim({ category: "Spaceship" })).rejects.toThrow(/category/);
    await expect(sim({ condition: "SHINY" })).rejects.toThrow(/condition/);
    await expect(sim({ cost: "abc" })).rejects.toThrow(/cost/);
  });

  it("shares one number series with fixed assets bought through the books", async () => {
    const fa = await registerAsset(db, { organizationId: org, actorId: hr, name: "Dell laptop", purchaseDate: "2026-11-01", cost: "150000", currency: "PKR", usefulLifeMonths: 36, payment: { kind: "BANK", bankAccountId: bank } });
    expect(fa.number).toBe("FA-0002");
    expect((await sim({ name: "Mouse", category: "Accessory" })).number).toBe("AST-0003");
  });

  it("is never depreciated and cannot be disposed of through Finance", async () => {
    await sim({ name: "Chair", category: "Furniture", cost: "20000", purchaseDate: "2026-01-01" });
    await runDepreciation(db, { organizationId: org, upTo: "2026-11", actorId: hr });
    const hrIds = (await db.asset.findMany({ where: { organizationId: org, inBooks: false } })).map((a) => a.id);
    expect(await db.depreciationEntry.count({ where: { assetId: { in: hrIds } } })).toBe(0);
    expect(await db.depreciationEntry.count()).toBeGreaterThan(0); // the laptop in the books was depreciated
    await expect(disposeAsset(db, { organizationId: org, assetId: hrIds[0], date: "2026-11-24", proceeds: "0", actorId: hr })).rejects.toThrow(/not in the books/);
  });
});

describe("handover", () => {
  it("issues to an active employee, who confirms receipt once", async () => {
    const a = await sim({ name: "Samsung A15", category: "Phone" });
    const { assignment } = await issueItem(db, { organizationId: org, assetId: a.id, userId: emp, actorId: hr, condition: "GOOD" });
    expect(assignment.issuedById).toBe(hr);
    expect(assignment.conditionOut).toBe("GOOD");
    expect(assignment.acknowledgedAt).toBeNull();
    // Already with someone: must be taken back first
    await expect(issueItem(db, { organizationId: org, assetId: a.id, userId: emp2, actorId: hr })).rejects.toThrow(/Take it back first/);
    // Somebody else cannot confirm it
    await expect(acknowledgeItem(db, { organizationId: org, assignmentId: assignment.id, userId: emp2 })).rejects.toThrow(/not with you/);
    const ok = await acknowledgeItem(db, { organizationId: org, assignmentId: assignment.id, userId: emp });
    expect(ok.acknowledgedAt).not.toBeNull();
    const again = await acknowledgeItem(db, { organizationId: org, assignmentId: assignment.id, userId: emp });
    expect(again.acknowledgedAt!.getTime()).toBe(ok.acknowledgedAt!.getTime());
    const held = await itemsHeldBy(db, org, emp);
    expect(held.map((h) => h.name)).toContain("Samsung A15");
    expect(held.find((h) => h.name === "Samsung A15")!.handover!.id).toBe(assignment.id);
  });

  it("refuses people who left, other organizations and closed items", async () => {
    const a = await sim({ name: "Monitor", category: "Monitor" });
    await expect(issueItem(db, { organizationId: org, assetId: a.id, userId: leaver, actorId: hr })).rejects.toThrow(/left the company/);
    await expect(issueItem(db, { organizationId: otherOrg, assetId: a.id, userId: emp, actorId: hr })).rejects.toThrow(/not found/);
    const outsider = (await db.user.create({ data: { organizationId: otherOrg, name: "O", email: "o@o.example", passwordHash: "x", userType: "EMPLOYEE" } })).id;
    await expect(issueItem(db, { organizationId: org, assetId: a.id, userId: outsider, actorId: hr })).rejects.toThrow(/active member of staff/);
  });

  it("takes an item back with its condition and closes the handover", async () => {
    const a = await db.asset.findFirstOrThrow({ where: { organizationId: org, name: "Samsung A15" } });
    await expect(returnItem(db, { organizationId: org, assetId: a.id, actorId: hr, condition: "BROKEN" })).rejects.toThrow(/condition/);
    const { asset, fromUserId } = await returnItem(db, { organizationId: org, assetId: a.id, actorId: hr, condition: "FAIR", note: "Scratched screen" });
    expect(fromUserId).toBe(emp);
    expect(asset.assignedToId).toBeNull();
    expect(asset.condition).toBe("FAIR");
    const h = await db.assetAssignment.findFirstOrThrow({ where: { assetId: a.id } });
    expect(h.returnedAt).not.toBeNull();
    expect(h.returnedById).toBe(hr);
    expect(h.conditionIn).toBe("FAIR");
    await expect(returnItem(db, { organizationId: org, assetId: a.id, actorId: hr, condition: "GOOD" })).rejects.toThrow(/already in stock/);
  });

  it("records an item that never came back and lets HR write it off, keeping the history", async () => {
    const a = await sim({ name: "Office key", category: "Access card or key" });
    await issueItem(db, { organizationId: org, assetId: a.id, userId: emp2, actorId: hr });
    await expect(returnItem(db, { organizationId: org, assetId: a.id, actorId: hr, condition: "LOST" })).rejects.toThrow(/what happened/);
    await returnItem(db, { organizationId: org, assetId: a.id, actorId: hr, condition: "LOST", note: "Lost on the bus" });
    await expect(writeOffItem(db, { organizationId: org, assetId: a.id, actorId: hr, reason: "MISPLACED" })).rejects.toThrow(/why/);
    const w = await writeOffItem(db, { organizationId: org, assetId: a.id, actorId: hr, reason: "LOST", note: "Lost on the bus" });
    expect(w.status).toBe("DISPOSED");
    expect(w.writeOffReason).toBe("LOST: Lost on the bus");
    expect(await db.assetAssignment.count({ where: { assetId: a.id } })).toBe(1);
    await expect(issueItem(db, { organizationId: org, assetId: a.id, userId: emp, actorId: hr })).rejects.toThrow(/written off/);
    await expect(updateItem(db, { organizationId: org, assetId: a.id, condition: "GOOD" })).rejects.toThrow(/closed/);
    expect(await db.journalEntry.count({ where: { sourceId: a.id } })).toBe(0);
  });

  it("does not let HR write off an item in the books", async () => {
    const fa = await db.asset.findFirstOrThrow({ where: { organizationId: org, inBooks: true } });
    await expect(writeOffItem(db, { organizationId: org, assetId: fa.id, actorId: hr, reason: "LOST" })).rejects.toThrow(/Finance disposes/);
  });

  it("lets HR keep the physical details of an item in the books, not its name", async () => {
    const fa = await db.asset.findFirstOrThrow({ where: { organizationId: org, inBooks: true } });
    const u = await updateItem(db, { organizationId: org, assetId: fa.id, name: "Renamed", serialNumber: "SN-9", condition: "FAIR", location: "Islamabad" });
    expect(u.name).toBe("Dell laptop");
    expect(u.serialNumber).toBe("SN-9");
    expect(u.location).toBe("Islamabad");
  });
});

describe("equipment requests", () => {
  it("issuing against an open equipment request approves it in the same step", async () => {
    const r = await db.employeeRequest.create({ data: { organizationId: org, userId: emp, type: "EQUIPMENT", subject: "Need a headset", body: "For calls" } });
    const a = await sim({ name: "Headset", category: "Accessory" });
    const { assignment } = await issueItem(db, { organizationId: org, assetId: a.id, userId: emp, actorId: hr, requestId: r.id });
    expect(assignment.requestId).toBe(r.id);
    const after = await db.employeeRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.status).toBe("APPROVED");
    expect(after.handledById).toBe(hr);
    expect(after.responseNote).toMatch(/Issued AST-/);
  });

  it("refuses a request from someone else, of another type, or already answered, and issues nothing", async () => {
    const a = await sim({ name: "Webcam", category: "Accessory" });
    const other = await db.employeeRequest.create({ data: { organizationId: org, userId: emp2, type: "EQUIPMENT", subject: "Webcam", body: "x" } });
    const cert = await db.employeeRequest.create({ data: { organizationId: org, userId: emp, type: "SALARY_CERTIFICATE", subject: "Cert", body: "x" } });
    const done = await db.employeeRequest.create({ data: { organizationId: org, userId: emp, type: "EQUIPMENT", subject: "Old", body: "x", status: "DECLINED" } });
    const own = await db.employeeRequest.create({ data: { organizationId: org, userId: hr, type: "EQUIPMENT", subject: "Mine", body: "x" } });
    await expect(issueItem(db, { organizationId: org, assetId: a.id, userId: emp, actorId: hr, requestId: other.id })).rejects.toThrow(/someone else/);
    await expect(issueItem(db, { organizationId: org, assetId: a.id, userId: emp, actorId: hr, requestId: cert.id })).rejects.toThrow(/not found/);
    await expect(issueItem(db, { organizationId: org, assetId: a.id, userId: emp, actorId: hr, requestId: done.id })).rejects.toThrow(/already been answered/);
    await expect(issueItem(db, { organizationId: org, assetId: a.id, userId: hr, actorId: hr, requestId: own.id })).rejects.toThrow(/your own application/);
    expect((await db.asset.findUniqueOrThrow({ where: { id: a.id } })).assignedToId).toBeNull();
    expect(await db.assetAssignment.count({ where: { assetId: a.id } })).toBe(0);
  });
});

describe("who may see and change company items", () => {
  const actor = (id: string, perms: string[]): FileActor => ({ id, organizationId: org, userType: "EMPLOYEE", clientId: null, vendorId: null, permissions: new Set(perms) });
  it("files on an item: HR and Finance read, the holder reads, only custody adds", async () => {
    const a = await db.asset.findFirstOrThrow({ where: { organizationId: org, name: "Headset" } }); // with emp
    expect(await authorizeOwner(db, actor(hr, ["assets.custody"]), "ASSET", a.id, "upload")).toBe(true);
    expect(await authorizeOwner(db, actor("fin", ["assets.view"]), "ASSET", a.id, "read")).toBe(true);
    expect(await authorizeOwner(db, actor("fin", ["assets.view"]), "ASSET", a.id, "upload")).toBe(false);
    expect(await authorizeOwner(db, actor(emp, []), "ASSET", a.id, "read")).toBe(true);
    expect(await authorizeOwner(db, actor(emp, []), "ASSET", a.id, "upload")).toBe(false);
    expect(await authorizeOwner(db, actor(emp2, []), "ASSET", a.id, "read")).toBe(false);
  });

  it("HR roles and Finance can look after company items; other staff cannot", () => {
    const perms = (k: string) => ROLE_DEFS.find((r) => r.key === k)!.permissions;
    for (const k of ["HR_MANAGER", "HR_COORDINATOR", "FINANCE_MANAGER", "ACCOUNTANT"]) expect(perms(k)).toContain("assets.custody");
    for (const k of ["SALES_AGENT", "GRAPHIC_DESIGNER", "PROJECT_MANAGER"]) expect(perms(k)).not.toContain("assets.custody");
    // HR never gets Finance's book values through this
    expect(perms("HR_COORDINATOR")).not.toContain("assets.view");
  });
});
