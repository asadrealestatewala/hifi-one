// Client requests: a client asks for something from their portal ("add our Eid offer to next week's posts"). Nothing reaches
// the team's task list until the project manager (or someone with projects.manage) approves it, which makes a client-visible
// task in the same step; or declines it with a reason the client reads. The client can withdraw a request still waiting.
// Free of Next.js imports so it can be tested against the database.
import type { PrismaClient, ClientRequest } from "@prisma/client";
import { notify } from "./notifications";
import { taskAssigned } from "./events";

type Db = PrismaClient;
const OPEN = ["ACTIVE", "ON_HOLD"];
const MAX_WAITING = 20; // per project, so a portal can't flood the team
export const REQUEST_STATUS_LABEL: Record<string, string> = { PENDING: "Waiting for the team", APPROVED: "Accepted", DECLINED: "Declined", WITHDRAWN: "Withdrawn" };

export type RequestResult<T = ClientRequest> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string) => ({ ok: false as const, error });
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());

// Raised by a client portal user. The project comes from the request but must belong to the client from the session.
export async function raiseRequest(db: Db, p: { clientId: string; userId: string; projectId: string; title: string; details?: string | null; wantedBy?: string | null; today: string }): Promise<RequestResult> {
  const project = await db.project.findFirst({ where: { id: p.projectId, clientId: p.clientId }, select: { id: true, organizationId: true, name: true, status: true, managerId: true, archivedAt: true } });
  if (!project || project.archivedAt) return fail("Project not found.");
  if (!OPEN.includes(project.status)) return fail("This project is closed, so it can't take new requests. Write to your project manager instead.");
  const title = p.title.trim().replace(/\s+/g, " ");
  if (title.length < 3) return fail("Say in a few words what you need.");
  if (title.length > 200) return fail("Keep the request title under 200 characters and put the rest in the details.");
  const details = p.details?.trim() || null;
  if (details && details.length > 4000) return fail("Keep the details under 4,000 characters.");
  const wantedBy = p.wantedBy?.trim() || null;
  if (wantedBy && !isDate(wantedBy)) return fail("Choose a valid date.");
  if (wantedBy && wantedBy < p.today) return fail("The date you need it by has already passed.");
  const waiting = await db.clientRequest.count({ where: { projectId: project.id, status: "PENDING" } });
  if (waiting >= MAX_WAITING) return fail(`${MAX_WAITING} requests are already waiting on this project. Please wait for the team to answer some first.`);
  const r = await db.clientRequest.create({ data: { organizationId: project.organizationId, projectId: project.id, clientId: p.clientId, createdById: p.userId, title, details, wantedBy } });
  if (project.managerId) {
    const client = await db.client.findUnique({ where: { id: p.clientId }, select: { name: true } });
    await notify(db, project.managerId, { kind: "project.client_request", title: `${client?.name ?? "The client"} asked for: ${title}`, body: `${project.name}${wantedBy ? ` · wanted by ${wantedBy}` : ""}. Approve it into a task or decline it.`, link: `/projects/${project.id}#requests`, dedupeKey: `client-request:${r.id}` });
  }
  return { ok: true, value: r };
}

export async function withdrawRequest(db: Db, p: { clientId: string; requestId: string }): Promise<RequestResult> {
  const r = await db.clientRequest.findFirst({ where: { id: p.requestId, clientId: p.clientId } });
  if (!r) return fail("Request not found.");
  if (r.status !== "PENDING") return fail("The team has already answered this request.");
  return { ok: true, value: await db.clientRequest.update({ where: { id: r.id }, data: { status: "WITHDRAWN", decidedAt: new Date() } }) };
}

type Decider = { organizationId: string; userId: string; canManageAll: boolean };

// The request, if this person may decide it: the project's manager, or anyone with projects.manage.
async function decidable(db: Db, d: Decider, requestId: string) {
  const r = await db.clientRequest.findFirst({ where: { id: requestId, organizationId: d.organizationId }, include: { project: { select: { id: true, name: true, status: true, managerId: true } } } });
  if (!r) return fail("Request not found.");
  if (!d.canManageAll && r.project.managerId !== d.userId) return fail("Only the project manager can answer client requests.");
  if (r.status !== "PENDING") return fail(r.status === "WITHDRAWN" ? "The client withdrew this request." : "This request has already been answered.");
  return { ok: true as const, value: r };
}

