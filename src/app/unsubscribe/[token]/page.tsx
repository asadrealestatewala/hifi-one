import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { FollowUpError, readUnsubscribeToken, unsubscribe } from "@/lib/followups";
import { brandFor } from "@/lib/email-template-store";
import { limiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// The unsubscribe link in follow-up emails. Protected by a signed token. Opening the page changes nothing (mail scanners
// open links); the button does. Mail apps' one-click unsubscribe posts to /api/unsubscribe instead.
async function confirm(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "");
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  if (!limiter("unsubscribe", 30, 60 * 60_000).take(ip)) redirect(`/unsubscribe/${token}?error=1`);
  try {
    await unsubscribe(db, token);
  } catch (e) {
    if (e instanceof FollowUpError) redirect(`/unsubscribe/${token}?error=1`);
    throw e;
  }
  redirect(`/unsubscribe/${token}?done=1`);
}

export default async function Unsubscribe({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string; error?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const id = readUnsubscribeToken(token);
  const e = id ? await db.followUpEnrollment.findUnique({ where: { id }, select: { email: true, organizationId: true } }) : null;
  const company = e ? (await brandFor(db, e.organizationId)).company : "us";
  return (
    <main className="min-h-screen grid place-items-center bg-background p-4">
      <div className="card w-full max-w-md space-y-4 text-center">
        <h1 className="text-xl font-bold">{sp.done ? "You're unsubscribed" : "Unsubscribe"}</h1>
        {!e || sp.error ? (
          <p className="text-sm text-muted">This unsubscribe link is not valid. Reply to the email you received and ask to be removed; we will take care of it.</p>
        ) : sp.done ? (
          <p className="text-sm text-muted"><strong>{e.email}</strong> will not get any more follow-up emails from {company}. If you change your mind, just reply to one of our emails.</p>
        ) : (
          <form action={confirm} className="space-y-4">
            <input type="hidden" name="token" value={token} />
            <p className="text-sm text-muted">Stop follow-up emails from {company} to <strong>{e.email}</strong>?</p>
            <button className="btn w-full">Unsubscribe</button>
          </form>
        )}
      </div>
    </main>
  );
}
