import Image from "next/image";
import { redirect } from "next/navigation";
import { getSessionUser, login } from "@/lib/auth";
import { db } from "@/lib/db";
import { needsSetup } from "@/lib/bootstrap";

export const dynamic = "force-dynamic";

async function signIn(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const result = await login(email, password);
  if (!result.ok) redirect(`/login?error=${encodeURIComponent(result.error)}`);
  if (result.mfa) redirect("/login/verify");
  const u = await db.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: { userType: true } });
  redirect(u?.userType === "CLIENT" ? "/portal" : u?.userType === "VENDOR" ? "/vendor" : "/dashboard");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  if (await needsSetup(db)) redirect("/setup");
  const current = await getSessionUser();
  if (current) redirect(current.userType === "CLIENT" ? "/portal" : current.userType === "VENDOR" ? "/vendor" : "/dashboard");
  const { error, notice } = await searchParams;
  return (
    <main className="min-h-screen grid place-items-center p-4">
      <form action={signIn} className="card w-full max-w-sm space-y-4">
        <div className="flex items-center gap-3">
          <Image src="/logo.png" alt="Hifi One" width={44} height={44} className="rounded-lg" />
          <div>
            <h1 className="text-lg font-bold leading-tight">Hifi One</h1>
            <p className="text-xs text-muted">Hifi Marketing and Technologies</p>
          </div>
        </div>
        {notice && <p className="text-sm text-green-700 bg-green-600/10 rounded-lg px-3 py-2">{notice}</p>}
        {error && (
          <p role="alert" className="text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required autoComplete="username" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input id="password" name="password" type="password" required autoComplete="current-password" className="input" />
        </div>
        <button className="btn w-full">Sign in</button>
      </form>
    </main>
  );
}
