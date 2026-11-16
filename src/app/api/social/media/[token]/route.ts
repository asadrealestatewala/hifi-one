import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyDownload } from "@/lib/files";
import { serveBytes } from "@/lib/serve-bytes";
import { defaultStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

// Public on purpose: Facebook and Instagram fetch a post's image or video from here when we publish it. The link is signed
// for one file, expires after a day, and only works for the creative of a post that is scheduled or published. Anything else is a 404.
// "social-jpg" links are turned into JPEG, because Instagram takes JPEG only.
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ok = verifyDownload(token, process.env.SESSION_SECRET ?? "");
  const notFound = () => new NextResponse("Not found", { status: 404 });
  if (!ok || (ok.userId !== "social" && ok.userId !== "social-jpg")) return notFound();
  const file = await db.storedFile.findFirst({ where: { id: ok.fileId, ownerType: "CONTENT", deletedAt: null } });
  if (!file) return notFound();
  const item = await db.contentItem.findFirst({ where: { id: file.ownerId, organizationId: file.organizationId, status: { in: ["SCHEDULED", "PUBLISHED"] } }, select: { id: true } });
  if (!item) return notFound();
  let bytes = await defaultStorage().get(file.storageKey);
  let contentType = file.contentType;
  let filename = file.filename;
  if (ok.userId === "social-jpg" && file.contentType.startsWith("image/") && file.contentType !== "image/jpeg") {
    try {
      const sharp = (await import("sharp")).default;
      bytes = await sharp(bytes).flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).toBuffer();
      contentType = "image/jpeg";
      filename = filename.replace(/\.[a-z0-9]+$/i, "") + ".jpg";
    } catch (e) {
      console.error("Could not convert an image to JPEG for Instagram", e);
    }
  }
  return serveBytes(req, bytes, { contentType, filename, inline: true });
}
