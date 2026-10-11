import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { openScreenshot } from "@/lib/monitoring";
import { defaultStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

// The owner always; anyone else only with monitoring.screenshots, and then every view is written to the access log
// the owner can read. Anything else is an ordinary 404, indistinguishable from a screenshot that does not exist.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireSession();
  const { id } = await params;
  const r = await openScreenshot(db, defaultStorage(), { id: user.id, organizationId: user.organizationId, permissions: user.permissions }, id);
  if (!r) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  return new Response(new Uint8Array(r.bytes), {
    headers: { "content-type": r.contentType, "x-content-type-options": "nosniff", "cache-control": "private, no-store", "content-security-policy": "default-src 'none'; sandbox", "content-disposition": "inline" },
  });
}
