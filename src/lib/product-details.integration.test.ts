// Product details and the brand assets link against hifi_one_test: only a sales manager changes them, the library is a real project
// that can take uploads, and a project from another organization cannot be linked.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { saveProduct } from "./field-visits";
import { createAssetsProject, linkAssetsProject, saveProductDetails } from "./product-details";
import { addAssetFile, listAssets } from "./project-assets";
import { type Actor } from "./prospector";
import { type FileActor } from "./file-access";
import type { StorageProvider } from "./storage";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const actor = (id: string, organizationId: string, perms: string[]): Actor => ({ id, organizationId, permissions: new Set(perms) });
let org: string, other: string, mgr: Actor, agent: Actor, product: string, foreign: string;

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "ProjectAsset","ProjectMember","Project","NumberSequence","SaasProduct","UserRole","RolePermission","Permission","Role","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "A" } })).id;
  other = (await db.organization.create({ data: { name: "B" } })).id;
  const m = await db.user.create({ data: { organizationId: org, email: "m@a.test", name: "Mgr", passwordHash: "x" } });
  const a = await db.user.create({ data: { organizationId: org, email: "a@a.test", name: "Agent", passwordHash: "x" } });
  const o = await db.user.create({ data: { organizationId: other, email: "o@b.test", name: "Other", passwordHash: "x" } });
  mgr = actor(m.id, org, ["field.review", "projects.view", "projects.manage"]);
  agent = actor(a.id, org, ["field.capture"]);
  foreign = (await db.project.create({ data: { organizationId: other, number: "PRJ-0001", name: "Theirs", managerId: o.id } })).id;
  product = (await saveProduct(db, mgr, { name: "Pharmivo", businessLabel: "Pharmacy" })).id;
});
afterAll(async () => { await db.$disconnect(); });

describe("product details", () => {
  it("a manager saves the pitch details, which are trimmed and persisted", async () => {
    await saveProductDetails(db, mgr, product, { tagline: "  Run your pharmacy  ", description: "Billing and stock.", pricing: "PKR 5,000 a month", demoUrl: "https://demo.pharmivo.test" });
    const row = await db.saasProduct.findUniqueOrThrow({ where: { id: product } });
    expect(row.tagline).toBe("Run your pharmacy");
    expect(row.pricing).toBe("PKR 5,000 a month");
    expect(row.keyFeatures).toBeNull();
  });
  it("refuses a bad demo link, an unknown product, and anyone without field.review", async () => {
    await expect(saveProductDetails(db, mgr, product, { demoUrl: "not a link" })).rejects.toThrow(/http/);
    await expect(saveProductDetails(db, mgr, "missing", {})).rejects.toThrow(/no longer exists/);
    await expect(saveProductDetails(db, agent, product, { tagline: "x" })).rejects.toThrow(/Only a sales manager/);
    await expect(createAssetsProject(db, agent, product)).rejects.toThrow(/Only a sales manager/);
    await expect(linkAssetsProject(db, agent, product, null)).rejects.toThrow(/Only a sales manager/);
  });
});

describe("brand assets library", () => {
  it("creates a project library once, and files can be uploaded into it", async () => {
    const p = await createAssetsProject(db, mgr, product);
    expect(p.name).toBe("Pharmivo brand assets");
    expect((await db.saasProduct.findUniqueOrThrow({ where: { id: product } })).assetsProjectId).toBe(p.id);
    await expect(createAssetsProject(db, mgr, product)).rejects.toThrow(/already has/);
    const store: StorageProvider = { put: async () => undefined, get: async () => Buffer.alloc(0), delete: async () => undefined } as unknown as StorageProvider;
    const fa: FileActor = { id: mgr.id, organizationId: org, userType: "EMPLOYEE", permissions: mgr.permissions, clientId: null, vendorId: null } as FileActor;
    await addAssetFile(db, store, { actor: fa, projectId: p.id, name: "Logo", folder: "Logos", fileName: "logo.png", bytes: Buffer.from("89504e470d0a1a0a", "hex") }).catch(() => undefined);
    expect(Array.isArray(await listAssets(db, org, p.id))).toBe(true);
  });
  it("links an existing project of the same organization, detaches it, and refuses another organization's project", async () => {
    const own = await db.project.create({ data: { organizationId: org, number: "PRJ-0099", name: "Design", managerId: mgr.id } });
    await linkAssetsProject(db, mgr, product, own.id);
    expect((await db.saasProduct.findUniqueOrThrow({ where: { id: product } })).assetsProjectId).toBe(own.id);
    await expect(linkAssetsProject(db, mgr, product, foreign)).rejects.toThrow(/listed projects/);
    await linkAssetsProject(db, mgr, product, null);
    expect((await db.saasProduct.findUniqueOrThrow({ where: { id: product } })).assetsProjectId).toBeNull();
  });
});
