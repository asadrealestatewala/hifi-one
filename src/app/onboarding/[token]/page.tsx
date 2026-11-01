import Image from "next/image";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { OnboardingError, onboardingByToken, resendCode, verifyCode } from "@/lib/onboarding";
import { limiter } from "@/lib/rate-limit";
import { Notice } from "@/components/ui";

export const dynamic = "force-dynamic";

// The page behind the button in the onboarding email. Protected by the secret link plus the 6-digit code from the same
// email, a per-request try limit and a per-address rate limit. Verifying sends the account to the approvers.
const ip = async () => (await headers()).get("x-forwarded-for")?.split(",")[0].trim() ?? "local";

async function verify(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "");
  const back = (k: "error" | "ok", m: string): never => redirect(`/onboarding/${token}?${k}=${encodeURIComponent(m)}`);
  if (!limiter("onboarding-verify", 20, 60 * 60_000).take(await ip())) back("error", "Too many attempts. Please try again later.");
  try {
    await verifyCode(db, { token, code: String(formData.get("code") ?? ""), password: String(formData.get("password") ?? "") || undefined, confirm: String(formData.get("confirm") ?? "") || undefined });
  } catch (e) {
    if (e instanceof OnboardingError) back("error", e.message);
    throw e;
  }
  redirect("/login?notice=" + encodeURIComponent("Email verified. Your account is now waiting for approval; we will email you as soon as it is approved."));
}

async function resend(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "");
  if (!limiter("onboarding-resend", 5, 60 * 60_000).take(await ip())) redirect(`/onboarding/${token}?error=${encodeURIComponent("Too many requests. Please try again later.")}`);
  try {
    await resendCode(db, { token });
  } catch (e) {
    if (e instanceof OnboardingError) redirect(`/onboarding/${token}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  // The link changes with every new code, so the person continues from the new email
  redirect("/login?notice=" + encodeURIComponent("A new code is on its way. Open the newest email and use its button: earlier links stop working."));
}

export default async function Onboarding({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> }) {
  const { token } = await params;
  const { error } = await searchParams;
  const info = await onboardingByToken(db, token);
  return (
    <main className="min-h-screen grid place-items-center bg-background p-4">
      <div className="card w-full max-w-md space-y-5">
        <div className="flex items-center gap-3">
          <Image src="/logo.png" alt="Hifi One" width={44} height={44} className="rounded-lg" />
          <div><h1 className="text-lg font-bold">Set up your account</h1>{info && <p className="text-sm text-muted">Welcome, {info.name.split(" ")[0]}!</p>}</div>
        </div>
        {!info ? (
          <p className="text-sm text-muted">This link is no longer valid: it was already used, a newer code was sent, or it expired. Use the button in your newest email, or ask HR to send a new code.</p>
        ) : (
          <>
            <ol className="grid grid-cols-4 gap-1 text-center text-[11px] text-muted" aria-label="Progress">
              {["Verify email", "Password", "Approval", "Sign in"].map((s, i) => (
                <li key={s}><span className={`mb-1 block h-1.5 rounded-full ${i === 0 ? "bg-primary" : "bg-border"}`} />{s}</li>
              ))}
            </ol>
            {error && <Notice kind="error">{error}</Notice>}
            <form action={verify} className="space-y-4">
              <input type="hidden" name="token" value={token} />
              <div>
                <label className="label" htmlFor="code">6-digit code from the email to {info.email}</label>
                <input id="code" name="code" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} className="input text-center font-mono text-2xl tracking-[0.5em]" autoFocus />
                {!info.codeUsable && <p className="mt-1 text-xs text-amber-700">This code has expired or was tried too often. Send yourself a new one below.</p>}
              </div>
              {info.needsPassword && (
                <>
                  <div><label className="label" htmlFor="password">Choose a password (10+ characters)</label><input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" className="input" /></div>
                  <div><label className="label" htmlFor="confirm">Repeat the password</label><input id="confirm" name="confirm" type="password" required minLength={10} autoComplete="new-password" className="input" /></div>
                </>
              )}
              <button className="btn w-full">Verify my email</button>
            </form>
            <form action={resend} className="text-center text-sm">
              <input type="hidden" name="token" value={token} />
              <span className="text-muted">No code, or it expired? </span><button className="font-medium text-primary underline">Send a new code</button>
            </form>
            <p className="text-xs text-muted">After you verify, a manager approves your account. You will get an email the moment you can sign in.</p>
          </>
        )}
      </div>
    </main>
  );
}
