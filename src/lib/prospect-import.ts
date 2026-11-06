// Import prospects from a spreadsheet a person built by hand (Google Maps copied into Excel, a campaign sheet): .xlsx with one or more tabs, or CSV.
// A sales manager previews it first (nothing is saved), then imports. Each row becomes a prospect, never a lead, kept apart from the CRM until
// someone logs an interested contact. Every row is checked before it is saved:
//   - phone: read the way people type it locally (3359275375, 0335-9275375, 0092 335 9275375) and stored as +international in the chosen country
//   - the do-not-contact list (phone and email): refused
//   - prospects that already exist, whatever their status or owner, and earlier rows of the same file: refused
//   - CRM leads, with the shared duplicate protection: refused unless the organization has switched that check off
// Free of Next.js imports so it can be tested against the database.
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { normalizeEmail } from "./contacts";
import { normalizeFacebookUrl } from "./facebook-link";
import { findLeadDuplicates, getPolicy, suppressionMatcher } from "./lead-duplicates";
import { notify } from "./notifications";
import { isCountry, normalizeE164, phoneTail } from "./phone";
import { assignableAgents, isManager, ProspectorError, type Actor } from "./prospector";
import { rescoreProspects } from "./prospect-scoring";
import { websiteFrom } from "./prospect-manual";

type Db = PrismaClient;
export const MAX_IMPORT_ROWS = 1000;
export const DEFAULT_LABEL = "Manual scrape";

export const FIELDS = ["name", "phone", "email", "website", "maps", "status", "notes", "city"] as const;
export type Field = (typeof FIELDS)[number];
export const FIELD_LABEL: Record<Field, string> = { name: "Business name", phone: "Phone", email: "Email", website: "Website", maps: "Google Maps link", status: "Status (what happened)", notes: "Remarks / notes", city: "City or area" };
export type Mapping = Partial<Record<Field, number>>;

// ---------- reading the columns ----------
const SYNONYMS: Record<Field, string[]> = {
  name: ["nameofbusiness", "businessname", "business", "companyname", "company", "name", "title", "organization", "organisation"],
  phone: ["contactno", "contactnumber", "contact", "phonenumber", "phone", "mobileno", "mobilenumber", "mobile", "whatsapp", "cell", "telephone", "tel"],
  email: ["email", "emailaddress", "mail"],
  website: ["websitelink", "website", "web", "url", "site", "link"],
  maps: ["googlemaplink", "googlemapslink", "googlemaplocation", "maplink", "mapslink", "googlemap", "googlemaps", "map", "maps", "location"],
  status: ["status", "outcome", "response", "callstatus", "leadstatus"],
  notes: ["remarks", "remark", "notes", "note", "comments", "comment", "feedback"],
  city: ["city", "area", "town"],
};
const squash = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

export type SheetShape = { headerRow: number; headers: string[]; map: Mapping };

// The header is the first row with two or more filled cells. Columns are matched by their usual names; a column with no header that is full of
// Google Maps links (some sheets leave it unnamed) is taken as the maps column.
export function detectSheet(rows: string[][]): SheetShape {
  const headerRow = Math.max(0, rows.findIndex((r) => r.filter((c) => c.trim()).length >= 2));
  const headers = (rows[headerRow] ?? []).map((h) => h.trim());
  const width = Math.max(headers.length, ...rows.slice(headerRow + 1, headerRow + 40).map((r) => r.length), 0);
  while (headers.length < width) headers.push("");
  const map: Mapping = {};
  const used = new Set<number>();
  for (const f of FIELDS) {
    const exact = headers.findIndex((h, i) => !used.has(i) && SYNONYMS[f].includes(squash(h)));
    if (exact >= 0) { map[f] = exact; used.add(exact); }
  }
  if (map.maps === undefined) {
    const sample = rows.slice(headerRow + 1, headerRow + 40);
    const col = headers.findIndex((h, i) => !used.has(i) && !h && sample.filter((r) => MAPS_URL.test(r[i] ?? "")).length >= Math.max(2, sample.filter((r) => (r[i] ?? "").trim()).length / 2));
    if (col >= 0) { map.maps = col; used.add(col); }
  }
  return { headerRow, headers, map };
}

