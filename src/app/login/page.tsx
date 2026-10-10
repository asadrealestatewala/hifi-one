import Image from "next/image";
import { redirect } from "next/navigation";
import { getSessionUser, login } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function signIn(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const result = await login(email, password);
  if (!result.ok) redirect(`/login?error=${encodeURIComponent(result.error)}`);
  redirect("/dashboard");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getSessionUser()) redirect("/dashboard");
  const { error } = await searchParams;
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
