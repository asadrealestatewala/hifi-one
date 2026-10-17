import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { syncPermissionsAndRoles } from "./bootstrap";
import { DeliverableError, cleanLink, createDeliverable, decide, editDeliverable, portalDeliverables, submitForApproval } from "./deliverables";
import { SupportError, assignRequest, clientReply, createRequest, portalRequest, portalRequests, setSupportStatus, staffReply } from "./support";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, acme: string, beta: string, acmeUser: string, acmeUser2: string, betaUser: string, agent: string, pm: string, project: string, betaProject: string;
const inbox = (id: string) => db.notification.findMany({ where: { userId: id }, orderBy: { createdAt: "asc" } });

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "Notification","SupportMessage","SupportRequest","Deliverable","Task","ProjectMember","Project","NumberSequence","UserRole","RolePermission","Role","Permission","User","Client","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Support Org" } })).id;
  await syncPermissionsAndRoles(db, org, { overwrite: true });
  acme = (await db.client.create({ data: { organizationId: org, name: "Acme", currency: "USD" } })).id;
  beta = (await db.client.create({ data: { organizationId: org, name: "Beta", currency: "USD" } })).id;
  const u = (name: string, extra: Record<string, unknown> = {}) => db.user.create({ data: { organizationId: org, email: `${name}@s.test`, name, passwordHash: "x", ...extra } }).then((x) => x.id);
  const role = await db.role.findFirstOrThrow({ where: { organizationId: org, key: "SUCCESS_MANAGER" } });
  agent = await u("agent", { roles: { create: { roleId: role.id } } });
  pm = await u("pm");
  acmeUser = await u("acme1", { userType: "CLIENT", clientId: acme }); acmeUser2 = await u("acme2", { userType: "CLIENT", clientId: acme }); betaUser = await u("beta1", { userType: "CLIENT", clientId: beta });
  project = (await db.project.create({ data: { organizationId: org, number: "P1", name: "Acme site", clientId: acme, managerId: pm } })).id;
  betaProject = (await db.project.create({ data: { organizationId: org, number: "P2", name: "Beta site", clientId: beta, managerId: pm } })).id;
});
afterAll(async () => { await db.$disconnect(); });