// Approving creates the task (client-visible, with the client's words) and links it, in one transaction.
export async function approveRequest(db: Db, d: Decider & { requestId: string; assigneeId?: string | null; dueDate?: string | null; priority?: string; title?: string | null }): Promise<RequestResult<{ request: ClientRequest; taskId: string }>> {
  const found = await decidable(db, d, d.requestId);
  if (!found.ok) return found;
  const r = found.value;
  if (!OPEN.includes(r.project.status)) return fail("This project is closed. Reopen it before adding work.");
  const assigneeId = d.assigneeId || null;
  if (assigneeId && !(await db.projectMember.findUnique({ where: { projectId_userId: { projectId: r.projectId, userId: assigneeId } } }))) return fail("Only people on the team can be given the task.");
  const due = d.dueDate?.trim() || r.wantedBy;
  if (due && !isDate(due)) return fail("Choose a valid due date.");
  const priority = ["LOW", "MEDIUM", "HIGH"].includes(d.priority ?? "") ? d.priority! : "MEDIUM";
  const title = (d.title?.trim() || r.title).slice(0, 200);
  const out = await db.$transaction(async (tx) => {
    // Claim the request first so two managers deciding at once make one task
    const claimed = await tx.clientRequest.updateMany({ where: { id: r.id, status: "PENDING" }, data: { status: "APPROVED", decidedById: d.userId, decidedAt: new Date() } });
    if (claimed.count === 0) return null;
    const task = await tx.task.create({ data: { projectId: r.projectId, title, description: r.details ? `Client request: ${r.details}` : "Client request from the portal.", assigneeId, createdById: d.userId, priority, dueDate: due ? new Date(`${due}T00:00:00Z`) : null, clientVisible: true } });
    const request = await tx.clientRequest.update({ where: { id: r.id }, data: { taskId: task.id } });
    return { request, taskId: task.id };
  });
  if (!out) return fail("This request has already been answered.");
  await taskAssigned(db, { organizationId: d.organizationId, taskId: out.taskId, toUserId: assigneeId, byUserId: d.userId });
  await notify(db, r.createdById, { kind: "portal.request_decided", title: `Accepted: ${r.title}`, body: `The team added it to ${r.project.name}${due ? `, due ${due}` : ""}. You can follow it on the project page.`, link: `/portal/projects/${r.projectId}#requests`, dedupeKey: `client-request-decided:${r.id}` });
  return { ok: true, value: out };
}

export async function declineRequest(db: Db, d: Decider & { requestId: string; reason: string }): Promise<RequestResult> {
  const found = await decidable(db, d, d.requestId);
  if (!found.ok) return found;
  const r = found.value;
  const reason = d.reason.trim();
  if (reason.length < 3) return fail("Tell the client why, so they know what to do next.");
  const claimed = await db.clientRequest.updateMany({ where: { id: r.id, status: "PENDING" }, data: { status: "DECLINED", decidedById: d.userId, decidedAt: new Date(), declineReason: reason.slice(0, 1000) } });
  if (claimed.count === 0) return fail("This request has already been answered.");
  await notify(db, r.createdById, { kind: "portal.request_decided", title: `Declined: ${r.title}`, body: reason.slice(0, 300), link: `/portal/projects/${r.projectId}#requests`, dedupeKey: `client-request-decided:${r.id}` });
  return { ok: true, value: (await db.clientRequest.findUniqueOrThrow({ where: { id: r.id } })) };
}

// A project's requests for the staff project page: waiting ones first, then the last 10 answered.
export async function projectRequests(db: Db, p: { organizationId: string; projectId: string }) {
  const [waiting, answered] = await Promise.all([
    db.clientRequest.findMany({ where: { organizationId: p.organizationId, projectId: p.projectId, status: "PENDING" }, orderBy: { createdAt: "asc" } }),
    db.clientRequest.findMany({ where: { organizationId: p.organizationId, projectId: p.projectId, status: { not: "PENDING" } }, orderBy: { decidedAt: "desc" }, take: 10 }),
  ]);
  const people = new Map((await db.user.findMany({ where: { id: { in: [...waiting, ...answered].flatMap((r) => [r.createdById, r.decidedById ?? ""]).filter(Boolean) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const name = (id: string | null) => (id ? people.get(id) ?? "Someone" : null);
  const shape = (r: ClientRequest) => ({ ...r, askedBy: name(r.createdById)!, decidedBy: name(r.decidedById) });
  return { waiting: waiting.map(shape), answered: answered.map(shape) };
}

// The client's own requests on one project, newest first.
export async function portalRequests(db: Db, p: { clientId: string; projectId: string }) {
  return db.clientRequest.findMany({ where: { clientId: p.clientId, projectId: p.projectId }, orderBy: { createdAt: "desc" }, take: 30 });
}
