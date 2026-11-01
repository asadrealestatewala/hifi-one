import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { UpdateError, clientFeed, postUpdate, projectFeed, setUpdateVisibility } from "./project-updates";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, dev: string, pm: string, clientA: string, clientB: string, project: string, internal: string;

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "ProjectUpdate","ProjectMember","Project","Client","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Upd Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other" } })).id;
  const u = async (n: string) => (await db.user.create({ data: { organizationId: org, email: `${n}@u.test`, name: n, passwordHash: "x" } })).id;
  [dev, pm] = await Promise.all([u("dev"), u("pm")]);
  clientA = (await db.client.create({ data: { organizationId: org, name: "A", currency: "USD" } })).id;
  clientB = (await db.client.create({ data: { organizationId: org, name: "B", currency: "USD" } })).id;
  project = (await db.project.create({ data: { organizationId: org, number: "P-1", name: "App", clientId: clientA, managerId: pm } })).id;
  internal = (await db.project.create({ data: { organizationId: org, number: "P-2", name: "Internal tool", managerId: pm } })).id;
});
afterAll(async () => { await db.$disconnect(); });

const base = () => ({ organizationId: org, projectId: project, authorId: dev, kind: "UPDATE", title: "Login screen done", visibleToClient: true, canSetPhase: false });

describe("project updates", () => {
  it("posts an entry and validates it", async () => {
    const u = await postUpdate(db, base());
    expect(u.visibleToClient).toBe(true);
    await expect(postUpdate(db, { ...base(), title: "  " })).rejects.toThrow(UpdateError);
    await expect(postUpdate(db, { ...base(), kind: "GOSSIP" })).rejects.toThrow(UpdateError);
    await expect(postUpdate(db, { ...base(), body: "x".repeat(4001) })).rejects.toThrow(UpdateError);
  });
  it("only someone allowed to set the phase can move it", async () => {
    await expect(postUpdate(db, { ...base(), phase: "TESTING" })).rejects.toThrow(/project manager/);
    expect((await db.project.findUniqueOrThrow({ where: { id: project } })).phase).toBeNull();
    const u = await postUpdate(db, { ...base(), title: "Build started", phase: "DEVELOPMENT", canSetPhase: true });
    expect(u.phase).toBe("DEVELOPMENT");
    expect((await db.project.findUniqueOrThrow({ where: { id: project } })).phase).toBe("DEVELOPMENT");
    await expect(postUpdate(db, { ...base(), phase: "NOPE", canSetPhase: true })).rejects.toThrow(/Unknown phase/);
    // repeating the current phase needs no special right
    expect((await postUpdate(db, { ...base(), phase: "DEVELOPMENT" })).phase).toBe("DEVELOPMENT");
  });
  it("refuses another organization's project and a cancelled project", async () => {
    await expect(postUpdate(db, { ...base(), organizationId: other })).rejects.toThrow(/not found/);
    const c = await db.project.create({ data: { organizationId: org, number: "P-3", name: "Old", clientId: clientA, managerId: pm, status: "CANCELLED" } });
    await expect(postUpdate(db, { ...base(), projectId: c.id })).rejects.toThrow(/cancelled/);
  });
  it("never shows an entry to a client when the project has none", async () => {
    const u = await postUpdate(db, { ...base(), projectId: internal });
    expect(u.visibleToClient).toBe(false);
    await expect(setUpdateVisibility(db, { organizationId: org, updateId: u.id, visibleToClient: true })).rejects.toThrow(/no client/);
  });
  it("shows the client only visible entries of their own project", async () => {
    const hidden = await postUpdate(db, { ...base(), title: "Internal: DB tuning", visibleToClient: false });
    const feed = await clientFeed(db, { clientId: clientA, projectId: project });
    expect(feed?.phase).toBe("DEVELOPMENT");
    expect(feed?.updates.some((x) => x.id === hidden.id)).toBe(false);
    expect(feed?.updates.length).toBeGreaterThan(0);
    expect(JSON.stringify(feed)).not.toContain("organizationId");
    // another client gets nothing, and not even a hint the project exists
    expect(await clientFeed(db, { clientId: clientB, projectId: project })).toBeNull();
    await setUpdateVisibility(db, { organizationId: org, updateId: hidden.id, visibleToClient: true });
    expect((await clientFeed(db, { clientId: clientA, projectId: project }))?.updates.some((x) => x.id === hidden.id)).toBe(true);
    await setUpdateVisibility(db, { organizationId: org, updateId: hidden.id, visibleToClient: false });
    expect((await clientFeed(db, { clientId: clientA, projectId: project }))?.updates.some((x) => x.id === hidden.id)).toBe(false);
    await expect(setUpdateVisibility(db, { organizationId: other, updateId: hidden.id, visibleToClient: true })).rejects.toThrow(/not found/);
  });
  it("lists the staff feed newest first with author names", async () => {
    const feed = await projectFeed(db, { organizationId: org, projectId: project });
    expect(feed[0].author).toBe("dev");
    expect(feed.map((f) => +f.createdAt)).toEqual([...feed.map((f) => +f.createdAt)].sort((a, b) => b - a));
    expect(await projectFeed(db, { organizationId: other, projectId: project })).toEqual([]);
  });
});
