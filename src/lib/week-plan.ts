// Plan the week (HR's Required Changes, item 4): the project manager writes a week of tasks for the team on one screen,
// uploads them from the Excel template, or copies last week's tasks, then saves them all at once. Every line becomes an
// ordinary task (project, person, due day, optional time, priority, hours), so the countdown, alerts, planner and reports
// treat it like any other. Rules: only projects the person manages (or every project with projects.manage), open
// projects, people on that project's team, days of the chosen week that have not passed. Nothing is saved when any line
// is wrong, and each line says what to fix. Free of Next.js imports so it can be tested against the database.
import type { Prisma, PrismaClient } from "@prisma/client";
import { deadlineAt } from "./task-deadline";
import { parseEstimate } from "./task-rules";
import { addDays, weekStart } from "./workload";
import { dateInZone } from "./hr-rules";
import { type Calendar, getWorkingContext, isTimeString, isWorkingDate } from "./working-calendar";

type Db = PrismaClient;
type Actor = { id: string; organizationId: string; permissions: ReadonlySet<string> };

export const PLAN_MAX_LINES = 200;
export const PLAN_PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;
export const TEMPLATE_HEADERS = ["Person", "Project", "Day", "Task", "Priority", "Due time", "Hours"] as const;

export type PlanLine = { personId: string; projectId: string; date: string; title: string; priority: string; dueTime: string; hours: string };
export type PlanDay = { date: string; label: string; working: boolean; past: boolean };
export type PlanProject = { id: string; name: string; number: string; team: string[] };
export type PlanPerson = { id: string; name: string; email: string | null };
export type PlanContext = { week: string; days: PlanDay[]; projects: PlanProject[]; people: PlanPerson[] };
export type LineError = { line: number; message: string }; // line counts from 0, as the lines were sent
export type Skipped = { row: number; reason: string }; // row is the spreadsheet row number

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const fold = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

// The projects whose work this person plans: all open ones with projects.manage, otherwise the open ones they manage.
export function plannedProjectsWhere(actor: Actor): Prisma.ProjectWhereInput {
  const base: Prisma.ProjectWhereInput = { organizationId: actor.organizationId, status: { in: ["ACTIVE", "ON_HOLD"] }, archivedAt: null };
  return actor.permissions.has("projects.manage") ? base : { ...base, managerId: actor.id };
}

export function planDays(week: string, today: string, cal: Pick<Calendar, "workDays">, holidays: readonly string[]): PlanDay[] {
  const from = weekStart(week);
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(from, i);
    const label = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
    return { date, label, working: isWorkingDate(cal, date, holidays), past: date < today };
  });
}

async function activeStaff(db: Db, organizationId: string, ids: string[]): Promise<Map<string, PlanPerson>> {
  if (ids.length === 0) return new Map();
  const users = await db.user.findMany({ where: { id: { in: [...new Set(ids)] }, organizationId, active: true, userType: "EMPLOYEE" }, select: { id: true, name: true, email: true } });
  return new Map(users.map((u) => [u.id, u]));
}

