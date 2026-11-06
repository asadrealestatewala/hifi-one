"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { getKey } from "@/lib/integration-keys";
import { MAX_QUEUE_PER_CLICK, drainWebsiteChecks, queueChecks } from "@/lib/website-checks";
import { MAX_FETCH_PER_CLICK, SocialAccessError, fetchFacebookData, setFacebookLink } from "@/lib/prospect-social";
import { rescoreProspects } from "@/lib/prospect-scoring";
import { OUTCOME_LABEL, logOutreach } from "@/lib/prospect-crm";
import { addProspect, removeOwnProspect } from "@/lib/prospect-manual";
import { FIELDS, detectSheet, importProspects, planImport, type Field, type ImportInput, type Mapping, type Skipped } from "@/lib/prospect-import";
import { readWorkbook, type WorkbookSheet } from "@/lib/spreadsheet";
import { ProspectorError, assign, isManager, dismiss, markReviewed, restore, runSearch, setDailyLimits } from "@/lib/prospector";

const BASE = "/leads/prospector";
const OWN = "/leads/prospector/mine";
const s = (f: FormData, k: string) => String(f.get(k) ?? "");
const flash = (kind: "error" | "ok", m: string, extra = "", base = BASE): never => redirect(`${base}?${kind}=${encodeURIComponent(m)}${extra}`);
const backTo = (f: FormData) => (s(f, "back") === OWN ? OWN : BASE); // only our own two pages, never a link from the form

export async function searchProspects(formData: FormData): Promise<void> {
  const user = await requirePermission("prospector.use");
  let ok = "";
  let searchId = "";
  try {
    // The key (entered by a Super Admin in Settings > Integrations, else the server's) is read here and goes no further than the request to Google
    const r = await runSearch(db, {
      actor: user, apiKey: await getKey(db, user.organizationId, "GOOGLE_PLACES"),
      input: { businessType: s(formData, "businessType"), city: s(formData, "city"), country: s(formData, "country"), maxResults: Number(s(formData, "maxResults")) },
    });
    await audit(user, { action: "prospector.search", entity: "ProspectSearch", entityId: r.searchId, after: { found: r.found, added: r.added, requests: r.requests, costUsd: r.costUsd } });
    searchId = r.searchId;
    ok = `Found ${r.found} businesses: ${r.added} new, ${r.duplicates} already known (prospects, leads or do-not-contact)${r.closed ? `, ${r.closed} permanently closed left out` : ""}. Cost about $${r.costUsd.toFixed(3)}.${r.partialError ? ` Stopped early: ${r.partialError}` : ""}`;
  } catch (e) {
    if (e instanceof ProspectorError) return flash("error", e.message);
    throw e;
  }
  return flash("ok", ok, `&search=${searchId}`);
}

// Review, dismiss, restore and assign work on the ticked rows (or one row's own button). Only sales managers may; the service checks again.
export async function reviewProspects(formData: FormData): Promise<void> {
  const user = await requirePermission("crm.edit");
  const back = backTo(formData);
  const ids = formData.getAll("ids").map(String).filter(Boolean).slice(0, 500);
  if (ids.length === 0) return flash("error", "Tick at least one prospect first.", "", back);
  const op = s(formData, "op");
  try {
    let n = 0, label = "";
    if (op === "review") { n = await markReviewed(db, user, ids); label = "marked as reviewed"; }
    else if (op === "dismiss") { n = await dismiss(db, user, ids); label = "dismissed"; }
    else if (op === "restore") { n = await restore(db, user, ids); label = "restored"; }
    else if (op === "assign") {
      const agent = s(formData, "agentId");
      if (!agent) return flash("error", "Choose who to assign them to.", "", back);
      n = await assign(db, user, ids, agent); label = "assigned";
    } else return flash("error", "Unknown action.", "", back);
    await audit(user, { action: `prospect.${op}`, entity: "Prospect", after: { count: n, ids: ids.slice(0, 50) } });
    return flash("ok", `${n} prospect${n === 1 ? "" : "s"} ${label}.`, "", back);
  } catch (e) {
    if (e instanceof ProspectorError) return flash("error", e.message, "", back);
    throw e;
  }
}

