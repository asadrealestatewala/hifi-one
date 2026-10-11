// File service: validated saves, authorized reads, soft deletion with later purge, and signed time-limited download links.
// Free of Next.js imports so it can be tested against the database.
import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { authorizeOwner, type FileActor, OWNER_TYPES } from "./file-access";
import { FileError, validateUpload } from "./file-validation";
import { newStorageKey, type StorageProvider } from "./storage";

export { FileError };

export async function saveFile(
  db: PrismaClient,
  storage: StorageProvider,
  p: { actor: FileActor; ownerType: string; ownerId: string; name: string; bytes: Buffer; category?: string; expiresOn?: string },
) {
  if (!(OWNER_TYPES as readonly string[]).includes(p.ownerType)) throw new FileError("Unknown record type.");
  // Authorization first: nothing is read or stored for someone who may not add files here
  if (!(await authorizeOwner(db, p.actor, p.ownerType, p.ownerId, "upload"))) throw new FileError("You cannot add files to this record.");
  if (p.expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(p.expiresOn)) throw new FileError("Enter a valid expiry date.");
  const { contentType, filename } = validateUpload(p.name, p.bytes);
  const storageKey = newStorageKey();
  await storage.put(storageKey, p.bytes);
  try {
    return await db.storedFile.create({
      data: {
        organizationId: p.actor.organizationId, ownerType: p.ownerType, ownerId: p.ownerId, filename, contentType, size: p.bytes.length,
        sha256: crypto.createHash("sha256").update(p.bytes).digest("hex"), storageKey, category: p.category?.trim() || null, expiresOn: p.expiresOn || null,
        uploadedById: p.actor.id,
      },
    });
  } catch (e) {
    await storage.delete(storageKey); // no orphaned bytes when the record could not be saved
    throw e;
  }
}

export async function listFiles(db: PrismaClient, actor: FileActor, ownerType: string, ownerId: string) {
  if (!(await authorizeOwner(db, actor, ownerType, ownerId, "read"))) return [];
  return db.storedFile.findMany({ where: { organizationId: actor.organizationId, ownerType, ownerId, deletedAt: null }, orderBy: { createdAt: "asc" } });
}

export async function openFile(db: PrismaClient, storage: StorageProvider, actor: FileActor, fileId: string) {
  const f = await db.storedFile.findFirst({ where: { id: fileId, organizationId: actor.organizationId, deletedAt: null } });
  // A file you may not read looks exactly like a file that does not exist
  if (!f || !(await authorizeOwner(db, actor, f.ownerType, f.ownerId, "read"))) return null;
  return { file: f, bytes: await storage.get(f.storageKey) };
}

export async function deleteFile(db: PrismaClient, actor: FileActor, fileId: string) {
  const f = await db.storedFile.findFirst({ where: { id: fileId, organizationId: actor.organizationId, deletedAt: null } });
  if (!f) throw new FileError("File not found.");
  const mineAndOpen = f.uploadedById === actor.id && (await authorizeOwner(db, actor, f.ownerType, f.ownerId, "upload"));
  if (!mineAndOpen && !(await authorizeOwner(db, actor, f.ownerType, f.ownerId, "delete"))) throw new FileError("You cannot remove this file.");
  // Soft delete: the bytes are kept until the retention purge, so an accidental removal can be recovered
  return db.storedFile.update({ where: { id: f.id }, data: { deletedAt: new Date(), deletedById: actor.id } });
}

// Retention: permanently remove bytes and records that were deleted more than `days` ago.
export async function purgeDeleted(db: PrismaClient, storage: StorageProvider, days: number, now = new Date()) {
  const cutoff = new Date(now.getTime() - days * 86400000);
  const old = await db.storedFile.findMany({ where: { deletedAt: { not: null, lt: cutoff } } });
  for (const f of old) {
    await storage.delete(f.storageKey);
    await db.storedFile.delete({ where: { id: f.id } });
  }
  return old.length;
}

// ----- Signed, time-limited download links -----
// The link names one file and one person and expires. It is checked together with the person's own sign-in and the
// record's access rule, so a copied link is useless to anyone else.

const sig = (payload: string, secret: string) => crypto.createHmac("sha256", secret).update(`file-download:${payload}`).digest("base64url");

export function signDownload(fileId: string, userId: string, secret: string, ttlSeconds = 600, nowMs = Date.now()): string {
  const payload = `${fileId}.${userId}.${Math.floor(nowMs / 1000) + ttlSeconds}`;
  return `${Buffer.from(payload).toString("base64url")}.${sig(payload, secret)}`;
}

export function verifyDownload(token: string, secret: string, nowMs = Date.now()): { fileId: string; userId: string } | null {
  const [p, s] = token.split(".");
  if (!p || !s) return null;
  let payload: string;
  try {
    payload = Buffer.from(p, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const expected = sig(payload, secret);
  if (s.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected))) return null;
  const [fileId, userId, exp] = payload.split(".");
  if (!fileId || !userId || Number(exp) * 1000 < nowMs) return null;
  return { fileId, userId };
}