export async function weekPlanContext(db: Db, p: { actor: Actor; week: string; today: string; calendar: Calendar; holidays: readonly string[] }): Promise<PlanContext> {
  const projects = await db.project.findMany({
    where: plannedProjectsWhere(p.actor), orderBy: [{ name: "asc" }, { id: "asc" }], take: 300,
    select: { id: true, name: true, number: true, members: { select: { userId: true } } },
  });
  const staff = await activeStaff(db, p.actor.organizationId, projects.flatMap((pr) => pr.members.map((m) => m.userId)));
  const people = new Map<string, PlanPerson>();
  const list: PlanProject[] = projects.map((pr) => {
    const team = pr.members.map((m) => staff.get(m.userId)).filter((u): u is PlanPerson => Boolean(u));
    for (const u of team) people.set(u.id, u);
    return { id: pr.id, name: pr.name, number: pr.number, team: team.map((u) => u.id) };
  });
  return { week: weekStart(p.week), days: planDays(p.week, p.today, p.calendar, p.holidays), projects: list, people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

// Everything the Plan the week screen, its actions and the template need, for the week asked (this week when none or nonsense).
export async function loadPlanContext(db: Db, actor: Actor, week?: string | null, now = new Date()): Promise<{ today: string; calendar: Calendar; ctx: PlanContext }> {
  const profile = await db.companyProfile.findFirst({ where: { organizationId: actor.organizationId, isDefault: true }, select: { timezone: true } });
  const today = dateInZone(now, profile?.timezone ?? "UTC");
  const w = weekStart(week && /^\d{4}-\d{2}-\d{2}$/.test(week) && !Number.isNaN(Date.parse(`${week}T00:00:00Z`)) ? week : today);
  const work = await getWorkingContext(db, actor.organizationId, w, addDays(w, 6));
  return { today, calendar: work.calendar, ctx: await weekPlanContext(db, { actor, week: w, today, calendar: work.calendar, holidays: work.holidayDates }) };
}

// "Mon", "monday", "2026-11-24" or "24/11/2026" → a date of the week, or null.
export function readDay(raw: string, days: PlanDay[]): string | null {
  const v = fold(raw);
  if (!v) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  const date = iso ? `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}` : dmy ? `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}` : null;
  if (date) return days.some((d) => d.date === date) ? date : null;
  const word = v.replace(/[^a-z]/g, "");
  if (word.length < 2) return null;
  for (const d of days) {
    const name = DAY_NAMES[new Date(`${d.date}T12:00:00Z`).getUTCDay()];
    if (name.startsWith(word) || (word.length >= 3 && word.startsWith(name.slice(0, 3)))) return d.date;
  }
  return null;
}

export function readPriority(raw: string): string | null {
  const v = fold(raw);
  if (!v || v === "normal" || v === "medium" || v === "med" || v === "m") return "MEDIUM";
  if (v === "high" || v === "urgent" || v === "h") return "HIGH";
  if (v === "low" || v === "l") return "LOW";
  return null;
}

// "15:00", "3:00 pm", "3 pm", "15.30" → "HH:MM", "" when empty, null when it is not a time.
export function readTime(raw: string): string | null {
  const v = fold(raw).replace(/\./g, ":");
  if (!v) return "";
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(v);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? "0");
  if (m[3]) { if (h < 1 || h > 12) return null; h = (h % 12) + (m[3] === "pm" ? 12 : 0); }
  else if (m[2] === undefined) return null; // a bare number is too easy to misread
  const out = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  return isTimeString(out) ? out : null;
}

// The rows of the template (or any sheet with those headings) as plan lines. A row that cannot be matched is skipped with the
// reason, so the manager can add it by hand; blank rows are ignored.
export function linesFromSheet(rows: string[][], ctx: PlanContext): { lines: PlanLine[]; skipped: Skipped[] } {
  const headerAt = rows.slice(0, 10).findIndex((r) => r.some((c) => /^(task|title)/i.test(c.trim())));
  if (headerAt < 0) return { lines: [], skipped: [{ row: 1, reason: "No heading row with a Task column. Use the template." }] };
  const head = rows[headerAt].map((c) => fold(c));
  const col = (...names: RegExp[]) => head.findIndex((h) => names.some((n) => n.test(h)));
  const at = {
    person: col(/^(person|employee|name|assignee|staff)/), project: col(/^project/), day: col(/^(day|date|due date)$/, /^day/),
    title: col(/^(task|title)/), priority: col(/^priority/), time: col(/^(due time|time)/), hours: col(/^(hours|estimate)/),
  };
  const missing = (["person", "project", "day", "title"] as const).filter((k) => at[k] < 0);
  if (missing.length) return { lines: [], skipped: [{ row: headerAt + 1, reason: `Missing column${missing.length > 1 ? "s" : ""}: ${missing.map((k) => (k === "title" ? "Task" : k[0].toUpperCase() + k.slice(1))).join(", ")}. Use the template.` }] };

  const byName = new Map<string, PlanPerson[]>();
  for (const u of ctx.people) {
    for (const key of [fold(u.name), u.email ? fold(u.email) : ""].filter(Boolean)) byName.set(key, [...(byName.get(key) ?? []), u]);
  }
  const projectBy = new Map<string, PlanProject[]>();
  for (const pr of ctx.projects) for (const key of [fold(pr.name), fold(pr.number)]) projectBy.set(key, [...(projectBy.get(key) ?? []), pr]);

  const lines: PlanLine[] = [];
  const skipped: Skipped[] = [];
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  rows.slice(headerAt + 1).forEach((r, i) => {
    const row = headerAt + 2 + i;
    const skip = (reason: string) => { skipped.push({ row, reason }); };
    if (!r.some((c) => c.trim())) return;
    const title = cell(r, at.title).replace(/\s+/g, " ");
    if (!title) return skip("No task written.");
    const personText = cell(r, at.person), projectText = cell(r, at.project), dayText = cell(r, at.day);
    const people = byName.get(fold(personText)) ?? [];
    const projects = projectBy.get(fold(projectText)) ?? [];
    const why = !personText ? "No person." : people.length === 0 ? `Nobody called "${personText}" is on a project you plan.` : people.length > 1 ? `Two people are called "${personText}"; use their email instead.`
      : !projectText ? "No project." : projects.length === 0 ? `No open project "${projectText}" that you plan.` : projects.length > 1 ? `Two projects are called "${projectText}"; use the project number.`
      : null;
    if (why) return skip(why);
    const date = readDay(dayText, ctx.days);
    if (!date) return skip(dayText ? `"${dayText}" is not a day of this week.` : "No day.");
    const priority = readPriority(cell(r, at.priority));
    const time = readTime(cell(r, at.time));
    lines.push({
      personId: people[0].id, projectId: projects[0].id, date, title: title.slice(0, 200),
      priority: priority ?? "MEDIUM", dueTime: time ?? "", hours: cell(r, at.hours),
    });
    if (priority === null) skip(`Priority "${cell(r, at.priority)}" was not understood, so Medium was used.`);
    if (time === null) skip(`Due time "${cell(r, at.time)}" was not understood, so it was left empty (end of the office day).`);
  });
  return { lines, skipped };
}

// Last week's tasks on the same projects, one week later, to edit before saving. Subtasks and repeating tasks are left out
// (repeating tasks already make their own next one).
export async function linesFromLastWeek(db: Db, ctx: PlanContext): Promise<PlanLine[]> {
  const from = new Date(`${addDays(ctx.week, -7)}T00:00:00Z`), to = new Date(`${ctx.week}T00:00:00Z`);
  const ids = ctx.projects.map((p) => p.id);
  if (ids.length === 0) return [];
  const tasks = await db.task.findMany({
    where: { projectId: { in: ids }, dueDate: { gte: from, lt: to }, assigneeId: { not: null }, parentId: null, recurrence: null, recurredFromId: null },
    select: { title: true, projectId: true, assigneeId: true, dueDate: true, dueTime: true, priority: true, estimatedHours: true },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }, { id: "asc" }], take: PLAN_MAX_LINES,
  });
  const team = new Map(ctx.projects.map((p) => [p.id, new Set(p.team)]));
  return tasks.filter((t) => team.get(t.projectId)?.has(t.assigneeId!)).map((t) => ({
    personId: t.assigneeId!, projectId: t.projectId, date: addDays(t.dueDate!.toISOString().slice(0, 10), 7), title: t.title,
    priority: t.priority, dueTime: t.dueTime ?? "", hours: t.estimatedHours === null ? "" : String(Number(t.estimatedHours)),
  }));
}

