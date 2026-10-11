// Prospecting worklists: raw outreach records kept apart from the CRM, so unqualified rows never
// inflate lead and conversion metrics. A row becomes a real lead only when someone converts it.
import type { PrismaClient } from "@prisma/client";
import { mapHeaders, normalizeEmail, normalizePhone, parseCsv } from "./contacts";
import { ensureContactForLead } from "./crm-contacts";

export class WorklistError extends Error {}
export const MAX_ROWS = 5000;

export type ImportReport = { worklistId: string; imported: number; skipped: { row: number; reason: string }[]; duplicates: number; suppressed: number };

export function previewCsv(text: string) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new WorklistError("The file needs a header row and at least one data row.");
  if (rows.length - 1 > MAX_ROWS) throw new WorklistError(`Too many rows (limit ${MAX_ROWS}). Split the file.`);
  const headers = rows[0];
  const map = mapHeaders(headers);
  if (!("name" in map) && !("company" in map)) throw new WorklistError('Could not find a name or company column. Use headers such as "Name", "Company", "Email", "Phone".');
  return { headers, map, rows: rows.slice(1) };
}

export async function importWorklist(
  db: PrismaClient,
  p: { organizationId: string; name: string; source?: string; assignedToId?: string; targetDate?: string; csv: string; createdById: string },
): Promise<ImportReport> {
  if (p.name.trim().length < 2) throw new WorklistError("Name the worklist.");
  const { headers, map, rows } = previewCsv(p.csv);
  const cell = (r: string[], f: string) => (f in map ? (r[map[f]] ?? "").trim() : "");

  // Existing CRM leads and the do-not-contact list, loaded once for the whole file
  const [leads, suppressed] = await Promise.all([
    db.lead.findMany({ where: { organizationId: p.organizationId }, select: { id: true, email: true, phone: true } }),
    db.suppressedContact.findMany({ where: { organizationId: p.organizationId } }),
  ]);
  const leadByEmail = new Map(leads.filter((l) => l.email).map((l) => [l.email!, l.id]));
  const leadByPhone = new Map(leads.filter((l) => l.phone).map((l) => [l.phone!, l.id]));
  const blockedEmail = new Set(suppressed.map((s) => s.email).filter(Boolean));
  const blockedPhone = new Set(suppressed.map((s) => normalizePhone(s.phone)).filter(Boolean));

  const skipped: { row: number; reason: string }[] = [];
  const seen = new Set<string>();
  const data: { rowNumber: number; name: string; company: string | null; email: string | null; phone: string | null; raw: Record<string, string>; status: string; duplicateLeadId: string | null }[] = [];
  let duplicates = 0;
  let sup = 0;
  rows.forEach((r, i) => {
    const rowNumber = i + 2; // as in the spreadsheet, header is row 1
    const rawEmail = cell(r, "email");
    const email = normalizeEmail(rawEmail);
    const phone = normalizePhone(cell(r, "phone"));
    const name = cell(r, "name") || cell(r, "company");
    if (!name) return void skipped.push({ row: rowNumber, reason: "No name or company" });
    if (rawEmail && !email) return void skipped.push({ row: rowNumber, reason: `Invalid email "${rawEmail}"` });
    if (!email && !phone) return void skipped.push({ row: rowNumber, reason: "No valid email or phone, so it cannot be contacted" });
    const keys = [email && `e:${email}`, phone && `p:${phone}`].filter(Boolean) as string[];
    if (keys.some((k) => seen.has(k))) return void skipped.push({ row: rowNumber, reason: "Duplicate of an earlier row in this file" });
    keys.forEach((k) => seen.add(k));
    const raw: Record<string, string> = {};
    headers.forEach((h, c) => { if (h.trim()) raw[h.trim()] = (r[c] ?? "").trim(); });
    const isSuppressed = (email && blockedEmail.has(email)) || (phone && blockedPhone.has(phone));
    const duplicateLeadId = (email && leadByEmail.get(email)) || (phone && leadByPhone.get(phone)) || null;
    if (isSuppressed) sup++;
    else if (duplicateLeadId) duplicates++;
    data.push({ rowNumber, name, company: cell(r, "name") ? cell(r, "company") || null : null, email, phone, raw, status: isSuppressed ? "DO_NOT_CONTACT" : "NEW", duplicateLeadId: duplicateLeadId || null });
  });
  if (data.length === 0) throw new WorklistError("No usable rows. " + (skipped[0] ? `First problem: row ${skipped[0].row}, ${skipped[0].reason}.` : ""));

  const wl = await db.worklist.create({
    data: {
      organizationId: p.organizationId, name: p.name.trim(), source: p.source || null, assignedToId: p.assignedToId || null, targetDate: p.targetDate || null, createdById: p.createdById,
      rows: { create: data },
    },
  });
  return { worklistId: wl.id, imported: data.length, skipped, duplicates, suppressed: sup };
}

