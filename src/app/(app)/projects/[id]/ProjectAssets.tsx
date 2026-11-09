import type { SessionUser } from "@/lib/auth";
import { toFileActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectAssetRights } from "@/lib/file-access";
import { appUrl } from "@/lib/email-template-store";
import { signDownload } from "@/lib/files";
import { ASSET_EXTENSIONS, ASSET_MAX_BYTES } from "@/lib/file-validation";
import { DEFAULT_FOLDERS, kindOf, listAssets } from "@/lib/project-assets";
import { Notice } from "@/components/ui";
import ConfirmButton from "@/components/ui/ConfirmButton";
import { createShareAction, deleteAssetAction, revokeShareAction, updateAssetAction } from "../assets-actions";

const kb = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const day = (d: Date) => d.toISOString().slice(0, 10);

// The project's asset library: brand guides, logos, videos and creatives, grouped by folder, with versions and public preview links.
export default async function ProjectAssets({ user, projectId, folder, flash }: { user: SessionUser; projectId: string; folder?: string; flash: { assetError?: string; assetOk?: string } }) {
  const rights = await projectAssetRights(db, toFileActor(user), projectId);
  if (!rights.read) return null;
  const [all, shares] = await Promise.all([
    listAssets(db, user.organizationId, projectId),
    rights.manage ? db.projectAssetShare.findMany({ where: { projectId, organizationId: user.organizationId }, orderBy: { createdAt: "desc" }, take: 20 }) : Promise.resolve([]),
  ]);
  const folders = [...new Set([...all.map((a) => a.folder)])].sort();
  const shown = folder ? all.filter((a) => a.folder === folder) : all;
  const secret = process.env.SESSION_SECRET ?? "";
  const link = (id: string, dl = false) => `/api/files/${id}?t=${signDownload(id, user.id, secret)}${dl ? "&dl=1" : ""}`;
  const now = new Date();
  const suggestions = [...new Set([...DEFAULT_FOLDERS, ...folders])];
  const accept = ASSET_EXTENSIONS.map((e) => `.${e}`).join(",");
  return (
    <section id="assets" className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Assets: brand guides, logos, videos and creatives</h2>
        <span className="text-xs text-muted">{all.length} {all.length === 1 ? "file" : "files"}</span>
      </div>
      {flash.assetError && <Notice kind="error">{flash.assetError}</Notice>}
      {flash.assetOk && <Notice kind="ok">{flash.assetOk}</Notice>}

      {folders.length > 0 && (
        <nav className="flex flex-wrap gap-1.5 text-sm" aria-label="Folders">
          <a href={`/projects/${projectId}#assets`} className={`rounded-full border px-3 py-1 ${!folder ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-hover"}`}>All</a>
          {folders.map((f) => <a key={f} href={`/projects/${projectId}?folder=${encodeURIComponent(f)}#assets`} className={`rounded-full border px-3 py-1 ${folder === f ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-hover"}`}>{f} <span className="text-xs text-muted">{all.filter((a) => a.folder === f).length}</span></a>)}
        </nav>
      )}

      {shown.length === 0 ? <p className="text-sm text-muted">{all.length === 0 ? "No files yet. Add the brand guide, logos and videos so the team and outside designers work from the same set." : "Nothing in this folder."}</p> : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((a) => {
            const c = a.current;
            const kind = kindOf(c.contentType);
            return (
              <li key={a.id} className="space-y-2 rounded-xl border border-border p-3">
                <div className="flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-hover">
                  {kind === "image" && <img src={link(c.id)} alt={a.name} loading="lazy" className="max-h-full max-w-full object-contain" />}
                  {kind === "video" && <video src={link(c.id)} controls preload="metadata" className="max-h-full max-w-full" />}
                  {(kind === "pdf" || kind === "file") && <span className="text-sm font-medium text-muted">{kind === "pdf" ? "PDF" : c.filename.split(".").pop()?.toUpperCase()}</span>}
                </div>
                <div>
                  <p className="font-medium break-words">{a.name}</p>
                  <p className="text-xs text-muted">{a.folder} · {c.filename} · {kb(c.size)}{a.versions.length > 1 && ` · version ${c.version}`}</p>
                  {a.tags.length > 0 && <p className="text-xs text-muted">{a.tags.map((t) => `#${t}`).join(" ")}</p>}
                  {a.description && <p className="text-xs text-muted">{a.description}</p>}
                </div>
                <div className="flex flex-wrap gap-3 text-sm">
                  {(kind === "pdf" || kind === "image") && <a className="text-primary hover:underline" href={link(c.id)} target="_blank" rel="noopener noreferrer">Open</a>}
                  <a className="text-primary hover:underline" href={link(c.id, true)}>Download</a>
                </div>
                {a.versions.length > 1 && (
                  <details className="text-xs text-muted">
                    <summary className="cursor-pointer">Earlier versions ({a.versions.length - 1})</summary>
                    <ul className="mt-1 space-y-0.5">{a.versions.slice(0, -1).reverse().map((v) => <li key={v.id}>v{v.version} · {day(v.createdAt)} · {kb(v.size)} · <a className="text-primary hover:underline" href={link(v.id, true)}>Download</a></li>)}</ul>
                  </details>
                )}
                {rights.upload && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-primary">Upload a new version</summary>
                    <form action={`/api/projects/${projectId}/assets`} method="post" encType="multipart/form-data" className="mt-2 flex flex-wrap items-center gap-2">
                      <input type="hidden" name="assetId" value={a.id} />
                      <input type="file" name="file" required accept={accept} aria-label="New version file" className="input" />
                      <button className="btn-ghost">Upload version</button>
                    </form>
                  </details>
                )}
                {rights.manage && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-primary">Edit details</summary>
                    <form action={updateAssetAction} className="mt-2 grid gap-2">
                      <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="assetId" value={a.id} />
                      <input name="name" defaultValue={a.name} required aria-label="Name" className="input" />
                      <input name="folder" defaultValue={a.folder} list="asset-folders" aria-label="Folder" className="input" />
                      <input name="tags" defaultValue={a.tags.join(", ")} placeholder="Tags, separated by commas" aria-label="Tags" className="input" />
                      <textarea name="description" defaultValue={a.description ?? ""} rows={2} placeholder="Note for the team" aria-label="Description" className="input" />
                      <div className="flex gap-2"><button className="btn-ghost">Save</button></div>
                    </form>
                    <form action={deleteAssetAction} className="mt-2">
                      <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="assetId" value={a.id} />
                      <ConfirmButton title="Remove from library" confirmLabel="Remove" message={`Remove ${a.name} and all its versions from the library? Share links will stop showing it.`} className="text-xs text-brand hover:underline">Remove from library</ConfirmButton>
                    </form>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {rights.upload && (
        <form action={`/api/projects/${projectId}/assets`} method="post" encType="multipart/form-data" className="space-y-2 rounded-xl bg-hover/50 p-3">
          <h3 className="text-sm font-medium">Add a file</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <div><label className="label" htmlFor="asset-file">File</label><input id="asset-file" type="file" name="file" required accept={accept} className="input" /></div>
            <div><label className="label" htmlFor="asset-name">Name (optional)</label><input id="asset-name" name="name" placeholder="Defaults to the file name" className="input" /></div>
            <div><label className="label" htmlFor="asset-folder">Folder</label><input id="asset-folder" name="folder" defaultValue={folder ?? ""} list="asset-folders" placeholder="Brand guides, Logos, Videos…" className="input" /></div>
            <div><label className="label" htmlFor="asset-tags">Tags</label><input id="asset-tags" name="tags" placeholder="logo, dark, 2026" className="input" /></div>
          </div>
          <datalist id="asset-folders">{suggestions.map((f) => <option key={f} value={f} />)}</datalist>
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn">Upload</button>
            <span className="text-xs text-muted">Up to {Math.round(ASSET_MAX_BYTES / 1048576)} MB per file. PDF, PNG, JPG, SVG, GIF, WebP, MP4, MOV, WebM, audio, DOCX, XLSX, CSV, TXT. Large videos can take a minute.</span>
          </div>
        </form>
      )}

      {rights.manage && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Preview links for people without a login</h3>
          <form action={createShareAction} className="grid gap-2 rounded-xl bg-hover/50 p-3 sm:grid-cols-5 sm:items-end">
            <input type="hidden" name="projectId" value={projectId} />
            <div className="sm:col-span-2"><label className="label" htmlFor="share-label">Who is it for?</label><input id="share-label" name="label" placeholder="e.g. Brand manager at Acme" className="input" /></div>
            <div><label className="label" htmlFor="share-folder">Share</label>
              <select id="share-folder" name="folder" className="input" defaultValue={folder ?? ""}><option value="">Whole library</option>{folders.map((f) => <option key={f} value={f}>{f} only</option>)}</select></div>
            <div><label className="label" htmlFor="share-days">Expires after (days)</label><input id="share-days" name="days" type="number" min={1} max={365} defaultValue={30} placeholder="Never" className="input" /></div>
            <div><label className="label" htmlFor="share-pw">Password (optional)</label><input id="share-pw" name="password" type="text" autoComplete="off" className="input" /></div>
            <div className="sm:col-span-5"><button className="btn-ghost">Create link</button> <span className="text-xs text-muted">Viewers can look and download, never change or upload. Leave days empty for no expiry.</span></div>
          </form>
          {shares.length > 0 && (
            <ul className="divide-y divide-border text-sm">
              {shares.map((sh) => {
                const state = sh.revokedAt ? "Switched off" : sh.expiresAt && sh.expiresAt <= now ? "Expired" : "Live";
                const url = `${appUrl()}/a/${sh.token}`;
                return (
                  <li key={sh.id} className="space-y-1 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{sh.label ?? "Preview link"} <span className="text-xs font-normal text-muted">· {sh.folder ?? "whole library"} · {state}{sh.passwordHash && " · password"}{sh.expiresAt && state === "Live" && ` · until ${day(sh.expiresAt)}`} · opened {sh.viewCount}×{sh.lastViewedAt && ` (last ${day(sh.lastViewedAt)})`}</span></span>
                      {state === "Live" && (
                        <form action={revokeShareAction}><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="shareId" value={sh.id} />
                          <ConfirmButton title="Switch off link" confirmLabel="Switch off" message="Anyone who has this link will lose access." className="text-xs text-brand hover:underline">Switch off</ConfirmButton></form>
                      )}
                    </div>
                    {state === "Live" && <input readOnly value={url} aria-label="Share link" className="input w-full text-xs" />}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
