"use server";

import { redirect } from "next/navigation";
import { audit, requireUser, toFileActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { FileError, deleteFile, saveFile } from "@/lib/files";
import { defaultStorage } from "@/lib/storage";

const MAX_PHOTO = 2 * 1024 * 1024;
const PHOTO_TYPES = ["png", "jpg", "jpeg", "webp"];

const back = (to: string, key: "photoOk" | "photoError", msg: string) => redirect(`${to}${to.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(msg)}`);
const safeTo = (p: string) => (p.startsWith("/") && !p.startsWith("//") && !p.includes("\\") ? p : "/me/profile");

// Set a profile picture for yourself, or (HR only) for a colleague. Replaces the previous picture, which is kept until the normal file purge.
export async function uploadPhotoAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const to = safeTo(String(formData.get("returnTo") ?? ""));
  const targetId = String(formData.get("userId") || user.id);
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) back(to, "photoError", "Choose a picture to upload.");
  const f = file as File;
  if (f.size > MAX_PHOTO) back(to, "photoError", "The picture must be 2 MB or smaller.");
  if (!PHOTO_TYPES.includes(f.name.split(".").pop()?.toLowerCase() ?? "")) back(to, "photoError", "Use a PNG, JPG or WebP picture.");
  const actor = toFileActor(user);
  try {
    const old = await db.storedFile.findMany({ where: { organizationId: user.organizationId, ownerType: "USER_PHOTO", ownerId: targetId, deletedAt: null }, select: { id: true } });
    const saved = await saveFile(db, defaultStorage(), { actor, ownerType: "USER_PHOTO", ownerId: targetId, name: f.name, bytes: Buffer.from(await f.arrayBuffer()), category: "Profile picture" });
    for (const o of old) await deleteFile(db, actor, o.id);
    await audit(user, { action: "user.photo", entity: "User", entityId: targetId, after: { fileId: saved.id } });
  } catch (e) {
    if (e instanceof FileError) back(to, "photoError", e.message);
    throw e;
  }
  back(to, "photoOk", "Picture updated.");
}

export async function removePhotoAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const to = safeTo(String(formData.get("returnTo") ?? ""));
  const targetId = String(formData.get("userId") || user.id);
  const actor = toFileActor(user);
  try {
    const old = await db.storedFile.findMany({ where: { organizationId: user.organizationId, ownerType: "USER_PHOTO", ownerId: targetId, deletedAt: null }, select: { id: true } });
    for (const o of old) await deleteFile(db, actor, o.id);
    await audit(user, { action: "user.photo_remove", entity: "User", entityId: targetId });
  } catch (e) {
    if (e instanceof FileError) back(to, "photoError", e.message);
    throw e;
  }
  back(to, "photoOk", "Picture removed.");
}
