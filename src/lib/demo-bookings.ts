// Field sales phase 3 (decision 73): the demo queue. A business that asks a field agent for a demo becomes a DemoBooking in REQUESTED;
// the onboarding team (permission prospector.schedule_demo) books a time, and booking it is what turns the prospect into a CRM lead,
// through the one shared path in prospect-crm.ts (owner: the agent who found it, source "Prospector: Field visit", product tag). The lead
// gets an APPOINTMENT activity with the demo time, and the agent is told. After the demo the team marks it done or a no-show on the same
// row, which is written on the lead's timeline. A request that cannot be booked is cancelled with a reason and the shop goes back to the
// agent's go-back list; a booked demo that is cancelled leaves the lead (a lead never goes back to being a prospect).
// Free of Next.js imports so it can be tested against the database.
import type { Prisma, PrismaClient } from "@prisma/client";
import { mirrorLeadActivity } from "./crm-contacts";
import { DEMO_CANCELLED } from "./field-visits";
import { notify, usersWithPermission } from "./notifications";
import { convertProspectToLead, loadProspect } from "./prospect-crm";
import { ProspectorError, type Actor } from "./prospector";

type Db = PrismaClient;

export const DEMO_STATUSES = ["REQUESTED", "SCHEDULED", "DONE", "NO_SHOW", "CANCELLED"] as const;
export type DemoStatus = (typeof DEMO_STATUSES)[number];
export const DEMO_STATUS_LABEL: Record<DemoStatus, string> = { REQUESTED: "Requested", SCHEDULED: "Booked", DONE: "Done", NO_SHOW: "No show", CANCELLED: "Cancelled" };
export const DEMO_MODES = ["ON_SITE", "ONLINE"] as const;
export type DemoMode = (typeof DEMO_MODES)[number];
export const DEMO_MODE_LABEL: Record<DemoMode, string> = { ON_SITE: "At the business", ONLINE: "Online" };
export const DEMO_CLOSE_STATUSES = ["DONE", "NO_SHOW", "CANCELLED"] as const;
const MAX_AHEAD_DAYS = 120; // a demo booked further ahead than this is a typo
const MAX_BEHIND_HOURS = 24; // a demo that happened this morning can still be written down
const NOTE_MAX = 1000;

export const canScheduleDemos = (a: Actor) => a.permissions.has("prospector.schedule_demo");
const clean = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);
const fmtWhen = (d: Date, zone?: string) => d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: zone });

async function loadBooking(db: Db, actor: Actor, id: string) {
  if (!canScheduleDemos(actor)) throw new ProspectorError("Only the onboarding team can book demos.");
  const b = await db.demoBooking.findFirst({ where: { id, organizationId: actor.organizationId }, include: { prospect: { select: { id: true, name: true, status: true, leadId: true, assignedToId: true } } } });
  if (!b) throw new ProspectorError("That demo request no longer exists.");
  return b;
}

export type ScheduleInput = { scheduledAt: string | Date; trainerId?: string | null; mode?: string; note?: string; timeZone?: string };
export type ScheduleResult = { bookingId: string; leadId: string; linkedExisting: boolean; rescheduled: boolean; owner: string };

