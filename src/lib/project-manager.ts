// Who manages a project. Free of Next.js imports so it can be tested against the test database.
import type { PrismaClient } from "@prisma/client";
import { notify } from "./notifications";
import { deleteTaskFamilies } from "./task-bulk";

type Db = PrismaClient;

export const PM_ROLE = "Project manager";
const isPmRole = (role: string | null) => !!role && role.trim().toLowerCase() === PM_ROLE.toLowerCase();

export type ManagerChange = { ok: true; changed: boolean; fromId: string; toId: string } | { ok: false; error: string };

// Hands a project to another staff member. The new manager joins the team as "Project manager"; the previous one stays on the team
// (so they keep their tasks and history) with the manager label removed. Closed projects keep the manager they finished with.
export async function setProjectManager(db: Db, p: { organizationId: string; projectId: string; managerId: string; byUserId: string }): Promise<ManagerChange> {
  const project = await db.project.findFirst({ where: { id: p.projectId, organizationId: p.organizationId }, select: { id: true, name: true, number: true, managerId: true, status: true } });
  if (!project) return { ok: false, error: "Project not found" };
  if (project.status === "COMPLETED" || project.status === "CANCELLED") return { ok: false, error: "This project is closed, so its manager cannot change" };
  const next = await db.user.findFirst({ where: { id: p.managerId, organizationId: p.organizationId, active: true, userType: "EMPLOYEE" }, select: { id: true } });
  if (!next) return { ok: false, error: "Choose an active staff member" };
  if (project.managerId === next.id) return { ok: true, changed: false, fromId: project.managerId, toId: next.id };

  await db.$transaction(async (tx) => {
    await tx.project.update({ where: { id: project.id }, data: { managerId: next.id } });
    await tx.projectMember.upsert({
      where: { projectId_userId: { projectId: project.id, userId: next.id } },
      update: { role: PM_ROLE }, create: { projectId: project.id, userId: next.id, role: PM_ROLE },
    });
    const prev = await tx.projectMember.findUnique({ where: { projectId_userId: { projectId: project.id, userId: project.managerId } } });
    if (prev && isPmRole(prev.role)) await tx.projectMember.update({ where: { projectId_userId: { projectId: project.id, userId: project.managerId } }, data: { role: null } });
  });

  if (next.id !== p.byUserId) {
    await notify(db, next.id, {
      kind: "project.manager_changed", title: `You now manage the project ${project.name}`, body: project.number,
      link: `/projects/${project.id}`,
    });
  }
  return { ok: true, changed: true, fromId: project.managerId, toId: next.id };
}

// What happens to the open tasks of someone leaving a project's team.
// "reassign": they go to another team member. "unassign": they wait, unassigned, for the manager.
// "delete": they are deleted with their subtasks, except tasks with logged time, work sessions, files or a linked content post,
// which are kept (unassigned) so no history is lost.
export type Handover = { mode: "reassign"; toUserId: string } | { mode: "unassign" } | { mode: "delete" };
export type TeamChange = { ok: true; reassigned: string[]; toUserId: string | null; unassigned: number; deleted: number } | { ok: false; error: string };

// Takes someone off a project's team. The manager can't be removed (hand the project over first). Finished tasks, logged time
// and comments keep their name. Their project chat room closes for them the next time chat syncs. Closed projects keep their team.
export async function removeProjectMember(db: Db, p: { organizationId: string; projectId: string; userId: string; byUserId: string; handover?: Handover }): Promise<TeamChange> {
  const handover: Handover = p.handover ?? { mode: "unassign" };
  const project = await db.project.findFirst({ where: { id: p.projectId, organizationId: p.organizationId }, select: { id: true, name: true, number: true, managerId: true, status: true } });
  if (!project) return { ok: false, error: "Project not found" };
  if (project.status === "COMPLETED" || project.status === "CANCELLED") return { ok: false, error: "This project is closed, so its team cannot change" };
  if (project.managerId === p.userId) return { ok: false, error: "This person manages the project. Choose a new project manager first, then remove them" };
  const member = await db.projectMember.findUnique({ where: { projectId_userId: { projectId: project.id, userId: p.userId } } });
  if (!member) return { ok: false, error: "This person is not on the team" };
  if (handover.mode === "reassign") {
    if (handover.toUserId === p.userId) return { ok: false, error: "Choose someone else to take over the tasks" };
    const to = await db.projectMember.findUnique({ where: { projectId_userId: { projectId: project.id, userId: handover.toUserId } }, select: { userId: true } });
    const active = to && (await db.user.findFirst({ where: { id: to.userId, organizationId: p.organizationId, active: true, userType: "EMPLOYEE" }, select: { id: true } }));
    if (!active) return { ok: false, error: "The person taking over must be an active member of this team" };
  }
  const result = await db.$transaction(async (tx) => {
    const open = await tx.task.findMany({ where: { projectId: project.id, assigneeId: p.userId, status: { not: "DONE" } }, select: { id: true } });
    const ids = open.map((t) => t.id);
    let reassigned: string[] = [], unassigned = 0, deleted = 0;
    if (handover.mode === "reassign") {
      await tx.task.updateMany({ where: { id: { in: ids } }, data: { assigneeId: handover.toUserId, assignedAt: new Date() } });
      reassigned = ids;
    } else if (handover.mode === "delete" && ids.length) {
      // A task (with its subtasks) is only deleted when nothing worth keeping hangs off it; the rest wait, unassigned
      const { deleted: drop, kept: keep } = await deleteTaskFamilies(tx, project.id, ids);
      if (keep.length) await tx.task.updateMany({ where: { id: { in: keep } }, data: { assigneeId: null } });
      unassigned = keep.length;
      deleted = drop.length;
    } else {
      await tx.task.updateMany({ where: { id: { in: ids } }, data: { assigneeId: null } });
      unassigned = ids.length;
    }
    await tx.projectMember.delete({ where: { projectId_userId: { projectId: project.id, userId: p.userId } } });
    return { reassigned, unassigned, deleted };
  });
  if (p.userId !== p.byUserId) {
    await notify(db, p.userId, { kind: "project.member_removed", title: `You were taken off the project ${project.name}`, body: project.number });
  }
  return { ok: true, toUserId: handover.mode === "reassign" ? handover.toUserId : null, ...result };
}

// Changes what someone does on the project ("Designer", "Ads campaign manager"). Empty clears it.
export async function setProjectMemberRole(db: Db, p: { organizationId: string; projectId: string; userId: string; role: string }): Promise<{ ok: true; role: string | null } | { ok: false; error: string }> {
  const project = await db.project.findFirst({ where: { id: p.projectId, organizationId: p.organizationId }, select: { id: true, status: true } });
  if (!project) return { ok: false, error: "Project not found" };
  if (project.status === "COMPLETED" || project.status === "CANCELLED") return { ok: false, error: "This project is closed, so its team cannot change" };
  const member = await db.projectMember.findUnique({ where: { projectId_userId: { projectId: project.id, userId: p.userId } } });
  if (!member) return { ok: false, error: "This person is not on the team" };
  const role = p.role.trim().slice(0, 80) || null;
  await db.projectMember.update({ where: { projectId_userId: { projectId: project.id, userId: p.userId } }, data: { role } });
  return { ok: true, role };
}
