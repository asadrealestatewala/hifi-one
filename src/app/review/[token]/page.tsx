import Image from "next/image";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { limiter } from "@/lib/rate-limit";
import { ClientReviewError, reviewByToken, submitClientReview } from "@/lib/client-reviews";
import { Notice } from "@/components/ui";
import ReviewAreasField, { readAreaRatings } from "@/components/ReviewAreasField";

export const dynamic = "force-dynamic";
export const metadata = { title: "Weekly review", robots: { index: false, follow: false } };

// The weekly review form a client opens from the Monday email (or a link sent on WhatsApp). The secret in the address is the key;
// it works once, for one client and one week, and expires after 14 days.
async function submit(formData: FormData): Promise<void> {
  "use server";
  const token = String(formData.get("token") ?? "");
  const ip = ((await headers()).get("x-forwarded-for") ?? "local").split(",")[0].trim();
  const to = (q: string) => redirect(`/review/${token}?${q}`);
  if (!limiter("client-review", 20, 600_000).take(ip)) return to(`error=${encodeURIComponent("Too many attempts. Please wait a few minutes.")}`);
  try {
    await submitClientReview(db, { token, rating: Number(formData.get("rating") || 0), review: String(formData.get("review") ?? ""), areaRatings: readAreaRatings(formData) });
  } catch (e) {
    if (e instanceof ClientReviewError) return to(`error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  to("done=1");
}

const Shell = ({ children }: { children: React.ReactNode }) => (
  <main className="mx-auto min-h-screen max-w-xl space-y-5 p-5 sm:p-8">
    <div className="flex items-center gap-3"><Image src="/logo.png" alt="" width={36} height={36} className="rounded-lg" /><span className="font-semibold">Hifi Marketing and Technologies</span></div>
    {children}
  </main>
);

export default async function WeeklyReview({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string; done?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  if (sp.done) return <Shell><h1 className="text-xl font-semibold">Thank you</h1><p className="text-sm text-muted">Your review was sent to your project manager and our management team. You can see all your reviews in your client portal.</p></Shell>;
  const info = await reviewByToken(db, token);
  if (!info) return <Shell><h1 className="text-xl font-semibold">This link is not available</h1><p className="text-sm text-muted">It may have expired or the week is already reviewed. Ask your project manager for a new link.</p></Shell>;
  return (
    <Shell>
      <h1 className="text-xl font-semibold">How was the week of {info.week}?</h1>
      <p className="text-sm text-muted">{info.clientName}{info.projectManager ? ` · Project manager: ${info.projectManager}` : ""}</p>
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      <form action={submit} className="card space-y-4">
        <input type="hidden" name="token" value={token} />
        <ReviewAreasField areas={info.areas} idPrefix="rv" />
        <button className="btn w-full sm:w-auto">Send review</button>
      </form>
    </Shell>
  );
}
