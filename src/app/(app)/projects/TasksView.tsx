import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { paging } from "@/lib/paging";
import { projectScope } from "@/lib/projects";
import TaskListTable from "./TaskListTable";
import { buildTaskRows } from "./task-rows";
import { AppliedFilters, Chips, Empty, Notice, PageHeader, Pager, SearchBox, Stat, SubmitButton, ListToolbar } from "@/components/ui";
import Drawer from "@/components/ui/Drawer";
import ConfirmButton from "@/components/ui/ConfirmButton";
import { LABEL_COLORS, LABEL_COLOR_NAME, listLabels, type Label } from "@/lib/task-labels";
import { createLabelAction, deleteLabelAction, updateLabelAction } from "./label-actions";
import LabelChip from "./LabelChip";

export type TaskSP = { view?: string; who?: string; tstatus?: string; priority?: string; project?: string; due?: string; q?: string; page?: string; from?: string; label?: string; labels?: string; labelError?: string; labelOk?: string };
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
  const labels = await listLabels(db, user.organizationId);
  const labelId = labels.some((l) => l.id === sp.label) ? sp.label : undefined;
  const now = new Date();
  const dayStart = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const weekEnd = new Date(dayStart.getTime() + 7 * 86_400_000);
  const where = {
    ...scope,
    ...(who === "me" ? { assigneeId: user.id } : {}),
    ...(tstatus === "open" ? { status: { not: "DONE" } } : tstatus === "all" ? {} : { status: tstatus }),
    ...(priority ? { priority } : {}),
    ...(sp.project ? { projectId: sp.project } : {}),
    ...(labelId ? { labelIds: { has: labelId } } : {}),
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
  const list = await buildTaskRows(user, rows, dayStart.toISOString().slice(0, 10), labels);
  const canLabels = user.permissions.has("projects.manage");
  const cur: Record<string, string | undefined> = { view: "tasks", who: who === "me" ? undefined : "all", tstatus: tstatus === "open" ? undefined : tstatus, priority, project: sp.project, label: labelId, due, q, from: sp.from };
  const href = (over: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ ...cur, ...over })) if (v) p.set(k, v); return `/projects?${p}`; };
  const pname = projects.find((p) => p.id === sp.project);
  const applied = [
    q && { label: `“${q}”`, removeHref: href({ q: undefined }) },
    priority && { label: `Priority: ${label(priority)}`, removeHref: href({ priority: undefined }) },
    sp.project && { label: `Project: ${pname?.name ?? "unknown"}`, removeHref: href({ project: undefined }) },
    due && { label: due === "overdue" ? "Overdue" : "Due in 7 days", removeHref: href({ due: undefined }) },
    labelId && { label: `Label: ${labels.find((l) => l.id === labelId)!.name}`, removeHref: href({ label: undefined }) },
  ].filter(Boolean) as { label: string; removeHref: string }[];
  return (
    <div className="space-y-5">
      <PageHeader title="Projects" subtitle="Delivery work, progress and deadlines in one place." />
      {sp.labelOk && !sp.labels && <Notice kind="ok">{sp.labelOk}</Notice>}
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
          {Object.entries(cur).filter(([k, v]) => v && !["project", "priority", "label"].includes(k)).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <select name="project" defaultValue={sp.project ?? ""} aria-label="Project" className="input !w-auto"><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.number} {p.name}</option>)}</select>
          <select name="priority" defaultValue={priority ?? ""} aria-label="Priority" className="input !w-auto"><option value="">Any priority</option>{PRIORITIES.map((p) => <option key={p} value={p}>{label(p)}</option>)}</select>
          {labels.length > 0 && <select name="label" defaultValue={labelId ?? ""} aria-label="Label" className="input !w-auto"><option value="">Any label</option>{labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>}
          <button className="btn-ghost">Apply</button>
        </form>
        {canLabels && <Link href={href({ labels: "1" })} className="btn-ghost">Labels</Link>}
      </ListToolbar>
      {rows.length === 0 ? <Empty title="No tasks match">{who === "me" && !applied.length && tstatus === "open" ? "Nothing is assigned to you right now. Try Everyone to see the team's tasks." : <Link className="underline" href="/projects?view=tasks">Clear the filters</Link>}</Empty> : (
        <>
          <TaskListTable {...list} />
          <div className="card !p-0"><Pager page={pg.page} size={pg.size} total={matched} href={(n) => href({ page: n > 1 ? String(n) : undefined })} /></div>
        </>
      )}
      {canLabels && sp.labels && <LabelsDrawer labels={labels} closeTo={href({ labels: undefined })} error={sp.labelError} ok={sp.labelOk} />}
    </div>
  );
}

// The organization's task labels: add, rename, recolour, remove. Removing takes the label off every task that has it.
function LabelsDrawer({ labels, closeTo, error, ok }: { labels: Label[]; closeTo: string; error?: string; ok?: string }) {
  const colorSelect = (id: string, value: string) => (
    <select id={id} name="color" defaultValue={value} className="input !w-auto" aria-label="Colour">{LABEL_COLORS.map((c) => <option key={c} value={c}>{LABEL_COLOR_NAME[c]}</option>)}</select>
  );
  return (
    <Drawer title="Task labels" closeTo={closeTo}>
      <div className="space-y-5 p-5 text-sm">
        <p className="text-muted">Labels such as Copy, Design or Ads can go on any project&apos;s tasks. Filter the task list by them, add or remove them in bulk, or group a project&apos;s board by them.</p>
        {error && <Notice kind="error">{error}</Notice>}
        {ok && <Notice kind="ok">{ok}</Notice>}
        <form action={createLabelAction} className="flex flex-wrap items-end gap-2">
          <div className="flex-1"><label className="label" htmlFor="nl-name">New label</label><input id="nl-name" name="name" required maxLength={24} placeholder="e.g. Design" className="input" /></div>
          {colorSelect("nl-color", "primary")}
          <SubmitButton>Add label</SubmitButton>
        </form>
        {labels.length === 0 ? <p className="text-muted">No labels yet.</p> : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {labels.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-2 p-2">
                <form action={updateLabelAction} className="flex flex-1 flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={l.id} />
                  <LabelChip label={l} />
                  <input name="name" defaultValue={l.name} maxLength={24} aria-label={`Name of ${l.name}`} className="input !w-36 !py-1" />
                  {colorSelect(`c-${l.id}`, l.color)}
                  <SubmitButton className="btn-ghost !py-1">Save</SubmitButton>
                </form>
                <form action={deleteLabelAction}>
                  <input type="hidden" name="id" value={l.id} />
                  <ConfirmButton title={`Remove ${l.name}?`} message="It comes off every task that has it. The tasks themselves stay." confirmLabel="Remove label" className="btn-ghost !py-1 text-brand">Remove</ConfirmButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Drawer>
  );
}
