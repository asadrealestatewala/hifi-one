import { db } from "@/lib/db";
import { PartnerError, submitInquiry } from "@/lib/partner-stack";
import { limiter } from "@/lib/rate-limit";
import { sameSite } from "@/lib/same-site";
import { websiteOrganizationId } from "@/lib/site-forms";

export const dynamic = "force-dynamic";

// The Hifi Partner Stack question form (src/app/(site)/partners). Public by design: no session, same-origin only, size and rate limited,
// a hidden field and a minimum fill time keep simple bots out. The result is saved in Partner Stack for the partner team.
const MAX_BYTES = 20_000;
const MIN_FILL_MS = 2_500;
const reply = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function POST(req: Request) {
  if (!sameSite(req)) return reply({ ok: false, error: "Not allowed." }, 403);
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  if (!limiter("partner-inquiry", 6, 3_600_000).take(ip)) return reply({ ok: false, error: "Too many submissions from your connection. Please try again later, or email us." }, 429);
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) return reply({ ok: false, error: "Send the form as JSON." }, 415);
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return reply({ ok: false, error: "Your message is too long." }, 413);
  let input: unknown;
  try { input = JSON.parse(raw); } catch { return reply({ ok: false, error: "Could not read the form." }, 400); }
  if (typeof input !== "object" || input === null || Array.isArray(input)) return reply({ ok: false, error: "Could not read the form." }, 400);
  const form = input as Record<string, unknown>;
  // Sent by a script within a moment of loading the page: answer normally and store nothing
  if (typeof form.started === "number" && Date.now() - form.started < MIN_FILL_MS) return reply({ ok: true }, 200);
  const org = await websiteOrganizationId(db);
  if (!org) return reply({ ok: false, error: "Not available right now." }, 503);
  try {
    await submitInquiry(db, { organizationId: org, input: form });
    return reply({ ok: true }, 200);
  } catch (e) {
    if (e instanceof PartnerError) return reply({ ok: false, error: e.message, field: e.field }, e.status);
    console.error("partner-inquiry", e);
    return reply({ ok: false, error: "Something went wrong on our side. Please email us instead." }, 500);
  }
}
