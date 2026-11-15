// Contracts shown on the client portal: who can see them and their files, and the rules for sharing.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { authorizeOwner, type FileActor } from "./file-access";
import { SalesError, portalContracts, setContractShared, setContractStatus } from "./sales";
import { contractShared } from "./events";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, elan: string, ace: string, sow: string, draft: string, portalUser: string, foreignUser: string;
const client = (clientId: string, id: string): FileActor => ({ id, organizationId: org, userType: "CLIENT", clientId, vendorId: null, permissions: new Set() });
const staff = (perms: string[]): FileActor => ({ id: "staff", organizationId: org, userType: "EMPLOYEE", clientId: null, vendorId: null, permissions: new Set(perms) });

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "Notification","Contract","User","Client","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Agency" } })).id;
  other = (await db.organization.create({ data: { name: "Other" } })).id;
  elan = (await db.client.create({ data: { organizationId: org, name: "HB Elan" } })).id;
  ace = (await db.client.create({ data: { organizationId: org, name: "Ace" } })).id;
  portalUser = (await db.user.create({ data: { organizationId: org, name: "Mr Babar", phone: "+920000000001", passwordHash: "x", userType: "CLIENT", clientId: elan } })).id;
  foreignUser = (await db.user.create({ data: { organizationId: org, name: "Ace Owner", email: "ace@c.test", passwordHash: "x", userType: "CLIENT", clientId: ace } })).id;
  sow = (await db.contract.create({ data: { organizationId: org, clientId: elan, title: "Scope of work", startDate: "2026-11-13", endDate: "2027-02-12" } })).id;
  draft = (await db.contract.create({ data: { organizationId: org, clientId: elan, title: "Unsigned renewal" } })).id;
});
afterAll(async () => { await db.$disconnect(); });

describe("showing a contract to the client", () => {
  it("refuses a draft, so only what was agreed reaches the portal", async () => {
    await expect(setContractShared(db, { organizationId: org, contractId: sow, shared: true })).rejects.toBeInstanceOf(SalesError);
    expect(await portalContracts(db, elan)).toHaveLength(0);
  });

  it("hides an unshared contract's files from the client", async () => {
    await setContractStatus(db, { organizationId: org, contractId: sow, to: "ACTIVE" });
    expect(await authorizeOwner(db, client(elan, portalUser), "CONTRACT", sow, "read")).toBe(false);
  });

  it("once shared, the client sees it and can read (never change) its files; other clients and organizations cannot", async () => {
    const r = await setContractShared(db, { organizationId: org, contractId: sow, shared: true });
    expect(r.changed).toBe(true);
    expect(r.contract.sharedAt).not.toBeNull();
    expect((await portalContracts(db, elan)).map((c) => c.id)).toEqual([sow]);
    expect(await portalContracts(db, ace)).toHaveLength(0);
    expect(await authorizeOwner(db, client(elan, portalUser), "CONTRACT", sow, "read")).toBe(true);
    expect(await authorizeOwner(db, client(elan, portalUser), "CONTRACT", sow, "upload")).toBe(false);
    expect(await authorizeOwner(db, client(elan, portalUser), "CONTRACT", sow, "delete")).toBe(false);
    expect(await authorizeOwner(db, client(ace, foreignUser), "CONTRACT", sow, "read")).toBe(false);
    expect(await authorizeOwner(db, client(elan, portalUser), "CONTRACT", draft, "read")).toBe(false);
    expect(await authorizeOwner(db, { ...client(elan, portalUser), organizationId: other }, "CONTRACT", sow, "read")).toBe(false);
    // staff rights are unchanged
    expect(await authorizeOwner(db, staff(["contracts.view"]), "CONTRACT", sow, "read")).toBe(true);
    expect(await authorizeOwner(db, staff([]), "CONTRACT", sow, "read")).toBe(false);
  });

  it("tells the client's portal users once, and nobody else", async () => {
    await contractShared(db, { organizationId: org, contractId: sow });
    await contractShared(db, { organizationId: org, contractId: sow });
    expect((await db.notification.findMany({ where: { userId: portalUser } })).map((n) => n.link)).toEqual(["/portal/agreements"]);
    expect(await db.notification.count({ where: { userId: foreignUser } })).toBe(0);
  });

  it("sharing again changes nothing; hiding takes it off the portal and closes file access", async () => {
    expect((await setContractShared(db, { organizationId: org, contractId: sow, shared: true })).changed).toBe(false);
    const r = await setContractShared(db, { organizationId: org, contractId: sow, shared: false });
    expect(r.changed).toBe(true);
    expect(r.contract.sharedAt).toBeNull();
    expect(await portalContracts(db, elan)).toHaveLength(0);
    expect(await authorizeOwner(db, client(elan, portalUser), "CONTRACT", sow, "read")).toBe(false);
  });

  it("cannot reach a contract in another organization", async () => {
    await expect(setContractShared(db, { organizationId: other, contractId: sow, shared: true })).rejects.toThrow("Contract not found.");
  });
});
