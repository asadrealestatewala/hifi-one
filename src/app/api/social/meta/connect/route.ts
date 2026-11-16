import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { loginUrl, metaApp, signState } from "@/lib/social-meta";

export const dynamic = "force-dynamic";

// "Connect with Facebook" on Social accounts: sends the person to Facebook's sign-in with a signed, 15-minute state that names
// them, the company and the client the accounts are for.
export async function GET(req: Request) {
  const user = await requirePermission("content.publish");
  const back = (m: string) => NextResponse.redirect(new URL(`/content/accounts?error=${encodeURIComponent(m)}`, req.url));
  const app = await metaApp(db, user.organizationId);
  if (!app) return back("Enter the Meta app ID and app secret in Settings → Integrations first.");
  const c = new URL(req.url).searchParams.get("client") ?? "";
  let clientId: string | null = null;
  if (c && c !== "own") {
    const client = await db.client.findFirst({ where: { id: c, organizationId: user.organizationId }, select: { id: true } });
    if (!client) return back("Client not found.");
    clientId = client.id;
  }
  return NextResponse.redirect(loginUrl(app.appId, signState({ userId: user.id, organizationId: user.organizationId, clientId }, process.env.SESSION_SECRET ?? "")));
}
