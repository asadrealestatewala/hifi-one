import Image from "next/image";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AccountError, consumeReset, resetInfo } from "@/lib/accounts";
import { db } from "@/lib/db";
import { limiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

async function reset(formData: FormData) {
  "use server";
  const token = String(formData.get("token"));
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  if (!limiter("reset", 10, 60 * 60_000).take(ip)) redirect(`/reset/${token}?error=${encodeURIComponent("Too many attempts. Please try again later.")}`);
  if (String(formData.get("password")) !== String(formData.get("confirm"))) redirect(`/reset/${token}?error=${encodeURIComponent("The two passwords do not match.")}`);
  try {
    await consumeReset(db, { token, password: String(formData.get("password") ?? "") });
  } catch (e) {
    if (e instanceof AccountError) redirect(`/reset/${token}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect("/login?notice=" + encodeURIComponent("Password set. Please sign in."));
}

export default async function Reset({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> }) {
  const { token } = await params;
  const { error } = await searchParams;
  const info = await resetInfo(db, token);
  return (
    <main className="min-h-screen grid place-items-center p-4">
      <div className="card w-full max-w-sm space-y-4">
        <div className="flex items-center gap-3">
          <Image src="/logo.png" alt="Hifi One" width={44} height={44} className="rounded-lg" />
          <h1 className="text-lg font-bold">Set your password</h1>
        </div>
        {!info ? (
          <p className="text-sm text-muted">This link is invalid, already used, or expired. Ask an administrator for a new one.</p>
        ) : (
          <form action={reset} className="space-y-4">
            <p className="text-sm">Choose a new password for <strong>{info.email}</strong>.</p>
            {error && <p role="alert" className="text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{error}</p>}
            <input type="hidden" name="token" value={token} />
            <div><label className="label" htmlFor="password">New password (10+ characters)</label><input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" className="input" /></div>
            <div><label className="label" htmlFor="confirm">Repeat password</label><input id="confirm" name="confirm" type="password" required minLength={10} autoComplete="new-password" className="input" /></div>
            <button className="btn w-full">Set password</button>
          </form>
        )}
      </div>
    </main>
  );
}
