import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { projectScope } from "@/lib/projects";
import { projectProgress } from "@/lib/project-rules";
import { addMember, createTask, setProjectStatus } from "../actions";
import ProjectDepth from "./ProjectDepth";
import ProjectMeetings from "./ProjectMeetings";
import TaskBoard from "./TaskBoard";
import TaskDetail from "./TaskDetail";
import Drawer from "@/components/ui/Drawer";
import Avatar from "@/components/ui/Avatar";
import FilesPanel from "@/components/FilesPanel";
import { openBlockers } from "@/lib/task-rules";
import { Notice } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
  searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; task?: string; fileError?: string; fileOk?: string }> }) {
  const user = await requirePermission("projects.view");
  const { id } = await params;
  const { error, task: taskId, fileError, fileOk } = await searchParams;
  const project = await db.project.findFirst({
    where: { id, ...projectScope(user) },
    include: { members: true, tasks: { orderBy: { createdAt: "asc" } } },
  });
  if (!project) notFound();
  const projectCampaign = project.campaignId ? await db.campaign.findFirst({ where: { id: project.campaignId, organizationId: user.organizationId }, select: { id: true, name: true } }) : null;
  const canManage = user.permissions.has("projects.manage");
  const canMove = user.permissions.has("tasks.edit");
  const orgUsers = await db.user.findMany({
    where: { organizationId: user.organizationId, active: true, userType: "EMPLOYEE" },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const nameOf = new Map(orgUsers.map((u) => [u.id, u.name]));
  const client = project.clientId ? await db.client.findUnique({ where: { id: project.clientId } }) : null;
  const progress = projectProgress(project.tasks);
  const open = taskId ? project.tasks.find((t) => t.id === taskId) ?? null : null;
  const comments = open ? await db.taskComment.findMany({ where: { taskId: open.id }, orderBy: { createdAt: "asc" }, take: 100 }) : [];
  // Comment authors can also be the client's portal users, who are not in the staff list
  const outsiders = new Map((await db.user.findMany({ where: { id: { in: comments.map((c) => c.authorId).filter((a) => !nameOf.has(a)) } }, select: { id: true, name: true, clientId: true } })).map((u) => [u.id, u]));
  const top = project.tasks.filter((t) => !t.parentId);
  const byId = new Map(project.tasks.map((t) => [t.id, t]));
  const closed = project.status === "COMPLETED" || project.status === "CANCELLED";
  return (
    <div className="space-y-6">
      <Link href="/projects" className="text-sm text-muted hover:underline">← All projects</Link>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{project.name} <span className="text-muted text-base font-normal">{project.number}</span></h1>
          {projectCampaign && <p className="text-sm text-muted">Campaign: {user.permissions.has("campaigns.view") ? <Link className="hover:underline" href={`/campaigns/${projectCampaign.id}`}>{projectCampaign.name}</Link> : projectCampaign.name}</p>}
          <p className="text-sm text-muted">
            {client ? client.name : "Internal project"} · {project.status.replace("_", " ")} · Manager: {nameOf.get(project.managerId) ?? "Unknown"}
            {project.deadline && ` · Due ${project.deadline.toLocaleDateString()}`}
            {project.budgetAmount && ` · Budget ${formatMoney(project.budgetAmount, project.currency)}`}
          </p>
        </div>
        {canManage && (
          <form action={setProjectStatus} className="flex gap-2 items-end">
            <input type="hidden" name="projectId" value={project.id} />
            <div>
              <label className="label" htmlFor="status">Project status</label>
              <select id="status" name="status" defaultValue={project.status} className="input">
                {["ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
              </select>
            </div>
            <button className="btn-ghost">Update</button>
          </form>
        )}
      </div>
      <div>
        <div className="flex justify-between text-xs text-muted mb-1"><span>Progress (tasks done)</span><span>{progress}%</span></div>
        <div className="h-2 rounded-full bg-border overflow-hidden"><div className={`h-full transition-all duration-700 ${progress >= 100 ? "bg-success" : "bg-primary"}`} style={{ width: `${progress}%` }} /></div>
      </div>
      {project.scope && <section className="card text-sm whitespace-pre-line">{project.scope}</section>}

      <ProjectDepth user={user} projectId={project.id} closed={closed} />
      {user.permissions.has("meetings.use") && <ProjectMeetings projectId={project.id} organizationId={user.organizationId} closed={closed} />}

      <TaskBoard
        key={project.tasks.map((t) => `${t.id}:${t.status}:${t.blockedBy.join("")}`).join(",")}
        canMove={canMove && !closed}
        userId={user.id}
        isManager={canManage || project.managerId === user.id}
        tasks={top.map((t) => ({
          id: t.id, title: t.title, status: t.status, priority: t.priority,
          assignee: t.assigneeId ? nameOf.get(t.assigneeId) ?? "Unknown" : null, assigneeId: t.assigneeId,
          due: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null,
          overdue: t.status !== "DONE" && t.dueDate !== null && t.dueDate < new Date(),
          subDone: project.tasks.filter((x) => x.parentId === t.id && x.status === "DONE").length, subTotal: project.tasks.filter((x) => x.parentId === t.id).length,
          waitingFor: openBlockers(t.blockedBy, byId).map((x) => x.title), recurrence: t.recurrence, href: `/projects/${project.id}?task=${t.id}`,
        }))}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card space-y-3">
          <h2 className="font-semibold">Team</h2>
          <ul className="text-sm space-y-1">
            {project.members.map((m) => <li key={m.userId} className="flex items-center gap-2"><Avatar name={nameOf.get(m.userId) ?? "Unknown"} userId={m.userId} size={28} /><span>{nameOf.get(m.userId) ?? "Unknown"}{m.role && <span className="text-muted"> · {m.role}</span>}</span></li>)}
          </ul>
          {canManage && !closed && (
            <form action={addMember} className="flex gap-2 flex-wrap">
              <input type="hidden" name="projectId" value={project.id} />
              <select name="userId" required aria-label="Team member" className="input w-48">
                <option value="">Add member…</option>
                {orgUsers.filter((u) => !project.members.some((m) => m.userId === u.id)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              <input name="role" placeholder="Role (e.g. Designer)" aria-label="Role" className="input w-44" />
              <button className="btn-ghost">Add</button>
            </form>
          )}
        </section>
        {canManage && !closed && (
          <form action={createTask} className="card space-y-3">
            <h2 className="font-semibold">New task</h2>
            <input type="hidden" name="projectId" value={project.id} />
            <input name="title" required placeholder="Task title" aria-label="Task title" className="input" />
            <div className="grid grid-cols-3 gap-2">
              <select name="assigneeId" aria-label="Assignee" className="input">
                <option value="">Unassigned</option>
                {project.members.map((m) => <option key={m.userId} value={m.userId}>{nameOf.get(m.userId)}</option>)}
              </select>
              <select name="priority" aria-label="Priority" defaultValue="MEDIUM" className="input">
                {["LOW", "MEDIUM", "HIGH"].map((c) => <option key={c}>{c}</option>)}
              </select>
              <input name="dueDate" type="date" aria-label="Due date" className="input" />
            </div>
            <label className="text-sm flex items-center gap-2"><input type="checkbox" name="clientVisible" /> Visible to the client</label>
            <button className="btn">Add task</button>
          </form>
        )}
      </div>
      {open && (
        <Drawer title={open.title} closeTo={`/projects/${project.id}`}>
          <TaskDetail
            key={`${open.id}:${open.status}:${project.tasks.length}:${comments.length}`}
            task={{ id: open.id, title: open.title, status: open.status, description: open.description ?? "", priority: open.priority, assigneeId: open.assigneeId ?? "", due: open.dueDate ? open.dueDate.toISOString().slice(0, 10) : "", clientVisible: open.clientVisible, recurrence: open.recurrence ?? "", blockedBy: open.blockedBy, parentTitle: open.parentId ? byId.get(open.parentId)?.title ?? "another task" : null }}
            subtasks={project.tasks.filter((t) => t.parentId === open.id).map((t) => ({ id: t.id, title: t.title, status: t.status }))}
            candidates={project.tasks.filter((t) => t.id !== open.id && t.parentId !== open.id && open.parentId !== t.id).map((t) => ({ id: t.id, title: t.title }))}
            members={project.members.map((m) => ({ id: m.userId, name: nameOf.get(m.userId) ?? "Unknown" }))}
            comments={comments.map((c) => ({ id: c.id, authorId: c.authorId, author: nameOf.get(c.authorId) ?? outsiders.get(c.authorId)?.name ?? "Former staff", body: c.body, at: c.createdAt.toLocaleString(), shared: !c.internal, fromClient: Boolean(outsiders.get(c.authorId)?.clientId) }))}
            canManage={(canManage || project.managerId === user.id) && !closed} canMoveSubtasks={canMove && !closed && (canManage || project.managerId === user.id || open.assigneeId === user.id)} canComment={canMove}
          >
            <FilesPanel user={user} ownerType="TASK" ownerId={open.id} returnTo={`/projects/${project.id}?task=${open.id}`} title="Files" flash={{ fileError, fileOk }} />
          </TaskDetail>
        </Drawer>
      )}
    </div>
  );
}
