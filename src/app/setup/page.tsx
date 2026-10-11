import Image from "next/image";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SetupError, firstSetup, needsSetup } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import { limiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const isProd = process.env.NODE_ENV === "production";
const expectedToken = () => (isProd ? process.env.SETUP_TOKEN ?? "" : undefined);

async function setup(formData: FormData) {
  "use server";
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  if (!limiter("setup", 10, 10 * 60_000).take(ip)) redirect(`/setup?error=${encodeURIComponent("Too many attempts. Please wait a few minutes.")}`);
  const expected = expectedToken();
  if (expected !== undefined && expected.length < 16) redirect(`/setup?error=${encodeURIComponent("SETUP_TOKEN is not configured on the server (16+ characters required).")}`);
  if (String(formData.get("password")) !== String(formData.get("confirm"))) redirect(`/setup?error=${encodeURIComponent("The two passwords do not match.")}`);
  try {
    await firstSetup(db, {
      companyName: String(formData.get("companyName") ?? ""),
      adminName: String(formData.get("adminName") ?? ""),
      adminEmail: String(formData.get("adminEmail") ?? ""),
      password: String(formData.get("password") ?? ""),
      timezone: String(formData.get("timezone") ?? "") || "UTC",
      currency: String(formData.get("currency") ?? "USD"),
      setupToken: String(formData.get("token") ?? ""),
      expectedToken: expected,
    });
  } catch (e) {
    if (e instanceof SetupError) redirect(`/setup?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect("/login?notice=" + encodeURIComponent("Setup complete. Sign in with the administrator account you just created."));
}

export default async function Setup({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  // Once any user exists this page is closed for good
  if (!(await needsSetup(db))) redirect("/login");
  const { error } = await searchParams;
  const tokenMissing = isProd && (process.env.SETUP_TOKEN ?? "").length < 16;
  return (
    <main className="min-h-screen grid place-items-center p-4">
      <form action={setup} className="card w-full max-w-lg space-y-4">
        <div className="flex items-center gap-3">
          <Image src="/logo.png" alt="Hifi One" width={44} height={44} className="rounded-lg" />
          <div>
            <h1 className="text-lg font-bold leading-tight">Set up Hifi One</h1>
            <p className="text-xs text-muted">Create your organization and the first administrator</p>
          </div>
        </div>
        {tokenMissing && (
          <p role="alert" className="text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">
            This server has no SETUP_TOKEN. Set a random value of 16 or more characters in the server environment and restart, so only you can run setup.
          </p>
        )}
        {error && <p role="alert" className="text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{error}</p>}
        {isProd && (
          <div>
            <label className="label" htmlFor="token">Setup token (from the server environment)</label>
            <input id="token" name="token" type="password" required className="input" />
          </div>
        )}
        <div><label className="label" htmlFor="companyName">Company name</label><input id="companyName" name="companyName" required className="input" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="currency">Main currency</label>
            <select id="currency" name="currency" className="input"><option>USD</option><option>PKR</option><option>AED</option><option>GBP</option></select>
          </div>
          <div><label className="label" htmlFor="timezone">Time zone</label><input id="timezone" name="timezone" defaultValue="UTC" className="input" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label" htmlFor="adminName">Administrator name</label><input id="adminName" name="adminName" required className="input" /></div>
          <div><label className="label" htmlFor="adminEmail">Administrator email</label><input id="adminEmail" name="adminEmail" type="email" required className="input" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label" htmlFor="password">Password (12+ characters)</label><input id="password" name="password" type="password" required minLength={12} autoComplete="new-password" className="input" /></div>
          <div><label className="label" htmlFor="confirm">Repeat password</label><input id="confirm" name="confirm" type="password" required minLength={12} autoComplete="new-password" className="input" /></div>
        </div>
        <button className="btn w-full" disabled={tokenMissing}>Create installation</button>
        <p className="text-xs text-muted">
          This creates roles, a starter chart of accounts, pipeline stages and leave types. Company address, bank accounts and other details are added afterwards in Company Settings.
          This page closes permanently once the first user exists.
        </p>
      </form>
    </main>
  );
}
