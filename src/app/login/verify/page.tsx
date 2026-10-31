import Image from "next/image";
import { redirect } from "next/navigation";
import { completeMfaLogin, getSessionUser } from "@/lib/auth";
import { Notice } from "@/components/ui";

export const dynamic = "force-dynamic";

async function verify(formData: FormData) {
  "use server";
  const r = await completeMfaLogin(String(formData.get("code") ?? ""));
  if (!r.ok) redirect(r.restart ? `/login?error=${encodeURIComponent(r.error)}` : `/login/verify?error=${encodeURIComponent(r.error)}`);
  const u = await getSessionUser();
  redirect(u?.userType === "CLIENT" ? "/portal" : u?.userType === "VENDOR" ? "/vendor" : "/dashboard");
}

export default async function Verify({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="min-h-screen grid place-items-center p-4">
      <form action={verify} className="card w-full max-w-sm space-y-4">
        <div className="flex items-center gap-3">
          <Image src="/logo.png" alt="Hifi One" width={44} height={44} className="rounded-lg" />
          <div>
            <h1 className="text-lg font-bold leading-tight">Two-step verification</h1>
            <p className="text-xs text-muted">Enter the 6-digit code from your authenticator app</p>
          </div>
        </div>
        {error && <Notice kind="error">{error}</Notice>}
        <div>
          <label className="label" htmlFor="code">Code or recovery code</label>
          <input id="code" name="code" required autoComplete="one-time-code" inputMode="text" autoFocus className="input" />
        </div>
        <button className="btn w-full">Verify</button>
        <p className="text-xs text-muted">Lost your phone? Use one of your recovery codes, or ask an administrator to reset your two-step verification.</p>
      </form>
    </main>
  );
}
