import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, toFileActor } from "@/lib/auth";
import { db } from "@/lib/db";
import type { PermissionKey } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import { projectScope } from "@/lib/projects";
import { projectProgress } from "@/lib/project-rules";
import { projectProfitability } from "@/lib/project-finance";
import { projectFeed, KIND_LABEL, PHASE_LABEL, type ProjectPhase, type UpdateKind } from "@/lib/project-updates";
import { projectAssetRights } from "@/lib/file-access";
import { listAssets } from "@/lib/project-assets";
import { addMember, approveClientRequestAction, changeProjectManager, createTask, declineClientRequestAction, removeMember, setProjectStatus, updateMemberRole } from "../actions";
import ProjectDepth from "./ProjectDepth";
import ProjectMeetings from "./ProjectMeetings";
import Deliverables from "./Deliverables";
import ProjectAssets from "./ProjectAssets";
import ProjectUpdates from "./ProjectUpdates";
import ProjectTimeline from "./ProjectTimeline";
import TaskTimerButton from "./TaskTimerButton";
import { currentTimer } from "@/lib/task-timer";
import ProjectTabs, { type ProjectTab } from "./ProjectTabs";
import { resolveTab } from "./tabs";
import TaskBoard from "./TaskBoard";
import TaskDetail from "./TaskDetail";
import TaskChecklist from "./TaskChecklist";
import { listChecklist, listSavedChecklists } from "@/lib/task-checklists";
import Drawer from "@/components/ui/Drawer";
import Avatar from "@/components/ui/Avatar";
import ConfirmButton from "@/components/ui/ConfirmButton";
import { projectRequests } from "@/lib/client-requests";
import FilesPanel from "@/components/FilesPanel";
import PhaseTracker from "@/components/PhaseTracker";
import { openBlockers } from "@/lib/task-rules";
import { HEALTH_LABEL, HEALTH_TONE, loadProjectHealth } from "@/lib/project-health";
import { dateInZone } from "@/lib/hr-rules";
import { Badge, Notice, PageHeader, PanelForm, Stat, StatusBadge } from "@/components/ui";
import RemoveRecordPanel from "@/components/RemoveRecordPanel";
import { projectDeleteBlockers } from "@/lib/record-removal";
import { listLabels } from "@/lib/task-labels";
import { getCalendar } from "@/lib/working-calendar";
import { deadlineAt, deadlineView, taskTimes } from "@/lib/task-deadline";
import { archiveProjectAction, deleteProjectAction, restoreProjectAction } from "../removal-actions";
import { saveProjectAsTemplateAction } from "../template-actions";
import SubmitButton from "@/components/ui/SubmitButton";

export const dynamic = "force-dynamic";

const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const SCOPE_PREVIEW = 260;

