import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { FileActor } from "./file-access";
import { MemoryStorage } from "./storage";
import { openFile } from "./files";
import {
  AssetError, addAssetFile, checkSharePassword, createShare, deleteAsset, fileForShare, hashSharePassword, isUnlocked, listAssets, makeUnlock,
  resolveShare, revokeShare, shareContent, updateAsset,
} from "./project-assets";
import { ASSET_MAX_BYTES, validateUpload } from "./file-validation";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const storage = new MemoryStorage();
let org: string, other: string, project: string, project2: string;
let pm: FileActor, member: FileActor, outsider: FileActor, clientUser: FileActor, otherOrg: FileActor;

const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from("fake image body")]);
const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from("body")]);
const mp4 = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypisom"), Buffer.alloc(40)]);
const svgOk = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>');

const actor = (id: string, organizationId: string, perms: string[], userType = "EMPLOYEE", clientId: string | null = null): FileActor => ({ id, organizationId, userType, clientId, vendorId: null, permissions: new Set(perms) });

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "ProjectAssetShare","ProjectAsset","StoredFile","ProjectMember","Project","UserRole","RolePermission","Role","Permission","User","CompanyProfile","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Assets Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other Org" } })).id;
  const mk = async (email: string, o: string, extra: object = {}) => (await db.user.create({ data: { organizationId: o, email, name: email.split("@")[0], passwordHash: "x", ...extra } })).id;
  const pmId = await mk("pm@a.test", org), memberId = await mk("designer@a.test", org), outId = await mk("out@a.test", org), cId = await mk("client@a.test", org, { userType: "CLIENT" }), oId = await mk("o@a.test", other);
  project = (await db.project.create({ data: { organizationId: org, number: "P-1", name: "Brand refresh", managerId: pmId, members: { create: { userId: memberId } } } })).id;
  project2 = (await db.project.create({ data: { organizationId: org, number: "P-2", name: "Other project", managerId: pmId } })).id;
  pm = actor(pmId, org, ["projects.view", "projects.manage", "tasks.edit"]);
  member = actor(memberId, org, ["projects.view", "tasks.edit"]);
  outsider = actor(outId, org, ["projects.view", "tasks.edit"]); // staff, but not on the project
  clientUser = actor(cId, org, ["projects.view"], "CLIENT", "c1");
  otherOrg = actor(oId, other, ["projects.view", "projects.manage", "tasks.edit"]);
});
afterAll(async () => { await db.$disconnect(); });

describe("project asset library", () => {
  it("lets a project member add files, keeps versions, and the newest is current", async () => {
    const a = await addAssetFile(db, storage, { actor: member, projectId: project, name: "Primary logo", folder: "Logos", tags: "Logo, dark, logo", fileName: "logo.png", bytes: png });
    expect(a.created).toBe(true);
    expect(a.asset.tags).toEqual(["logo", "dark"]);
    const v2 = await addAssetFile(db, storage, { actor: member, projectId: project, assetId: a.asset.id, fileName: "logo-v2.png", bytes: Buffer.concat([png, Buffer.from("2")]) });
    expect(v2.created).toBe(false);
    const list = await listAssets(db, org, project);
    expect(list).toHaveLength(1);
    expect(list[0].versions.map((v) => v.version)).toEqual([1, 2]);
    expect(list[0].current.filename).toBe("logo-v2.png");
  });

  it("takes PDF, video and a clean SVG, and refuses an SVG that can run code", async () => {
    await addAssetFile(db, storage, { actor: pm, projectId: project, name: "Brand guide", folder: "Brand guides", fileName: "guide.pdf", bytes: pdf });
    await addAssetFile(db, storage, { actor: pm, projectId: project, name: "Promo", folder: "Videos", fileName: "promo.mp4", bytes: mp4 });
    await addAssetFile(db, storage, { actor: pm, projectId: project, name: "Mark", folder: "Logos", fileName: "mark.svg", bytes: svgOk });
    for (const bad of ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', '<svg onload="x()"></svg>', '<svg><a href="https://evil.test">x</a></svg>', '<svg><foreignObject/></svg>']) {
      await expect(addAssetFile(db, storage, { actor: pm, projectId: project, name: "Bad", fileName: "bad.svg", bytes: Buffer.from(bad) })).rejects.toBeInstanceOf(AssetError);
    }
    expect(await db.projectAsset.count({ where: { projectId: project, name: "Bad" } })).toBe(0); // no empty asset left behind
  });

  it("allows big videos only in the library; other records keep the 15 MB limit", () => {
    const big = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypisom"), Buffer.alloc(20 * 1024 * 1024)]);
    expect(() => validateUpload("v.mp4", big)).toThrow(/too large/);
    expect(validateUpload("v.mp4", big, { media: true, maxBytes: ASSET_MAX_BYTES }).contentType).toBe("video/mp4");
    expect(() => validateUpload("a.svg", svgOk)).toThrow(/not allowed/);
    expect(validateUpload("a.svg", svgOk, { svg: true }).contentType).toBe("image/svg+xml");
  });

  it("denies people who are not on the project, clients, and other organisations", async () => {
    for (const who of [outsider, clientUser, otherOrg]) {
      await expect(addAssetFile(db, storage, { actor: who, projectId: project, name: "x", fileName: "x.png", bytes: png })).rejects.toThrow(/cannot add/);
    }
    const asset = (await listAssets(db, org, project))[0];
    expect(await openFile(db, storage, outsider, asset.current.id)).toBeNull();
    expect(await openFile(db, storage, clientUser, asset.current.id)).toBeNull();
    expect(await openFile(db, storage, otherOrg, asset.current.id)).toBeNull();
    expect(await openFile(db, storage, member, asset.current.id)).not.toBeNull();
    // a member may not rename, remove or share; the project manager may
    await expect(updateAsset(db, member, project, asset.id, { name: "n", folder: "f", tags: "", description: "" })).rejects.toThrow(/project manager/);
    await expect(deleteAsset(db, member, project, asset.id)).rejects.toThrow(/project manager/);
    await expect(createShare(db, member, { projectId: project })).rejects.toThrow(/project manager/);
    await expect(createShare(db, otherOrg, { projectId: project })).rejects.toThrow(/project manager/);
    // an asset of another project cannot be changed through this project's id
    await expect(updateAsset(db, pm, project2, asset.id, { name: "n", folder: "f", tags: "", description: "" })).rejects.toThrow(/no longer exists/);
  });
});

