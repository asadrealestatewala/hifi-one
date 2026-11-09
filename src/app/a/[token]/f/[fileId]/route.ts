import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fileForShare, isUnlocked, resolveShare, unlockCookieName } from "@/lib/project-assets";
import { limiter } from "@/lib/rate-limit";
import { serveBytes } from "@/lib/serve-bytes";
import { defaultStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

const gone = () => new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

// A file inside a public preview link. No sign-in: the secret in the address is the key, plus the password cookie when the link has one.
// Anything wrong (unknown, switched off, expired, locked, file outside the link's scope) answers the same plain 404.
export async function GET(req: Request, { params }: { params: Promise<{ token: string; fileId: string }> }) {
  const { token, fileId } = await params;
  const ip = ((await headers()).get("x-forwarded-for") ?? "local").split(",")[0].trim();
  if (!limiter("asset-share-file", 600, 600_000).take(ip)) return new NextResponse("Too many requests", { status: 429 });
  const share = await resolveShare(db, token);
  if (!share) return gone();
  if (!isUnlocked(share, (await cookies()).get(unlockCookieName(share.id))?.value, process.env.SESSION_SECRET ?? "")) return gone();
  const file = await fileForShare(db, share, fileId);
  if (!file) return gone();
  const bytes = await defaultStorage().get(file.storageKey);
  const dl = new URL(req.url).searchParams.get("dl") === "1";
  return serveBytes(req, bytes, { contentType: file.contentType, filename: file.filename, inline: !dl, cache: "private, no-store" });
}
