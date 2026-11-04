"use server";

import { redirect } from "next/navigation";
import { requireClientUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { CloutError, refreshCampaignNow, refreshPostNow, setCampaignTimer, clientScope } from "@/lib/clout";

const s = (f: FormData, k: string) => String(f.get(k) ?? "");
const flash = (to: string, kind: "error" | "ok", m: string): never => redirect(`${to}${to.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(m)}`);

// The client id always comes from the signed-in portal user; the ids in the form only choose among that client's own records.
export async function portalRefreshPost(formData: FormData): Promise<void> {
  const user = await requireClientUser();
  const id = s(formData, "postId");
  const to = `/portal/clout/${encodeURIComponent(id)}`;
  try {
    const org = (await db.client.findUniqueOrThrow({ where: { id: user.clientId }, select: { organizationId: true } })).organizationId;
    const r = await refreshPostNow(db, { organizationId: org, postId: id, where: clientScope(user.clientId) });
    return flash(to, r.outcome === "ok" ? "ok" : "error", r.outcome === "ok" ? "Numbers updated." : "The platform did not answer just now. We will try again shortly.");
  } catch (e) {
    if (e instanceof CloutError) return flash(to, "error", e.message);
    throw e;
  }
}

export async function portalRefreshCampaign(formData: FormData): Promise<void> {
  const user = await requireClientUser();
  const id = s(formData, "cloutCampaignId");
  try {
    const org = (await db.client.findUniqueOrThrow({ where: { id: user.clientId }, select: { organizationId: true } })).organizationId;
    const n = await refreshCampaignNow(db, { organizationId: org, cloutCampaignId: id, where: { clientId: user.clientId } });
    return flash("/portal/clout", "ok", `${n} post${n === 1 ? "" : "s"} queued. The numbers update over the next few minutes.`);
  } catch (e) {
    if (e instanceof CloutError) return flash("/portal/clout", "error", e.message);
    throw e;
  }
}

export async function portalSetTimer(formData: FormData): Promise<void> {
  const user = await requireClientUser();
  const id = s(formData, "cloutCampaignId");
  try {
    const cc = await db.cloutCampaign.findFirst({ where: { id, clientId: user.clientId }, select: { id: true, organizationId: true } });
    if (!cc) throw new CloutError("Campaign not found.");
    const r = await setCampaignTimer(db, { organizationId: cc.organizationId, cloutCampaignId: cc.id, seconds: s(formData, "seconds") });
    return flash("/portal/clout", "ok", r.fellBack > 0 ? `Timer saved. Your plan allows ${r.fastPosts} post${r.fastPosts === 1 ? "" : "s"} on the fast lane, so ${r.fellBack} now update every 15 minutes.` : "Timer saved.");
  } catch (e) {
    if (e instanceof CloutError) return flash("/portal/clout", "error", e.message);
    throw e;
  }
}