describe("support requests", () => {
  it("raises a numbered request, tells the support team, and rejects empty or foreign input", async () => {
    await expect(createRequest(db, { organizationId: org, clientId: acme, userId: acmeUser, subject: "x", body: "short" })).rejects.toThrow(SupportError);
    await expect(createRequest(db, { organizationId: org, clientId: acme, userId: acmeUser, subject: "Login problem", body: "I cannot sign in to the portal", projectId: betaProject })).rejects.toThrow(/your projects/);
    const r = await createRequest(db, { organizationId: org, clientId: acme, userId: acmeUser, subject: "Login problem", body: "I cannot sign in to the portal", projectId: project });
    expect(r.number).toBe("SUP-0001");
    expect((await inbox(agent)).map((n) => n.kind)).toEqual(["support.new"]);
    expect((await inbox(pm)).map((n) => n.kind)).toEqual(["support.new"]);
    expect(await inbox(betaUser)).toHaveLength(0);
  });

  it("keeps internal notes away from the client and each client's requests apart", async () => {
    const r = await db.supportRequest.findFirstOrThrow({ where: { clientId: acme } });
    await staffReply(db, { organizationId: org, authorId: agent, requestId: r.id, body: "Looks like a password reset is needed" });
    await staffReply(db, { organizationId: org, authorId: agent, requestId: r.id, body: "Careful, this client is slow to pay", internal: true });
    const seen = await portalRequest(db, acme, r.id);
    expect(seen?.messages.map((m) => m.body)).toEqual(["I cannot sign in to the portal", "Looks like a password reset is needed"]);
    expect(seen?.messages.map((m) => m.mine)).toEqual([true, false]);
    expect(await portalRequest(db, beta, r.id)).toBeNull();
    expect(await portalRequests(db, beta)).toHaveLength(0);
    expect((await inbox(acmeUser)).map((n) => n.kind)).toEqual(["support.reply"]);
    expect((await inbox(acmeUser2)).map((n) => n.kind)).toEqual(["support.reply"]);
    const after = await db.supportRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.status).toBe("IN_PROGRESS");
    expect(after.assigneeId).toBe(agent);
  });

  it("lets the client reopen a resolved request but not a closed one, and a stranger cannot reply", async () => {
    const r = await db.supportRequest.findFirstOrThrow({ where: { clientId: acme } });
    await setSupportStatus(db, { organizationId: org, requestId: r.id, status: "RESOLVED", actorId: agent });
    expect((await inbox(acmeUser)).map((n) => n.kind)).toContain("support.resolved");
    await clientReply(db, { organizationId: org, clientId: acme, userId: acmeUser2, requestId: r.id, body: "Still not working for me" });
    expect((await db.supportRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("OPEN");
    await expect(clientReply(db, { organizationId: org, clientId: beta, userId: betaUser, requestId: r.id, body: "hello" })).rejects.toThrow(/not found/i);
    await setSupportStatus(db, { organizationId: org, requestId: r.id, status: "CLOSED", actorId: agent });
    await expect(clientReply(db, { organizationId: org, clientId: acme, userId: acmeUser, requestId: r.id, body: "one more" })).rejects.toThrow(/closed/);
    await expect(assignRequest(db, { organizationId: org, requestId: r.id, assigneeId: acmeUser, actorId: agent })).rejects.toThrow(/staff member/);
  });
});

describe("deliverables and client approval", () => {
  it("validates links, edits only drafts, and sends to the client once", async () => {
    expect(cleanLink("https://example.com/design?id=1")).toBe("https://example.com/design?id=1");
    expect(() => cleanLink("javascript:alert(1)")).toThrow(DeliverableError);
    expect(() => cleanLink("not a link")).toThrow(DeliverableError);
    const d = await createDeliverable(db, { organizationId: org, projectId: project, actorId: pm, title: "Homepage design", link: "https://figma.example/abc" });
    await db.notification.deleteMany({});
    await submitForApproval(db, { organizationId: org, id: d.id, actorId: pm });
    await expect(submitForApproval(db, { organizationId: org, id: d.id, actorId: pm })).rejects.toThrow(/Already/);
    await expect(editDeliverable(db, { organizationId: org, id: d.id, title: "Changed after sending" })).rejects.toThrow(/cannot be changed/);
    expect((await inbox(acmeUser)).map((n) => n.kind)).toEqual(["deliverable.pending"]);
    expect(await inbox(betaUser)).toHaveLength(0);
    const internal = await db.project.create({ data: { organizationId: org, number: "P3", name: "Internal", managerId: pm } });
    const x = await createDeliverable(db, { organizationId: org, projectId: internal.id, actorId: pm, title: "Internal doc", description: "notes" });
    await expect(submitForApproval(db, { organizationId: org, id: x.id, actorId: pm })).rejects.toThrow(/no client/);
  });

  it("shows a client only their own non-draft deliverables, and only they can decide", async () => {
    const mine = await db.deliverable.findFirstOrThrow({ where: { projectId: project } });
    await createDeliverable(db, { organizationId: org, projectId: project, actorId: pm, title: "Still a draft", description: "wip" });
    expect((await portalDeliverables(db, acme)).map((d) => d.title)).toEqual(["Homepage design"]);
    expect(await portalDeliverables(db, beta)).toEqual([]);
    await expect(decide(db, { organizationId: org, clientId: beta, userId: betaUser, id: mine.id, decision: "APPROVE" })).rejects.toThrow(/Not found/);
    await expect(decide(db, { organizationId: org, clientId: acme, userId: acmeUser, id: mine.id, decision: "CHANGES", note: "no" })).rejects.toThrow(/what you would like changed/);
    await db.notification.deleteMany({});
    const r = await decide(db, { organizationId: org, clientId: acme, userId: acmeUser, id: mine.id, decision: "CHANGES", note: "Make the logo bigger please" });
    expect(r.status).toBe("CHANGES_REQUESTED");
    expect((await inbox(pm)).map((n) => n.kind)).toEqual(["deliverable.changes"]);
    await expect(decide(db, { organizationId: org, clientId: acme, userId: acmeUser2, id: mine.id, decision: "APPROVE" })).rejects.toThrow(/not waiting/);
  });

  it("returns a changed deliverable as a new version and records an approval", async () => {
    const d = await db.deliverable.findFirstOrThrow({ where: { projectId: project, status: "CHANGES_REQUESTED" } });
    const v2 = await editDeliverable(db, { organizationId: org, id: d.id, title: "Homepage design", link: "https://figma.example/abc-v2" });
    expect(v2).toMatchObject({ status: "DRAFT", version: 2, decisionNote: null });
    await submitForApproval(db, { organizationId: org, id: d.id, actorId: pm });
    const approved = await decide(db, { organizationId: org, clientId: acme, userId: acmeUser2, id: d.id, decision: "APPROVE", note: "Perfect" });
    expect(approved).toMatchObject({ status: "APPROVED", decidedById: acmeUser2, decisionNote: "Perfect", version: 2 });
    const both = await Promise.allSettled([decide(db, { organizationId: org, clientId: acme, userId: acmeUser, id: d.id, decision: "APPROVE" }), decide(db, { organizationId: org, clientId: acme, userId: acmeUser2, id: d.id, decision: "APPROVE" })]);
    expect(both.every((b) => b.status === "rejected")).toBe(true);
  });
});
