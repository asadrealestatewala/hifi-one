// Client requests against hifi_one_test: a client asks from the portal; only the project manager (or projects.manage) turns it
// into a client-visible task or declines it with a reason; other clients, other organizations and closed projects are refused.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { approveRequest, declineRequest, portalRequests, projectRequests, raiseRequest, withdrawRequest } from "./client-requests";
import { pendingApprovals } from "./approvals";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, client: string, otherClient: string, pm: string, designer: string, owner: string, portalUser: string, project: string, closed: string;
const today = "2026-11-18";
const user = (o: string, name: string, extra: Record<string, unknown> = {}) => db.user.create({ data: { organizationId: o, email: `${name}@req.test`, name, passwordHash: "x", userType: "EMPLOYEE", ...extra } }).then((u) => u.id);
const decider = (userId: string, canManageAll = false) => ({ organizationId: org, userId, canManageAll });
const ask = (title = "Add the Eid offer to next week's posts", over: Record<string, unknown> = {}) => raiseRequest(db, { clientId: client, userId: portalUser, projectId: project, title, details: "Banner in the shared folder", wantedBy: "2026-11-25", today, ...over });

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "ClientRequest","Notification","TaskChecklistItem","Task","ProjectMember","Project","Client","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Req Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other Org" } })).id;
  client = (await db.client.create({ data: { organizationId: org, name: "Food Co" } })).id;
  otherClient = (await db.client.create({ data: { organizationId: org, name: "Shoe Co" } })).id;
  pm = await user(org, "pm"); designer = await user(org, "designer"); owner = await user(org, "owner");
  portalUser = await user(org, "foodco", { userType: "CLIENT", clientId: client });
  project = (await db.project.create({ data: { organizationId: org, number: "RQ-1", name: "Food Co social", clientId: client, managerId: pm, members: { create: [{ userId: pm }, { userId: designer, role: "Designer" }] } } })).id;
  closed = (await db.project.create({ data: { organizationId: org, number: "RQ-2", name: "Old launch", clientId: client, managerId: pm, status: "COMPLETED" } })).id;
});
beforeEach(async () => { await db.clientRequest.deleteMany(); await db.task.deleteMany(); await db.notification.deleteMany(); });
afterAll(async () => { await db.$disconnect(); });

