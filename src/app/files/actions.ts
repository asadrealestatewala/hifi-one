"use server";

import { redirect } from "next/navigation";
import { audit, requireSession, toFileActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { FileError, deleteFile, saveFile } from "@/lib/files";
import { defaultStorage } from "@/lib/storage";

// Only same-site paths are accepted as the place to return to
const safeReturn = (p: string) => (p.startsWith("/") && !p.startsWith("//") && !p.includes("\\") ? p : "/dashboard");
const withMessage = (to: string, key: "fileError" | "fileOk", msg: string) => `${to}${to.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(msg)}`;

export async function uploadFileAction(formData: FormData) {
  const user = await requireSession();
  const returnTo = safeReturn(String(formData.get("returnTo") ?? ""));
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) redirect(withMessage(returnTo, "fileError", "Choose a file to upload."));
  try {
    const f = await saveFile(db, defaultStorage(), {
      actor: toFileActor(user), ownerType: String(formData.get("ownerType")), ownerId: String(formData.get("ownerId")), name: (file as File).name,
      bytes: Buffer.from(await (file as File).arrayBuffer()), category: String(formData.get("category") ?? ""), expiresOn: String(formData.get("expiresOn") ?? ""),
    });
    await audit(user, { action: "file.upload", entity: "StoredFile", entityId: f.id, after: { owner: `${f.ownerType}:${f.ownerId}`, name: f.filename, size: f.size } });
  } catch (e) {
    if (e instanceof FileError) redirect(withMessage(returnTo, "fileError", e.message));
    throw e;
  }
  redirect(withMessage(returnTo, "fileOk", "File uploaded."));
}

export async function deleteFileAction(formData: FormData) {
  const user = await requireSession();
  const returnTo = safeReturn(String(formData.get("returnTo") ?? ""));
  try {
    const f = await deleteFile(db, toFileActor(user), String(formData.get("fileId")));
    await audit(user, { action: "file.delete", entity: "StoredFile", entityId: f.id, after: { name: f.filename } });
  } catch (e) {
    if (e instanceof FileError) redirect(withMessage(returnTo, "fileError", e.message));
    throw e;
  }
  redirect(withMessage(returnTo, "fileOk", "File removed."));
}