export async function saveSearchLimits(formData: FormData): Promise<void> {
  const user = await requirePermission("prospector.manage");
  try {
    const overrides: { userId: string; limit: number | null }[] = [];
    for (const [k, v] of formData.entries()) {
      if (!k.startsWith("limit:")) continue;
      const raw = String(v).trim();
      overrides.push({ userId: k.slice(6), limit: raw === "" ? null : Number(raw) });
    }
    await setDailyLimits(db, { organizationId: user.organizationId, defaultLimit: Number(s(formData, "defaultLimit")), overrides });
    await audit(user, { action: "prospector.limits", entity: "ProspectorSettings", after: { defaultLimit: Number(s(formData, "defaultLimit")), overrides: overrides.length } });
  } catch (e) {
    if (e instanceof ProspectorError) return flash("error", e.message);
    throw e;
  }
  return flash("ok", "Search limits saved.");
}

// Puts the ticked prospects in the website-check queue and starts working through it after the page has answered.
// Anyone who may search or manage can do this, for the prospects they can see; the service checks again.
export async function checkWebsites(formData: FormData): Promise<void> {
  const user = await requirePermission("crm.edit");
  const ids = formData.getAll("ids").map(String).filter(Boolean).slice(0, MAX_QUEUE_PER_CLICK);
  if (ids.length === 0) return flash("error", "Tick at least one prospect first.");
  let ok = "";
  try {
    const r = await queueChecks(db, user, ids, { force: s(formData, "force") === "1" });
    await audit(user, { action: "prospect.check_websites", entity: "Prospect", after: { ...r, ids: ids.slice(0, 50) } });
    if (r.queued > 0) after(() => drainWebsiteChecks(db, { organizationId: user.organizationId }).then(() => undefined, () => undefined));
    const parts = [`${r.queued} queued`, r.noWebsite ? `${r.noWebsite} have no website` : "", r.fresh ? `${r.fresh} checked in the last week (use Check again to repeat)` : "", r.busy ? `${r.busy} already waiting` : "", r.skipped ? `${r.skipped} not available to you` : ""].filter(Boolean);
    ok = `Website checks: ${parts.join(", ")}.${r.queued > 0 ? " Results appear here within a few minutes." : ""}`;
  } catch (e) {
    if (e instanceof Error && /access/.test(e.message)) return flash("error", e.message);
    throw e;
  }
  return flash("ok", ok);
}

// Reads followers, likes and the last post date for the ticked prospects that have a Facebook address. Each business uses 2 of the
// SocialAPIs requests, so one click handles at most MAX_FETCH_PER_CLICK; the service checks access and the monthly and daily limits again.
export async function getFacebookData(formData: FormData): Promise<void> {
  const user = await requirePermission("crm.edit");
  const ids = formData.getAll("ids").map(String).filter(Boolean).slice(0, 200);
  if (ids.length === 0) return flash("error", "Tick at least one prospect first.");
  let ok = "";
  try {
    const r = await fetchFacebookData(db, user, ids, { force: s(formData, "force") === "1" });
    await audit(user, { action: "prospect.facebook_data", entity: "Prospect", after: { ...r, ids: ids.slice(0, 50) } });
    if (r.notConfigured) return flash("error", "SocialAPIs is not configured, so nothing was fetched. A Super Admin can add the SocialAPIs key in Administration, then Integrations.");
    const parts = [`${r.fetched} fetched`, r.noLink ? `${r.noLink} have no Facebook link (run Check websites or add the link)` : "", r.fresh ? `${r.fresh} fetched in the last week (use Fetch again to repeat)` : "", r.failed ? `${r.failed} could not be read` : "", r.left ? `${r.left} left, press the button again (up to ${MAX_FETCH_PER_CLICK} at a time)` : "", r.skipped ? `${r.skipped} not available to you` : ""].filter(Boolean);
    ok = `Facebook data: ${parts.join(", ")}.${r.stopped ? ` Stopped: ${r.stopped}` : ""}`;
  } catch (e) {
    if (e instanceof SocialAccessError) return flash("error", e.message);
    throw e;
  }
  return flash("ok", ok);
}

export async function saveFacebookLink(formData: FormData): Promise<void> {
  const user = await requirePermission("crm.edit");
  const id = s(formData, "prospectId");
  if (!id) return flash("error", "Choose a prospect first.");
  let ok = "";
  try {
    const url = await setFacebookLink(db, user, id, s(formData, "facebookUrl"));
    await audit(user, { action: "prospect.facebook_link", entity: "Prospect", entityId: id, after: { facebookUrl: url } });
    ok = url ? "Facebook link saved." : "Facebook link removed.";
  } catch (e) {
    if (e instanceof SocialAccessError) return flash("error", e.message);
    throw e;
  }
  return flash("ok", ok);
}

