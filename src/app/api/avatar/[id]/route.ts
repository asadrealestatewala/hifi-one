import { NextResponse } from "next/server";
import { requireUser, toFileActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { openFile } from "@/lib/files";
import { defaultStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

// A colleague's profile picture. Only signed-in staff of the same organization can load it; anyone else, or a person without a
// picture, gets a plain 404 (the page then shows initials). The file itself goes through the normal file access check.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const miss = () => new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "private, max-age=60" } });
  const photo = await db.storedFile.findFirst({ where: { organizationId: user.organizationId, ownerType: "USER_PHOTO", ownerId: id, deletedAt: null }, orderBy: { createdAt: "desc" }, select: { id: true, sha256: true } });
  if (!photo) return miss();
  const found = await openFile(db, defaultStorage(), toFileActor(user), photo.id);
  if (!found) return miss();
  const { file, bytes } = found;
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(bytes.length),
      ETag: `"${file.sha256}"`,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:",
    },
  });
}