// Every problem with the lines, or none. Pure.
export function checkLines(lines: PlanLine[], ctx: PlanContext): LineError[] {
  const errors: LineError[] = [];
  if (lines.length === 0) return [{ line: -1, message: "Add at least one task." }];
  if (lines.length > PLAN_MAX_LINES) return [{ line: -1, message: `Up to ${PLAN_MAX_LINES} tasks at a time. Split the week into two saves.` }];
  const projects = new Map(ctx.projects.map((p) => [p.id, p]));
  const days = new Map(ctx.days.map((d) => [d.date, d]));
  lines.forEach((l, line) => {
    const title = String(l.title ?? "").trim();
    const project = projects.get(String(l.projectId ?? ""));
    const day = days.get(String(l.date ?? ""));
    const message =
      title.length < 2 ? "Write the task." :
      title.length > 200 ? "Keep the task under 200 characters; put details in the description later." :
      !project ? "Choose a project you plan." :
      !l.personId ? "Choose who does it." :
      !project.team.includes(String(l.personId)) ? "That person is not on this project's team. Add them to the team first." :
      !day ? "Choose a day of this week." :
      day.past ? "That day has passed." :
      !(PLAN_PRIORITIES as readonly string[]).includes(String(l.priority)) ? "Choose a priority." :
      l.dueTime && !isTimeString(String(l.dueTime)) ? "Enter the due time as hours and minutes, for example 15:00." :
      !parseEstimate(l.hours).ok ? "Hours must be a number such as 2 or 1.5." :
      null;
    if (message) errors.push({ line, message });
  });
  return errors;
}

