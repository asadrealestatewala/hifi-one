// Project asset library: brand guides, logos, videos and creatives per project, with versions and public preview links.
// Free of Next.js imports so it can be tested against the database.
import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { type FileActor, projectAssetRights } from "./file-access";
import { FileError, saveFile } from "./files";
import type { StorageProvider } from "./storage";

export class AssetError extends Error {}

export const OWNER = "PROJECT_ASSET";
export const DEFAULT_FOLDERS = ["Brand guides", "Logos", "Videos", "Creatives", "Documents"] as const;

const clean = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
export const cleanFolder = (s: string | null | undefined) => clean(s ?? "", 60) || "General";
export const parseTags = (s: string | null | undefined) =>
  [...new Set((s ?? "").split(/[,\n]/).map((t) => clean(t, 30).toLowerCase()).filter(Boolean))].slice(0, 10);

export type AssetKind = "image" | "pdf" | "video" | "file";
export const kindOf = (contentType: string): AssetKind =>
  contentType.startsWith("image/") ? "image" : contentType === "application/pdf" ? "pdf" : contentType.startsWith("video/") ? "video" : "file";

// ----- Adding, versioning, editing, removing -----

// Uploads a file as a new asset, or as a new version of `assetId`. Rights are checked before anything is stored.
export async function addAssetFile(
  db: PrismaClient, storage: StorageProvider,
  p: { actor: FileActor; projectId: string; assetId?: string | null; name?: string; folder?: string; tags?: string; description?: string; fileName: string; bytes: Buffer },
) {
  const rights = await projectAssetRights(db, p.actor, p.projectId);
  if (!rights.upload) throw new AssetError("You cannot add files to this project's library.");
  let asset;
  let created = false;
  if (p.assetId) {
    asset = await db.projectAsset.findFirst({ where: { id: p.assetId, projectId: p.projectId, organizationId: p.actor.organizationId, deletedAt: null } });
    if (!asset) throw new AssetError("That asset no longer exists.");
  } else {
    asset = await db.projectAsset.create({
      data: {
        organizationId: p.actor.organizationId, projectId: p.projectId, folder: cleanFolder(p.folder), name: clean(p.name ?? "", 120) || clean(p.fileName.replace(/\.[^.]+$/, ""), 120) || "Untitled",
        description: clean(p.description ?? "", 500) || null, tags: parseTags(p.tags), createdById: p.actor.id,
      },
    });
    created = true;
  }
  try {
    const file = await saveFile(db, storage, { actor: p.actor, ownerType: OWNER, ownerId: asset.id, name: p.fileName, bytes: p.bytes, limits: "ASSET" });
    await db.projectAsset.update({ where: { id: asset.id }, data: {} }); // bumps updatedAt
    return { asset, file, created };
  } catch (e) {
    if (created) await db.projectAsset.delete({ where: { id: asset.id } }); // no empty asset left behind by a refused file
    if (e instanceof FileError) throw new AssetError(e.message);
    throw e;
  }
}

export async function updateAsset(db: PrismaClient, actor: FileActor, projectId: string, assetId: string, d: { name: string; folder: string; tags: string; description: string }) {
  if (!(await projectAssetRights(db, actor, projectId)).manage) throw new AssetError("Only the project manager can change library details.");
  const a = await db.projectAsset.findFirst({ where: { id: assetId, projectId, organizationId: actor.organizationId, deletedAt: null } });
  if (!a) throw new AssetError("That asset no longer exists.");
  const name = clean(d.name, 120);
  if (!name) throw new AssetError("Give the asset a name.");
  return db.projectAsset.update({ where: { id: a.id }, data: { name, folder: cleanFolder(d.folder), tags: parseTags(d.tags), description: clean(d.description, 500) || null } });
}

// Soft delete: the asset and its versions disappear from the library and from every share link at once; the bytes are purged later by the file retention job.
export async function deleteAsset(db: PrismaClient, actor: FileActor, projectId: string, assetId: string) {
  if (!(await projectAssetRights(db, actor, projectId)).manage) throw new AssetError("Only the project manager can remove library files.");
  const a = await db.projectAsset.findFirst({ where: { id: assetId, projectId, organizationId: actor.organizationId, deletedAt: null } });
  if (!a) throw new AssetError("That asset no longer exists.");
  const now = new Date();
  await db.$transaction([
    db.projectAsset.update({ where: { id: a.id }, data: { deletedAt: now } }),
    db.storedFile.updateMany({ where: { ownerType: OWNER, ownerId: a.id, deletedAt: null }, data: { deletedAt: now, deletedById: actor.id } }),
  ]);
  return a;
}

export async function listAssets(db: PrismaClient, organizationId: string, projectId: string, folder?: string | null) {
  const assets = await db.projectAsset.findMany({
    where: { organizationId, projectId, deletedAt: null, ...(folder ? { folder } : {}) },
    orderBy: [{ folder: "asc" }, { updatedAt: "desc" }],
  });
  const files = assets.length ? await db.storedFile.findMany({ where: { ownerType: OWNER, ownerId: { in: assets.map((x) => x.id) }, deletedAt: null }, orderBy: { createdAt: "asc" } }) : [];
  return assets.flatMap((a) => {
    const versions = files.filter((f) => f.ownerId === a.id).map((f, i) => ({ ...f, version: i + 1 }));
    return versions.length ? [{ ...a, versions, current: versions[versions.length - 1] }] : [];
  });
}
export type LibraryAsset = Awaited<ReturnType<typeof listAssets>>[number];

