import { db } from "@/lib/db";
import { ApplicationError, CV_MAX_BYTES, submitApplication } from "@/lib/job-applications";
import { limiter } from "@/lib/rate-limit";
import { sameSite } from "@/lib/same-site";
import { defaultStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

// The careers page's apply form (src/app/(site)/_components/ApplyForm.tsx). Public by design: no session, same-origin only,
// size and rate limited; the application and CV are saved for HR (HR > Job applications).
const MAX_BYTES = CV_MAX_BYTES + 64 * 1024;
const reply = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function POST(req: Request) {
  if (!sameSite(req)) return reply({ ok: false, error: "Not allowed." }, 403);
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  if (!limiter("site-apply", 10, 3_600_000).take(ip)) return reply({ ok: false, error: "Too many applications from your connection. Please try again later." }, 429);
  if (!(req.headers.get("content-type") ?? "").includes("multipart/form-data")) return reply({ ok: false, error: "Send the form with its file." }, 415);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) return reply({ ok: false, error: "Your CV is larger than 5 MB. Please upload a smaller file.", field: "cv" }, 413);
  let form: FormData;
  try { form = await req.formData(); } catch { return reply({ ok: false, error: "Could not read the form." }, 400); }
  const file = form.get("cv");
  const cv = file instanceof File && file.size > 0 ? { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) } : null;
  const field = (k: string) => { const v = form.get(k); return typeof v === "string" ? v : ""; };
  try {
    await submitApplication(db, defaultStorage(), {
      cv,
      input: { jobId: field("jobId"), name: field("name"), email: field("email"), phone: field("phone"), profileUrl: field("profileUrl"), coverNote: field("coverNote"), website_url: field("website_url"), sourceUrl: req.headers.get("referer") ?? "" },
    });
    return reply({ ok: true }, 200);
  } catch (e) {
    if (e instanceof ApplicationError) return reply({ ok: false, error: e.message, field: e.field }, e.status);
    console.error("site apply form", e);
    return reply({ ok: false, error: "Something went wrong on our side. Please try again, or email careers.asia@hifimarketing.co." }, 500);
  }
}