// ---------- reading a row ----------
const MAPS_URL = /(?:maps\.app\.goo\.gl|goo\.gl\/maps|google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|g\.page|share\.google)/i;
const URL_IN_TEXT = /(?:https?:\/\/|www\.)[^\s,;|]+/gi;
const SOCIAL_HOST = /(?:^|\.)(?:instagram|youtube|youtu|tiktok|linkedin|twitter|x|wa|whatsapp|t)\.(?:com|be|me|co)$/i;
const clean = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export type Links = { website: string | null; maps: string | null; facebook: string | null; other: string[] };
// A cell may hold a website, a Maps link, a Facebook page, or words such as "Dont have a website": sort what is a link and ignore the words.
export function sortLinks(...cells: string[]): Links {
  const out: Links = { website: null, maps: null, facebook: null, other: [] };
  for (const cell of cells) {
    const tokens = [...(cell.match(URL_IN_TEXT) ?? []), ...cell.replace(URL_IN_TEXT, " ").split(/\s+/).filter((t) => /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(t) && !/^\d+(\.\d+)*$/.test(t))];
    for (const t of tokens) {
      const token = t.replace(/[)>\].,]+$/, "");
      if (MAPS_URL.test(token)) { out.maps ??= /^https?:\/\//i.test(token) ? token.slice(0, 300) : `https://${token}`.slice(0, 300); continue; }
      const fb = normalizeFacebookUrl(token);
      if (fb) { out.facebook ??= fb; continue; }
      const site = websiteFrom(token);
      if (!site) continue;
      const host = new URL(site).hostname;
      if (/(?:^|\.)(?:facebook|fb)\.com$/i.test(host) || SOCIAL_HOST.test(host)) out.other.push(site);
      else out.website ??= site;
    }
  }
  return out;
}

const PHONE_IN_TEXT = /\+?\d[\d\s().-]{5,}\d/g;
// The numbers in a phone cell, leaving out any link written beside them. The first is the prospect's number; the rest go into the note.
export function phonesIn(cell: string): string[] {
  const text = cell.replace(URL_IN_TEXT, " ");
  return (text.match(PHONE_IN_TEXT) ?? []).map((m) => m.trim());
}

export type SheetInput = { name: string; rows: string[][]; headerRow: number; map: Mapping; include?: boolean };
export type ImportInput = { sheets: SheetInput[]; country?: string; label?: string; closeNotInterested?: boolean; assignToId?: string | null };

export type PlannedRow = {
  key: string; sheet: string; row: number; name: string; phone: string | null; email: string | null; website: string | null; mapsUrl: string | null; facebookUrl: string | null;
  city: string | null; notes: string | null; closed: boolean;
};
export type Skipped = { sheet: string; row: number; name: string; reason: string; kind: "invalid" | "inFile" | "prospect" | "lead" | "suppressed" };
export type Plan = {
  rows: PlannedRow[]; skipped: Skipped[]; ignored: number; country: string; label: string;
  counts: { read: number; ready: number; closed: number; invalid: number; inFile: number; prospect: number; lead: number; suppressed: number; withWebsite: number; withMaps: number };
};

const STATUS_WORD: Record<string, string> = { NEW: "new", REVIEWED: "reviewed", ASSIGNED: "assigned", CONTACTED: "contacted", NOT_INTERESTED: "closed as not interested", SENT_TO_CRM: "already a lead", DISMISSED: "dismissed" };
const NOT_INTERESTED = /not\s*inter+est|no\s*interest|do\s*not\s*call|don'?t\s*call|wrong\s*number/i;

