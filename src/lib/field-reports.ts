// Field sales phase 4 (decision 74): what the sales manager sees of the field teams. Per agent and day: visits against the target, how
// they ended, demos asked for, leads made, visits without a location, and two honesty checks that are shown, never hidden (visits
// logged without GPS, and two consecutive visits further apart than a person could have travelled in the time). One agent-day can be
// opened as a map of the day's route. The CSV holds one row per visit. Reads only; sales managers (field.review) only.
// Days are the company's days (the time zone offset is passed in), not the server's. Free of Next.js imports so it can be tested.
import type { Prisma, PrismaClient } from "@prisma/client";
import { tableCsv } from "./crm-contacts";
import { parseRange, rangeLabel, type DateRange } from "./date-range";
import { agentProfile, canReview, metresBetween, VISIT_OUTCOME_LABEL } from "./field-visits";
import { ProspectorError, type Actor } from "./prospector";

type Db = PrismaClient;
export const DEFAULT_DAYS = 7;
export const FAST_TRAVEL_KMH = 80; // a field agent on a bike in a city does not cover ground faster than this between two shops
const MAX_ROUTE_POINTS = 10; // Google Maps directions take at most ten stops in a link

export type ReportFilters = { productId?: string; agentId?: string; from?: string; to?: string; tzOffsetMinutes?: number; now?: Date };

const dayKey = (d: Date, tz: number) => new Date(d.getTime() + tz * 60_000).toISOString().slice(0, 10);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

// The report's whole days in the company's zone: default the last 7 days up to today
export function reportRange(f: ReportFilters): { range: DateRange; from: string; to: string; gte: Date; lt: Date } {
  const tz = f.tzOffsetMinutes ?? 0;
  const now = f.now ?? new Date();
  const today = dayKey(now, tz);
  const parsed = parseRange(f.from, f.to);
  const to = parsed.to ?? (parsed.from && parsed.from > today ? parsed.from : today);
  const from = parsed.from ?? isoDay(new Date(Date.parse(`${to}T00:00:00Z`) - (DEFAULT_DAYS - 1) * 86_400_000));
  return { range: { from, to }, from, to, gte: new Date(Date.parse(`${from}T00:00:00Z`) - tz * 60_000), lt: new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000 - tz * 60_000) };
}

export type AgentDay = {
  agentId: string; agentName: string; day: string; productId: string | null; productName: string | null;
  visits: number; // distinct businesses that day
  entries: number; // visit rows (a shop visited twice the same day counts once above, twice here)
  target: number;
  outcomes: Record<string, number>;
  interested: number; demosRequested: number; leads: number; needsDetails: number; noLocation: number; fastTravel: number;
  firstAt: Date; lastAt: Date;
};
export type AgentTotal = { agentId: string; agentName: string; days: number; visits: number; target: number; interested: number; demosRequested: number; leads: number; noLocation: number; fastTravel: number };

type VisitRow = Prisma.ProspectVisitGetPayload<{ select: { id: true; agentId: true; productId: true; prospectId: true; visitedAt: true; lat: true; lng: true; accuracyM: true; locationSource: true; outcome: true; reason: true; note: true; prospect: { select: { id: true; name: true; phone: true; email: true; address: true; city: true; status: true; leadId: true } } } }>;

async function loadVisits(db: Db, actor: Actor, f: ReportFilters) {
  if (!canReview(actor)) throw new ProspectorError("Only a sales manager can see the field reports.");
  const org = actor.organizationId;
  const r = reportRange(f);
  const where: Prisma.ProspectVisitWhereInput = { organizationId: org, visitedAt: { gte: r.gte, lt: r.lt }, ...(f.productId ? { productId: f.productId } : {}), ...(f.agentId ? { agentId: f.agentId } : {}) };
  const visits: VisitRow[] = await db.prospectVisit.findMany({
    where, orderBy: [{ agentId: "asc" }, { visitedAt: "asc" }],
    select: { id: true, agentId: true, productId: true, prospectId: true, visitedAt: true, lat: true, lng: true, accuracyM: true, locationSource: true, outcome: true, reason: true, note: true, prospect: { select: { id: true, name: true, phone: true, email: true, address: true, city: true, status: true, leadId: true } } },
  });
  const agentIds = [...new Set(visits.map((v) => v.agentId))];
  const [users, products] = await Promise.all([
    db.user.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } }),
    db.saasProduct.findMany({ where: { organizationId: org }, select: { id: true, name: true, dailyVisitTarget: true } }),
  ]);
  return { org, r, visits, names: new Map(users.map((u) => [u.id, u.name])), products: new Map(products.map((p) => [p.id, p])) };
}

