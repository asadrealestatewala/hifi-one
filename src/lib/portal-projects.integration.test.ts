import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { clientCommented, commentSharedWithClient } from "./events";
import { portalAddComment, portalProject, portalProjects } from "./portal";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, acme: string, beta: string, acmeUser: string, betaUser: string, pm: string, dev: string, project: string, visible: string, hidden: string, betaProject: string;
const inbox = (id: string) => db.notification.findMany({ where: { userId: id } });

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "Notification","TaskComment","Task","ProjectMember","Project","Client","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Portal Org" } })).id;
  acme = (await db.client.create({ data: { organizationId: org, name: "Acme", currency: "USD" } })).id;
  beta = (await db.client.create({ data: { organizationId: org, name: "Beta", currency: "USD" } })).id;
  const u = (name: string, extra: Record<string, string> = {}) => db.user.create({ data: { organizationId: org, email: `${name}@pp.test`, name, passwordHash: "x", ...extra } }).then((x) => x.id);
  pm = await u("pm"); dev = await u("dev"); acmeUser = await u("acme-user", { userType: "CLIENT", clientId: acme }); betaUser = await u("beta-user", { userType: "CLIENT", clientId: beta });
  project = (await db.project.create({ data: { organizationId: org, number: "P1", name: "Acme site", clientId: acme, managerId: pm } })).id;
  betaProject = (await db.project.create({ data: { organizationId: org, number: "P2", name: "Beta site", clientId: beta, managerId: pm } })).id;
  visible = (await db.task.create({ data: { projectId: project, title: "Homepage", clientVisible: true, assigneeId: dev, createdById: pm } })).id;
  hidden = (await db.task.create({ data: { projectId: project, title: "Internal cleanup", clientVisible: false } })).id;
});
afterAll(async () => { await db.$disconnect(); });

describe("client portal projects", () => {
  it("shows only the client's own projects, shared tasks and shared comments", async () => {
    await db.taskComment.create({ data: { taskId: visible, authorId: pm, body: "Secret margin talk", internal: true } });
    await db.taskComment.create({ data: { taskId: visible, authorId: pm, body: "Draft is ready for you", internal: false } });
    const p = await portalProject(db, acme, project);
    expect(p?.tasks.map((t) => t.title)).toEqual(["Homepage"]);
    expect(p?.tasks[0].comments.map((c) => c.body)).toEqual(["Draft is ready for you"]);
    expect(await portalProject(db, acme, betaProject)).toBeNull();
    expect((await portalProjects(db, beta)).map((x) => x.name)).toEqual(["Beta site"]);
  });

  it("lets a client write only on a shared task of their own project", async () => {
    const c = await portalAddComment(db, { clientId: acme, userId: acmeUser, taskId: visible, body: "  Looks great, please add a contact form " });
    expect(c.internal).toBe(false);
    expect(c.body).toBe("Looks great, please add a contact form");
    await expect(portalAddComment(db, { clientId: acme, userId: acmeUser, taskId: hidden, body: "hello" })).rejects.toThrow(/not found/i);
    await expect(portalAddComment(db, { clientId: beta, userId: betaUser, taskId: visible, body: "hello" })).rejects.toThrow(/not found/i);
    await expect(portalAddComment(db, { clientId: acme, userId: acmeUser, taskId: visible, body: "   " })).rejects.toThrow(/Write a message/);
    const p = await portalProject(db, acme, project);
    expect(p?.tasks[0].comments.find((x) => x.body.startsWith("Looks great"))?.mine).toBe(true);
  });

  it("tells the team about a client comment, and the client about a shared reply", async () => {
    const c = await db.taskComment.findFirstOrThrow({ where: { authorId: acmeUser } });
    await clientCommented(db, { organizationId: org, taskId: visible, commentId: c.id, userId: acmeUser });
    await clientCommented(db, { organizationId: org, taskId: visible, commentId: c.id, userId: acmeUser });
    expect((await inbox(dev)).map((n) => n.kind)).toEqual(["task.client_comment"]);
    expect((await inbox(pm)).map((n) => n.kind)).toEqual(["task.client_comment"]);
    expect(await inbox(betaUser)).toHaveLength(0);
    const reply = await db.taskComment.create({ data: { taskId: visible, authorId: pm, body: "Added", internal: false } });
    await commentSharedWithClient(db, { organizationId: org, taskId: visible, commentId: reply.id, authorId: pm });
    expect((await inbox(acmeUser)).map((n) => n.link)).toEqual([`/portal/projects/${project}`]);
    expect(await inbox(betaUser)).toHaveLength(0);
    await commentSharedWithClient(db, { organizationId: org, taskId: hidden, commentId: reply.id, authorId: pm });
    expect(await inbox(acmeUser)).toHaveLength(1);
  });
});
