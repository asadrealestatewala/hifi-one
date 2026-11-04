"use server";

import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { CloutError, addPost, campaignScope, deletePost, enableCampaign, postScope, refreshCampaignNow, refreshPostNow, saveInfluencer, saveProviderSetting, saveQuota, setCampaignClient, setCampaignTimer, setPostStatus, setPostTimer, updatePostLinks } from "@/lib/clout";
import { setShareToken } from "@/lib/clout-views";

const s = (f: FormData, k: string) => String(f.get(k) ?? "");
// Only addresses inside this module can be a return target
const back = (f: FormData) => { const b = s(f, "back"); return b.startsWith("/clout") && !b.startsWith("//") ? b.split("?")[0].slice(0, 120) : "/clout"; };
const flash = (to: string, kind: "error" | "ok", m: string): never => redirect(`${to}${to.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(m)}`);

export async function addPostAction(formData: FormData): Promise<void> {
  const user = await requirePermission("clout.view");
  const to = back(formData);
  let ok = "";
  try {
    const r = await addPost(db, user, { url: s(formData, "url"), cloutCampaignId: s(formData, "cloutCampaignId"), influencerId: s(formData, "influencerId") || null, projectId: s(formData, "projectId") || null, trackingCode: s(formData, "trackingCode"), trackingLink: s(formData, "trackingLink") });
    await audit(user, { action: "clout.post.add", entity: "CloutPost", entityId: r.postId, after: { url: s(formData, "url").slice(0, 300), campaign: s(formData, "cloutCampaignId") } });
    ok = r.message;
    redirect(`/clout/${r.postId}?ok=${encodeURIComponent(ok)}`);
  } catch (e) {
    if (e instanceof CloutError) return flash(to, "error", e.message);
    throw e;
  }
}

export async function refreshPostAction(formData: FormData): Promise<void> {
  const user = await requirePermission("clout.view");
  const id = s(formData, "postId");
  const dest = back(formData);
  try {
    const r = await refreshPostNow(db, { organizationId: user.organizationId, postId: id, where: postScope(user) });
    await audit(user, { action: "clout.post.refresh", entity: "CloutPost", entityId: id, after: { outcome: r.outcome } });
    return flash(dest, r.outcome === "ok" ? "ok" : "error", r.outcome === "ok" ? "Numbers updated." : `Could not update right now: ${r.message}`);
  } catch (e) {
    if (e instanceof CloutError) return flash(dest, "error", e.message);
    throw e;
  }
}

export async function refreshCampaignAction(formData: FormData): Promise<void> {
  const user = await requirePermission("clout.view");
  const id = s(formData, "cloutCampaignId");
  const to = `/clout/campaigns/${encodeURIComponent(id)}`;
  try {
    const n = await refreshCampaignNow(db, { organizationId: user.organizationId, cloutCampaignId: id, where: campaignScope(user) });
    await audit(user, { action: "clout.campaign.refresh", entity: "CloutCampaign", entityId: id, after: { posts: n } });
    return flash(to, "ok", `${n} post${n === 1 ? "" : "s"} queued. The numbers update over the next few minutes.`);
  } catch (e) {
    if (e instanceof CloutError) return flash(to, "error", e.message);
    throw e;
  }
}

export async function setCampaignTimerAction(formData: FormData): Promise<void> {
  const user = await requirePermission("clout.view");
  const id = s(formData, "cloutCampaignId");
  const to = `/clout/campaigns/${encodeURIComponent(id)}`;
  try {
    if (!(await db.cloutCampaign.findFirst({ where: { id, ...campaignScope(user) }, select: { id: true } }))) throw new CloutError("Campaign not found.");
    const r = await setCampaignTimer(db, { organizationId: user.organizationId, cloutCampaignId: id, seconds: s(formData, "seconds") });
    await audit(user, { action: "clout.campaign.timer", entity: "CloutCampaign", entityId: id, after: { seconds: r.seconds, fellBack: r.fellBack } });
    return flash(to, "ok", r.fellBack > 0 ? `Timer saved. Only ${r.fastPosts} post${r.fastPosts === 1 ? "" : "s"} can use the fast lane (every 5 minutes or quicker), so ${r.fellBack} now update every 15 minutes instead.` : "Timer saved.");
  } catch (e) {
    if (e instanceof CloutError) return flash(to, "error", e.message);
    throw e;
  }
}

