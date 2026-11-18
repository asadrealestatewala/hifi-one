import type { SessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import type { ListRow } from "./TaskListTable";

type TaskWithProject = {
  id: string; title: string; assigneeId: string | null; priority: string; status: string; dueDate: Date | null; estimatedHours: { toString(): string } | null;
  project: { id: string; name: string; managerId: string; status: string };
};

// Turns tasks into rows for TaskListTable, with who may edit what: the manager of a row's project (or anyone with
// projects.manage) edits details; assignees move their own tasks; closed projects are read-only. Also loads each managed
// project's active team for the assignee menus. The server action checks all of this again.
export async function buildTaskRows(user: SessionUser, tasks: TaskWithProject[], today: string) {
  const canEdit = user.permissions.has("tasks.edit");
  const isManager = (p: { managerId: string }) => user.permissions.has("projects.manage") || p.managerId === user.id;
  const closed = (s: string) => s === "COMPLETED" || s === "CANCELLED";
  const managed = [...new Set(tasks.filter((t) => canEdit && isManager(t.project) && !closed(t.project.status)).map((t) => t.project.id))];
  const team = managed.length ? await db.projectMember.findMany({ where: { projectId: { in: managed } }, select: { projectId: true, userId: true } }) : [];
  const userIds = [...new Set([...team.map((m) => m.userId), ...(tasks.map((t) => t.assigneeId).filter(Boolean) as string[])])];
  const users = userIds.length ? await db.user.findMany({ where: { id: { in: userIds }, organizationId: user.organizationId }, select: { id: true, name: true, active: true, userType: true }, orderBy: { name: "asc" } }) : [];
  const name = new Map(users.map((u) => [u.id, u.name]));
  const staff = new Map(users.filter((u) => u.active && u.userType === "EMPLOYEE").map((u) => [u.id, { id: u.id, name: u.name }]));
  const members: Record<string, { id: string; name: string }[]> = {};
  for (const m of team) { const u = staff.get(m.userId); if (u) (members[m.projectId] ??= []).push(u); }
  for (const list of Object.values(members)) list.sort((a, b) => a.name.localeCompare(b.name));
  const inTeams = new Set(team.map((m) => m.userId));
  const people = [...staff.values()].filter((u) => inTeams.has(u.id));
  const rows: ListRow[] = tasks.map((t) => {
    const due = t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null;
    return {
      id: t.id, title: t.title, projectId: t.project.id, projectName: t.project.name, assigneeId: t.assigneeId, assigneeName: t.assigneeId ? name.get(t.assigneeId) ?? null : null,
      priority: t.priority, status: t.status, due, estimate: t.estimatedHours ? String(Number(t.estimatedHours.toString())) : null, late: Boolean(t.status !== "DONE" && due && due < today),
      canManage: canEdit && isManager(t.project) && !closed(t.project.status),
      canMove: canEdit && !closed(t.project.status) && (isManager(t.project) || t.assigneeId === user.id),
    };
  });
  return { rows, members, people, selectable: canEdit };
}