export async function fieldReport(db: Db, actor: Actor, f: ReportFilters = {}) {
  const tz = f.tzOffsetMinutes ?? 0;
  const { org, r, visits, names, products } = await loadVisits(db, actor, f);
  const agentIds = [...new Set(visits.map((v) => v.agentId))];
  // Demos asked for are counted on the day they were asked. Leads are counted on the day of the visit: a business visited on Monday whose
  // demo was booked on Wednesday is Monday's lead, because that is the visit that earned it.
  const prospectIds = [...new Set(visits.map((v) => v.prospectId))];
  const [demos, profiles] = await Promise.all([
    db.demoBooking.findMany({ where: { organizationId: org, prospectId: { in: prospectIds }, requestedAt: { gte: r.gte, lt: r.lt } }, select: { prospectId: true, requestedById: true, requestedAt: true } }),
    Promise.all(agentIds.map((id) => agentProfile(db, org, id).then((p) => [id, p] as const))),
  ]);
  const profile = new Map(profiles);
  const demoKey = new Set(demos.map((d) => `${d.requestedById}|${dayKey(d.requestedAt, tz)}|${d.prospectId}`));

  const days = new Map<string, AgentDay & { businesses: Set<string>; leadIds: Set<string>; prev?: VisitRow }>();
  for (const v of visits) {
    const day = dayKey(v.visitedAt, tz);
    const key = `${v.agentId}|${day}`;
    let d = days.get(key);
    if (!d) {
      const p = profile.get(v.agentId);
      const prod = (v.productId && products.get(v.productId)) || (p?.productId && products.get(p.productId)) || null;
      d = { agentId: v.agentId, agentName: names.get(v.agentId) ?? "Unknown", day, productId: prod?.id ?? null, productName: prod?.name ?? null, visits: 0, entries: 0, target: p?.dailyVisitTarget ?? prod?.dailyVisitTarget ?? 0, outcomes: {}, interested: 0, demosRequested: 0, leads: 0, needsDetails: 0, noLocation: 0, fastTravel: 0, firstAt: v.visitedAt, lastAt: v.visitedAt, businesses: new Set(), leadIds: new Set() };
      days.set(key, d);
    }
    d.entries += 1; d.businesses.add(v.prospectId); d.lastAt = v.visitedAt;
    d.outcomes[v.outcome] = (d.outcomes[v.outcome] ?? 0) + 1;
    if (v.outcome === "INTERESTED" || v.outcome === "DEMO_REQUESTED") d.interested += 1;
    if (demoKey.has(`${v.agentId}|${day}|${v.prospectId}`)) { d.demosRequested += 1; demoKey.delete(`${v.agentId}|${day}|${v.prospectId}`); }
    if (v.prospect.leadId) d.leadIds.add(v.prospect.leadId);
    if (!v.prospect.phone && !v.prospect.email) d.needsDetails += 1;
    if (v.locationSource === "NONE" || v.lat === null || v.lng === null) d.noLocation += 1;
    else if (d.prev && d.prev.lat !== null && d.prev.lng !== null) {
      const km = metresBetween({ lat: Number(d.prev.lat), lng: Number(d.prev.lng) }, { lat: Number(v.lat), lng: Number(v.lng) }) / 1000;
      const hours = Math.max((v.visitedAt.getTime() - d.prev.visitedAt.getTime()) / 3_600_000, 1 / 60); // at least a minute, so two saves in the same minute do not divide by zero
      if (km > 0.5 && km / hours > FAST_TRAVEL_KMH) d.fastTravel += 1;
    }
    if (v.locationSource !== "NONE" && v.lat !== null && v.lng !== null) d.prev = v;
  }
  const rows: AgentDay[] = [...days.values()].map((x) => { const { businesses, leadIds, ...d } = x; delete (d as { prev?: unknown }).prev; return { ...d, visits: businesses.size, leads: leadIds.size }; }).sort((a, b) => (a.day === b.day ? a.agentName.localeCompare(b.agentName) : b.day.localeCompare(a.day)));

  const perAgent = new Map<string, AgentTotal>();
  for (const d of rows) {
    const t = perAgent.get(d.agentId) ?? { agentId: d.agentId, agentName: d.agentName, days: 0, visits: 0, target: 0, interested: 0, demosRequested: 0, leads: 0, noLocation: 0, fastTravel: 0 };
    t.days += 1; t.visits += d.visits; t.target += d.target; t.interested += d.interested; t.demosRequested += d.demosRequested; t.leads += d.leads; t.noLocation += d.noLocation; t.fastTravel += d.fastTravel;
    perAgent.set(d.agentId, t);
  }
  const agents = [...perAgent.values()].sort((a, b) => b.visits - a.visits || a.agentName.localeCompare(b.agentName));
  const totals = agents.reduce((s, a) => ({ visits: s.visits + a.visits, target: s.target + a.target, interested: s.interested + a.interested, demosRequested: s.demosRequested + a.demosRequested, leads: s.leads + a.leads, noLocation: s.noLocation + a.noLocation, fastTravel: s.fastTravel + a.fastTravel, days: s.days + a.days }), { visits: 0, target: 0, interested: 0, demosRequested: 0, leads: 0, noLocation: 0, fastTravel: 0, days: 0 });
  const businesses = new Set(visits.map((v) => v.prospectId)).size;
  return { range: r.range, label: rangeLabel(r.range), rows, agents, totals: { ...totals, businesses, entries: visits.length } };
}

