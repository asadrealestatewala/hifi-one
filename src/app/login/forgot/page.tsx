import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { limiter } from "@/lib/rate-limit";
import { HELP_MESSAGE, requestPasswordHelp } from "@/lib/password-help";
import { Notice, SubmitButton } from "@/components/ui";

export const dynamic = "force-dynamic";

async function ask(formData: FormData) {
  "use server";
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  const identifier = String(formData.get("identifier") ?? "").slice(0, 200);
  // Same answer whatever happens, so the page cannot be used to find out who has an account
  if (limiter("pw-help-ip", 5, 15 * 60_000).take(ip) && limiter("pw-help-id", 3, 60 * 60_000).take(identifier.trim().toLowerCase())) {
    await requestPasswordHelp(db, { identifier, origin: `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}` });
  }
  redirect("/login/forgot?done=1");
}

export default async function Forgot({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const { done } = await searchParams;
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <form action={ask} className="w-full max-w-sm space-y-5">
        <div className="space-y-1"><h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1><p className="text-sm text-muted">Enter the email or phone number you sign in with.</p></div>
        {done && <Notice kind="ok">{HELP_MESSAGE}</Notice>}
        <div><label className="label" htmlFor="identifier">Email or phone number</label><input id="identifier" name="identifier" required autoComplete="username" className="input" /></div>
        <SubmitButton className="btn w-full !py-2.5" pendingText="Sending…">Send reset link</SubmitButton>
        <p className="text-sm"><Link href="/login" className="text-primary underline">Back to sign in</Link></p>
      </form>
    </main>
  );
}
