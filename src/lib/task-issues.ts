// Problems reported inside a task (HR's Required Changes, item 2): anyone working on the task writes what is wrong; the
// project manager and the owners (executive dashboard) hear at once, in the bell and by email, with the time it was
// reported. The issue stays Open until the project manager (or anyone with projects.manage) resolves it with a note,
// and the person who reported it is told. Callers have already checked that the person may see the project.
import type { PrismaClient } from "@prisma/client";
import { notifyMany, usersWithPermission } from "./notifications";
import { appUrl, firstName, sendTemplateQuietly } from "./email-template-store";
import { TaskError } from "./tasks";

type Db = PrismaClient;
const LINK = (projectId: string, taskId: string) => `/projects/${projectId}?task=${taskId}`;
export const ISSUE_MAX = 2000;

export async function reportIssue(db: Db, p: { organizationId: string; projectId: string; taskId: string; actorId: string; body: string; now?: Date }) {
  const task = await db.task.findFirst({ where: { id: p.taskId, projectId: p.projectId, project: { organizationId: p.organizationId } }, select: { id: true, title: true, projectId: true, project: { select: { name: true, managerId: true, status: true } } } });
  if (!task) throw new TaskError("Task not found.");
  if (task.project.status === "COMPLETED" || task.project.status === "CANCELLED") throw new TaskError("This project is closed.");
  const body = p.body.trim();
  if (body.length < 3) throw new TaskError("Write what the problem is.");
  if (body.length > ISSUE_MAX) throw new TaskError("Keep the issue under 2,000 characters; add details as comments.");
  const open = await db.taskIssue.count({ where: { taskId: task.id, status: "OPEN" } });
  if (open >= 10) throw new TaskError("This task already has 10 open issues. Resolve some first.");
  const issue = await db.taskIssue.create({ data: { taskId: task.id, reportedById: p.actorId, body, ...(p.now ? { createdAt: p.now } : {}) } });

  const reporter = (await db.user.findUnique({ where: { id: p.actorId }, select: { name: true } }))?.name ?? "A team member";
  const owners = await usersWithPermission(db, p.organizationId, "dashboard.executive");
  const people = [...new Set([...(task.project.managerId ? [task.project.managerId] : []), ...owners])].filter((id) => id !== p.actorId);
  await notifyMany(db, people, { kind: "task.issue", title: `Issue on ${task.title}`, body: `${reporter}: ${body.slice(0, 160)}`, link: LINK(task.projectId, task.id), dedupeKey: `task-issue:${issue.id}` });
  const emails = await db.user.findMany({ where: { id: { in: people }, active: true, email: { not: null } }, select: { email: true, name: true } });
  for (const u of emails) {
    await sendTemplateQuietly(db, {
      organizationId: p.organizationId, key: "task_issue", to: u.email!, purpose: "NOREPLY", relatedType: "Task", relatedId: task.id, buttonUrl: `${appUrl()}${LINK(task.projectId, task.id)}`,
      vars: { first_name: firstName(u.name), reporter, task_title: task.title, project: task.project.name, issue: body.slice(0, 1000) },
    });
  }
  return issue;
}

// Only someone who manages the project closes an issue, and says how it was solved.
export async function resolveIssue(db: Db, p: { organizationId: string; issueId: string; actorId: string; canManageAll: boolean; resolution: string; now?: Date }) {
  const issue = await db.taskIssue.findFirst({ where: { id: p.issueId, task: { project: { organizationId: p.organizationId } } }, include: { task: { select: { id: true, title: true, projectId: true, project: { select: { managerId: true } } } } } });
  if (!issue) throw new TaskError("Issue not found.");
  if (!p.canManageAll && issue.task.project.managerId !== p.actorId) throw new TaskError("Only the project manager can resolve issues.");
  if (issue.status === "RESOLVED") throw new TaskError("This issue is already resolved.");
  const resolution = p.resolution.trim().slice(0, ISSUE_MAX);
  if (resolution.length < 2) throw new TaskError("Write how it was solved.");
  const done = await db.taskIssue.update({ where: { id: issue.id }, data: { status: "RESOLVED", resolvedById: p.actorId, resolvedAt: p.now ?? new Date(), resolution } });
  if (issue.reportedById !== p.actorId) {
    await notifyMany(db, [issue.reportedById], { kind: "task.issue_resolved", title: `Issue resolved on ${issue.task.title}`, body: resolution.slice(0, 160), link: LINK(issue.task.projectId, issue.task.id), dedupeKey: `task-issue-resolved:${issue.id}` });
  }
  return done;
}
