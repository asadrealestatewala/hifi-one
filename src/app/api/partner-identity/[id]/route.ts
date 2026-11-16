import { NextResponse } from "next/server";
import { audit, requireSession, toFileActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { openFile, verifyDownload } from "@/lib/files";
import { DOCUMENT_LABEL } from "@/lib/partner-identity";
import { serveBytes } from "@/lib/serve-bytes";
import { defaultStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

// A partner's ID picture. Same checks as every stored file (sign-in, a link signed for this person and file, the record's access
// rule: the partner themself or staff with partners.view_identity), plus an audit entry for every staff view. Refusals are a plain 404.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireSession();
  const { id } = await params;
  const token = new URL(req.url).searchParams.get("t") ?? "";
  const ok = verifyDownload(token, process.env.SESSION_SECRET ?? "");
  if (!ok || ok.fileId !== id || ok.userId !== user.id) return new NextResponse("Not found", { status: 404 });
  const found = await openFile(db, defaultStorage(), toFileActor(user), id);
  if (!found || found.file.ownerType !== "PARTNER_IDENTITY") return new NextResponse("Not found", { status: 404 });
  const { file, bytes } = found;
  if (user.userType !== "PARTNER") {
    await audit(user, { action: "partner.identity.view_document", entity: "Earner", entityId: file.ownerId, after: { document: DOCUMENT_LABEL[file.category ?? ""] ?? file.category } });
  }
  const res = serveBytes(req, bytes, { contentType: file.contentType, filename: file.filename, inline: new URL(req.url).searchParams.get("dl") !== "1" });
  return res;
}
