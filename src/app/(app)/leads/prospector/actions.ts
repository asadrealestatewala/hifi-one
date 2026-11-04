"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { getKey } from "@/lib/integration-keys";
import { MAX_QUEUE_PER_CLICK, drainWebsiteChecks, queueChecks } from "@/lib/website-checks";
import { ProspectorError, assign, dismiss, markReviewed, restore, runSearch, setDailyLimits } from "@/lib/prospector";

const BASE = "/leads/prospector";
const s = (f: FormData, k: string) => String(f.get(k) ?? "");
const flash = (kind: "error" | "ok", m: string, extra = ""): never => redirect(`${BASE}?${kind}=${encodeURIComponent(m)}${extra}`);

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
  const ids = formData.getAll("ids").map(String).filter(Boolean).slice(0, 500);
  if (ids.length === 0) return flash("error", "Tick at least one prospect first.");
  const op = s(formData, "op");
  try {
    let n = 0, label = "";
    if (op === "review") { n = await markReviewed(db, user, ids); label = "marked as reviewed"; }
    else if (op === "dismiss") { n = await dismiss(db, user, ids); label = "dismissed"; }
    else if (op === "restore") { n = await restore(db, user, ids); label = "restored"; }
    else if (op === "assign") {
      const agent = s(formData, "agentId");
      if (!agent) return flash("error", "Choose who to assign them to.");
      n = await assign(db, user, ids, agent); label = "assigned";
    } else return flash("error", "Unknown action.");
    await audit(user, { action: `prospect.${op}`, entity: "Prospect", after: { count: n, ids: ids.slice(0, 50) } });
    return flash("ok", `${n} prospect${n === 1 ? "" : "s"} ${label}.`);
  } catch (e) {
    if (e instanceof ProspectorError) return flash("error", e.message);
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