describe("client requests", () => {
  it("lets the client ask on their own open project and tells the project manager", async () => {
    const r = await ask();
    expect(r).toMatchObject({ ok: true, value: { status: "PENDING", organizationId: org, wantedBy: "2026-11-25" } });
    expect(await db.notification.findMany({ where: { userId: pm, kind: "project.client_request" } })).toHaveLength(1);
    expect(await db.task.count({ where: { projectId: project } })).toBe(0); // nothing reaches the task list yet
  });

  it("refuses another client's project, a closed project, a bad title and a date already passed", async () => {
    expect(await raiseRequest(db, { clientId: otherClient, userId: portalUser, projectId: project, title: "Sneaky", today })).toEqual({ ok: false, error: "Project not found." });
    expect(await ask("Reopen please", { projectId: closed })).toMatchObject({ ok: false, error: expect.stringMatching(/closed/) });
    expect(await ask("  a ")).toMatchObject({ ok: false });
    expect(await ask("Late thing", { wantedBy: "2026-11-01" })).toMatchObject({ ok: false, error: expect.stringMatching(/already passed/) });
  });

  it("only the project manager or projects.manage may decide, and approval makes one client-visible task", async () => {
    const r = await ask(); if (!r.ok) throw new Error(r.error);
    expect(await approveRequest(db, { ...decider(designer), requestId: r.value.id })).toEqual({ ok: false, error: "Only the project manager can answer client requests." });
    expect(await approveRequest(db, { organizationId: other, userId: owner, canManageAll: true, requestId: r.value.id })).toEqual({ ok: false, error: "Request not found." });
    expect(await approveRequest(db, { ...decider(pm), requestId: r.value.id, assigneeId: owner })).toMatchObject({ ok: false, error: expect.stringMatching(/on the team/) });

    const a = await approveRequest(db, { ...decider(pm), requestId: r.value.id, assigneeId: designer, priority: "HIGH" });
    if (!a.ok) throw new Error(a.error);
    const task = await db.task.findUniqueOrThrow({ where: { id: a.value.taskId } });
    expect(task).toMatchObject({ projectId: project, title: "Add the Eid offer to next week's posts", assigneeId: designer, clientVisible: true, priority: "HIGH", createdById: pm });
    expect(task.dueDate?.toISOString().slice(0, 10)).toBe("2026-11-25"); // the date the client asked for
    expect(task.description).toContain("Banner in the shared folder");
    expect(await db.notification.count({ where: { userId: portalUser, kind: "portal.request_decided" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: designer } })).toBe(1); // assigned

    // A second decision (another manager at the same time, or a decline after) changes nothing
    expect(await approveRequest(db, { ...decider(owner, true), requestId: r.value.id })).toMatchObject({ ok: false, error: expect.stringMatching(/already been answered/) });
    expect(await declineRequest(db, { ...decider(pm), requestId: r.value.id, reason: "No" })).toMatchObject({ ok: false });
    expect(await db.task.count({ where: { projectId: project } })).toBe(1);
  });

  it("declining needs a reason, which the client reads", async () => {
    const r = await ask("Make a TV ad"); if (!r.ok) throw new Error(r.error);
    expect(await declineRequest(db, { ...decider(owner, true), requestId: r.value.id, reason: " " })).toMatchObject({ ok: false, error: expect.stringMatching(/why/) });
    expect(await declineRequest(db, { ...decider(owner, true), requestId: r.value.id, reason: "TV is outside this retainer; we can quote it separately." })).toMatchObject({ ok: true, value: { status: "DECLINED", decidedById: owner } });
    const mine = await portalRequests(db, { clientId: client, projectId: project });
    expect(mine[0]).toMatchObject({ status: "DECLINED", declineReason: expect.stringMatching(/quote it separately/) });
    expect(await portalRequests(db, { clientId: otherClient, projectId: project })).toHaveLength(0);
  });

  it("the client can withdraw only while it waits; the waiting list and Approvals follow", async () => {
    const r = await ask(); if (!r.ok) throw new Error(r.error);
    const r2 = await ask("Second thing"); if (!r2.ok) throw new Error(r2.error);
    expect((await projectRequests(db, { organizationId: org, projectId: project })).waiting.map((x) => x.title)).toEqual(["Add the Eid offer to next week's posts", "Second thing"]);
    const groups = async (id: string, perms: string[]) => (await pendingApprovals(db, { id, organizationId: org, permissions: new Set(perms) })).find((g) => g.key === "clientRequests")?.count ?? 0;
    expect(await groups(pm, ["projects.view"])).toBe(2); // manager of the project
    expect(await groups(designer, ["projects.view"])).toBe(0); // on the team, but not the manager
    expect(await groups(owner, ["projects.manage"])).toBe(2);

    expect(await withdrawRequest(db, { clientId: otherClient, requestId: r.value.id })).toEqual({ ok: false, error: "Request not found." });
    expect(await withdrawRequest(db, { clientId: client, requestId: r.value.id })).toMatchObject({ ok: true, value: { status: "WITHDRAWN" } });
    expect(await approveRequest(db, { ...decider(pm), requestId: r.value.id })).toMatchObject({ ok: false, error: expect.stringMatching(/withdrew/) });
    await approveRequest(db, { ...decider(pm), requestId: r2.value.id });
    expect(await withdrawRequest(db, { clientId: client, requestId: r2.value.id })).toMatchObject({ ok: false, error: expect.stringMatching(/already answered/) });
    expect(await groups(pm, ["projects.view"])).toBe(0);
  });
});