export async function setRowStatus(db: PrismaClient, p: { organizationId: string; rowId: string; status: string; note?: string }) {
  if (!["NEW", "CONTACTED", "NOT_INTERESTED"].includes(p.status)) throw new WorklistError("Unknown status.");
  const row = await db.worklistRow.findFirst({ where: { id: p.rowId, worklist: { organizationId: p.organizationId } } });
  if (!row) throw new WorklistError("Row not found.");
  if (row.status === "DO_NOT_CONTACT") throw new WorklistError("This contact is on the do-not-contact list.");
  if (row.status === "CONVERTED") throw new WorklistError("This row has already become a lead.");
  return db.worklistRow.update({ where: { id: row.id }, data: { status: p.status, note: p.note?.trim() || row.note } });
}

// Creates a real CRM lead from a worklist row. Safe to retry: a second call returns the same lead.
export async function convertRow(db: PrismaClient, p: { organizationId: string; rowId: string; actorId: string }) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "WorklistRow" WHERE id = ${p.rowId} FOR UPDATE`;
    const row = await tx.worklistRow.findFirst({ where: { id: p.rowId, worklist: { organizationId: p.organizationId } }, include: { worklist: true } });
    if (!row) throw new WorklistError("Row not found.");
    if (row.convertedLeadId) return { leadId: row.convertedLeadId, created: false };
    if (row.status === "DO_NOT_CONTACT") throw new WorklistError("This contact is on the do-not-contact list and cannot become a lead.");
    // Re-check at conversion time: the contact may have been added to the CRM or suppression list since the import
    const email = row.email;
    const phone = row.phone;
    const blocked = await tx.suppressedContact.findFirst({
      where: { organizationId: p.organizationId, OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] },
    });
    if (blocked) throw new WorklistError("This contact is on the do-not-contact list and cannot become a lead.");
    const dup = await tx.lead.findFirst({ where: { organizationId: p.organizationId, OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] } });
    if (dup) throw new WorklistError("This contact is already in the CRM. Open the existing lead instead.");
    const stage = await tx.pipelineStage.findFirst({ where: { organizationId: p.organizationId }, orderBy: { sortOrder: "asc" } });
    if (!stage) throw new WorklistError("The pipeline has no stages.");
    const lead = await tx.lead.create({
      data: {
        organizationId: p.organizationId, name: row.name, company: row.company, email, phone, source: row.worklist.source ?? "Prospecting worklist", stageId: stage.id,
        assignedToId: p.actorId, createdById: p.actorId,
        activities: { create: { kind: "CREATED", actorId: p.actorId, body: `Converted from prospecting worklist "${row.worklist.name}", row ${row.rowNumber}` } },
      },
    });
    await ensureContactForLead(tx, lead.id);
    await tx.worklistRow.update({ where: { id: row.id }, data: { status: "CONVERTED", convertedLeadId: lead.id } });
    return { leadId: lead.id, created: true };
  });
}

// Two separate productivity numbers, as the spec requires: records processed vs genuine CRM leads generated.
export async function worklistMetrics(db: PrismaClient, worklistId: string) {
  const groups = await db.worklistRow.groupBy({ by: ["status"], where: { worklistId }, _count: true });
  const n = (s: string) => groups.find((g) => g.status === s)?._count ?? 0;
  const total = groups.reduce((a, g) => a + g._count, 0);
  return { total, processed: total - n("NEW") - n("DO_NOT_CONTACT"), remaining: n("NEW"), notInterested: n("NOT_INTERESTED"), doNotContact: n("DO_NOT_CONTACT"), leadsGenerated: n("CONVERTED") };
}

export async function addSuppression(db: PrismaClient, p: { organizationId: string; email?: string; phone?: string; reason?: string }) {
  const email = normalizeEmail(p.email);
  const phone = normalizePhone(p.phone);
  if (!email && !phone) throw new WorklistError("Enter a valid email or phone number.");
  await db.suppressedContact.create({ data: { organizationId: p.organizationId, email, phone, reason: p.reason?.trim() || null } });
  // Existing worklist rows for this contact stop being contactable immediately
  await db.worklistRow.updateMany({
    where: { worklist: { organizationId: p.organizationId }, status: { in: ["NEW", "CONTACTED"] }, OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] },
    data: { status: "DO_NOT_CONTACT" },
  });
}
