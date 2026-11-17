"use server";

import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { FeedError, createFeedKey, linkWorkspace, removeFeedKey } from "@/lib/solution-feed";

const BASE = "/partner-stack/live";
const flash = (kind: "error" | "ok", m: string): never => redirect(`${BASE}?${kind}=${encodeURIComponent(m)}`);

export type FeedKeyState = { error?: string; secret?: string; hint?: string; code?: string };

// Creating or replacing a Solution's secret is Super Admin only; the secret is shown once in the reply and never stored in clear
export async function createFeedKeyAction(_prev: FeedKeyState, formData: FormData): Promise<FeedKeyState> {
  const user = await requirePermission("integrations.manage");
  if (!user.roleKeys.includes("SUPER_ADMIN")) redirect("/forbidden");
  const productId = String(formData.get("productId") ?? "");
  const product = await db.saasProduct.findFirst({ where: { id: productId, organizationId: user.organizationId }, select: { id: true, code: true } });
  if (!product) return { error: "That Solution was not found." };
  try {
    const r = await createFeedKey(db, { productId: product.id, userId: user.id });
    await audit(user, { action: "solution_feed.key.create", entity: "SolutionFeedKey", entityId: product.id, after: { product: product.code, hint: r.hint } });
    return { secret: r.secret, hint: r.hint, code: product.code };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "The secret could not be created." };
  }
}

export async function removeFeedKeyAction(formData: FormData): Promise<void> {
  const user = await requirePermission("integrations.manage");
  if (!user.roleKeys.includes("SUPER_ADMIN")) redirect("/forbidden");
  const productId = String(formData.get("productId") ?? "");
  const product = await db.saasProduct.findFirst({ where: { id: productId, organizationId: user.organizationId }, select: { id: true, code: true } });
  if (!product) return flash("error", "That Solution was not found.");
  const n = await removeFeedKey(db, product.id);
  if (n > 0) await audit(user, { action: "solution_feed.key.remove", entity: "SolutionFeedKey", entityId: product.id, after: { product: product.code } });
  return flash("ok", n > 0 ? "Feed switched off for that Solution." : "There was no secret to remove.");
}

export async function linkWorkspaceAction(formData: FormData): Promise<void> {
  const user = await requirePermission("partners.manage");
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const clientId = String(formData.get("clientId") ?? "") || null;
  try {
    await linkWorkspace(db, { organizationId: user.organizationId, workspaceId, clientId, actorId: user.id });
    await audit(user, { action: clientId ? "solution_feed.workspace.link" : "solution_feed.workspace.unlink", entity: "SolutionWorkspace", entityId: workspaceId, after: { clientId } });
  } catch (e) {
    if (e instanceof FeedError) return flash("error", e.message);
    throw e;
  }
  return flash("ok", clientId ? "Workspace linked." : "Workspace unlinked.");
}