// One project: a header with the key facts and figures, then tabs (Overview, Tasks, Updates, Files, Meetings,
// Time & money, Settings). Each tab only appears for people who can use it; every action keeps its own server-side check.
export default async function ProjectPage({
  params,
  searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; msg?: string; req?: string; removed?: string; task?: string; new?: string; tab?: string; fileError?: string; fileOk?: string; folder?: string; assetError?: string; assetOk?: string }> }) {
  const user = await requirePermission("projects.view");
  const { id } = await params;
  const { error, msg, req, removed, task: taskId, new: newPanel, tab, fileError, fileOk, folder, assetError, assetOk } = await searchParams;
  const project = await db.project.findFirst({
    where: { id, ...projectScope(user) },
    include: { members: true, tasks: { orderBy: { createdAt: "asc" } } },
  });
  if (!project) notFound();
  const org = user.organizationId;
  const can = (p: PermissionKey) => user.permissions.has(p);
  const canManage = can("projects.manage");
  const canMove = can("tasks.edit");
  const canCosts = can("projects.costs");
  const canMeet = can("meetings.use");
  const canRemove = can("records.delete");
  const closed = project.status === "COMPLETED" || project.status === "CANCELLED";
  const base = `/projects/${project.id}`;
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);

  const [projectCampaign, orgUsers, client, milestonesRaw, latest, waitingOnClient, nextMeeting, assetRights] = await Promise.all([
    project.campaignId ? db.campaign.findFirst({ where: { id: project.campaignId, organizationId: org }, select: { id: true, name: true } }) : null,
    db.user.findMany({ where: { organizationId: org, active: true, userType: "EMPLOYEE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    project.clientId ? db.client.findUnique({ where: { id: project.clientId } }) : null,
    db.milestone.findMany({ where: { projectId: project.id }, orderBy: { sortOrder: "asc" }, select: { name: true, dueDate: true, status: true } }),
    projectFeed(db, { organizationId: org, projectId: project.id, take: 1 }),
    db.deliverable.count({ where: { projectId: project.id, organizationId: org, status: "PENDING" } }),
    canMeet ? db.meeting.findFirst({ where: { organizationId: org, projectId: project.id, status: { in: ["SCHEDULED", "LIVE"] }, OR: [{ scheduledAt: null }, { scheduledAt: { gte: now } }] }, orderBy: { scheduledAt: "asc" }, select: { id: true, title: true, scheduledAt: true, status: true } }) : null,
    projectAssetRights(db, toFileActor(user), project.id),
  ]);
  const labels = await listLabels(db, user.organizationId);
  const profile = await db.companyProfile.findFirst({ where: { organizationId: org, isDefault: true }, select: { timezone: true } });
  const canDecide = canManage || project.managerId === user.id;
  const [fin, fileCount, removalBlockers, healthMap, requests] = await Promise.all([
    canCosts ? projectProfitability(db, org, project.id) : null,
    assetRights.read ? listAssets(db, org, project.id).then((a) => a.length) : 0,
    canRemove ? projectDeleteBlockers(db, project.id) : [],
    loadProjectHealth(db, { organizationId: org, projects: [project], today: dateInZone(now, profile?.timezone ?? "UTC"), withBudget: canCosts }),
    project.clientId ? projectRequests(db, { organizationId: org, projectId: project.id }) : null,
  ]);
  const health = healthMap.get(project.id) ?? null;

  const nameOf = new Map(orgUsers.map((u) => [u.id, u.name]));
  const progress = projectProgress(project.tasks);
  const open = taskId ? project.tasks.find((t) => t.id === taskId) ?? null : null;
  const comments = open ? await db.taskComment.findMany({ where: { taskId: open.id }, orderBy: { createdAt: "asc" }, take: 100 }) : [];
  // Checklist progress for the board, and the open task's own checklist with the organization's saved checklists
  const [checkRows, checkDoneRows, checklist, savedChecklists] = await Promise.all([
    db.taskChecklistItem.groupBy({ by: ["taskId"], where: { task: { projectId: project.id } }, _count: { _all: true } }),
    db.taskChecklistItem.groupBy({ by: ["taskId"], where: { task: { projectId: project.id }, done: true }, _count: { _all: true } }),
    open ? listChecklist(db, open.id) : Promise.resolve([]),
    open ? listSavedChecklists(db, user.organizationId) : Promise.resolve([]),
  ]);
  const checkTotal = new Map(checkRows.map((r) => [r.taskId, r._count._all]));
  const checkDone = new Map(checkDoneRows.map((r) => [r.taskId, r._count._all]));
  // Comment authors can also be the client's portal users, who are not in the staff list
  const outsiders = new Map((await db.user.findMany({ where: { id: { in: comments.map((c) => c.authorId).filter((a) => !nameOf.has(a)) } }, select: { id: true, name: true, clientId: true } })).map((u) => [u.id, u]));
  const top = project.tasks.filter((t) => !t.parentId);
  const byId = new Map(project.tasks.map((t) => [t.id, t]));
  const milestones = milestonesRaw.map((m) => ({ name: m.name, dueDate: m.dueDate ? String(m.dueDate).slice(0, 10) : null }));
  const nextMilestone = milestonesRaw.filter((m) => m.status !== "DONE").sort((a, b) => String(a.dueDate ?? "9999").localeCompare(String(b.dueDate ?? "9999")))[0] ?? null;
  const openTasks = top.filter((t) => t.status !== "DONE");
  const cal = await getCalendar(db, user.organizationId);
  // Late once the deadline (the due date's time, or the end of the office day) has passed
  const isOverdue = (t: (typeof top)[number]) => t.status !== "DONE" && t.dueDate !== null && deadlineAt(t.dueDate, t.dueTime, cal)! < now;
  const overdue = openTasks.filter(isOverdue);
  const soon = new Date(now.getTime() + 7 * 86_400_000);
  const attention = openTasks.filter((t) => t.dueDate && t.dueDate <= soon).sort((a, b) => a.dueDate!.getTime() - b.dueDate!.getTime()).slice(0, 6);
  const taskHref = (tid: string) => `${base}?task=${tid}`;
  const update = latest[0] ?? null;
  const showSettings = canManage || canCosts || (canRemove && (project.status === "CANCELLED" || Boolean(project.archivedAt)));

  const header = (
    <PageHeader
      back={{ href: "/projects", label: "All projects" }}
      title={project.name}
      subtitle={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{project.number}</span><StatusBadge status={project.status} />
          <span>· {client ? client.name : "Internal project"}</span>
          <span>· Manager: {nameOf.get(project.managerId) ?? "Unknown"}</span>
          {(project.startDate || project.deadline) && <span>· {project.startDate ? day(project.startDate) : "Start not set"} to {project.deadline ? day(project.deadline) : "no due date"}</span>}
          <span>· Phase: {project.phase ? PHASE_LABEL[project.phase as ProjectPhase] ?? project.phase : "not set"}</span>
          {projectCampaign && <span>· Campaign: {can("campaigns.view") ? <Link className="hover:underline" href={`/campaigns/${projectCampaign.id}`}>{projectCampaign.name}</Link> : projectCampaign.name}</span>}
        </span>
      }
      actions={!closed && (
        <div className="flex flex-wrap items-center gap-2">
          {canMove && <a href="#time" className="btn-ghost">Log time</a>}
          {canMove && <a href="#updates" className="btn-ghost">Post update</a>}
          {canManage && <Link href={`${base}?new=task`} className="btn">+ New task</Link>}
        </div>
      )}
    />
  );

  const figures = (
    <div className={`grid grid-cols-2 gap-3 ${fin ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
      <div className={`card !p-4 ${fin ? "col-span-2 lg:col-span-1" : ""}`}>
        <p className="text-xs font-medium text-muted">Progress (tasks done)</p>
        <p className="mt-0.5 text-2xl font-semibold tracking-tight">{progress}%</p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-hover" role="progressbar" aria-label="Progress" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div className={`h-full rounded-full ${progress >= 100 ? "bg-success" : "bg-primary"}`} style={{ width: `${progress}%` }} />
        </div>
      </div>
      <Stat label="Open tasks" href="#tasks" value={openTasks.length} hint={overdue.length > 0 ? <span className="text-brand font-medium">{overdue.length} overdue</span> : "None overdue"} />
      <Stat label="Next milestone" href="#milestones" value={<span className="text-base">{nextMilestone ? nextMilestone.name : "None set"}</span>} hint={nextMilestone?.dueDate ? `Due ${nextMilestone.dueDate}` : undefined} />
      <Stat label="Waiting on client" href="#deliverables" value={waitingOnClient} hint={waitingOnClient === 1 ? "deliverable to approve" : "deliverables to approve"} />
      {fin && <Stat label="Profit to date" href="#money" value={<span className="text-xl">{formatMoney(fin.profit.toString(), fin.currency)}</span>} hint={fin.budgetUsedPct !== null ? `${fin.budgetUsedPct.toString()}% of budget used` : "Restricted"} />}
    </div>
  );

  const overview = (
    <div key="overview" className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <section className="card space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Needs attention</h2>{health && <Badge tone={HEALTH_TONE[health.health]}>{HEALTH_LABEL[health.health]}</Badge>}</div>
          {health && health.health !== "PAUSED" && health.reasons.length > 0 && <p className="text-sm">{health.reasons.join(" · ")}</p>}
          {attention.length === 0 ? <p className="text-sm text-muted">Nothing overdue or due in the next 7 days.</p> : (
            <ul className="divide-y divide-border text-sm">
              {attention.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link href={taskHref(t.id)} className="hover:underline">{t.title}<span className="text-muted"> · {t.assigneeId ? nameOf.get(t.assigneeId) ?? "Unknown" : "Unassigned"}</span></Link>
                  <span className={isOverdue(t) ? "text-brand font-medium" : "text-muted"}>{isOverdue(t) ? "Overdue" : "Due"} {t.dueDate!.toISOString().slice(0, 10)}</span>
                </li>
              ))}
            </ul>
          )}
          {overdue.length > attention.filter(isOverdue).length && <p className="text-xs text-muted">More on the <a href="#tasks" className="underline">Tasks</a> tab.</p>}
        </section>
        {requests && (requests.waiting.length > 0 || requests.answered.length > 0) && (
          <section id="requests" className="card space-y-3" aria-labelledby="req-h">
            <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="req-h" className="font-semibold">Client requests</h2>{requests.waiting.length > 0 && <Badge tone="warning">{requests.waiting.length} waiting</Badge>}</div>
            {req === "accepted" && <Notice kind="ok">Request accepted. It is now a task the client can follow on their portal.</Notice>}
            {req === "declined" && <Notice kind="ok">Request declined. The client has your reason.</Notice>}
            {requests.waiting.length === 0 && <p className="text-sm text-muted">Nothing waiting. New requests from the client portal appear here for {canDecide ? "you" : "the project manager"} to accept or decline.</p>}
            <ul className="divide-y divide-border text-sm">
              {requests.waiting.map((r) => (
                <li key={r.id} className="space-y-2 py-3 first:pt-0">
                  <div><p className="font-medium">{r.title}</p><p className="text-xs text-muted">{r.askedBy} · {r.createdAt.toLocaleDateString()}{r.wantedBy ? ` · wanted by ${r.wantedBy}` : ""}</p></div>
                  {r.details && <p className="whitespace-pre-wrap text-muted">{r.details}</p>}
                  {canDecide && !closed && (
                    <div className="flex flex-wrap items-end gap-2">
                      <form action={approveClientRequestAction} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="projectId" value={project.id} /><input type="hidden" name="requestId" value={r.id} />
                        <div><label className="label" htmlFor={`ra-${r.id}`}>Give to</label><select id={`ra-${r.id}`} name="assigneeId" className="input w-44"><option value="">Unassigned</option>{project.members.map((m) => <option key={m.userId} value={m.userId}>{nameOf.get(m.userId) ?? "Unknown"}</option>)}</select></div>
                        <div><label className="label" htmlFor={`rd-${r.id}`}>Due</label><input id={`rd-${r.id}`} name="dueDate" type="date" defaultValue={r.wantedBy ?? ""} className="input w-40" /></div>
                        <div><label className="label" htmlFor={`rp-${r.id}`}>Priority</label><select id={`rp-${r.id}`} name="priority" defaultValue="MEDIUM" className="input w-28">{["LOW", "MEDIUM", "HIGH"].map((c) => <option key={c} value={c}>{c.charAt(0) + c.slice(1).toLowerCase()}</option>)}</select></div>
                        <SubmitButton pendingText="Accepting…">Accept as task</SubmitButton>
                      </form>
                      <form action={declineClientRequestAction}>
                        <input type="hidden" name="projectId" value={project.id} /><input type="hidden" name="requestId" value={r.id} />
                        <ConfirmButton title="Decline this request?" message={<>The client sees your reason on their portal and gets a notice. Say what they can do instead.</>} confirmLabel="Decline" reason>Decline</ConfirmButton>
                      </form>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {requests.answered.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted">Answered ({requests.answered.length})</summary>
                <ul className="mt-2 divide-y divide-border">
                  {requests.answered.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>{r.taskId ? <Link href={taskHref(r.taskId)} className="hover:underline">{r.title}</Link> : r.title}{r.declineReason && <span className="block text-xs text-muted">Reason: {r.declineReason}</span>}</span>
                      <span className="text-xs text-muted"><StatusBadge status={r.status} />{r.decidedBy ? ` ${r.decidedBy}` : ""}{r.decidedAt ? ` · ${r.decidedAt.toLocaleDateString()}` : ""}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        )}
        <section className="card space-y-3">
          <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">Latest update</h2><a href="#updates" className="text-xs text-primary hover:underline">All updates</a></div>
          <PhaseTracker phase={project.phase} />
          {update ? (
            <div className="space-y-1 text-sm">
              <p className="flex flex-wrap items-center gap-2 font-medium">{update.title}<Badge>{KIND_LABEL[update.kind as UpdateKind] ?? update.kind}</Badge></p>
              {update.body && <p className="line-clamp-3 whitespace-pre-wrap text-muted">{update.body}</p>}
              <p className="text-xs text-muted">{update.author} · {update.createdAt.toLocaleString()}</p>
            </div>
          ) : <p className="text-sm text-muted">No updates yet. The team posts what changed, what was tested and what is blocked.</p>}
        </section>
        {project.scope && (
          <section className="card space-y-2 text-sm">
            <h2 className="font-semibold">Scope</h2>
            {project.scope.length <= SCOPE_PREVIEW ? <p className="whitespace-pre-line">{project.scope}</p> : (
              <details className="group">
                <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                  <span className="group-open:hidden">{project.scope.slice(0, SCOPE_PREVIEW).trimEnd()}… <span className="text-primary">Show all</span></span>
                  <span className="hidden text-primary group-open:inline">Show less</span>
                </summary>
                <p className="mt-2 whitespace-pre-line">{project.scope}</p>
              </details>
            )}
          </section>
        )}
      </div>
      <div className="space-y-6">
        <section className="card space-y-3">
          <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">Team</h2>{canManage && !closed && <a href="#settings" className="text-xs text-primary hover:underline">Manage</a>}</div>
          {project.members.length === 0 ? <p className="text-sm text-muted">Nobody on the team yet.</p> : (
            <ul className="space-y-1.5 text-sm">
              {project.members.map((m) => <li key={m.userId} className="flex items-center gap-2"><Avatar name={nameOf.get(m.userId) ?? "Unknown"} userId={m.userId} size={28} /><span>{nameOf.get(m.userId) ?? "Unknown"}{m.role && <span className="text-muted"> · {m.role}</span>}</span></li>)}
            </ul>
          )}
        </section>
        <section className="card space-y-1 text-sm">
          <h2 className="mb-1 font-semibold">Coming up</h2>
          {canMeet && <div className="flex justify-between gap-2 border-t border-border py-2"><span>Next meeting</span>{nextMeeting ? <Link href={`/meetings/${nextMeeting.id}`} className="text-right hover:underline">{nextMeeting.title}<span className="block text-xs text-muted">{nextMeeting.status === "LIVE" ? "Live now" : nextMeeting.scheduledAt ? nextMeeting.scheduledAt.toLocaleString() : "Instant"}</span></Link> : <span className="text-muted">None booked</span>}</div>}
          <div className="flex justify-between gap-2 border-t border-border py-2"><span>Next milestone</span><span className="text-right text-muted">{nextMilestone ? `${nextMilestone.name}${nextMilestone.dueDate ? ` · ${nextMilestone.dueDate}` : ""}` : "None set"}</span></div>
          <div className="flex justify-between gap-2 border-t border-border py-2"><span>Deliverables with the client</span><a href="#deliverables" className="text-muted hover:underline">{waitingOnClient}</a></div>
          {assetRights.read && <div className="flex justify-between gap-2 border-t border-border py-2"><span>Files</span><a href="#files" className="text-muted hover:underline">{fileCount}</a></div>}
        </section>
      </div>
    </div>
  );

  const tasks = (
    <div key="tasks" className="space-y-6">
      <TaskBoard
        key={project.tasks.map((t) => `${t.id}:${t.status}:${t.blockedBy.join("")}:${t.labelIds.join("")}:${checkDone.get(t.id) ?? 0}/${checkTotal.get(t.id) ?? 0}`).join(",") + labels.map((l) => l.name + l.color).join("")}
        canMove={canMove && !closed}
        userId={user.id}
        isManager={canManage || project.managerId === user.id}
        tasks={top.map((t) => ({
          id: t.id, title: t.title, status: t.status, priority: t.priority,
          assignee: t.assigneeId ? nameOf.get(t.assigneeId) ?? "Unknown" : null, assigneeId: t.assigneeId,
          due: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null,
          overdue: isOverdue(t), deadline: deadlineView(t, cal, now),
          subDone: project.tasks.filter((x) => x.parentId === t.id && x.status === "DONE").length, subTotal: project.tasks.filter((x) => x.parentId === t.id).length,
          checkDone: checkDone.get(t.id) ?? 0, checkTotal: checkTotal.get(t.id) ?? 0,
          waitingFor: openBlockers(t.blockedBy, byId).map((x) => x.title), recurrence: t.recurrence, href: taskHref(t.id), labelIds: t.labelIds,
        }))}
        labels={labels}
      />
      <ProjectTimeline projectId={project.id} canEdit={(canManage || project.managerId === user.id) && !closed} today={todayIso} projectStart={project.startDate} deadline={project.deadline} milestones={milestones}
        tasks={top.map((t) => ({ id: t.id, title: t.title, status: t.status, createdAt: t.createdAt, startDate: t.startDate, dueDate: t.dueDate, completedAt: t.completedAt, assignee: t.assigneeId ? nameOf.get(t.assigneeId) ?? null : null, blockedBy: t.blockedBy }))} />
      <ProjectDepth user={user} projectId={project.id} closed={closed} part="milestones" />
    </div>
  );

  const settings = (
    <div key="settings" className="space-y-6">
      {canManage && (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="card space-y-3">
            <h2 className="font-semibold">Status and manager</h2>
            <form key={project.status} action={setProjectStatus} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="projectId" value={project.id} />
              <div>
                <label className="label" htmlFor="status">Project status</label>
                <select id="status" name="status" defaultValue={project.status} className="input w-48">
                  {["ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"].map((s) => <option key={s} value={s}>{s.replace("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}</option>)}
                </select>
              </div>
              <button className="btn-ghost">Save status</button>
            </form>
            {!closed && (
              <form action={changeProjectManager} className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
                <input type="hidden" name="projectId" value={project.id} />
                <div>
                  <label className="label" htmlFor="managerId">Project manager</label>
                  <select id="managerId" name="managerId" required defaultValue={project.managerId} className="input w-48">
                    {orgUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
                <button className="btn-ghost">Change manager</button>
                <p className="w-full text-xs text-muted">The previous manager stays on the team.</p>
              </form>
            )}
          </section>
          <section className="card space-y-3">
            <h2 className="font-semibold">Team</h2>
            <ul className="divide-y divide-border text-sm">
              {project.members.map((m) => {
                const who = nameOf.get(m.userId) ?? "Unknown";
                const isPm = m.userId === project.managerId;
                const openCount = openTasks.filter((t) => t.assigneeId === m.userId).length;
                return (
                  <li key={m.userId} className="flex flex-wrap items-center gap-2 py-2">
                    <Avatar name={who} userId={m.userId} size={28} />
                    <span className="min-w-32 flex-1">{who}{closed && m.role && <span className="text-muted"> · {m.role}</span>}{isPm && <span className="text-xs text-muted"> · manages the project</span>}</span>
                    {!closed && (
                      <form key={`${m.userId}:${m.role ?? ""}`} action={updateMemberRole} className="flex items-center gap-1">
                        <input type="hidden" name="projectId" value={project.id} /><input type="hidden" name="userId" value={m.userId} />
                        <input name="role" defaultValue={m.role ?? ""} maxLength={80} placeholder="Role" aria-label={`Role of ${who}`} className="input !w-40 !py-1 text-xs" />
                        <button className="btn-ghost !px-2 !py-1 text-xs">Save</button>
                      </form>
                    )}
                    {!closed && !isPm && (
                      <form action={removeMember}>
                        <input type="hidden" name="projectId" value={project.id} /><input type="hidden" name="userId" value={m.userId} />
                        <ConfirmButton className="btn-ghost !px-2 !py-1 text-xs !text-danger" title={`Remove ${who} from the team?`} confirmLabel="Remove from team"
                          message={
                            <div className="space-y-3">
                              <p>{who} will no longer see this project unless their role lets them see all projects. Logged time, finished tasks and comments keep their name.</p>
                              {openCount > 0 && (
                                <div>
                                  <label className="label" htmlFor={`handover-${m.userId}`}>Their {openCount} open task{openCount === 1 ? "" : "s"} here</label>
                                  <select id={`handover-${m.userId}`} name="handover" defaultValue={project.members.some((x) => x.userId === project.managerId) ? `to:${project.managerId}` : "unassign"} className="input">
                                    {project.members.filter((x) => x.userId !== m.userId).map((x) => <option key={x.userId} value={`to:${x.userId}`}>Give to {nameOf.get(x.userId) ?? "Unknown"}{x.userId === project.managerId ? " (manager)" : ""}</option>)}
                                    <option value="unassign">Leave unassigned</option>
                                    <option value="delete">Delete them</option>
                                  </select>
                                  <p className="mt-1 text-xs">Deleting keeps any task with logged time, files or a content post; those become unassigned instead.</p>
                                </div>
                              )}
                            </div>
                          }>
                          Remove
                        </ConfirmButton>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
            {!closed && <p className="text-xs text-muted">To remove the project manager, choose a new manager first.</p>}
            {!closed && (
              <form action={addMember} className="flex flex-wrap gap-2 border-t border-border pt-3">
                <input type="hidden" name="projectId" value={project.id} />
                <select name="userId" required aria-label="Team member" className="input w-48">
                  <option value="">Add a person…</option>
                  {orgUsers.filter((u) => !project.members.some((m) => m.userId === u.id)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                <input name="role" placeholder="Role (e.g. Designer)" aria-label="Role" className="input w-44" />
                <button className="btn-ghost">Add to team</button>
              </form>
            )}
          </section>
        </div>
      )}
      <ProjectDepth user={user} projectId={project.id} closed={closed} part="rates" />
      {user.permissions.has("projects.manage") && (
        <section className="card space-y-3">
          <div><h2 className="font-semibold">Save as template</h2><p className="text-sm text-muted">Copies this project&apos;s team roles, milestones and tasks (with subtasks, estimates, labels and due days) into a template for the next project like it. Clients, money and files are not copied.</p></div>
          <form action={saveProjectAsTemplateAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="projectId" value={project.id} />
            <div><label className="label" htmlFor="tplName">Template name</label><input id="tplName" name="name" required minLength={2} maxLength={80} defaultValue={project.name} className="input w-64" /></div>
            <SubmitButton className="btn-ghost" pendingText="Saving…">Save as template</SubmitButton>
          </form>
        </section>
      )}
      {canRemove && (project.status === "CANCELLED" || project.archivedAt) && (
        <details className="text-sm" open={Boolean(project.archivedAt)}>
          <summary className="cursor-pointer text-muted hover:text-foreground">{project.archivedAt ? "Restore this project" : "Remove this project"}</summary>
          <div className="mt-3">
            <RemoveRecordPanel kind="project" name={project.name} idField="projectId" id={project.id} archived={Boolean(project.archivedAt)} canArchive={project.status === "CANCELLED"}
              archiveHint="To archive it, set the project status to Cancelled first." blockers={removalBlockers}
              deleteBlockedReason={project.status === "CANCELLED" ? undefined : "To delete it, set the project status to Cancelled first."}
              archiveAction={archiveProjectAction} restoreAction={restoreProjectAction} deleteAction={deleteProjectAction} archiveLabel="Archive project" restoreLabel="Restore project" />
          </div>
        </details>
      )}
    </div>
  );

  const tabs: ProjectTab[] = [
    { key: "overview", label: "Overview", panel: overview },
    { key: "tasks", label: "Tasks", count: openTasks.length, panel: tasks },
    {
      key: "updates", label: "Updates", panel: (
        <div key="updates" className="space-y-6">
          <ProjectUpdates projectId={project.id} organizationId={org} phase={project.phase} hasClient={Boolean(project.clientId)} canPost={canMove} canSetPhase={canManage} closed={closed} msg={msg} />
          <Deliverables projectId={project.id} organizationId={org} canManage={canManage} hasClient={Boolean(project.clientId)} closed={closed} msg={msg} />
        </div>
      ),
    },
    ...(assetRights.read ? [{ key: "files", label: "Files", count: fileCount, panel: <ProjectAssets key="files" user={user} projectId={project.id} folder={folder} flash={{ assetError, assetOk }} /> }] : []),
    ...(canMeet ? [{ key: "meetings", label: "Meetings", panel: <ProjectMeetings key="meetings" projectId={project.id} organizationId={org} closed={closed} /> }] : []),
    {
      key: "time", label: canCosts ? "Time & money" : "Time", panel: (
        <div key="time" className="space-y-6">
          <ProjectDepth user={user} projectId={project.id} closed={closed} part="time" />
          {canCosts && <ProjectDepth user={user} projectId={project.id} closed={closed} part="money" />}
        </div>
      ),
    },
    ...(showSettings ? [{ key: "settings", label: "Settings", panel: settings }] : []),
  ];

  return (
    <div className="space-y-5">
      {error && <Notice kind="error">{error}</Notice>}
      {removed && <Notice kind="ok">{removed}</Notice>}
      {project.archivedAt && <Notice kind="ok">This project is archived, so it is hidden from project lists.{canRemove ? " Restore it from the Settings tab." : ""}</Notice>}
      <ProjectTabs initial={open || newPanel === "task" ? "tasks" : resolveTab(tab, tabs.map((t) => t.key)) ?? "overview"} tabs={tabs} header={<div key="header" className="space-y-4">{header}{figures}</div>} />
      {canManage && !closed && newPanel === "task" && (
        <Drawer title="New task" closeTo={`${base}?tab=tasks`}>
          <PanelForm action={createTask} closeTo={`${base}?tab=tasks`} submit="Add task" hint="Only people on the team can be assigned.">
            <input type="hidden" name="projectId" value={project.id} />
            <div><label className="label" htmlFor="nt-title">Task title</label><input id="nt-title" name="title" required minLength={2} maxLength={200} autoFocus className="input" /></div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div><label className="label" htmlFor="nt-as">Assignee</label>
                <select id="nt-as" name="assigneeId" className="input"><option value="">Unassigned</option>{project.members.map((m) => <option key={m.userId} value={m.userId}>{nameOf.get(m.userId) ?? "Unknown"}</option>)}</select></div>
              <div><label className="label" htmlFor="nt-pr">Priority</label>
                <select id="nt-pr" name="priority" defaultValue="MEDIUM" className="input">{["LOW", "MEDIUM", "HIGH"].map((c) => <option key={c} value={c}>{c.charAt(0) + c.slice(1).toLowerCase()}</option>)}</select></div>
              <div><label className="label" htmlFor="nt-due">Due date</label><input id="nt-due" name="dueDate" type="date" className="input" /></div>
              <div><label className="label" htmlFor="nt-time">Due time</label><input id="nt-time" name="dueTime" type="time" className="input" aria-describedby="nt-time-hint" /><p id="nt-time-hint" className="mt-1 text-xs text-muted">Leave empty for the end of the office day ({cal.workEnd}).</p></div>
              <div><label className="label" htmlFor="nt-est">Estimate (hours)</label><input id="nt-est" name="estimatedHours" inputMode="decimal" placeholder="e.g. 3" className="input" /></div>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="clientVisible" /> Visible to the client in their portal</label>
          </PanelForm>
        </Drawer>
      )}
      {open && (
        <Drawer title={open.title} closeTo={`${base}?tab=tasks`}>
          <TaskDetail
            key={`${open.id}:${open.status}:${project.tasks.length}:${comments.length}`}
            task={{ id: open.id, title: open.title, status: open.status, description: open.description ?? "", priority: open.priority, assigneeId: open.assigneeId ?? "", due: open.dueDate ? open.dueDate.toISOString().slice(0, 10) : "", start: open.startDate ? open.startDate.toISOString().slice(0, 10) : "", estimate: open.estimatedHours ? String(open.estimatedHours) : "", clientVisible: open.clientVisible, recurrence: open.recurrence ?? "", blockedBy: open.blockedBy, labelIds: open.labelIds, parentTitle: open.parentId ? byId.get(open.parentId)?.title ?? "another task" : null,
              dueTime: open.dueTime ?? "", workEnd: cal.workEnd, deadline: deadlineView(open, cal, now), times: taskTimes(open, cal.timezone, now) }}
            subtasks={project.tasks.filter((t) => t.parentId === open.id).map((t) => ({ id: t.id, title: t.title, status: t.status }))}
            candidates={project.tasks.filter((t) => t.id !== open.id && t.parentId !== open.id && open.parentId !== t.id).map((t) => ({ id: t.id, title: t.title }))}
            members={project.members.map((m) => ({ id: m.userId, name: nameOf.get(m.userId) ?? "Unknown" }))}
            labels={labels} canManageLabels={canManage}
            comments={comments.map((c) => ({ id: c.id, authorId: c.authorId, author: nameOf.get(c.authorId) ?? outsiders.get(c.authorId)?.name ?? "Former staff", body: c.body, at: c.createdAt.toLocaleString(), shared: !c.internal, fromClient: Boolean(outsiders.get(c.authorId)?.clientId) }))}
            checklist={<TaskChecklist taskId={open.id} taskDone={open.status === "DONE"} canSave={canManage}
              canWork={canMove && !closed && (canManage || project.managerId === user.id || open.assigneeId === user.id)}
              items={checklist.map((i) => ({ id: i.id, text: i.text, done: i.done, by: i.doneById ? nameOf.get(i.doneById) ?? outsiders.get(i.doneById)?.name ?? "Former staff" : null, at: i.doneAt ? i.doneAt.toLocaleString() : null }))}
              saved={savedChecklists.map((c) => ({ id: c.id, name: c.name, count: c.items.length }))} />}
            timer={canMove && !closed && open.status !== "DONE" && user.userType === "EMPLOYEE" && (project.managerId === user.id || project.members.some((m) => m.userId === user.id))
              ? <TaskTimerButton taskId={open.id} runningTaskId={(await currentTimer(db, { organizationId: user.organizationId, userId: user.id }))?.taskId ?? null} /> : null}
            canManage={(canManage || project.managerId === user.id) && !closed} canMoveSubtasks={canMove && !closed && (canManage || project.managerId === user.id || open.assigneeId === user.id)} canComment={canMove}
          >
            <FilesPanel user={user} ownerType="TASK" ownerId={open.id} returnTo={`${base}?task=${open.id}`} title="Files" flash={{ fileError, fileOk }} />
          </TaskDetail>
        </Drawer>
      )}
    </div>
  );
}