// Scores every prospect again from what is known now. Scores also update by themselves whenever a search, website check or Facebook read
// adds a fact, so this is for rows that were saved before scoring existed or after a rule changed.
export async function updateScores(formData: FormData): Promise<void> {
  const user = await requirePermission("crm.edit");
  void formData;
  if (!isManager(user)) return flash("error", "Only a sales manager can update scores.");
  const n = await rescoreProspects(db, user.organizationId, null);
  await audit(user, { action: "prospect.rescore", entity: "Prospect", after: { count: n } });
  return flash("ok", `${n} prospect${n === 1 ? "" : "s"} scored again.`);
}

// The salesperson who owns a prospect (or a manager) logs what happened when they contacted the business. Contacted keeps it a prospect,
// Not interested closes it, and Interested turns it into a CRM lead in the same step and opens the lead.
export async function logProspectContact(formData: FormData): Promise<void> {
  const user = await requirePermission("crm.edit");
  const id = s(formData, "prospectId");
  if (!id) return flash("error", "Choose a prospect first.", "", backTo(formData));
  let ok = "";
  let leadId: string | null = null;
  try {
    const r = await logOutreach(db, user, id, { outcome: s(formData, "outcome"), note: s(formData, "note") });
    await audit(user, { action: "prospect.outreach", entity: "Prospect", entityId: id, after: { outcome: r.outcome, leadId: r.leadId, linkedExisting: r.linkedExisting } });
    leadId = r.leadId;
    ok = `Saved: ${OUTCOME_LABEL[r.outcome].toLowerCase()}.${r.outcome === "NOT_INTERESTED" ? " The prospect is closed." : ""}`;
  } catch (e) {
    if (e instanceof ProspectorError) return flash("error", e.message, "", backTo(formData));
    throw e;
  }
  if (leadId) return redirect(`/leads/${leadId}`);
  return flash("ok", ok, "", backTo(formData));
}

// What the quick Add prospect form gets back: either the saved prospect, or a message for the field it belongs to (and what was typed, so nothing is lost).
export type AddState = { ok?: true; message?: string; field?: string; error?: string; values?: Record<string, string> };
const VALUE_KEYS = ["name", "country", "phone", "email", "source", "note"] as const;

// A sales agent adds a prospect they found themselves (referral, own contact, other). It is owned by them and checked against existing
// prospects, leads and the do-not-contact list before it is saved. Errors come back to the form, next to the field, instead of redirecting.
export async function addOwnProspect(_prev: AddState, formData: FormData): Promise<AddState> {
  const user = await requirePermission("crm.edit");
  const values = Object.fromEntries(VALUE_KEYS.map((k) => [k, s(formData, k)]));
  try {
    const r = await addProspect(db, user, { ...values, confirm: s(formData, "confirm") === "1" });
    await audit(user, { action: "prospect.add_manual", entity: "Prospect", entityId: r.id, after: { source: values.source } });
    revalidatePath(BASE);
    revalidatePath(OWN);
    return { ok: true, message: `${r.name} was added to your prospects. Press Log contact when you speak to them.` };
  } catch (e) {
    if (e instanceof ProspectorError) return { error: e.message, field: e.field, values };
    throw e;
  }
}

// Deletes a prospect the person added by hand and has not contacted. It is dismissed, not erased, so a manager can restore it.
export async function removeOwnProspectAction(formData: FormData): Promise<void> {
  const user = await requirePermission("crm.edit");
  const back = backTo(formData);
  const id = s(formData, "prospectId");
  if (!id) return flash("error", "Choose a prospect first.", "", back);
  let ok = "";
  try {
    const r = await removeOwnProspect(db, user, id);
    await audit(user, { action: "prospect.remove_manual", entity: "Prospect", entityId: id });
    ok = `${r.name} was deleted.`;
  } catch (e) {
    if (e instanceof ProspectorError) return flash("error", e.message, "", back);
    throw e;
  }
  return flash("ok", ok, "", back);
}