export async function planImport(db: Db, actor: Actor, input: ImportInput): Promise<Plan> {
  if (!isManager(actor)) throw new ProspectorError("Only a sales manager can import prospects.");
  const org = actor.organizationId;
  const policy = await getPolicy(db, org);
  const picked = clean(input.country, 2).toUpperCase();
  const country = isCountry(picked) ? picked : policy.defaultCountry;
  const label = clean(input.label, 40) || DEFAULT_LABEL;
  const closeNo = input.closeNotInterested !== false;

  const sheets = input.sheets.filter((s) => s.include !== false);
  if (sheets.length === 0) throw new ProspectorError("Choose at least one sheet to import.");
  for (const s of sheets) if (s.map.name === undefined) throw new ProspectorError(`Choose the column that holds the business name for "${s.name}".`);
  const total = sheets.reduce((n, s) => n + Math.max(0, s.rows.length - s.headerRow - 1), 0);
  if (total > MAX_IMPORT_ROWS * 2) throw new ProspectorError(`That file has ${total} rows. Import at most ${MAX_IMPORT_ROWS} at a time: split the file.`);

  const [existing, suppressed] = await Promise.all([
    db.prospect.findMany({ where: { organizationId: org }, select: { phone: true, email: true, name: true, status: true } }),
    suppressionMatcher(db, org),
  ]);
  const byTail = new Map<string, { name: string; status: string }>();
  const byEmail = new Map<string, { name: string; status: string }>();
  for (const e of existing) {
    const t = phoneTail(e.phone);
    if (t && !byTail.has(t)) byTail.set(t, e);
    const m = normalizeEmail(e.email);
    if (m && !byEmail.has(m)) byEmail.set(m, e);
  }

  const rows: PlannedRow[] = [];
  const skipped: Skipped[] = [];
  const seen = new Map<string, string>(); // key -> "Sheet row N"
  let ignored = 0;
  let read = 0;
  const counts = { invalid: 0, inFile: 0, prospect: 0, lead: 0, suppressed: 0 };

  for (const sh of sheets) {
    const cell = (r: string[], f: Field) => (sh.map[f] === undefined ? "" : (r[sh.map[f] as number] ?? "").trim());
    for (let i = sh.headerRow + 1; i < sh.rows.length; i++) {
      const r = sh.rows[i];
      if (!r.some((c) => c.trim())) continue;
      const rowNo = i + 1;
      const name = clean(cell(r, "name"), 160);
      const phoneCell = cell(r, "phone");
      const numbers = phonesIn(phoneCell);
      const rawEmail = clean(cell(r, "email"), 200);
      // a heading or date line in the middle of the sheet has no name and no way to contact: it is not a business
      if (!name && numbers.length === 0 && !rawEmail) { ignored++; continue; }
      read++;
      if (read > MAX_IMPORT_ROWS) { skipped.push({ sheet: sh.name, row: rowNo, name: name || "(no name)", reason: `Over the limit of ${MAX_IMPORT_ROWS} rows per import. Import the rest in another file.`, kind: "invalid" }); counts.invalid++; continue; }
      const skip = (reason: string, kind: Skipped["kind"]) => { skipped.push({ sheet: sh.name, row: rowNo, name: name || "(no name)", reason, kind }); counts[kind]++; };

      if (!name) { skip("No business name.", "invalid"); continue; }
      const e164 = numbers.map((n) => normalizeE164(n, country)).filter(Boolean) as string[];
      const phone = e164[0] ?? null;
      const email = rawEmail ? normalizeEmail(rawEmail) : null;
      if (rawEmail && !email && !phone) { skip(`The email "${rawEmail}" does not look right and there is no usable phone.`, "invalid"); continue; }
      if (!phone && !email) { skip(phoneCell ? `The phone "${clean(phoneCell, 40)}" does not look like a valid number for ${country}.` : "No phone or email, so it cannot be contacted or checked for duplicates.", "invalid"); continue; }

      if (suppressed({ phone, email }) || e164.some((p) => suppressed({ phone: p }))) { skip("On the do-not-contact list.", "suppressed"); continue; }

      const tail = phoneTail(phone);
      const keys = [tail && `p:${tail}`, email && `e:${email}`].filter(Boolean) as string[];
      const earlier = keys.map((k) => seen.get(k)).find(Boolean);
      if (earlier) { skip(`Same phone or email as ${earlier}.`, "inFile"); continue; }
      const known = (tail && byTail.get(tail)) || (email && byEmail.get(email)) || null;
      if (known) { skip(`Already in Prospector as "${known.name}" (${STATUS_WORD[known.status] ?? known.status.toLowerCase()}).`, "prospect"); continue; }
      if (policy.mode !== "OFF") {
        const dup = (await findLeadDuplicates(db, { organizationId: org, phone, email, country }, policy))[0];
        if (dup) { skip(`Already a CRM lead (#${dup.number}${dup.closed ? `, ${dup.closed === "WON" ? "won" : "lost"}` : ""}).`, "lead"); continue; }
      }

      const links = sortLinks(cell(r, "website"), cell(r, "maps"), phoneCell);
      const status = clean(cell(r, "status"), 120);
      const remarks = clean(cell(r, "notes"), 400);
      const extra = [
        status && `Status in the sheet: ${status}.`,
        remarks && `${/[.!?]$/.test(remarks) ? remarks : `${remarks}.`}`,
        e164.length > 1 && `Other numbers: ${e164.slice(1).join(", ")}.`,
        rawEmail && !email && `Email not usable: ${rawEmail}.`,
        links.other.length > 0 && `Also: ${links.other.slice(0, 3).join(" ")}`,
      ].filter(Boolean).join(" ");
      const notes = extra ? extra.slice(0, 1000) : null;
      keys.forEach((k) => seen.set(k, `${sh.name} row ${rowNo}`));
      rows.push({
        key: `${sh.name}:${rowNo}`, sheet: sh.name, row: rowNo, name, phone, email, website: links.website, mapsUrl: links.maps, facebookUrl: links.facebook,
        city: clean(cell(r, "city"), 80) || null, notes, closed: closeNo && NOT_INTERESTED.test(status),
      });
    }
  }
  return {
    rows, skipped, ignored, country, label,
    counts: { read, ready: rows.length, closed: rows.filter((r) => r.closed).length, ...counts, withWebsite: rows.filter((r) => r.website).length, withMaps: rows.filter((r) => r.mapsUrl).length },
  };
}

