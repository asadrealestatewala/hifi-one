// Monday 9:00 project emails, so owners and clients follow the work without asking the team:
// - owners (Executive dashboard and View all projects): every active project's health and what moved last week;
// - each client with an open project: progress, finished shared work, what waits for their approval, their requests.
// Sent once per person or client per week (the email log is the record), with an in-app notice beside the email.
// Free of Next.js imports so it can be tested against the database.
import type { PrismaClient } from "@prisma/client";
import { loadProjectHealth, type ProjectHealthRow } from "./project-health";
import { notifyMany, usersWithPermission } from "./notifications";
import { appUrl, firstName, sendTemplateQuietly } from "./email-template-store";

type Db = PrismaClient;
const DAY = 86_400_000;
const LIST = 5; // names shown in one row before "and N more"

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const listed = (items: string[], empty = "") => (items.length === 0 ? empty : items.length <= LIST ? items.join("; ") : `${items.slice(0, LIST).join("; ")}; and ${items.length - LIST} more`);
const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const addDays = (iso: string, n: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * DAY).toISOString().slice(0, 10);

// Last week: the seven days before `today` (Monday), e.g. "9 to 15 Nov 2026"
export function weekWindow(today: string) {
  const from = addDays(today, -7), to = addDays(today, -1);
  const year = to.slice(0, 4);
  return { from, to, since: new Date(`${from}T00:00:00Z`), until: new Date(`${today}T00:00:00Z`), label: `${shortDate(from)} to ${shortDate(to)} ${year}`, key: `week-${from}` };
}

export async function ownerDigest(db: Db, p: { organizationId: string; today: string; withBudget: boolean }) {
  const w = weekWindow(p.today);
  const projects = await db.project.findMany({ where: { organizationId: p.organizationId, status: "ACTIVE", archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, status: true, deadline: true, createdAt: true, budgetAmount: true } });
  const health = await loadProjectHealth(db, { organizationId: p.organizationId, projects, today: p.today, withBudget: p.withBudget });
  const ids = projects.map((x) => x.id);
  const [finished, overdue, requests, deliverables, posts] = await Promise.all([
    db.task.count({ where: { projectId: { in: ids }, status: "DONE", completedAt: { gte: w.since, lt: w.until } } }),
    db.task.count({ where: { projectId: { in: ids }, status: { not: "DONE" }, dueDate: { lt: w.until } } }),
    db.clientRequest.count({ where: { organizationId: p.organizationId, status: "PENDING" } }),
    db.deliverable.count({ where: { organizationId: p.organizationId, status: "PENDING" } }),
    db.contentItem.count({ where: { organizationId: p.organizationId, status: "CLIENT_REVIEW" } }),
  ]);
  const row = (h: ProjectHealthRow | undefined) => h ?? { health: "GREEN", reasons: [] as string[] };
  const named = (kind: string) => projects.filter((x) => row(health.get(x.id)).health === kind).map((x) => `${x.name} (${row(health.get(x.id)).reasons[0] ?? ""})`);
  const atRisk = named("RED"), watch = named("AMBER");
  return {
    week: w,
    active: projects.length, atRisk, watch, onTrack: projects.length - atRisk.length - watch.length,
    finished, overdue, requests, approvals: deliverables + posts,
  };
}

export async function clientDigest(db: Db, p: { organizationId: string; clientId: string; today: string }) {
  const w = weekWindow(p.today);
  const projects = await db.project.findMany({
    where: { organizationId: p.organizationId, clientId: p.clientId, status: { in: ["ACTIVE", "ON_HOLD"] }, archivedAt: null }, orderBy: { name: "asc" },
    select: { id: true, name: true, status: true, managerId: true, tasks: { select: { status: true, title: true, clientVisible: true, dueDate: true, completedAt: true } } },
  });
  if (!projects.length) return null;
  const ids = projects.map((x) => x.id);
  const [deliverables, posts, requests] = await Promise.all([
    db.deliverable.count({ where: { organizationId: p.organizationId, projectId: { in: ids }, status: "PENDING" } }),
    db.contentItem.count({ where: { organizationId: p.organizationId, clientId: p.clientId, status: "CLIENT_REVIEW" } }),
    db.clientRequest.findMany({ where: { clientId: p.clientId, projectId: { in: ids }, OR: [{ status: "PENDING" }, { decidedAt: { gte: w.since, lt: w.until } }] }, select: { status: true } }),
  ]);
  // Progress counts every task, as the portal does; only tasks shared with the client are ever named
  const progress = projects.map((x) => {
    const done = x.tasks.filter((t) => t.status === "DONE").length;
    return `${x.name}: ${x.tasks.length ? Math.round((done / x.tasks.length) * 100) : 0}% done${x.status === "ON_HOLD" ? " (on hold)" : ""}`;
  });
  const shared = projects.flatMap((x) => x.tasks.filter((t) => t.clientVisible));
  const finished = shared.filter((t) => t.status === "DONE" && t.completedAt && t.completedAt >= w.since && t.completedAt < w.until).map((t) => t.title);
  const next = shared.filter((t) => t.status !== "DONE" && t.dueDate && t.dueDate >= w.until).sort((a, b) => a.dueDate!.getTime() - b.dueDate!.getTime()).slice(0, 3).map((t) => `${t.title} due ${shortDate(t.dueDate!.toISOString().slice(0, 10))}`);
  const waiting = [deliverables ? plural(deliverables, "deliverable") : "", posts ? plural(posts, "post") : ""].filter(Boolean);
  const count = (s: string) => requests.filter((r) => r.status === s).length;
  const req = [count("APPROVED") ? `${count("APPROVED")} accepted` : "", count("DECLINED") ? `${count("DECLINED")} declined` : "", count("PENDING") ? `${count("PENDING")} waiting` : ""].filter(Boolean);
  const client = await db.client.findUnique({ where: { id: p.clientId }, select: { name: true, email: true, projectManagerId: true } });
  const pmId = client?.projectManagerId ?? projects[0].managerId;
  const pm = pmId ? await db.user.findUnique({ where: { id: pmId }, select: { name: true } }) : null;
  return {
    week: w, clientName: client?.name ?? "", clientEmail: client?.email ?? null, projectManager: pm?.name ?? "",
    progress, finished, next, waiting: waiting.length ? `${waiting.join(" and ")} to approve` : "", waitingCount: deliverables + posts, requests: req.join(", "),
  };
}

