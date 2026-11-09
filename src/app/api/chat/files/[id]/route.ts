import { requirePermission } from "@/lib/auth";
import { NextResponse } from "next/server";
import { staffOnly, toFileActor } from "@/lib/chat-http";
import { db } from "@/lib/db";
import { openFile } from "@/lib/files";
import { defaultStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

// A picture sent in chat. The file's own access rule (authorizeOwner, CHAT_MESSAGE) lets only people currently in that room open it;
// anything else is a plain 404. Chat pictures never change, so the browser may keep its copy.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("chat.use", { json: true });
  if (user instanceof Response) return new NextResponse("Not found", { status: 404 });
  const denied = staffOnly(user);
  if (denied) return new NextResponse("Not found", { status: 404 });
  const { id } = await params;
  const f = await db.storedFile.findFirst({ where: { id, ownerType: "CHAT_MESSAGE", organizationId: user.organizationId, deletedAt: null }, select: { id: true } });
  const found = f ? await openFile(db, defaultStorage(), toFileActor(user), f.id) : null;
  if (!found) return new NextResponse("Not found", { status: 404 });
  const { file, bytes } = found;
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": file.contentType, "Content-Length": String(bytes.length),
      "Content-Disposition": `inline; filename="${file.filename.replace(/[^\x20-\x7e]/g, "_")}"`,
      "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:",
      "Cache-Control": "private, max-age=86400, immutable",
    },
  });
}