export async function setPostTimerAction(formData: FormData): Promise<void> {
  const user = await requirePermission("clout.view");
  const id = s(formData, "postId");
  const to = `/clout/${encodeURIComponent(id)}`;
  try {
    if (!(await db.cloutPost.findFirst({ where: { id, ...postScope(user) }, select: { id: true } }))) throw new CloutError("Post not found.");
    const r = await setPostTimer(db, { organizationId: user.organizationId, postId: id, seconds: s(formData, "seconds") || null });
    await audit(user, { action: "clout.post.timer", entity: "CloutPost", entityId: id, after: r });
    return flash(to, "ok", r.fellBack ? "Timer saved, but the fast-lane quota is full, so this post updates every 15 minutes." : "Timer saved.");
  } catch (e) {
    if (e instanceof CloutError) return flash(to, "error", e.message);
    throw e;
  }
}

// Pause, resume, pin and unpin change how the post is tracked, so only managers do them
export async function postStateAction(formData: FormData): Promise<void> {
  const user = await requirePermission("clout.manage");
  const id = s(formData, "postId");
  const action = s(formData, "op");
  const to = `/clout/${encodeURIComponent(id)}`;
  try {
    if (!["pause", "resume", "pin", "unpin"].includes(action)) throw new CloutError("Unknown action.");
    await setPostStatus(db, { organizationId: user.organizationId, postId: id, action: action as "pause" });
    await audit(user, { action: `clout.post.${action}`, entity: "CloutPost", entityId: id });
    return flash(to, "ok", "Saved.");
  } catch (e) {
    if (e instanceof CloutError) return flash(to, "error", e.message);
    throw e;
  }
}

export async function deletePostAction(formData: FormData): Promise<void> {
  const user = await requirePermission("clout.manage");
  const id = s(formData, "postId");
  try {
    await deletePost(db, { organizationId: user.organizationId, postId: id });
    await audit(user, { action: "clout.post.delete", entity: "CloutPost", entityId: id });
  } catch (e) {
    if (e instanceof CloutError) return flash(`/clout/${encodeURIComponent(id)}`, "error", e.message);
    throw e;
  }
  return flash("/clout", "ok", "Post removed with its history.");
}

export async function updateLinksAction(formData: FormData): Promise<void> {
  const user = await requirePermission("clout.view");
  const id = s(formData, "postId");
  const to = `/clout/${encodeURIComponent(id)}`;
  try {
    await updatePostLinks(db, { organizationId: user.organizationId, postId: id, where: postScope(user), influencerId: s(formData, "influencerId") || null, projectId: s(formData, "projectId") || null, trackingCode: s(formData, "trackingCode") || null, trackingLink: s(formData, "trackingLink") || null });
    await audit(user, { action: "clout.post.update", entity: "CloutPost", entityId: id, after: { influencerId: s(formData, "influencerId"), projectId: s(formData, "projectId"), trackingCode: s(formData, "trackingCode") } });
    return flash(to, "ok", "Saved.");
  } catch (e) {
    if (e instanceof CloutError) return flash(to, "error", e.message);
    throw e;
  }
}

export async function saveInfluencerAction(formData: FormData): Promise<void> {
  const user = await requirePermission("clout.manage");
  const id = s(formData, "id") || undefined;
  try {
    const saved = await saveInfluencer(db, { organizationId: user.organizationId, id, input: { name: s(formData, "name"), tiktok: s(formData, "tiktok"), instagram: s(formData, "instagram"), facebook: s(formData, "facebook"), phone: s(formData, "phone"), notes: s(formData, "notes"), rate: s(formData, "rate"), rateCurrency: s(formData, "rateCurrency"), active: id ? formData.get("active") === "on" : true } });
    await audit(user, { action: id ? "clout.influencer.update" : "clout.influencer.create", entity: "CloutInfluencer", entityId: saved, after: { name: s(formData, "name") } });
  } catch (e) {
    if (e instanceof CloutError) return flash("/clout/influencers", "error", e.message);
    throw e;
  }
  return flash("/clout/influencers", "ok", id ? "Influencer saved." : "Influencer added.");
}

