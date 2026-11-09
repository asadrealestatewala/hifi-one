import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { staffOnly, toFileActor } from "@/lib/chat-http";
import { db } from "@/lib/db";
import { openFile } from "@/lib/files";
import { defaultStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

// A file sent in chat. The file's own access rule (authorizeOwner, CHAT_MESSAGE) lets only people currently in that room open it;
// anything else is a plain 404. Chat files never change, so the browser may keep its copy. Byte ranges are supported so
// videos and voice notes can be played and skipped through (Safari needs this). Pictures, video and audio show in the page;
// documents always download (?dl=1 forces a download of anything).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const notFound = () => new NextResponse("Not found", { status: 404 });
  const user = await requirePermission("chat.use", { json: true });
  if (user instanceof Response) return notFound();
  const denied = staffOnly(user);
  if (denied) return notFound();
  const { id } = await params;
  const f = await db.storedFile.findFirst({ where: { id, ownerType: "CHAT_MESSAGE", organizationId: user.organizationId, deletedAt: null }, select: { id: true } });
  const found = f ? await openFile(db, defaultStorage(), toFileActor(user), f.id) : null;
  if (!found) return notFound();
  const { file, bytes } = found;
  const inline = /^(image|video|audio)\//.test(file.contentType) && new URL(req.url).searchParams.get("dl") !== "1";
  const headers: Record<string, string> = {
    "Content-Type": file.contentType,
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${file.filename.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'",
    "Cache-Control": "private, max-age=86400, immutable", "Accept-Ranges": "bytes",
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    const size = bytes.length;
    let start = range[1] ? Number(range[1]) : Math.max(size - Number(range[2]), 0);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    end = Math.min(end, size - 1);
    if (start > end || start >= size) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    start = Math.max(start, 0);
    return new NextResponse(new Uint8Array(bytes.subarray(start, end + 1)), { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
  }
  return new NextResponse(new Uint8Array(bytes), { headers: { ...headers, "Content-Length": String(bytes.length) } });
}
