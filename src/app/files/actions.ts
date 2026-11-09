"use server";

import { redirect } from "next/navigation";
import { audit, requireSession, toFileActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { DocumentError, afterEmployeeUpload, isEmployeeDocCategory } from "@/lib/employee-docs";
import { FileError, deleteFile, saveFile } from "@/lib/files";
import { notifyPermission } from "@/lib/notifications";
import { defaultStorage } from "@/lib/storage";

// Only same-site paths are accepted as the place to return to
const safeReturn = (p: string) => (p.startsWith("/") && !p.startsWith("//") && !p.includes("\\") ? p : "/dashboard");
const withMessage = (to: string, key: "fileError" | "fileOk", msg: string) => `${to}${to.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(msg)}`;

export async function uploadFileAction(formData: FormData) {
  const user = await requireSession();
  const returnTo = safeReturn(String(formData.get("returnTo") ?? ""));
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) redirect(withMessage(returnTo, "fileError", "Choose a file to upload."));
  const ownerType = String(formData.get("ownerType"));
  const ownerId = String(formData.get("ownerId"));
  const category = String(formData.get("category") ?? "").trim();
  const requestId = String(formData.get("requestId") ?? "").trim() || null;
  // Employee documents use the fixed list of types, so HR can see at a glance what is on file and what is missing
  if (ownerType === "EMPLOYEE" && !requestId && !isEmployeeDocCategory(category)) redirect(withMessage(returnTo, "fileError", "Choose the document type."));
  let ok = "File uploaded.";
  try {
    const f = await saveFile(db, defaultStorage(), {
      actor: toFileActor(user), ownerType, ownerId, name: (file as File).name,
      bytes: Buffer.from(await (file as File).arrayBuffer()), category, expiresOn: String(formData.get("expiresOn") ?? ""),
    });
    await audit(user, { action: "file.upload", entity: "StoredFile", entityId: f.id, after: { owner: `${f.ownerType}:${f.ownerId}`, name: f.filename, size: f.size } });
    if (ownerType === "EMPLOYEE") {
      const r = await afterEmployeeUpload(db, { fileId: f.id, actorId: user.id, organizationId: user.organizationId, requestId });
      if (r.notifyHr) {
        await notifyPermission(db, user.organizationId, "hr.view_sensitive", {
          kind: "document.uploaded", title: `${user.name} uploaded ${r.file.category ?? "a document"}`, body: r.request ? "Answers a document you asked for. Review it." : "Waiting for your review.",
          link: "/hr/documents", dedupeKey: `doc-uploaded:${f.id}`,
        }, user.id);
        ok = r.request ? "Uploaded. HR will review it and you will be told the outcome." : "Uploaded. HR has been told and will review it.";
      }
    }
  } catch (e) {
    if (e instanceof FileError || e instanceof DocumentError) redirect(withMessage(returnTo, "fileError", e.message));
    throw e;
  }
  redirect(withMessage(returnTo, "fileOk", ok));
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