export async function enableCampaignAction(formData: FormData): Promise<void> {
  const user = await requirePermission("clout.manage");
  try {
    const cc = await enableCampaign(db, { organizationId: user.organizationId, campaignId: s(formData, "campaignId"), clientId: s(formData, "clientId") || null });
    await audit(user, { action: "clout.campaign.enable", entity: "CloutCampaign", entityId: cc.id, after: { campaignId: cc.campaignId } });
    redirect(`/clout/campaigns/${cc.id}?ok=${encodeURIComponent("Tracking switched on for this campaign.")}`);
  } catch (e) {
    if (e instanceof CloutError) return flash("/clout/campaigns", "error", e.message);
    throw e;
  }
}

export async function setCampaignClientAction(formData: FormData): Promise<void> {
  const user = await requirePermission("clout.manage");
  const id = s(formData, "cloutCampaignId");
  const to = `/clout/campaigns/${encodeURIComponent(id)}`;
  try {
    await setCampaignClient(db, { organizationId: user.organizationId, cloutCampaignId: id, clientId: s(formData, "clientId") || null });
    await audit(user, { action: "clout.campaign.client", entity: "CloutCampaign", entityId: id, after: { clientId: s(formData, "clientId") } });
    return flash(to, "ok", "Saved.");
  } catch (e) {
    if (e instanceof CloutError) return flash(to, "error", e.message);
    throw e;
  }
}

export async function toggleShareAction(formData: FormData): Promise<void> {
  const user = await requirePermission("clout.manage");
  const id = s(formData, "cloutCampaignId");
  const on = s(formData, "on") === "1";
  await setShareToken(db, { organizationId: user.organizationId, cloutCampaignId: id, on });
  await audit(user, { action: on ? "clout.share.on" : "clout.share.off", entity: "CloutCampaign", entityId: id });
  return flash(`/clout/campaigns/${encodeURIComponent(id)}`, "ok", on ? "Share link created." : "Share link switched off. The old link no longer works.");
}

export async function saveProviderAction(formData: FormData): Promise<void> {
  const user = await requirePermission("clout.settings");
  try {
    await saveProviderSetting(db, { organizationId: user.organizationId, platform: s(formData, "platform"), primary: s(formData, "primary"), fallback: s(formData, "fallback") || null });
    await audit(user, { action: "clout.provider.save", entity: "CloutProviderSetting", after: { platform: s(formData, "platform"), primary: s(formData, "primary"), fallback: s(formData, "fallback") } });
  } catch (e) {
    if (e instanceof CloutError) return flash("/clout/settings", "error", e.message);
    throw e;
  }
  return flash("/clout/settings", "ok", "Provider settings saved.");
}

export async function saveQuotaAction(formData: FormData): Promise<void> {
  const user = await requirePermission("clout.settings");
  try {
    await saveQuota(db, { organizationId: user.organizationId, clientId: s(formData, "clientId") || null, plan: s(formData, "plan"), fastPosts: s(formData, "fastPosts") === "" ? undefined : Number(s(formData, "fastPosts")), minSeconds: s(formData, "minSeconds") === "" ? undefined : Number(s(formData, "minSeconds")) });
    await audit(user, { action: "clout.quota.save", entity: "CloutQuota", after: { clientId: s(formData, "clientId"), plan: s(formData, "plan"), fastPosts: s(formData, "fastPosts") } });
  } catch (e) {
    if (e instanceof CloutError) return flash("/clout/settings", "error", e.message);
    throw e;
  }
  return flash("/clout/settings", "ok", "Quota saved.");
}
