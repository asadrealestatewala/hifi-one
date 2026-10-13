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

// Self-service: a person may change their own contact numbers and address, nothing else. Everything else on the profile is HR's.
export async function updateMyContactAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const field = (k: string, max: number) => String(formData.get(k) ?? "").trim().slice(0, max) || null;
  const email = field("personalEmail", 200);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) redirect(`/me/profile?edit=1&error=${encodeURIComponent("Enter a valid personal email.")}`);
  const phone = field("phone", 40);
  if (phone && !/^[+\d][\d\s().-]{5,}$/.test(phone)) redirect(`/me/profile?edit=1&error=${encodeURIComponent("Enter a valid phone number, for example +92 300 1234567.")}`);
  const mine = await db.employeeProfile.findFirst({ where: { userId: user.id, organizationId: user.organizationId }, select: { id: true } });
  if (!mine) redirect("/me/profile");
  await db.employeeProfile.update({ where: { id: mine.id }, data: { phone, emergencyContact: field("emergencyContact", 200), personalEmail: email, address: field("address", 300) } });
  await audit(user, { action: "employee.self_update", entity: "EmployeeProfile", entityId: mine.id, after: { fields: ["phone", "emergencyContact", "personalEmail", "address"] } });
  redirect("/me/profile?saved=1");
}
