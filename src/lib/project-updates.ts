import type { PrismaClient } from "@prisma/client";

export class UpdateError extends Error {}

// The delivery phases a software, app or AI project moves through. The order is the order shown to the client.
export const PROJECT_PHASES = ["DISCOVERY", "DESIGN", "DEVELOPMENT", "TESTING", "CLIENT_REVIEW", "LAUNCHED"] as const;
export type ProjectPhase = (typeof PROJECT_PHASES)[number];
export const PHASE_LABEL: Record<ProjectPhase, string> = {
  DISCOVERY: "Discovery", DESIGN: "Design", DEVELOPMENT: "Development", TESTING: "Testing", CLIENT_REVIEW: "Client review", LAUNCHED: "Launched",
};
export const UPDATE_KINDS = ["UPDATE", "TESTING", "RELEASE", "BLOCKER", "DECISION"] as const;
export type UpdateKind = (typeof UPDATE_KINDS)[number];
export const KIND_LABEL: Record<UpdateKind, string> = { UPDATE: "Update", TESTING: "Testing", RELEASE: "Release", BLOCKER: "Blocker", DECISION: "Decision" };

export const isPhase = (v: string): v is ProjectPhase => (PROJECT_PHASES as readonly string[]).includes(v);
export const isKind = (v: string): v is UpdateKind => (UPDATE_KINDS as readonly string[]).includes(v);

// Posts an entry to a project's updates feed. A new phase (only when `canSetPhase`) moves the project's current phase and is
// recorded on the entry. Entries are shown to the client only when the project has a client and `visibleToClient` is set.
export async function postUpdate(db: PrismaClient, p: {
  organizationId: string; projectId: string; authorId: string; kind: string; title: string; body?: string | null;
  phase?: string | null; visibleToClient: boolean; canSetPhase: boolean;
}) {
  const title = p.title.trim();
  if (!title) throw new UpdateError("Give the update a title.");
  if (title.length > 160) throw new UpdateError("The title is too long (160 characters at most).");
  const body = p.body?.trim() || null;
  if (body && body.length > 4000) throw new UpdateError("The details are too long (4000 characters at most).");
  if (!isKind(p.kind)) throw new UpdateError("Choose what kind of update this is.");
  const project = await db.project.findFirst({ where: { id: p.projectId, organizationId: p.organizationId }, select: { id: true, status: true, clientId: true, phase: true } });
  if (!project) throw new UpdateError("Project not found.");
  if (project.status === "CANCELLED") throw new UpdateError("This project is cancelled.");
  const newPhase = p.phase?.trim() || null;
  if (newPhase) {
    if (!isPhase(newPhase)) throw new UpdateError("Unknown phase.");
    if (newPhase !== project.phase && !p.canSetPhase) throw new UpdateError("Only a project manager can change the project phase.");
  }
  return db.$transaction(async (tx) => {
    if (newPhase && newPhase !== project.phase) await tx.project.update({ where: { id: project.id }, data: { phase: newPhase } });
    return tx.projectUpdate.create({
      data: {
        organizationId: p.organizationId, projectId: project.id, authorId: p.authorId, kind: p.kind, title, body,
        phase: newPhase ?? project.phase, visibleToClient: p.visibleToClient && Boolean(project.clientId),
      },
    });
  });
}

// Shows or hides an existing entry for the client. Entries are a record, so they are hidden rather than deleted.
export async function setUpdateVisibility(db: PrismaClient, p: { organizationId: string; updateId: string; visibleToClient: boolean }) {
  const u = await db.projectUpdate.findFirst({ where: { id: p.updateId, organizationId: p.organizationId }, include: { project: { select: { clientId: true } } } });
  if (!u) throw new UpdateError("Update not found.");
  if (p.visibleToClient && !u.project.clientId) throw new UpdateError("This project has no client to show it to.");
  return db.projectUpdate.update({ where: { id: u.id }, data: { visibleToClient: p.visibleToClient } });
}

export async function projectFeed(db: PrismaClient, p: { organizationId: string; projectId: string; take?: number }) {
  const rows = await db.projectUpdate.findMany({ where: { organizationId: p.organizationId, projectId: p.projectId }, orderBy: { createdAt: "desc" }, take: p.take ?? 100 });
  const names = new Map((await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.authorId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return rows.map((r) => ({ ...r, author: names.get(r.authorId) ?? "Hifi team" }));
}

// What the client sees: only entries marked visible, with the author's name and no internal fields.
export async function clientFeed(db: PrismaClient, p: { clientId: string; projectId: string; take?: number }) {
  const project = await db.project.findFirst({ where: { id: p.projectId, clientId: p.clientId, status: { not: "CANCELLED" } }, select: { id: true, phase: true } });
  if (!project) return null;
  const rows = await db.projectUpdate.findMany({ where: { projectId: project.id, visibleToClient: true }, orderBy: { createdAt: "desc" }, take: p.take ?? 100 });
  const names = new Map((await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.authorId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return {
    phase: project.phase,
    updates: rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, phase: r.phase, at: r.createdAt, author: names.get(r.authorId) ?? "Hifi team" })),
  };
}
