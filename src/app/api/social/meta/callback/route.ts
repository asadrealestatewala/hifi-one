import { NextResponse } from "next/server";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { classify, finishLogin, SocialError, verifyState } from "@/lib/social-meta";

export const dynamic = "force-dynamic";

// Facebook sends the person back here after sign-in. The state must be ours, recent, and for the person who is signed in.
export async function GET(req: Request) {
  const user = await requirePermission("content.publish");
  const url = new URL(req.url);
  const to = (path: string) => NextResponse.redirect(new URL(path, req.url));
  const back = (m: string) => to(`/content/accounts?error=${encodeURIComponent(m)}`);
  const state = verifyState(url.searchParams.get("state") ?? "", process.env.SESSION_SECRET ?? "");
  if (!state || state.userId !== user.id || state.organizationId !== user.organizationId) return back("That sign-in link is not valid any more. Press Connect with Facebook again.");
  if (url.searchParams.get("error")) return back("Facebook sign-in was cancelled. Nothing was connected.");
  const code = url.searchParams.get("code") ?? "";
  if (!code) return back("Facebook did not send a sign-in code. Try again.");
  try {
    const sessionId = await finishLogin(db, { organizationId: user.organizationId, userId: user.id, clientId: state.clientId, code });
    await audit(user, { action: "social.meta_signin", entity: "SocialConnectSession", entityId: sessionId, after: { clientId: state.clientId } });
    return to(`/content/accounts/choose?s=${encodeURIComponent(sessionId)}`);
  } catch (e) {
    if (e instanceof SocialError) return back(e.message);
    console.error("Meta sign-in failed", e);
    return back(classify(e).message);
  }
}