// ---------- import prospects from a spreadsheet (sales managers) ----------
export type ImportSheetView = { index: number; name: string; rows: number; headers: string[]; map: Record<string, string>; sample: string[][] };
export type ImportView = {
  error?: string; fileName?: string; sheets?: ImportSheetView[];
  preview?: { counts: Record<string, number>; ignored: number; label: string; country: string; sample: { name: string; phone: string | null; website: string | null; sheet: string; closed: boolean }[]; skipped: Skipped[] };
  done?: { imported: number; closed: number; assigned: number; label: string; counts: Record<string, number>; skipped: Skipped[] };
};
const MAX_UPLOAD = 8 * 1024 * 1024;
async function readUpload(formData: FormData): Promise<{ name: string; sheets: WorkbookSheet[] }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new ProspectorError("Choose an Excel (.xlsx) or CSV file first.");
  if (file.size > MAX_UPLOAD) throw new ProspectorError("That file is over 8 MB. Split it and import the parts.");
  if (!/\.(xlsx|xlsm|csv)$/i.test(file.name)) throw new ProspectorError(/\.xls$/i.test(file.name) ? "Old .xls files are not supported. Open it in Excel and save as .xlsx or CSV." : "Use an Excel (.xlsx) or CSV file.");
  try {
    const sheets = await readWorkbook(Buffer.from(await file.arrayBuffer()), file.name);
    return { name: file.name, sheets: sheets.filter((sh) => sh.rows.some((r) => r.some((c) => c.trim()))) };
  } catch (e) {
    throw new ProspectorError(e instanceof Error ? e.message : "Could not read that file.");
  }
}

// One action behind the three buttons of the import sheet: "inspect" reads the file and guesses the columns, "preview" shows what would happen
// without saving, "import" saves. The file is sent each time and read again here, so what is shown is always what is saved.
export async function runProspectImport(_prev: ImportView, formData: FormData): Promise<ImportView> {
  const user = await requirePermission("crm.edit");
  const intent = s(formData, "intent");
  try {
    if (!isManager(user)) throw new ProspectorError("Only a sales manager can import prospects.");
    const { name, sheets } = await readUpload(formData);
    if (sheets.length === 0) throw new ProspectorError("That file has no rows.");
    const shapes = sheets.map((sh) => detectSheet(sh.rows));
    const views: ImportSheetView[] = sheets.map((sh, index) => ({
      index, name: sh.name, rows: Math.max(0, sh.rows.length - shapes[index].headerRow - 1), headers: shapes[index].headers,
      map: Object.fromEntries(FIELDS.map((f) => [f, shapes[index].map[f] === undefined ? "" : String(shapes[index].map[f])])),
      sample: sh.rows.slice(shapes[index].headerRow + 1).filter((r) => r.some((c) => c.trim())).slice(0, 3),
    }));
    if (intent === "inspect") return { fileName: name, sheets: views };

    // the person's own column choices win over the guess
    const chosen = new Set(formData.getAll("sheet").map(String));
    const input: ImportInput = {
      sheets: sheets.map((sh, index) => {
        const map: Mapping = {};
        for (const f of FIELDS) {
          const v = s(formData, `map:${index}:${f}`);
          if (v !== "" && /^\d{1,3}$/.test(v)) map[f as Field] = Number(v);
        }
        views[index].map = Object.fromEntries(FIELDS.map((f) => [f, map[f] === undefined ? "" : String(map[f])]));
        return { name: sh.name, rows: sh.rows, headerRow: shapes[index].headerRow, map, include: chosen.has(String(index)) };
      }),
      country: s(formData, "country"), label: s(formData, "label"), closeNotInterested: s(formData, "closeNo") === "1", assignToId: s(formData, "assignToId") || null,
    };
    if (intent === "preview") {
      const plan = await planImport(db, user, input);
      return {
        fileName: name, sheets: views,
        preview: { counts: plan.counts, ignored: plan.ignored, label: plan.label, country: plan.country, sample: plan.rows.slice(0, 8).map((r) => ({ name: r.name, phone: r.phone, website: r.website, sheet: r.sheet, closed: r.closed })), skipped: plan.skipped.slice(0, 80) },
      };
    }
    if (intent !== "import") throw new ProspectorError("Unknown action.");
    const r = await importProspects(db, user, input);
    await audit(user, { action: "prospect.import", entity: "Prospect", after: { file: name, imported: r.imported, closed: r.closed, assigned: r.assigned, skipped: r.skipped.length, label: r.label } });
    revalidatePath(BASE);
    revalidatePath(OWN);
    return { fileName: name, done: { imported: r.imported, closed: r.closed, assigned: r.assigned, label: r.label, counts: r.counts, skipped: r.skipped.slice(0, 80) } };
  } catch (e) {
    if (e instanceof ProspectorError) return { error: e.message };
    throw e;
  }
}