// One agent's day, in order, for the map: the points with a location, the ones without listed beside, and a Google Maps directions link
export async function agentDay(db: Db, actor: Actor, agentId: string, day: string, f: { productId?: string; tzOffsetMinutes?: number } = {}) {
  const { visits, names } = await loadVisits(db, actor, { ...f, agentId, from: day, to: day, tzOffsetMinutes: f.tzOffsetMinutes });
  const stops = visits.map((v, i) => ({
    n: i + 1, id: v.id, visitedAt: v.visitedAt, outcome: v.outcome, outcomeLabel: VISIT_OUTCOME_LABEL[v.outcome as keyof typeof VISIT_OUTCOME_LABEL] ?? v.outcome, reason: v.reason, name: v.prospect.name, address: v.prospect.address, prospectId: v.prospectId, leadId: v.prospect.leadId,
    lat: v.locationSource !== "NONE" && v.lat !== null ? Number(v.lat) : null, lng: v.locationSource !== "NONE" && v.lng !== null ? Number(v.lng) : null, accuracyM: v.accuracyM,
  }));
  const located = stops.filter((s): s is typeof s & { lat: number; lng: number } => s.lat !== null && s.lng !== null);
  const route = located.length >= 2 ? `https://www.google.com/maps/dir/${located.slice(0, MAX_ROUTE_POINTS).map((s) => `${s.lat},${s.lng}`).join("/")}` : located.length === 1 ? `https://www.google.com/maps/search/?api=1&query=${located[0].lat},${located[0].lng}` : null;
  let distanceKm = 0;
  for (let i = 1; i < located.length; i++) distanceKm += metresBetween(located[i - 1], located[i]) / 1000;
  // the pins as a drawing: positions scaled into a 0..1 box so the page can draw them without a map service
  const lats = located.map((s) => s.lat), lngs = located.map((s) => s.lng);
  const box = located.length ? { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLng: Math.min(...lngs), maxLng: Math.max(...lngs) } : null;
  // scaled around the middle, so stops at one spot sit in the centre rather than in a corner; the same scale on both axes keeps shapes true
  const span = box ? Math.max(box.maxLng - box.minLng, (box.maxLat - box.minLat) / Math.max(Math.cos(((box.minLat + box.maxLat) / 2) * Math.PI / 180), 0.2), 0.0005) : 1;
  const mid = box ? { lat: (box.minLat + box.maxLat) / 2, lng: (box.minLng + box.maxLng) / 2 } : { lat: 0, lng: 0 };
  const pins = located.map((s) => ({ n: s.n, x: 0.5 + (s.lng - mid.lng) / span, y: 0.5 - (s.lat - mid.lat) / span, outcome: s.outcome }));
  return { agentId, agentName: names.get(agentId) ?? "Unknown", day, stops, located: located.length, route, routeTruncated: located.length > MAX_ROUTE_POINTS, distanceKm: Math.round(distanceKm * 10) / 10, pins, spanM: box ? Math.round(metresBetween({ lat: box.minLat, lng: box.minLng }, { lat: box.maxLat, lng: box.maxLng })) : 0 };
}

// One row per visit, every visit in the filters (no page cap), as a spreadsheet file
export async function fieldVisitsCsv(db: Db, actor: Actor, f: ReportFilters = {}) {
  const tz = f.tzOffsetMinutes ?? 0;
  const { r, visits, names, products } = await loadVisits(db, actor, f);
  const photos = visits.length ? await db.storedFile.groupBy({ by: ["ownerId"], where: { organizationId: actor.organizationId, ownerType: "PROSPECT_VISIT", ownerId: { in: visits.map((v) => v.id) }, deletedAt: null }, _count: { _all: true } }) : [];
  const photoCount = new Map(photos.map((p) => [p.ownerId, p._count._all]));
  const local = (d: Date) => new Date(d.getTime() + tz * 60_000).toISOString().replace("T", " ").slice(0, 16);
  const head = ["Date and time", "Agent", "Solution", "Business", "Phone", "Email", "Address", "City", "Outcome", "Reason", "Note", "Latitude", "Longitude", "Accuracy (m)", "Photos", "Prospect status", "Lead"];
  const rows = visits.sort((a, b) => a.visitedAt.getTime() - b.visitedAt.getTime()).map((v) => [
    local(v.visitedAt), names.get(v.agentId) ?? "", v.productId ? products.get(v.productId)?.name ?? "" : "", v.prospect.name, v.prospect.phone ?? "", v.prospect.email ?? "", v.prospect.address ?? "", v.prospect.city ?? "",
    VISIT_OUTCOME_LABEL[v.outcome as keyof typeof VISIT_OUTCOME_LABEL] ?? v.outcome, v.reason ?? "", v.note ?? "", v.locationSource === "NONE" ? "" : v.lat?.toString() ?? "", v.locationSource === "NONE" ? "" : v.lng?.toString() ?? "", v.accuracyM ?? "", photoCount.get(v.id) ?? 0,
    v.prospect.status === "SENT_TO_CRM" ? "Converted" : v.prospect.status.toLowerCase().replace(/_/g, " "), v.prospect.leadId ? "yes" : "",
  ]);
  return { filename: `field-visits-${r.from}-to-${r.to}`, text: tableCsv(head, rows), count: rows.length };
}
