import { NextResponse } from "next/server";
import { audit, requirePermission, toFileActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { ASSET_MAX_BYTES } from "@/lib/file-validation";
import { AssetError, addAssetFile } from "@/lib/project-assets";
import { defaultStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

// Library uploads come here instead of a server action, because videos are far bigger than the 16 MB a server action accepts.
// A plain form post: the person is sent back to the project page with a message. Rights are checked inside addAssetFile.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("projects.view");
  const { id } = await params;
  // Relative address on purpose: behind nginx the request URL says localhost:3000, so an absolute address built from it sends the browser to localhost
  let path: string | null = null; // a caller-given same-site page (the product details page), else the project page
  const back = (kind: "assetError" | "assetOk", m: string) => {
    if (path) return new NextResponse(null, { status: 303, headers: { Location: `${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(m)}#assets` } });
    return new NextResponse(null, { status: 303, headers: { Location: `/projects/${encodeURIComponent(id)}?${kind}=${encodeURIComponent(m)}#assets` } });
  };
  // Same-site posts only: a form on another site cannot upload on someone's behalf
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))) return new NextResponse("Not found", { status: 404 });
  let form: FormData;
  try { form = await req.formData(); } catch { return back("assetError", `The upload did not arrive in full (limit ${Math.round(ASSET_MAX_BYTES / 1048576)} MB per file). Try again.`); }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return back("assetError", "Choose a file to upload.");
  const s = (k: string) => String(form.get(k) ?? "");
  const ret = s("returnTo");
  if (/^\/[^/\\]/.test(ret)) path = ret; // same-site paths only
  try {
    const r = await addAssetFile(db, defaultStorage(), {
      actor: toFileActor(user), projectId: id, assetId: s("assetId") || null, name: s("name"), folder: s("folder") || s("folderPick"), tags: s("tags"), description: s("description"),
      fileName: file.name, bytes: Buffer.from(await file.arrayBuffer()),
    });
    await audit(user, { action: r.created ? "project.asset_added" : "project.asset_version_added", entity: "ProjectAsset", entityId: r.asset.id, after: { project: id, name: r.asset.name, folder: r.asset.folder, file: r.file.filename, size: r.file.size } });
    return back("assetOk", r.created ? `${r.asset.name} added to ${r.asset.folder}.` : `New version of ${r.asset.name} saved.`);
  } catch (e) {
    if (e instanceof AssetError) return back("assetError", e.message);
    throw e;
  }
}
