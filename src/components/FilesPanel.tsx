import { deleteFileAction, uploadFileAction } from "@/app/files/actions";
import type { SessionUser } from "@/lib/auth";
import { toFileActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { authorizeOwner } from "@/lib/file-access";
import { listFiles, signDownload } from "@/lib/files";

const kb = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// Lists the files on a record with short-lived signed links, and offers upload and removal only to people who may.
export default async function FilesPanel({
  user, ownerType, ownerId, returnTo, title = "Documents", withCategory = false, withExpiry = false, flash,
}: {
  user: SessionUser; ownerType: string; ownerId: string; returnTo: string; title?: string; withCategory?: boolean; withExpiry?: boolean;
  flash?: { fileError?: string; fileOk?: string };
}) {
  const actor = toFileActor(user);
  const [files, canUpload, canDeleteAny] = await Promise.all([
    listFiles(db, actor, ownerType, ownerId),
    authorizeOwner(db, actor, ownerType, ownerId, "upload"),
    authorizeOwner(db, actor, ownerType, ownerId, "delete"),
  ]);
  const secret = process.env.SESSION_SECRET ?? "";
  const today = new Date().toISOString().slice(0, 10);
  return (
    <section className="card space-y-3">
      <h2 className="font-semibold">{title}</h2>
      {flash?.fileError && <p role="alert" className="text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{flash.fileError}</p>}
      {flash?.fileOk && <p className="text-sm text-green-700 bg-green-600/10 rounded-lg px-3 py-2">{flash.fileOk}</p>}
      {files.length === 0 ? <p className="text-sm text-muted">No files yet.</p> : (
        <ul className="text-sm divide-y divide-border">
          {files.map((f) => {
            const link = `/api/files/${f.id}?t=${signDownload(f.id, user.id, secret)}`;
            const expired = f.expiresOn !== null && f.expiresOn < today;
            return (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <a className="underline font-medium" href={link} target="_blank" rel="noopener">{f.filename}</a>
                  <span className="text-xs text-muted"> · {kb(f.size)}{f.category && ` · ${f.category}`}{f.expiresOn && ` · expires ${f.expiresOn}`}</span>
                  {expired && <strong className="ml-2 text-xs text-brand">Expired</strong>}
                  <span className="text-[11px] text-muted"> · not virus-scanned</span>
                </span>
                {(canDeleteAny || (canUpload && f.uploadedById === user.id)) && (
                  <form action={deleteFileAction}>
                    <input type="hidden" name="fileId" value={f.id} /><input type="hidden" name="returnTo" value={returnTo} />
                    <button className="btn-ghost">Remove</button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canUpload && (
        <form action={uploadFileAction} className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <input type="hidden" name="ownerType" value={ownerType} /><input type="hidden" name="ownerId" value={ownerId} /><input type="hidden" name="returnTo" value={returnTo} />
          <div><label className="label" htmlFor={`file-${ownerType}`}>Add a file (PDF, image, Word, Excel, CSV, text or MP4; up to 15 MB)</label>
            <input id={`file-${ownerType}`} name="file" type="file" required accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.mp4,.docx,.xlsx,.csv,.txt" className="input" /></div>
          {withCategory && <div><label className="label" htmlFor={`cat-${ownerType}`}>Type</label><input id={`cat-${ownerType}`} name="category" placeholder="Identity, Contract…" className="input !w-40" /></div>}
          {withExpiry && <div><label className="label" htmlFor={`exp-${ownerType}`}>Expires</label><input id={`exp-${ownerType}`} name="expiresOn" type="date" className="input" /></div>}
          <button className="btn">Upload</button>
        </form>
      )}
    </section>
  );
}
