// Who manages a project. Free of Next.js imports so it can be tested against the test database.
import type { PrismaClient } from "@prisma/client";
import { notify } from "./notifications";

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