export type SavedPlan = { tasks: { id: string; title: string; projectId: string; assigneeId: string; date: string; dueTime: string | null; priority: string }[] };

// Saves every line as a task in one transaction, or nothing when any line is wrong.
export async function saveWeekPlan(db: Db, p: { actor: Actor; ctx: PlanContext; lines: PlanLine[]; now?: Date }): Promise<{ ok: true; saved: SavedPlan } | { ok: false; errors: LineError[] }> {
  const errors = checkLines(p.lines, p.ctx);
  if (errors.length) return { ok: false, errors };
  const now = p.now ?? new Date();
  // the team or the project may have changed since the screen was opened: check again against the database
  const projectIds = [...new Set(p.lines.map((l) => l.projectId))];
  const live = await db.project.findMany({ where: { id: { in: projectIds }, ...plannedProjectsWhere(p.actor) }, select: { id: true, members: { select: { userId: true } } } });
  const staff = await activeStaff(db, p.actor.organizationId, live.flatMap((pr) => pr.members.map((m) => m.userId)));
  const team = new Map(live.map((pr) => [pr.id, new Set(pr.members.map((m) => m.userId).filter((id) => staff.has(id)))]));
  const stale = p.lines.map((l, line) => (!team.get(l.projectId)?.has(l.personId) ? { line, message: team.has(l.projectId) ? "That person is no longer on this project's team." : "This project is closed or no longer yours to plan." } : null)).filter((x): x is LineError => Boolean(x));
  if (stale.length) return { ok: false, errors: stale };
  const tasks = await db.$transaction(p.lines.map((l) => db.task.create({
    data: {
      projectId: l.projectId, title: l.title.trim().replace(/\s+/g, " "), assigneeId: l.personId, createdById: p.actor.id, priority: l.priority,
      dueDate: new Date(`${l.date}T00:00:00.000Z`), dueTime: l.dueTime || null, assignedAt: now,
      estimatedHours: (parseEstimate(l.hours) as { ok: true; value: string | null }).value,
    },
    select: { id: true, title: true, projectId: true, assigneeId: true, dueTime: true, priority: true },
  })));
  return { ok: true, saved: { tasks: tasks.map((t, i) => ({ ...t, assigneeId: t.assigneeId!, date: p.lines[i].date })) } };
}

// ---------- the week by person, for the Planner ----------

export type WeekProgress = { total: number; done: number; late: number; notStarted: number };

// For each person, the tasks due in the week: how many are done, late (past the deadline and still open, or finished after
// it) and not started (still To do). Done tasks are counted too, unlike the grid, which shows open work only.
export async function weekProgress(db: Db, p: { projectWhere: Prisma.ProjectWhereInput; week: string; calendar: Pick<Calendar, "timezone" | "workEnd">; now?: Date; onlyUserId?: string }): Promise<Map<string, WeekProgress>> {
  const now = p.now ?? new Date();
  const from = new Date(`${weekStart(p.week)}T00:00:00Z`), to = new Date(`${addDays(weekStart(p.week), 7)}T00:00:00Z`);
  const tasks = await db.task.findMany({
    where: { project: { ...p.projectWhere, archivedAt: null, status: { not: "CANCELLED" } }, dueDate: { gte: from, lt: to }, assigneeId: p.onlyUserId ?? { not: null } },
    select: { assigneeId: true, status: true, dueDate: true, dueTime: true, completedAt: true }, take: 5000,
  });
  const out = new Map<string, WeekProgress>();
  for (const t of tasks) {
    const r = out.get(t.assigneeId!) ?? { total: 0, done: 0, late: 0, notStarted: 0 };
    const at = deadlineAt(t.dueDate, t.dueTime, p.calendar)!;
    r.total++;
    if (t.status === "DONE") { r.done++; if (t.completedAt && t.completedAt > at) r.late++; }
    else { if (at < now) r.late++; if (t.status === "TODO") r.notStarted++; }
    out.set(t.assigneeId!, r);
  }
  return out;
}