const alreadySent = (db: Db, organizationId: string, relatedId: string) => db.emailMessage.findFirst({ where: { organizationId, relatedType: "WeeklyDigest", relatedId }, select: { id: true } });

export async function sendWeeklyDigests(db: Db, p: { organizationId: string; today: string }) {
  const w = weekWindow(p.today);
  let owners = 0, clients = 0;

  // Owners: people with the Executive dashboard who can see every project. Budget reasons only for those allowed to see costs.
  const [execs, viewAll, costs] = await Promise.all(["dashboard.executive", "projects.view_all", "projects.costs"].map((k) => usersWithPermission(db, p.organizationId, k).then((ids) => new Set(ids))));
  const people = await db.user.findMany({ where: { id: { in: [...execs].filter((id) => viewAll.has(id)) } }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true } });
  const digests = new Map<boolean, Awaited<ReturnType<typeof ownerDigest>>>();
  for (const u of people) {
    const withBudget = costs.has(u.id);
    if (!digests.has(withBudget)) digests.set(withBudget, await ownerDigest(db, { organizationId: p.organizationId, today: p.today, withBudget }));
    const d = digests.get(withBudget)!;
    if (d.active === 0) continue;
    const relatedId = `${u.id}:${w.key}`;
    if (await alreadySent(db, p.organizationId, relatedId)) continue;
    const link = `${appUrl()}/projects?status=ATTENTION`;
    if (u.email) {
      await sendTemplateQuietly(db, {
        organizationId: p.organizationId, key: "project_weekly_owner", to: u.email, relatedType: "WeeklyDigest", relatedId, buttonUrl: link,
        vars: {
          first_name: firstName(u.name), week: w.label, active: String(d.active), at_risk_count: String(d.atRisk.length), at_risk: listed(d.atRisk, "None"), watch: listed(d.watch, "None"), on_track: String(d.onTrack),
          finished: plural(d.finished, "task"), overdue: plural(d.overdue, "task"), requests: d.requests ? `${d.requests} waiting` : "None waiting", approvals: d.approvals ? `${d.approvals} waiting on clients` : "None waiting", link,
        },
      });
    }
    await notifyMany(db, [u.id], { kind: "project.weekly", title: `Your projects this week: ${plural(d.atRisk.length, "project")} at risk`, body: `${d.watch.length} to watch, ${d.onTrack} on track, ${plural(d.finished, "task")} finished last week`, link: "/projects?status=ATTENTION", dedupeKey: `project-weekly:${relatedId}` });
    owners++;
  }

  // Clients: one email to the client's address (or its portal users when it has none), and a notice in their portal
  const withProjects = await db.project.findMany({ where: { organizationId: p.organizationId, status: { in: ["ACTIVE", "ON_HOLD"] }, archivedAt: null, clientId: { not: null } }, distinct: ["clientId"], select: { clientId: true } });
  for (const { clientId } of withProjects) {
    const active = await db.client.findFirst({ where: { id: clientId!, organizationId: p.organizationId, active: true }, select: { id: true } });
    if (!active) continue;
    const relatedId = `${clientId}:${w.key}`;
    if (await alreadySent(db, p.organizationId, relatedId)) continue;
    const d = await clientDigest(db, { organizationId: p.organizationId, clientId: clientId!, today: p.today });
    if (!d) continue;
    const portalUsers = await db.user.findMany({ where: { organizationId: p.organizationId, clientId: clientId!, active: true }, select: { id: true, email: true } });
    const to = d.clientEmail ? [d.clientEmail] : portalUsers.map((x) => x.email).filter((e): e is string => Boolean(e));
    const link = `${appUrl()}/portal`;
    for (const email of to) {
      await sendTemplateQuietly(db, {
        organizationId: p.organizationId, key: "project_weekly_client", to: email, relatedType: "WeeklyDigest", relatedId, buttonUrl: link,
        vars: { client_name: d.clientName, week: w.label, projects: d.progress.join("; "), finished: listed(d.finished), waiting: d.waiting, requests: d.requests, next: listed(d.next), project_manager: d.projectManager, link },
      });
    }
    await notifyMany(db, portalUsers.map((x) => x.id), { kind: "portal.weekly", title: `Your weekly update: ${d.finished.length} finished${d.waitingCount ? `, ${d.waitingCount} waiting for you` : ""}`, body: d.progress.join("; ").slice(0, 300), link: "/portal/projects", dedupeKey: `portal-weekly:${relatedId}` });
    if (to.length || portalUsers.length) clients++;
  }
  return { owners, clients, week: w.label };
}