// Book (or move) a demo. The first booking makes the lead; moving it only adds a new appointment on the lead's timeline.
export async function scheduleDemo(db: Db, actor: Actor, bookingId: string, input: ScheduleInput, now = new Date()): Promise<ScheduleResult> {
  const b = await loadBooking(db, actor, bookingId);
  if (b.status !== "REQUESTED" && b.status !== "SCHEDULED") throw new ProspectorError(`This demo is ${DEMO_STATUS_LABEL[b.status as DemoStatus]?.toLowerCase() ?? "closed"} and cannot be booked again.`);
  const at = input.scheduledAt instanceof Date ? input.scheduledAt : new Date(String(input.scheduledAt));
  if (Number.isNaN(at.getTime())) throw new ProspectorError("Choose the demo's date and time.", "scheduledAt");
  if (at.getTime() < now.getTime() - MAX_BEHIND_HOURS * 3600_000) throw new ProspectorError("That time is in the past. Choose when the demo will be.", "scheduledAt");
  if (at.getTime() > now.getTime() + MAX_AHEAD_DAYS * 86_400_000) throw new ProspectorError(`A demo cannot be booked more than ${MAX_AHEAD_DAYS} days ahead.`, "scheduledAt");
  const mode = clean(input.mode, 16) || "ON_SITE";
  if (!(DEMO_MODES as readonly string[]).includes(mode)) throw new ProspectorError("Choose how the demo is given: at the business or online.", "mode");
  const note = clean(input.note, NOTE_MAX) || null;
  const org = actor.organizationId;
  let trainerId = clean(input.trainerId, 64) || actor.id;
  const trainer = await db.user.findFirst({ where: { id: trainerId, organizationId: org, userType: "EMPLOYEE", active: true }, select: { id: true, name: true } });
  if (!trainer) throw new ProspectorError("Choose who gives the demo from the list.", "trainerId");
  trainerId = trainer.id;
  const rescheduled = b.status === "SCHEDULED";
  const when = fmtWhen(at, input.timeZone);
  const appointment = `Demo ${rescheduled ? "moved to" : "booked for"} ${when}, ${DEMO_MODE_LABEL[mode as DemoMode].toLowerCase()}, given by ${trainer.name}${note ? `. ${note}` : ""}`;

  // The lead: made now on the first booking, or the one the prospect already has (converted on a call, or booked before)
  let leadId = b.leadId ?? b.prospect.leadId ?? null;
  let linkedExisting = Boolean(leadId);
  let owner = b.prospect.assignedToId ?? b.requestedById;
  if (!leadId) {
    const row = await loadProspect(db, org, b.prospectId);
    if (!row) throw new ProspectorError("That prospect no longer exists.");
    if (row.status === "DISMISSED" || row.status === "NOT_INTERESTED") throw new ProspectorError(`${row.name} is ${row.status === "DISMISSED" ? "dismissed" : "closed as not interested"}. Ask a sales manager to restore it before booking a demo.`);
    const r = await convertProspectToLead(db, actor, row, {
      now, owner: row.assignedToId ?? b.requestedById,
      createdBody: () => `Became a lead when the onboarding team booked a demo: ${appointment}${row.address ? `. ${row.address}` : ""}`,
      notifyTitle: (name) => `${name} is now your lead: demo ${when}`,
      notifyBody: `Booked by the onboarding team${trainer.id !== actor.id ? `, given by ${trainer.name}` : ""}. Photos and visits are on the lead.`,
    });
    leadId = r.leadId; linkedExisting = r.linkedExisting; owner = r.owner;
  }
  await db.$transaction(async (tx) => {
    const moved = await tx.demoBooking.updateMany({ where: { id: b.id, status: { in: ["REQUESTED", "SCHEDULED"] } }, data: { status: "SCHEDULED", scheduledAt: at, scheduledById: actor.id, trainerId, mode, note, leadId } });
    if (moved.count !== 1) throw new ProspectorError("This demo was just changed by someone else. Reload the queue.");
    if (linkedExisting && !b.leadId) await tx.prospect.updateMany({ where: { id: b.prospectId, leadId: null }, data: { leadId, status: "SENT_TO_CRM" } });
    const a = await tx.leadActivity.create({ data: { leadId: leadId!, actorId: actor.id, kind: "APPOINTMENT", body: appointment } });
    await mirrorLeadActivity(tx, a.id);
    await tx.lead.updateMany({ where: { id: leadId!, OR: [{ nextFollowUp: null }, { nextFollowUp: { gt: at } }] }, data: { nextFollowUp: at } });
  });
  // The finding agent hears about a move or a linked lead too (the first booking's notice comes from the conversion itself)
  if ((rescheduled || linkedExisting) && owner !== actor.id) await notify(db, owner, { kind: "demo.scheduled", title: `${b.prospect.name}: demo ${rescheduled ? "moved to" : "booked for"} ${when}`, body: `Given by ${trainer.name}.`, link: `/leads/${leadId}`, dedupeKey: `demo-scheduled:${b.id}:${at.getTime()}` });
  if (trainerId !== actor.id) await notify(db, trainerId, { kind: "demo.assigned", title: `Demo ${when}: ${b.prospect.name}`, body: `${DEMO_MODE_LABEL[mode as DemoMode]}${note ? `. ${note}` : ""}`, link: `/leads/${leadId}`, dedupeKey: `demo-trainer:${b.id}:${at.getTime()}` });
  return { bookingId: b.id, leadId: leadId!, linkedExisting, rescheduled, owner };
}

