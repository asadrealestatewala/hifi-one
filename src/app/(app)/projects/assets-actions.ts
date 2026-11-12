"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission, toFileActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { AssetError, createShare, deleteAsset, revokeShare, updateAsset } from "@/lib/project-assets";

const s = (f: FormData, k: string) => String(f.get(k) ?? "");
// Same-site paths only; a form cannot send the person to another site.
const safeReturn = (v: string | null | undefined, fallback: string) => (v && /^\/[^/\\]/.test(v) ? v : fallback);
const where = (f: FormData, projectId: string) => safeReturn(s(f, "returnTo"), `/projects/${projectId}`);
const back = (path: string, kind: "assetError" | "assetOk", m: string) => redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(m)}#assets`);

// All four actions check the caller against the project inside the library service (only the project manager or people who manage projects).
export async function updateAssetAction(formData: FormData): Promise<void> {
  const user = await requirePermission("projects.view");
  const projectId = s(formData, "projectId");
  const path = where(formData, projectId);
  try {
    const a = await updateAsset(db, toFileActor(user), projectId, s(formData, "assetId"), { name: s(formData, "name"), folder: s(formData, "folder"), tags: s(formData, "tags"), description: s(formData, "description") });
    await audit(user, { action: "project.asset_updated", entity: "ProjectAsset", entityId: a.id, after: { name: a.name, folder: a.folder, tags: a.tags } });
  } catch (e) {
    if (e instanceof AssetError) return back(path, "assetError", e.message);
    throw e;
  }
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(path.split("?")[0]);
  back(path, "assetOk", "Details saved.");
}

export async function deleteAssetAction(formData: FormData): Promise<void> {
  const user = await requirePermission("projects.view");
  const projectId = s(formData, "projectId");
  const path = where(formData, projectId);
  try {
    const a = await deleteAsset(db, toFileActor(user), projectId, s(formData, "assetId"));
    await audit(user, { action: "project.asset_removed", entity: "ProjectAsset", entityId: a.id, after: { name: a.name, folder: a.folder } });
  } catch (e) {
    if (e instanceof AssetError) return back(path, "assetError", e.message);
    throw e;
  }
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(path.split("?")[0]);
  back(path, "assetOk", "Removed from the library. Share links no longer show it.");
}

export async function createShareAction(formData: FormData): Promise<void> {
  const user = await requirePermission("projects.view");
  const projectId = s(formData, "projectId");
  const path = where(formData, projectId);
  const days = s(formData, "days").trim();
  try {
    const sh = await createShare(db, toFileActor(user), {
      projectId, folder: s(formData, "folder") || null, label: s(formData, "label"), expiresInDays: days ? Number(days) : null, password: s(formData, "password"),
    });
    await audit(user, { action: "project.asset_share_created", entity: "ProjectAssetShare", entityId: sh.id, after: { project: projectId, folder: sh.folder, expiresAt: sh.expiresAt, password: Boolean(sh.passwordHash) } });
  } catch (e) {
    if (e instanceof AssetError) return back(path, "assetError", e.message);
    throw e;
  }
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(path.split("?")[0]);
  back(path, "assetOk", "Share link created. Copy it from the list below.");
}

export async function revokeShareAction(formData: FormData): Promise<void> {
  const user = await requirePermission("projects.view");
  const projectId = s(formData, "projectId");
  const path = where(formData, projectId);
  try {
    await revokeShare(db, toFileActor(user), projectId, s(formData, "shareId"));
    await audit(user, { action: "project.asset_share_revoked", entity: "ProjectAssetShare", entityId: s(formData, "shareId"), after: { project: projectId } });
  } catch (e) {
    if (e instanceof AssetError) return back(path, "assetError", e.message);
    throw e;
  }
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(path.split("?")[0]);
  back(path, "assetOk", "Link switched off. Anyone who opens it now sees that it is not available.");
}
