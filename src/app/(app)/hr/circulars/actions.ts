"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import crypto from "node:crypto";
import { audit, requirePermission, toFileActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { CircularError, sendCircular, type CircularAudience } from "@/lib/circulars";
import { FileError, deleteFile, saveFile } from "@/lib/files";
import { validateUpload } from "@/lib/file-validation";
import { defaultStorage } from "@/lib/storage";

const MAX_ATTACHMENTS = 3;
const ATTACHMENT_TYPES = ["application/pdf", "image/png", "image/jpeg"];

const s = (f: FormData, k: string) => String(f.get(k) ?? "");

export async function sendCircularAction(formData: FormData): Promise<void> {
  const user = await requirePermission("circulars.send");
  const type = s(formData, "audience");
  const audience: CircularAudience = type === "ROLES" ? { type: "ROLES", roleKeys: formData.getAll("roleKeys").map(String) } : type === "PEOPLE" ? { type: "PEOPLE", userIds: formData.getAll("userIds").map(String) } : { type: "ALL" };
  const id = crypto.randomUUID();
  let n: number;
  const saved: string[] = [];
  try {
    // Attachments are checked and stored first so a bad file stops the circular before anyone is notified
    const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length > MAX_ATTACHMENTS) throw new CircularError(`Attach at most ${MAX_ATTACHMENTS} files.`);
    const loaded: { name: string; bytes: Buffer }[] = [];
    for (const f of files) {
      const bytes = Buffer.from(await f.arrayBuffer());
      let ct: string;
      try { ct = validateUpload(f.name, bytes).contentType; } catch (e) { if (e instanceof FileError) throw new CircularError(`${f.name}: ${e.message}`); throw e; }
      if (!ATTACHMENT_TYPES.includes(ct)) throw new CircularError(`${f.name}: attach a PDF, JPG or PNG.`);
      loaded.push({ name: f.name, bytes });
    }
    for (const f of loaded) {
      try { saved.push((await saveFile(db, defaultStorage(), { actor: toFileActor(user), ownerType: "CIRCULAR", ownerId: id, name: f.name, bytes: f.bytes })).id); } catch (e) { if (e instanceof FileError) throw new CircularError(`${f.name}: ${e.message}`); throw e; }
    }
    const r = await sendCircular(db, { id, organizationId: user.organizationId, sentById: user.id, kind: s(formData, "kind"), title: s(formData, "title"), body: s(formData, "body"), audience });
    n = r.recipients;
    await audit(user, { action: "circular.send", entity: "Circular", entityId: id, after: { audience: audience.type, recipients: n, attachments: saved.length, title: s(formData, "title").slice(0, 120) } });
  } catch (e) {
    for (const fid of saved) await deleteFile(db, toFileActor(user), fid).catch(() => {}); // nothing was sent, so nothing stays attached
    if (e instanceof CircularError) redirect(`/hr/circulars?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath("/hr/circulars");
  redirect(`/hr/circulars/${id}?ok=${encodeURIComponent(`Sent to ${n} ${n === 1 ? "person" : "people"}. They get a notification and a popup until they confirm.`)}`);
}