describe("public share links", () => {
  it("show the whole library or one folder, read-only, and nothing outside it", async () => {
    const all = await createShare(db, pm, { projectId: project, label: "Brand manager" });
    const logos = await createShare(db, pm, { projectId: project, folder: "Logos" });
    const sAll = (await resolveShare(db, all.token))!;
    const sLogos = (await resolveShare(db, logos.token))!;
    expect((await shareContent(db, sAll)).length).toBe(4);
    const inLogos = await shareContent(db, sLogos);
    expect(inLogos.every((a) => a.folder === "Logos")).toBe(true);
    const guide = (await listAssets(db, org, project)).find((a) => a.folder === "Brand guides")!;
    expect(await fileForShare(db, sLogos, guide.current.id)).toBeNull(); // outside the folder
    expect(await fileForShare(db, sAll, guide.current.id)).not.toBeNull();
    expect(await fileForShare(db, sAll, "nope")).toBeNull();
    // a file from another project's library is never reachable through this link
    const o = await addAssetFile(db, storage, { actor: pm, projectId: project2, name: "Secret", fileName: "s.png", bytes: png });
    expect(await fileForShare(db, sAll, o.file.id)).toBeNull();
    // a file of a different kind of record is not reachable either
    const task = await db.storedFile.create({ data: { organizationId: org, ownerType: "EXPENSE", ownerId: "x", filename: "e.pdf", contentType: "application/pdf", size: 1, sha256: "x", storageKey: "k1", uploadedById: pm.id } });
    expect(await fileForShare(db, sAll, task.id)).toBeNull();
  });

  it("stop working when switched off or expired, and removed assets vanish at once", async () => {
    const s = await createShare(db, pm, { projectId: project, expiresInDays: 2 });
    expect(await resolveShare(db, s.token)).not.toBeNull();
    expect(await resolveShare(db, s.token, new Date(Date.now() + 3 * 86400000))).toBeNull(); // expired
    await revokeShare(db, pm, project, s.id);
    expect(await resolveShare(db, s.token)).toBeNull();
    expect(await resolveShare(db, "wrong-token")).toBeNull();
    await expect(revokeShare(db, pm, project, s.id)).rejects.toThrow(/already off/);
    const live = (await resolveShare(db, (await db.projectAssetShare.findFirst({ where: { label: "Brand manager" } }))!.token))!;
    const victim = (await listAssets(db, org, project)).find((a) => a.name === "Promo")!;
    await deleteAsset(db, pm, project, victim.id);
    expect(await fileForShare(db, live, victim.current.id)).toBeNull();
    expect((await shareContent(db, live)).some((a) => a.name === "Promo")).toBe(false);
  });

  it("checks expiry bounds and password length", async () => {
    await expect(createShare(db, pm, { projectId: project, expiresInDays: 0 })).rejects.toBeInstanceOf(AssetError);
    await expect(createShare(db, pm, { projectId: project, expiresInDays: 400 })).rejects.toBeInstanceOf(AssetError);
    await expect(createShare(db, pm, { projectId: project, password: "abc" })).rejects.toBeInstanceOf(AssetError);
  });

  it("protect with a password: wrong password and old unlocks are refused", async () => {
    const s = await createShare(db, pm, { projectId: project, password: "designer-pass" });
    expect(s.passwordHash).not.toContain("designer-pass");
    expect(checkSharePassword("designer-pass", s.passwordHash!)).toBe(true);
    expect(checkSharePassword("wrong", s.passwordHash!)).toBe(false);
    const secret = "test-secret";
    expect(isUnlocked(s, undefined, secret)).toBe(false);
    const cookie = makeUnlock(s, secret);
    expect(isUnlocked(s, cookie, secret)).toBe(true);
    expect(isUnlocked(s, cookie, "other-secret")).toBe(false);
    expect(isUnlocked(s, cookie, secret, Date.now() + 13 * 3600_000)).toBe(false); // 12 hours
    expect(isUnlocked({ ...s, passwordHash: hashSharePassword("changed") }, cookie, secret)).toBe(false); // new password ends old unlocks
    expect(isUnlocked({ id: "x", passwordHash: null }, undefined, secret)).toBe(true); // no password: open
  });
});