export type ImportReport = { imported: number; closed: number; assigned: number; skipped: Skipped[]; counts: Plan["counts"]; label: string };

export async function importProspects(db: Db, actor: Actor, input: ImportInput, now = new Date()): Promise<ImportReport> {
  const plan = await planImport(db, actor, input);
  const org = actor.organizationId;
  const agentId = input.assignToId || null;
  if (agentId && !(await assignableAgents(db, org)).some((a) => a.id === agentId)) throw new ProspectorError("Choose an active sales team member.");
  if (plan.rows.length === 0) throw new ProspectorError(plan.skipped[0] ? `Nothing to import. First problem: ${plan.skipped[0].sheet} row ${plan.skipped[0].row}, ${plan.skipped[0].reason}` : "Nothing to import: the sheet has no rows.");

  const ids: string[] = [];
  const skipped = [...plan.skipped];
  const toSave = await db.$transaction(async (tx) => {
    // Two imports at once: the second waits, then drops what the first already saved
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`prospect-import:${org}`}, 0))`;
    const fresh = await tx.prospect.findMany({ where: { organizationId: org }, select: { phone: true, email: true, name: true } });
    const tails = new Map(fresh.map((e) => [phoneTail(e.phone), e.name] as const).filter(([t]) => t));
    const emails = new Map(fresh.map((e) => [normalizeEmail(e.email), e.name] as const).filter(([m]) => m));
    const keep: PlannedRow[] = [];
    for (const r of plan.rows) {
      const t = phoneTail(r.phone);
      const clash = (t && tails.get(t)) || (r.email && emails.get(r.email));
      if (clash) { skipped.push({ sheet: r.sheet, row: r.row, name: r.name, reason: `Already in Prospector as "${clash}".`, kind: "prospect" }); continue; }
      keep.push(r);
    }
    const data: Prisma.ProspectCreateManyInput[] = keep.map((r) => {
      const id = randomUUID();
      ids.push(id);
      const open = !r.closed;
      return {
        id, organizationId: org, searchId: null, placeId: `import:${id}`, origin: "MANUAL", name: r.name, phone: r.phone, email: r.email, website: r.website, mapsUrl: r.mapsUrl, city: r.city,
        country: plan.country, sourceLabel: plan.label, sourceDetail: r.sheet.slice(0, 120), notes: r.notes, addedById: actor.id, placeFetchedAt: now,
        status: r.closed ? "NOT_INTERESTED" : agentId && open ? "ASSIGNED" : "NEW",
        assignedToId: agentId && open ? agentId : null, assignedAt: agentId && open ? now : null,
      };
    });
    if (data.length) await tx.prospect.createMany({ data });
    const social = keep.map((r, i) => (r.facebookUrl ? { prospectId: data[i].id as string, organizationId: org, facebookUrl: r.facebookUrl, source: "MANUAL" } : null)).filter(Boolean) as Prisma.ProspectSocialCreateManyInput[];
    if (social.length) await tx.prospectSocial.createMany({ data: social });
    return keep;
  }, { timeout: 60_000, maxWait: 15_000 });

  if (ids.length) await rescoreProspects(db, org, ids, now);
  const assigned = agentId ? toSave.filter((r) => !r.closed).length : 0;
  if (assigned > 0 && agentId !== actor.id) {
    await notify(db, agentId as string, {
      kind: "prospect.assigned", title: `${assigned} prospects assigned to you`, body: "Prospector", link: "/leads/prospector/mine",
      dedupeKey: `prospect-import:${agentId}:${now.getTime()}:${assigned}`,
    });
  }
  const counts = { ...plan.counts, ready: toSave.length, closed: toSave.filter((r) => r.closed).length, prospect: skipped.filter((s) => s.kind === "prospect").length };
  return { imported: toSave.length, closed: counts.closed, assigned, skipped, counts, label: plan.label };
}