export type CloseInput = { status: string; reason?: string; timeZone?: string };
export type CloseResult = { bookingId: string; status: DemoStatus; leadId: string | null };

// Done, no-show or cancelled. A request (no lead yet) can only be cancelled; a booked demo can be closed any of the three ways.
export async function closeDemo(db: Db, actor: Actor, bookingId: string, input: CloseInput, now = new Date()): Promise<CloseResult> {
  const b = await loadBooking(db, actor, bookingId);
  const status = clean(input.status, 16);
  if (!(DEMO_CLOSE_STATUSES as readonly string[]).includes(status)) throw new ProspectorError("Say what happened: done, no show or cancelled.");
  const reason = clean(input.reason, NOTE_MAX) || null;
  if (status === "CANCELLED" && !reason) throw new ProspectorError("Say why the demo is cancelled, so the agent knows.", "reason");
  if (b.status === "REQUESTED" && status !== "CANCELLED") throw new ProspectorError("This demo has not been booked yet. Book it first, or cancel the request.");
  if (b.status !== "REQUESTED" && b.status !== "SCHEDULED") throw new ProspectorError(`This demo is already ${DEMO_STATUS_LABEL[b.status as DemoStatus]?.toLowerCase() ?? "closed"}.`);
  const label = status === "DONE" ? "Demo held" : status === "NO_SHOW" ? "Demo missed: nobody was there" : "Demo cancelled";
  await db.$transaction(async (tx) => {
    const moved = await tx.demoBooking.updateMany({ where: { id: b.id, status: b.status }, data: { status, closedAt: now, closedById: actor.id, closeReason: reason } });
    if (moved.count !== 1) throw new ProspectorError("This demo was just changed by someone else. Reload the queue.");
    if (b.leadId) {
      const a = await tx.leadActivity.create({ data: { leadId: b.leadId, actorId: actor.id, kind: status === "CANCELLED" ? "NOTE" : "MEETING", outcome: status === "NO_SHOW" ? "NO_ANSWER" : null, body: `${label}${b.scheduledAt ? ` (was ${fmtWhen(b.scheduledAt, input.timeZone)})` : ""}${reason ? `: ${reason}` : ""}` } });
      await mirrorLeadActivity(tx, a.id);
    } else if (status === "CANCELLED") {
      // back to the agent's go-back list: still a prospect, with the reason in its notes
      const p = await tx.prospect.findUnique({ where: { id: b.prospectId }, select: { notes: true, status: true } });
      if (p && p.status !== "SENT_TO_CRM" && p.status !== "DISMISSED") await tx.prospect.update({ where: { id: b.prospectId }, data: { lastOutcome: DEMO_CANCELLED, notes: [p.notes, `${now.toISOString().slice(0, 10)}: demo not booked: ${reason}`].filter(Boolean).join("\n").slice(0, 4000) } });
    }
  });
  const agent = b.prospect.assignedToId ?? b.requestedById;
  if (agent !== actor.id && status !== "DONE") await notify(db, agent, { kind: "demo.closed", title: `${b.prospect.name}: ${label.toLowerCase()}`, body: reason ?? (status === "NO_SHOW" ? "The onboarding team found nobody there. Go back or call them." : undefined), link: b.leadId ? `/leads/${b.leadId}` : "/field", dedupeKey: `demo-closed:${b.id}` });
  return { bookingId: b.id, status: status as DemoStatus, leadId: b.leadId };
}

// ---------- the queue ----------
export type QueueTab = "requested" | "scheduled" | "done";
const TAB_STATUSES: Record<QueueTab, DemoStatus[]> = { requested: ["REQUESTED"], scheduled: ["SCHEDULED"], done: ["DONE", "NO_SHOW", "CANCELLED"] };
export const PAGE_SIZE = 25;