// ----- Passwords for share links (scrypt, salted) -----
export function hashSharePassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  return `${salt.toString("hex")}:${crypto.scryptSync(pw, salt, 32).toString("hex")}`;
}
export function checkSharePassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const got = crypto.scryptSync(pw, Buffer.from(salt, "hex"), 32);
  const want = Buffer.from(hash, "hex");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

// ----- Share links -----

export const newShareToken = () => crypto.randomBytes(24).toString("base64url");

export async function createShare(
  db: PrismaClient, actor: FileActor,
  p: { projectId: string; folder?: string | null; label?: string; expiresInDays?: number | null; password?: string; now?: Date },
) {
  if (!(await projectAssetRights(db, actor, p.projectId)).manage) throw new AssetError("Only the project manager can create share links.");
  const days = p.expiresInDays ?? null;
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 365)) throw new AssetError("Expiry must be between 1 and 365 days, or left empty for no expiry.");
  const pw = p.password?.trim() ?? "";
  if (pw && pw.length < 4) throw new AssetError("A password needs at least 4 characters.");
  const folder = p.folder ? cleanFolder(p.folder) : null;
  const now = p.now ?? new Date();
  return db.projectAssetShare.create({
    data: {
      organizationId: actor.organizationId, projectId: p.projectId, folder, label: clean(p.label ?? "", 80) || null, token: newShareToken(),
      passwordHash: pw ? hashSharePassword(pw) : null, expiresAt: days ? new Date(now.getTime() + days * 86400000) : null, createdById: actor.id,
    },
  });
}

export async function revokeShare(db: PrismaClient, actor: FileActor, projectId: string, shareId: string) {
  if (!(await projectAssetRights(db, actor, projectId)).manage) throw new AssetError("Only the project manager can switch off share links.");
  const r = await db.projectAssetShare.updateMany({ where: { id: shareId, projectId, organizationId: actor.organizationId, revokedAt: null }, data: { revokedAt: new Date() } });
  if (r.count === 0) throw new AssetError("That link is already off or does not exist.");
}

// The share a visitor's address points at, or null when it is unknown, switched off or past its expiry. Callers must treat all three the same.
export async function resolveShare(db: PrismaClient, token: string, now = new Date()) {
  if (!token || token.length > 80) return null;
  const s = await db.projectAssetShare.findUnique({ where: { token }, include: { project: { select: { name: true, number: true } } } });
  if (!s || s.revokedAt || (s.expiresAt && s.expiresAt <= now)) return null;
  return s;
}
export type ResolvedShare = NonNullable<Awaited<ReturnType<typeof resolveShare>>>;

export async function shareContent(db: PrismaClient, s: ResolvedShare) {
  return listAssets(db, s.organizationId, s.projectId, s.folder);
}

// A file may be opened through a share only if it is a live version of a live asset inside the share's scope.
export async function fileForShare(db: PrismaClient, s: ResolvedShare, fileId: string) {
  const f = await db.storedFile.findFirst({ where: { id: fileId, organizationId: s.organizationId, ownerType: OWNER, deletedAt: null } });
  if (!f) return null;
  const a = await db.projectAsset.findFirst({ where: { id: f.ownerId, projectId: s.projectId, organizationId: s.organizationId, deletedAt: null, ...(s.folder ? { folder: s.folder } : {}) }, select: { id: true } });
  return a ? f : null;
}

export async function recordShareView(db: PrismaClient, shareId: string) {
  await db.projectAssetShare.update({ where: { id: shareId }, data: { viewCount: { increment: 1 }, lastViewedAt: new Date() } });
}

// The unlock cookie proves the visitor typed the right password. It is tied to the share and to the current password, so changing
// the password or switching the link off ends every unlocked browser. Valid for 12 hours.
const unlockSig = (s: { id: string; passwordHash: string | null }, exp: number, secret: string) =>
  crypto.createHmac("sha256", secret).update(`asset-share:${s.id}:${s.passwordHash ?? ""}:${exp}`).digest("base64url");
export const unlockCookieName = (shareId: string) => `as_${shareId}`;
export function makeUnlock(s: { id: string; passwordHash: string | null }, secret: string, nowMs = Date.now()) {
  const exp = Math.floor(nowMs / 1000) + 12 * 3600;
  return `${exp}.${unlockSig(s, exp, secret)}`;
}
export function isUnlocked(s: { id: string; passwordHash: string | null }, cookie: string | undefined, secret: string, nowMs = Date.now()): boolean {
  if (!s.passwordHash) return true;
  if (!cookie) return false;
  const [e, sig] = cookie.split(".");
  const exp = Number(e);
  if (!exp || !sig || exp * 1000 < nowMs) return false;
  const want = unlockSig(s, exp, secret);
  return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}
