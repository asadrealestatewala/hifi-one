import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { paging } from "@/lib/paging";
import { projectScope } from "@/lib/projects";
import TaskListTable, { type ListRow } from "./TaskListTable";
import { AppliedFilters, Chips, Empty, PageHeader, Pager, SearchBox, Stat, ListToolbar } from "@/components/ui";

export type TaskSP = { view?: string; who?: string; tstatus?: string; priority?: string; project?: string; due?: string; q?: string; page?: string; from?: string };
const TS = ["TODO", "IN_PROGRESS", "REVIEW", "DONE"];
const PRIORITIES = ["HIGH", "MEDIUM", "LOW"];
const label = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

// Every task across the projects the person may see, with the filters that matter day to day.
// Counts come from aggregates over all tasks in scope; only the shown page is loaded.
export default async function TasksView({ user, sp, tabs }: { user: SessionUser; sp: TaskSP; tabs: React.ReactNode }) {
  const scope = { parentId: null, project: { ...projectScope(user), status: { not: "CANCELLED" as const } } };
  const who = sp.who === "all" ? "all" : "me";
  const tstatus = TS.includes(sp.tstatus ?? "") ? sp.tstatus! : sp.tstatus === "all" ? "all" : "open";
  const priority = PRIORITIES.includes(sp.priority ?? "") ? sp.priority : undefined;
  const due = ["overdue", "week"].includes(sp.due ?? "") ? sp.due : undefined;
  const q = sp.q?.trim();
  const now = new Date();
  const dayStart = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const weekEnd = new Date(dayStart.getTime() + 7 * 86_400_000);
  const where = {
    ...scope,
    ...(who === "me" ? { assigneeId: user.id } : {}),
    ...(tstatus === "open" ? { status: { not: "DONE" } } : tstatus === "all" ? {} : { status: tstatus }),
    ...(priority ? { priority } : {}),
    ...(sp.project ? { projectId: sp.project } : {}),
    ...(due === "overdue" ? { status: { not: "DONE" }, dueDate: { lt: dayStart } } : due === "week" ? { status: { not: "DONE" }, dueDate: { gte: dayStart, lt: weekEnd } } : {}),
    ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}),
  };
  const pg = paging(sp.page);
  const mine = { ...scope, assigneeId: user.id, status: { not: "DONE" } };
  const [rows, matched, open, overdue, week, review, projects] = await Promise.all([
    db.task.findMany({ where, include: { project: { select: { id: true, name: true, number: true, managerId: true, status: true } } }, orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }, { id: "asc" }], skip: pg.skip, take: pg.take }),
    db.task.count({ where }),
    db.task.count({ where: mine }),
    db.task.count({ where: { ...mine, dueDate: { lt: dayStart } } }),
    db.task.count({ where: { ...mine, dueDate: { gte: dayStart, lt: weekEnd } } }),
    db.task.count({ where: { ...scope, status: "REVIEW" } }),
    db.project.findMany({ where: { ...projectScope(user), status: { not: "CANCELLED" } }, orderBy: { number: "asc" }, select: { id: true, name: true, number: true } }),
  ]);
  const people = new Map((await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.assigneeId).filter(Boolean) as string[])] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  // Inline edits: the manager of a row's project (or anyone with projects.manage) edits details; assignees move their own tasks
  const canEdit = user.permissions.has("tasks.edit");
  const isManager = (p: { managerId: string }) => user.permissions.has("projects.manage") || p.managerId === user.id;
  const closed = (s: string) => s === "COMPLETED" || s === "CANCELLED";
  const managed = [...new Set(rows.filter((r) => canEdit && isManager(r.project) && !closed(r.project.status)).map((r) => r.projectId))];
  const team = managed.length ? await db.projectMember.findMany({ where: { projectId: { in: managed } }, select: { projectId: true, userId: true } }) : [];
  const staff = new Map((team.length ? await db.user.findMany({ where: { id: { in: [...new Set(team.map((m) => m.userId))] }, organizationId: user.organizationId, active: true, userType: "EMPLOYEE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : []).map((u) => [u.id, u]));
  const members: Record<string, { id: string; name: string }[]> = {};
  for (const m of team) { const u = staff.get(m.userId); if (u) (members[m.projectId] ??= []).push(u); }
  for (const list of Object.values(members)) list.sort((a, b) => a.name.localeCompare(b.name));
  const everyone = [...staff.values()];
  const listRows: ListRow[] = rows.map((t) => ({
    id: t.id, title: t.title, projectId: t.project.id, projectName: t.project.name, assigneeId: t.assigneeId, assigneeName: t.assigneeId ? people.get(t.assigneeId) ?? null : null,
    priority: t.priority, status: t.status, due: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null, late: Boolean(t.status !== "DONE" && t.dueDate && t.dueDate < dayStart),
    canManage: canEdit && isManager(t.project) && !closed(t.project.status),
    canMove: canEdit && !closed(t.project.status) && (isManager(t.project) || t.assigneeId === user.id),
  }));
  const cur: Record<string, string | undefined> = { view: "tasks", who: who === "me" ? undefined : "all", tstatus: tstatus === "open" ? undefined : tstatus, priority, project: sp.project, due, q, from: sp.from };
  const href = (over: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ ...cur, ...over })) if (v) p.set(k, v); return `/projects?${p}`; };
  const pname = projects.find((p) => p.id === sp.project);
  const applied = [
    q && { label: `“${q}”`, removeHref: href({ q: undefined }) },
    priority && { label: `Priority: ${label(priority)}`, removeHref: href({ priority: undefined }) },
    sp.project && { label: `Project: ${pname?.name ?? "unknown"}`, removeHref: href({ project: undefined }) },
    due && { label: due === "overdue" ? "Overdue" : "Due in 7 days", removeHref: href({ due: undefined }) },
  ].filter(Boolean) as { label: string; removeHref: string }[];
  return (
    <div className="space-y-5">
      <PageHeader title="Projects" subtitle="Delivery work, progress and deadlines in one place." />
      {tabs}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="My open tasks" value={open} href={href({ who: undefined, tstatus: undefined, due: undefined, page: undefined })} />
        <Stat label="Overdue" value={overdue} hint="assigned to me" href={href({ who: undefined, due: "overdue", tstatus: undefined })} />
        <Stat label="Due in 7 days" value={week} hint="assigned to me" href={href({ who: undefined, due: "week", tstatus: undefined })} />
        <Stat label="Waiting for review" value={review} hint="across my projects" href={href({ who: "all", tstatus: "REVIEW", due: undefined })} />
      </div>
      <AppliedFilters items={applied} clearHref="/projects?view=tasks" backHref={sp.from === "dashboard" ? "/dashboard" : undefined} />
      <ListToolbar>
        <SearchBox q={q} placeholder="Search task title" hidden={{ ...cur, q: undefined }} />
        <Chips current={who} items={[{ key: "me", label: "Assigned to me", href: href({ who: undefined, page: undefined }) }, { key: "all", label: "Everyone", href: href({ who: "all", page: undefined }) }]} />
        <Chips current={tstatus} items={[{ key: "open", label: "Open", href: href({ tstatus: undefined, page: undefined }) }, ...TS.map((s) => ({ key: s, label: label(s), href: href({ tstatus: s, page: undefined }) })), { key: "all", label: "All", href: href({ tstatus: "all", page: undefined }) }]} />
        <form className="flex flex-wrap gap-2" aria-label="More filters">
          {Object.entries(cur).filter(([k, v]) => v && !["project", "priority"].includes(k)).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <select name="project" defaultValue={sp.project ?? ""} aria-label="Project" className="input !w-auto"><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.number} {p.name}</option>)}</select>
          <select name="priority" defaultValue={priority ?? ""} aria-label="Priority" className="input !w-auto"><option value="">Any priority</option>{PRIORITIES.map((p) => <option key={p} value={p}>{label(p)}</option>)}</select>
          <button className="btn-ghost">Apply</button>
        </form>
      </ListToolbar>
      {rows.length === 0 ? <Empty title="No tasks match">{who === "me" && !applied.length && tstatus === "open" ? "Nothing is assigned to you right now. Try Everyone to see the team's tasks." : <Link className="underline" href="/projects?view=tasks">Clear the filters</Link>}</Empty> : (
        <>
          <TaskListTable rows={listRows} members={members} people={everyone} selectable={canEdit} />
          <div className="card !p-0"><Pager page={pg.page} size={pg.size} total={matched} href={(n) => href({ page: n > 1 ? String(n) : undefined })} /></div>
        </>
      )}
    </div>
  );
}
