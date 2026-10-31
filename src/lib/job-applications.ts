// Job applications from the careers pages of the public website. A visitor applies for a listed role with their details and
// a CV; HR reviews them under HR > Job applications. The CV goes through the same checks as every other upload (contents
// must match the extension, virus scan when a scanner is configured) and is stored as a StoredFile that only people with
// hr.view can open. Free of Next.js imports so it can be tested against the database.
import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { JOBS } from "../app/(site)/_content/jobs";
import { normalizeEmail, normalizePhone } from "./contacts";
import { FileError, validateUpload } from "./file-validation";
import { notifyMany, usersWithPermission } from "./notifications";
import { websiteOrganizationId } from "./site-forms";
import { newStorageKey, type StorageProvider } from "./storage";
import { scannerFromEnv, type Scanner } from "./virus-scan";

export class ApplicationError extends Error { constructor(message: string, readonly status = 400, readonly field?: string) { super(message); } }

export const APPLICATION_STATUSES = ["NEW", "REVIEWING", "SHORTLISTED", "INTERVIEW", "OFFERED", "HIRED", "REJECTED"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export const CV_MAX_BYTES = 5 * 1024 * 1024;
const CV_TYPES = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];

const cut = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max) : "");

export type ApplicationInput = { jobId: unknown; name: unknown; email: unknown; phone: unknown; profileUrl?: unknown; coverNote?: unknown; website_url?: unknown; sourceUrl?: unknown };
export type CvUpload = { name: string; bytes: Buffer } | null;

export async function submitApplication(db: PrismaClient, storage: StorageProvider, p: { input: ApplicationInput; cv: CvUpload; scanner?: Scanner | null; now?: Date }) {
  const i = p.input;
  // A hidden field real visitors never fill: bots that do get a normal answer and nothing is stored
  if (cut(i.website_url, 200)) return { ok: true as const, duplicate: false };
  const job = JOBS.find((j) => j.id === Number(i.jobId));
  if (!job) throw new ApplicationError("This role is no longer open.", 404);
  const name = cut(i.name, 120);
  if (name.length < 2) throw new ApplicationError("Enter your full name.", 400, "name");
  const email = normalizeEmail(cut(i.email, 200));
  if (!email) throw new ApplicationError("Enter a valid email address.", 400, "email");
  const phone = normalizePhone(cut(i.phone, 40));
  if (!phone) throw new ApplicationError("Enter a valid phone number.", 400, "phone");
  let profileUrl: string | null = null;
  const rawUrl = cut(i.profileUrl, 300);
  if (rawUrl) {
    try {
      const u = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
      profileUrl = u.toString();
    } catch {
      throw new ApplicationError("Enter a valid link, for example https://linkedin.com/in/your-name.", 400, "profileUrl");
    }
  }
  if (!p.cv && !profileUrl) throw new ApplicationError("Upload your CV, or add a LinkedIn or portfolio link.", 400, "cv");
  const coverNote = cut(i.coverNote, 3000) || null;
  let sourceUrl: string | null = null;
  try { const u = new URL(cut(i.sourceUrl, 500)); if (u.protocol === "https:" || u.protocol === "http:") sourceUrl = u.toString(); } catch { /* not a link */ }

  // Check and scan the CV before anything is stored
  let cv: { contentType: string; filename: string; bytes: Buffer; scanStatus: string } | null = null;
  if (p.cv) {
    if (p.cv.bytes.length > CV_MAX_BYTES) throw new ApplicationError("Your CV is larger than 5 MB. Please upload a smaller file.", 413, "cv");
    let checked;
    try { checked = validateUpload(p.cv.name, p.cv.bytes); } catch (e) { if (e instanceof FileError) throw new ApplicationError("Upload your CV as a PDF or Word (.docx) file.", 400, "cv"); throw e; }
    if (!CV_TYPES.includes(checked.contentType)) throw new ApplicationError("Upload your CV as a PDF or Word (.docx) file.", 400, "cv");
    const scanner = p.scanner === undefined ? scannerFromEnv() : p.scanner;
    let scanStatus = "UNSCANNED";
    if (scanner) {
      let r;
      try { r = await scanner(p.cv.bytes); } catch { throw new ApplicationError("We could not check your CV right now. Please try again in a few minutes.", 503, "cv"); }
      if (r.status === "INFECTED") throw new ApplicationError("Your CV could not be accepted. Please upload a different file.", 400, "cv");
      scanStatus = "CLEAN";
    }
    cv = { ...checked, bytes: p.cv.bytes, scanStatus };
  }

  const org = await websiteOrganizationId(db);
  if (!org) throw new ApplicationError("Applications are not open right now.", 503);
  const now = p.now ?? new Date();

  // Applying again for the same role updates the existing application instead of creating a second one
  const existing = await db.jobApplication.findUnique({ where: { organizationId_jobId_email: { organizationId: org, jobId: job.id, email } } });
  const app = existing
    ? await db.jobApplication.update({ where: { id: existing.id }, data: { name, phone, profileUrl: profileUrl ?? existing.profileUrl, coverNote: coverNote ?? existing.coverNote, submissions: { increment: 1 }, sourceUrl: sourceUrl ?? existing.sourceUrl } })
    : await db.jobApplication.create({ data: { organizationId: org, jobId: job.id, jobTitle: job.title, name, email, phone, profileUrl, coverNote, sourceUrl } });

  if (cv) {
    const storageKey = newStorageKey(now);
    await storage.put(storageKey, cv.bytes);
    try {
      const file = await db.storedFile.create({
        data: { organizationId: org, ownerType: "JOB_APPLICATION", ownerId: app.id, filename: cv.filename, contentType: cv.contentType, size: cv.bytes.length, sha256: crypto.createHash("sha256").update(cv.bytes).digest("hex"), storageKey, category: "CV", uploadedById: "website", scanStatus: cv.scanStatus },
      });
      if (app.cvFileId) await db.storedFile.updateMany({ where: { id: app.cvFileId, organizationId: org }, data: { deletedAt: now, deletedById: "website" } });
      await db.jobApplication.update({ where: { id: app.id }, data: { cvFileId: file.id } });
    } catch (e) {
      await storage.delete(storageKey);
      throw e;
    }
  }

  const hr = await usersWithPermission(db, org, "hr.manage");
  await notifyMany(db, hr, {
    kind: existing ? "application.updated" : "application.new",
    title: existing ? `${name} applied again for ${job.title}` : `New application: ${name} for ${job.title}`,
    body: "Careers page",
    link: `/hr/applications?open=${app.id}`,
    dedupeKey: `application:${app.id}:${app.submissions}`,
  });
  return { ok: true as const, duplicate: Boolean(existing) };
}

export async function updateApplication(db: PrismaClient, actor: { id: string; organizationId: string; permissions: ReadonlySet<string> }, p: { id: string; status?: string; notes?: string }, now = new Date()) {
  if (!actor.permissions.has("hr.manage")) throw new ApplicationError("You cannot change job applications.", 403);
  const app = await db.jobApplication.findFirst({ where: { id: p.id, organizationId: actor.organizationId } });
  if (!app) throw new ApplicationError("Application not found.", 404);
  if (p.status !== undefined && !(APPLICATION_STATUSES as readonly string[]).includes(p.status)) throw new ApplicationError("Choose a valid status.");
  const notes = p.notes === undefined ? undefined : p.notes.trim().slice(0, 4000) || null;
  const updated = await db.jobApplication.update({ where: { id: app.id }, data: { status: p.status ?? app.status, notes, reviewedById: actor.id, reviewedAt: now } });
  return { before: app, after: updated };
}
