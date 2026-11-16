"use server";

import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { ContentAiError, generatePlan, saveProfile, undoPlan } from "@/lib/content-ai";
import { db } from "@/lib/db";
import { ContentError } from "@/lib/content";
import { deleteHashtagGroup, saveHashtagGroup } from "@/lib/content-hashtags";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string) => (s(f, k) === "" ? 0 : Number(s(f, k)));
const to = (client: string, month: string, key: "ok" | "error", msg: string): never =>
  redirect(`/content/plan?client=${encodeURIComponent(client)}&m=${encodeURIComponent(month)}&${key}=${encodeURIComponent(msg)}`);

export async function saveProfileAction(formData: FormData): Promise<void> {
  const user = await requirePermission("content.manage");
  const clientId = s(formData, "clientId"), month = s(formData, "month");
  try {
    await saveProfile(db, {
      organizationId: user.organizationId, clientId, actorId: user.id,
      input: { brandVoice: s(formData, "brandVoice"), audience: s(formData, "audience"), about: s(formData, "about"), topics: s(formData, "topics"), avoid: s(formData, "avoid"), languages: s(formData, "languages"), hashtagRules: s(formData, "hashtagRules"), visualStyle: s(formData, "visualStyle"), platforms: formData.getAll("platforms").map(String), monthlyCapUsd: s(formData, "monthlyCapUsd") },
    });
    await audit(user, { action: "content.profile_save", entity: "Client", entityId: clientId });
  } catch (e) {
    if (e instanceof ContentAiError) to(clientId, month, "error", e.message);
    throw e;
  }
  to(clientId, month, "ok", "Content profile saved.");
}

// Writes the month's draft posts. Slow (up to a few minutes for a big month), so the page shows a progress button.
export async function generatePlanAction(formData: FormData): Promise<void> {
  const user = await requirePermission("content.manage");
  const clientId = s(formData, "clientId"), month = s(formData, "month");
  let msg: string;
  try {
    const r = await generatePlan(db, {
      organizationId: user.organizationId, clientId, month, actorId: user.id, monthBrief: String(formData.get("monthBrief") ?? ""),
      counts: { REEL: num(formData, "REEL"), LONG_VIDEO: num(formData, "LONG_VIDEO"), STATIC_CREATIVE: num(formData, "STATIC_CREATIVE") },
    });
    await audit(user, { action: "content.ai_plan", entity: "Client", entityId: clientId, after: { month, posts: r.created, runId: r.runId } });
    msg = `${r.created} draft posts were written for ${month}. Review them in the calendar, assign makers and send them on. Discard them below if you want to start again.`;
  } catch (e) {
    if (e instanceof ContentAiError) return to(clientId, month, "error", e.message);
    throw e;
  }
  to(clientId, month, "ok", msg);
}

export async function undoPlanAction(formData: FormData): Promise<void> {
  const user = await requirePermission("content.manage");
  const clientId = s(formData, "clientId"), month = s(formData, "month");
  let msg: string;
  try {
    const r = await undoPlan(db, { organizationId: user.organizationId, runId: s(formData, "runId") });
    await audit(user, { action: "content.ai_plan_discard", entity: "Client", entityId: clientId, after: { removed: r.removed, kept: r.kept } });
    msg = `${r.removed} untouched draft${r.removed === 1 ? "" : "s"} removed${r.kept ? `; ${r.kept} that were edited or sent on were kept` : ""}.`;
  } catch (e) {
    if (e instanceof ContentAiError) return to(clientId, month, "error", e.message);
    throw e;
  }
  to(clientId, month, "ok", msg);
}

export async function saveHashtagGroupAction(formData: FormData): Promise<void> {
  const user = await requirePermission("content.manage");
  const clientId = s(formData, "clientId"), month = s(formData, "month");
  try {
    const g = await saveHashtagGroup(db, { organizationId: user.organizationId, clientId: clientId || null, name: s(formData, "name"), tags: s(formData, "tags"), actorId: user.id });
    await audit(user, { action: "content.hashtag_group_save", entity: "HashtagGroup", entityId: g.id, after: { name: g.name } });
  } catch (e) {
    if (e instanceof ContentError) return to(clientId, month, "error", e.message);
    throw e;
  }
  to(clientId, month, "ok", "Hashtag group saved.");
}

export async function deleteHashtagGroupAction(formData: FormData): Promise<void> {
  const user = await requirePermission("content.manage");
  const clientId = s(formData, "clientId"), month = s(formData, "month"), id = s(formData, "id");
  try {
    await deleteHashtagGroup(db, { organizationId: user.organizationId, id });
    await audit(user, { action: "content.hashtag_group_delete", entity: "HashtagGroup", entityId: id });
  } catch (e) {
    if (e instanceof ContentError) return to(clientId, month, "error", e.message);
    throw e;
  }
  to(clientId, month, "ok", "Hashtag group deleted.");
}
