import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ContactError, createContact, setContactParent, updateContact } from "./crm-contacts";
import { authorizeOwner, type FileActor } from "./file-access";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, ann: string, bob: string, boss: string;
const actor = (id: string, ...perms: string[]): FileActor => ({ id, organizationId: org, userType: "EMPLOYEE", clientId: null, vendorId: null, permissions: new Set(perms) });

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "ContactActivity","Contact","Lead","PipelineStage","Client","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Profile Org" } })).id;
  const mk = (e: string) => db.user.create({ data: { organizationId: org, email: e, name: e, passwordHash: "x" } }).then((u) => u.id);
  ann = await mk("ann@p.test"); bob = await mk("bob@p.test"); boss = await mk("boss@p.test");
});
afterAll(async () => { await db.$disconnect(); });

describe("contact profile fields", () => {
  it("saves birthday, tax id, shipping address, social profiles and UTM tags, and keeps them when other fields change", async () => {
    const c = await createContact(db, { organizationId: org, actorId: ann, input: { firstName: "Angela", lastName: "Martin", birthday: "1987-12-17", taxId: " 12-345 ", shipCity: "Dubai", social: { facebook: "fb.com/a", bogus: "x", x: "" }, utm: { source: "ads", medium: "cpc", extra: "y" } } });
    expect(c).toMatchObject({ birthday: "1987-12-17", taxId: "12-345", shipCity: "Dubai" });
    expect(c.social).toEqual({ facebook: "fb.com/a" }); // unknown keys and blanks are dropped
    expect(c.utm).toEqual({ source: "ads", medium: "cpc" });
    const u = await updateContact(db, { organizationId: org, id: c.id, actorId: ann, patch: { city: "Karachi" } });
    expect(u).toMatchObject({ city: "Karachi", birthday: "1987-12-17", taxId: "12-345", shipCity: "Dubai" });
    const v = await updateContact(db, { organizationId: org, id: c.id, actorId: ann, patch: { shipCity: "", social: { linkedin: "in/a" } } });
    expect(v.shipCity).toBeNull();
    expect(v.social).toEqual({ linkedin: "in/a" });
  });

  it("rejects an invalid or future birthday", async () => {
    await expect(createContact(db, { organizationId: org, actorId: ann, input: { firstName: "X", birthday: "not-a-date" } })).rejects.toThrow(/birthday/);
    await expect(createContact(db, { organizationId: org, actorId: ann, input: { firstName: "Y", birthday: "2999-01-01" } })).rejects.toThrow(/birthday/);
  });

  it("links a person to an organization by name (creating it), moves them, and clears the link", async () => {
    const p = await createContact(db, { organizationId: org, actorId: ann, input: { firstName: "Tom" } });
    const a = await setContactParent(db, { organizationId: org, contactId: p.id, actorId: ann, parentName: "Golden Grains" });
    const org1 = await db.contact.findUniqueOrThrow({ where: { id: a.parentId! } });
    expect(org1).toMatchObject({ kind: "ORGANIZATION", name: "Golden Grains" });
    const b = await setContactParent(db, { organizationId: org, contactId: p.id, actorId: ann, parentName: "golden grains" });
    expect(b.parentId).toBe(org1.id); // reused, not duplicated
    expect((await setContactParent(db, { organizationId: org, contactId: p.id, actorId: ann, parentName: "" })).parentId).toBeNull();
    await expect(setContactParent(db, { organizationId: org, contactId: org1.id, actorId: ann, parentName: "X" })).rejects.toThrow(ContactError);
  });
});

describe("files on a contact follow the contact's visibility", () => {
  it("lets the owner, a follower and a manager in, and keeps others and non-editors out", async () => {
    const c = await createContact(db, { organizationId: org, actorId: ann, input: { firstName: "Private", followers: [bob] }, });
    const id = c.id;
    expect(await authorizeOwner(db, actor(ann, "crm.view", "crm.edit"), "CONTACT", id, "upload")).toBe(true);
    expect(await authorizeOwner(db, actor(ann, "crm.view"), "CONTACT", id, "upload")).toBe(false); // view only
    expect(await authorizeOwner(db, actor(ann, "crm.view"), "CONTACT", id, "read")).toBe(true);
    expect(await authorizeOwner(db, actor(boss, "crm.view", "crm.edit"), "CONTACT", id, "read")).toBe(false); // not owner, follower or manager
    expect(await authorizeOwner(db, actor(boss, "crm.view", "crm.edit", "crm.view_all"), "CONTACT", id, "read")).toBe(true);
    expect(await authorizeOwner(db, { ...actor(ann, "crm.view", "crm.edit"), userType: "CLIENT" }, "CONTACT", id, "read")).toBe(false);
    expect(await authorizeOwner(db, { ...actor(ann, "crm.view"), organizationId: "other" }, "CONTACT", id, "read")).toBe(false);
  });
});
