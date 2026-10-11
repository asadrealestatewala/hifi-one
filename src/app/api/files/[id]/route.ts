import { NextResponse } from "next/server";
import { requireSession, toFileActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { openFile, verifyDownload } from "@/lib/files";
import { defaultStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

// The only way to get at a stored file. It needs a valid sign-in, a link signed for this person and this file that has not
// expired, and the access rule of the record the file belongs to. A refusal is always a plain 404, so nothing is revealed.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireSession();
  const { id } = await params;
  const token = new URL(req.url).searchParams.get("t") ?? "";
  const ok = verifyDownload(token, process.env.SESSION_SECRET ?? "");
  if (!ok || ok.fileId !== id || ok.userId !== user.id) return new NextResponse("Not found", { status: 404 });
  const found = await openFile(db, defaultStorage(), toFileActor(user), id);
  if (!found) return new NextResponse("Not found", { status: 404 });
  const { file, bytes } = found;
  const inline = ["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.contentType) && new URL(req.url).searchParams.get("dl") !== "1";
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": file.contentType, // chosen by the server when the file was uploaded
      "Content-Length": String(bytes.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${file.filename.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
      "Cache-Control": "private, no-store",
    },
  });
}