export async function demoQueue(db: Db, actor: Actor, f: { tab?: string; productId?: string; q?: string; page?: number }) {
  if (!canScheduleDemos(actor)) throw new ProspectorError("Only the onboarding team can see the demo queue.");
  const org = actor.organizationId;
  const tab: QueueTab = f.tab === "scheduled" || f.tab === "done" ? f.tab : "requested";
  const q = clean(f.q, 80);
  const where: Prisma.DemoBookingWhereInput = {
    organizationId: org, status: { in: TAB_STATUSES[tab] }, ...(f.productId ? { productId: f.productId } : {}),
    ...(q ? { prospect: { OR: [{ name: { contains: q, mode: "insensitive" } }, { phone: { contains: q.replace(/\D/g, "").slice(-9) || q } }, { contactName: { contains: q, mode: "insensitive" } }, { city: { contains: q, mode: "insensitive" } }] } } : {}),
  };
  const page = Math.max(1, Math.floor(f.page ?? 1));
  const [total, rows, counts] = await Promise.all([
    db.demoBooking.count({ where }),
    db.demoBooking.findMany({
      where, orderBy: tab === "scheduled" ? { scheduledAt: "asc" } : tab === "done" ? { closedAt: "desc" } : { requestedAt: "asc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE,
      include: { product: { select: { id: true, name: true, businessLabel: true } }, prospect: { select: { id: true, name: true, contactName: true, phone: true, email: true, address: true, city: true, lat: true, lng: true, leadId: true, status: true } } },
    }),
    db.demoBooking.groupBy({ by: ["status"], where: { organizationId: org }, _count: { _all: true } }),
  ]);
  const userIds = [...new Set(rows.flatMap((r) => [r.requestedById, r.trainerId, r.scheduledById, r.closedById].filter(Boolean) as string[]))];
  const names = new Map((await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const visitIds = rows.map((r) => r.visitId).filter(Boolean) as string[];
  const photoCounts = visitIds.length ? await db.storedFile.groupBy({ by: ["ownerId"], where: { organizationId: org, ownerType: "PROSPECT_VISIT", ownerId: { in: visitIds }, deletedAt: null }, _count: { _all: true } }) : [];
  const photos = new Map(photoCounts.map((p) => [p.ownerId, p._count._all]));
  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Record<string, number>;
  return {
    tab, page, total, size: PAGE_SIZE,
    counts: { requested: byStatus.REQUESTED ?? 0, scheduled: byStatus.SCHEDULED ?? 0, done: (byStatus.DONE ?? 0) + (byStatus.NO_SHOW ?? 0) + (byStatus.CANCELLED ?? 0) },
    rows: rows.map((r) => ({
      ...r, requestedByName: names.get(r.requestedById) ?? "Unknown", trainerName: r.trainerId ? names.get(r.trainerId) ?? null : null, closedByName: r.closedById ? names.get(r.closedById) ?? null : null,
      photos: r.visitId ? photos.get(r.visitId) ?? 0 : 0,
    })),
  };
}

// People who can give a demo: the onboarding team itself
export async function trainers(db: Db, organizationId: string) {
  const ids = await usersWithPermission(db, organizationId, "prospector.schedule_demo");
  return db.user.findMany({ where: { id: { in: ids }, organizationId, userType: "EMPLOYEE", active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}

// A lead's field history: every visit to the prospects behind it, newest first (shown on the lead page with the photos)
export async function leadFieldVisits(db: Db, organizationId: string, leadId: string) {
  const visits = await db.prospectVisit.findMany({
    where: { organizationId, prospect: { leadId } }, orderBy: { visitedAt: "desc" }, take: 50,
    select: { id: true, visitedAt: true, outcome: true, reason: true, note: true, lat: true, lng: true, locationSource: true, agentId: true, prospect: { select: { name: true, address: true } } },
  });
  if (visits.length === 0) return [];
  const names = new Map((await db.user.findMany({ where: { id: { in: [...new Set(visits.map((v) => v.agentId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return visits.map((v) => ({ ...v, agentName: names.get(v.agentId) ?? "Unknown" }));
}
