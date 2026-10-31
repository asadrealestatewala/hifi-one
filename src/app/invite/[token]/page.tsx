import Image from "next/image";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { limiter } from "@/lib/rate-limit";
import { LedgerError } from "@/lib/ledger-math";
import { acceptInvite, inviteInfo } from "@/lib/portal";
import { Notice } from "@/components/ui";

export const dynamic = "force-dynamic";

async function accept(formData: FormData) {
  "use server";
  const token = String(formData.get("token"));
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  if (!limiter("invite-accept", 10, 60 * 60_000).take(ip)) redirect(`/invite/${token}?error=${encodeURIComponent("Too many attempts. Please try again later.")}`);
  try {
    await acceptInvite(db, { token, name: String(formData.get("name") ?? ""), password: String(formData.get("password") ?? "") });
  } catch (e) {
    if (e instanceof LedgerError) redirect(`/invite/${token}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect("/login?notice=" + encodeURIComponent("Account created. Please sign in."));
}

export default async function Invite({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> }) {
  const { token } = await params;
  const { error } = await searchParams;
  const info = await inviteInfo(db, token);
  return (
    <main className="min-h-screen grid place-items-center p-4">
      <div className="card w-full max-w-sm space-y-4">
        <div className="flex items-center gap-3">
          <Image src="/logo.png" alt="Hifi One" width={44} height={44} className="rounded-lg" />
          <h1 className="text-lg font-bold">Client portal</h1>
        </div>
        {!info ? (
          <p className="text-sm text-muted">This invitation link is invalid, already used, or expired. Please ask your account manager for a new one.</p>
        ) : (
          <form action={accept} className="space-y-4">
            <p className="text-sm">Create your login for <strong>{info.clientName}</strong> ({info.email}).</p>
            {error && <Notice kind="error">{error}</Notice>}
            <input type="hidden" name="token" value={token} />
            <div><label className="label" htmlFor="name">Your name</label><input id="name" name="name" required className="input" /></div>
            <div><label className="label" htmlFor="password">Password (10+ characters)</label><input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" className="input" /></div>
            <button className="btn w-full">Create account</button>
          </form>
        )}
      </div>
    </main>
  );
}
