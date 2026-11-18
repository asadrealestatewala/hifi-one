// Offboarding: when someone leaves, everything they hold on open projects moves in one step from People & HR. Projects they
// manage go to a successor; on every other open project they leave the team and their open tasks go to the successor (who
// joins the team with the leaver's role) or wait unassigned for the project manager. Closed projects, finished tasks, logged
// time and comments keep the leaver's name. Only for people who are no longer active, so this can't be used to move a working
// person's projects around. Free of Next.js imports so it can be tested against the database.
import type { PrismaClient } from "@prisma/client";
import { notify } from "./notifications";
import { removeProjectMember, setProjectManager } from "./project-manager";

type Db = PrismaClient;
const OPEN = ["ACTIVE", "ON_HOLD"];

export type HeldProject = { id: string; number: string; name: string; manages: boolean; role: string | null; openTasks: number };
export type HeldWork = { projects: HeldProject[]; openTasks: number };

// Open projects the person manages, is on the team of, or holds open tasks in.
export async function workHeldBy(db: Db, p: { organizationId: string; userId: string }): Promise<HeldWork> {
  const projects = await db.project.findMany({
    where: { organizationId: p.organizationId, status: { in: OPEN }, OR: [{ managerId: p.userId }, { members: { some: { userId: p.userId } } }, { tasks: { some: { assigneeId: p.userId, status: { not: "DONE" } } } }] },
    orderBy: { name: "asc" }, select: { id: true, number: true, name: true, managerId: true, members: { where: { userId: p.userId }, select: { role: true } } },
  });
  const counts = new Map((await db.task.groupBy({ by: ["projectId"], where: { projectId: { in: projects.map((x) => x.id) }, assigneeId: p.userId, status: { not: "DONE" } }, _count: { _all: true } })).map((r) => [r.projectId, r._count._all]));
  const list = projects.map((x) => ({ id: x.id, number: x.number, name: x.name, manages: x.managerId === p.userId, role: x.members[0]?.role ?? null, openTasks: counts.get(x.id) ?? 0 }));
  return { projects: list, openTasks: list.reduce((n, x) => n + x.openTasks, 0) };
}

export type HandoverResult =
  | { ok: true; managed: string[]; left: string[]; reassigned: number; unassigned: number; toUserId: string | null; errors: { project: string; error: string }[] }
  | { ok: false; error: string };

export async function handOverWork(db: Db, p: { organizationId: string; userId: string; byUserId: string; mode: "reassign" | "unassign"; toUserId?: string | null }): Promise<HandoverResult> {
  const leaver = await db.user.findFirst({ where: { id: p.userId, organizationId: p.organizationId, userType: "EMPLOYEE" }, select: { id: true, name: true, active: true } });
  if (!leaver) return { ok: false, error: "Staff member not found." };
  if (leaver.active) return { ok: false, error: `${leaver.name} is still active. Deactivate them or mark them as exited first, then hand over their work.` };
  const held = await workHeldBy(db, { organizationId: p.organizationId, userId: leaver.id });
  if (!held.projects.length) return { ok: false, error: `${leaver.name} holds no work on open projects.` };
  const to = p.toUserId ? await db.user.findFirst({ where: { id: p.toUserId, organizationId: p.organizationId, active: true, userType: "EMPLOYEE" }, select: { id: true, name: true } }) : null;
  if (p.toUserId && !to) return { ok: false, error: "The person taking over must be an active staff member." };
  if (to && to.id === leaver.id) return { ok: false, error: "Choose someone else to take over." };
  // A project always needs a manager, and reassigning needs someone to give the tasks to
  if (!to && (p.mode === "reassign" || held.projects.some((x) => x.manages))) return { ok: false, error: "Choose who takes over." };
  const managed: string[] = [], left: string[] = [], errors: { project: string; error: string }[] = [];
  let reassigned = 0, unassigned = 0;
  for (const pr of held.projects) {
    if (pr.manages) {
      const r = await setProjectManager(db, { organizationId: p.organizationId, projectId: pr.id, managerId: to!.id, byUserId: p.byUserId });
      if (!r.ok) { errors.push({ project: pr.name, error: r.error }); continue; }
      managed.push(pr.id);
    }
    // Open tasks of someone who isn't (or is no longer) on the team are handed over the same way
    const member = await db.projectMember.findUnique({ where: { projectId_userId: { projectId: pr.id, userId: leaver.id } } });
    if (!member) await db.projectMember.create({ data: { projectId: pr.id, userId: leaver.id } });
    if (p.mode === "reassign" && to && !(await db.projectMember.findUnique({ where: { projectId_userId: { projectId: pr.id, userId: to.id } } }))) {
      await db.projectMember.create({ data: { projectId: pr.id, userId: to.id, role: pr.manages ? null : pr.role } });
    }
    const r = await removeProjectMember(db, { organizationId: p.organizationId, projectId: pr.id, userId: leaver.id, byUserId: p.byUserId, handover: p.mode === "reassign" && to ? { mode: "reassign", toUserId: to.id } : { mode: "unassign" } });
    if (!r.ok) { errors.push({ project: pr.name, error: r.error }); continue; }
    left.push(pr.id);
    reassigned += r.reassigned.length;
    unassigned += r.unassigned;
    // The project's manager hears what happened to the team
    const mgr = (await db.project.findUnique({ where: { id: pr.id }, select: { managerId: true } }))?.managerId;
    if (mgr && mgr !== to?.id && mgr !== p.byUserId && (r.reassigned.length || r.unassigned)) {
      await notify(db, mgr, { kind: "project.handover", title: `${leaver.name} left the team of ${pr.name}`, body: p.mode === "reassign" ? `${r.reassigned.length} open task${r.reassigned.length === 1 ? "" : "s"} went to ${to?.name}.` : `${r.unassigned} open task${r.unassigned === 1 ? " is" : "s are"} waiting unassigned.`, link: `/projects/${pr.id}?tab=tasks`, dedupeKey: `handover:${pr.id}:${leaver.id}` });
    }
  }
  if (to && to.id !== p.byUserId && (reassigned || managed.length)) {
    await notify(db, to.id, { kind: "project.handover", title: `You took over ${leaver.name}'s work`, body: [managed.length ? `${managed.length} project${managed.length === 1 ? "" : "s"} to manage` : "", reassigned ? `${reassigned} open task${reassigned === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and "), link: "/me/tasks", dedupeKey: `handover-to:${leaver.id}:${to.id}` });
  }
  return { ok: true, managed, left, reassigned, unassigned, toUserId: to?.id ?? null, errors };
}
