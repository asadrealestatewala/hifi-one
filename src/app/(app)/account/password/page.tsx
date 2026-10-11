import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { audit, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

async function change(formData: FormData) {
  "use server";
  const user = await requireUser();
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const back = (m: string, ok = false) => redirect(`/account/password?${ok ? "ok" : "error"}=${encodeURIComponent(m)}`);
  const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!(await bcrypt.compare(current, row.passwordHash))) return back("Your current password is not correct.");
  if (next.length < 10) return back("Use a new password of at least 10 characters.");
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(next, 12) } });
  // Sign out every session (including other devices); the user signs in again with the new password
  await db.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit(user, { action: "auth.password_change", entity: "User", entityId: user.id });
  redirect("/login?notice=" + encodeURIComponent("Password changed. Please sign in again."));
}

export default async function Password({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireUser();
  const { error } = await searchParams;
  return (
    <div className="max-w-md space-y-4">
      <h1 className="text-2xl font-bold">Change password</h1>
      <form action={change} className="card space-y-4">
        {error && <p role="alert" className="text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{error}</p>}
        <div><label className="label" htmlFor="current">Current password</label><input id="current" name="current" type="password" required autoComplete="current-password" className="input" /></div>
        <div><label className="label" htmlFor="next">New password (10+ characters)</label><input id="next" name="next" type="password" required minLength={10} autoComplete="new-password" className="input" /></div>
        <button className="btn">Change password</button>
        <p className="text-xs text-muted">You will be signed out on all devices.</p>
      </form>
    </div>
  );
}
