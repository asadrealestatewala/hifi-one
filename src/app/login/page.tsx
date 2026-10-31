import Image from "next/image";
import { redirect } from "next/navigation";
import { getSessionUser, login } from "@/lib/auth";
import { db } from "@/lib/db";
import { needsSetup } from "@/lib/bootstrap";
import { Notice } from "@/components/ui";

export const dynamic = "force-dynamic";

async function signIn(formData: FormData) {
  "use server";
  const identifier = String(formData.get("identifier") ?? "");
  const password = String(formData.get("password") ?? "");
  const result = await login(identifier, password);
  if (!result.ok) redirect(`/login?error=${encodeURIComponent(result.error)}`);
  if (result.mfa) redirect("/login/verify");
  redirect(result.userType === "CLIENT" ? "/portal" : result.userType === "VENDOR" ? "/vendor" : "/dashboard");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  if (await needsSetup(db)) redirect("/setup");
  const current = await getSessionUser();
  if (current) redirect(current.userType === "CLIENT" ? "/portal" : current.userType === "VENDOR" ? "/vendor" : "/dashboard");
  const { error, notice } = await searchParams;
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-sidebar p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-primary/30 blur-3xl" aria-hidden="true" />
        <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-accent/20 blur-3xl" aria-hidden="true" />
        <div className="relative flex items-center gap-3"><Image src="/logo.png" alt="" width={40} height={40} className="rounded-xl" priority /><span className="text-lg font-semibold tracking-tight">Hifi One</span></div>
        <div className="relative max-w-md space-y-4">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">Sales, delivery, people and finance in one place.</h2>
          <p className="text-sm leading-relaxed text-white/70">From the first lead to the paid invoice, every step is connected, permission-aware and auditable.</p>
        </div>
        <p className="relative text-xs text-white/50">Hifi Marketing and Technologies</p>
      </section>
      <section className="grid place-items-center p-6">
        <form action={signIn} className="w-full max-w-sm space-y-5">
          <div className="flex items-center gap-3 lg:hidden"><Image src="/logo.png" alt="Hifi One" width={40} height={40} className="rounded-xl" /><span className="text-lg font-semibold">Hifi One</span></div>
          <div className="space-y-1"><h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1><p className="text-sm text-muted">Sign in to continue.</p></div>
          {notice && <p className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">{notice}</p>}
          {error && <Notice kind="error">{error}</Notice>}
          <div><label className="label" htmlFor="identifier">Email or phone number</label><input id="identifier" name="identifier" type="text" inputMode="email" required autoComplete="username" placeholder="you@company.com or +923001234567" className="input" /></div>
          <div><label className="label" htmlFor="password">Password</label><input id="password" name="password" type="password" required autoComplete="current-password" className="input" /></div>
          <button className="btn w-full !py-2.5">Sign in</button>
          <p className="text-center text-sm"><a href="/login/forgot" className="text-primary underline">Forgot your password?</a></p>
        </form>
      </section>
    </main>
  );
}
