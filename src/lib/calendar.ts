// A personal calendar feed (iCalendar) that Google Calendar, Outlook and Apple Calendar can subscribe to.
// The address contains a long random secret, like the "secret address" of other calendar tools: anyone holding the link can
// read the feed, so it can be switched off or replaced at any time. The feed only contains what the person could already see:
// their own tasks, leave and follow-ups, projects they manage, and contract or content dates if their role can view those.
import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";

type Db = PrismaClient;

export const newToken = () => crypto.randomBytes(24).toString("hex");

export async function setCalendarToken(db: Db, userId: string, mode: "create" | "rotate" | "off") {
  const token = mode === "off" ? null : newToken();
  await db.user.update({ where: { id: userId }, data: { calendarToken: token } });
  return token;
}

export async function permissionsOf(db: Db, userId: string): Promise<Set<string>> {
  const now = new Date();
  const roles = await db.userRole.findMany({
    where: { userId, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });
  return new Set(roles.flatMap((r) => r.role.permissions.map((p) => p.permission.key)));
}

export type CalEvent = { uid: string; date: string; title: string; description?: string };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const nextDay = (d: string) => iso(new Date(Date.parse(d) + 86400000));

// Everything the person may see, as all-day events. Returns null for an unknown, disabled or inactive token.
export async function eventsForToken(db: Db, token: string, now = new Date()): Promise<CalEvent[] | null> {
  if (!/^[0-9a-f]{48}$/.test(token)) return null;
  const user = await db.user.findUnique({ where: { calendarToken: token } });
  if (!user || !user.active || user.userType !== "EMPLOYEE") return null;
  const perms = await permissionsOf(db, user.id);
  const org = user.organizationId;
  const from = new Date(now.getTime() - 30 * 86400000);
  const to = new Date(now.getTime() + 180 * 86400000);
  const ev: CalEvent[] = [];

  for (const t of await db.task.findMany({ where: { assigneeId: user.id, status: { not: "DONE" }, dueDate: { gte: from, lte: to }, project: { organizationId: org } }, include: { project: { select: { name: true } } } })) {
    ev.push({ uid: `task-${t.id}`, date: iso(t.dueDate!), title: `Task due: ${t.title}`, description: `Project: ${t.project.name}` });
  }
  for (const l of await db.leaveRequest.findMany({ where: { userId: user.id, status: { in: ["APPROVED", "PENDING"] }, endDate: { gte: iso(from) }, startDate: { lte: iso(to) } }, include: { leaveType: { select: { name: true } } } })) {
    // an all-day event runs up to, not including, its end date
    ev.push({ uid: `leave-${l.id}`, date: l.startDate, title: `${l.status === "PENDING" ? "Leave requested" : "Leave"}: ${l.leaveType.name}` });
    if (l.endDate > l.startDate) ev.push({ uid: `leave-end-${l.id}`, date: l.endDate, title: `Leave ends: ${l.leaveType.name}` });
  }
  if (perms.has("crm.view")) {
    for (const l of await db.lead.findMany({ where: { organizationId: org, assignedToId: user.id, clientId: null, nextFollowUp: { gte: from, lte: to } } })) {
      ev.push({ uid: `lead-${l.id}`, date: iso(l.nextFollowUp!), title: `Follow up: ${l.name}`, description: l.company ?? undefined });
    }
  }
  if (perms.has("projects.view")) {
    for (const p of await db.project.findMany({ where: { organizationId: org, managerId: user.id, status: { in: ["ACTIVE", "ON_HOLD"] }, deadline: { gte: from, lte: to } } })) {
      ev.push({ uid: `project-${p.id}`, date: iso(p.deadline!), title: `Project deadline: ${p.name}`, description: p.number });
    }
  }
  if (perms.has("contracts.view")) {
    for (const c of await db.contract.findMany({ where: { organizationId: org, status: "ACTIVE", endDate: { gte: iso(from), lte: iso(to) } }, include: { client: { select: { name: true } } } })) {
      ev.push({ uid: `contract-${c.id}`, date: c.endDate!, title: `Contract ends: ${c.title}`, description: c.client.name });
    }
  }
  if (perms.has("content.view")) {
    for (const c of await db.contentItem.findMany({ where: { organizationId: org, status: { in: ["APPROVED", "SCHEDULED", "CLIENT_REVIEW"] }, plannedDate: { gte: iso(from), lte: iso(to) } } })) {
      ev.push({ uid: `content-${c.id}`, date: c.plannedDate!, title: `${c.platform.toLowerCase()} post: ${c.title}` });
    }
  }
  return ev.sort((a, b) => a.date.localeCompare(b.date));
}

// RFC 5545 text escaping and 75-octet line folding
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
function fold(line: string): string {
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (out.length === 0 ? 75 : 74)) { out.push(cur); cur = ""; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export function renderIcs(events: CalEvent[], name: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Hifi One//Calendar//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${esc(name)}`];
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}@hifi-one`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${e.date.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${nextDay(e.date).replace(/-/g, "")}`, `SUMMARY:${esc(e.title)}`);
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
