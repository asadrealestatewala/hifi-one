import { db } from "@/lib/db";
import { CaptureError } from "@/lib/lead-capture";
import { limiter } from "@/lib/rate-limit";
import { sameSite } from "@/lib/same-site";
import { submitContact } from "@/lib/site-forms";

export const dynamic = "force-dynamic";

// The website's contact form (src/app/(site)/_components/ContactForm.tsx). Public by design: no session, same-origin only,
// size and rate limited; the message becomes a lead in the CRM through the built-in website lead source.
const MAX_BYTES = 20_000;
const reply = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function POST(req: Request) {
  if (!sameSite(req)) return reply({ ok: false, error: "Not allowed." }, 403);
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  if (!limiter("site-contact", 8, 3_600_000).take(ip)) return reply({ ok: false, error: "Too many messages from your connection. Please try again later, or email us." }, 429);
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) return reply({ ok: false, error: "Send the form as JSON." }, 415);
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return reply({ ok: false, error: "Your message is too long." }, 413);
  let input: unknown;
  try { input = JSON.parse(raw); } catch { return reply({ ok: false, error: "Could not read the form." }, 400); }
  if (typeof input !== "object" || input === null || Array.isArray(input)) return reply({ ok: false, error: "Could not read the form." }, 400);
  try {
    await submitContact(db, input as Record<string, unknown>);
    return reply({ ok: true }, 200);
  } catch (e) {
    if (e instanceof CaptureError) return reply({ ok: false, error: e.message, field: e.field }, e.status);
    console.error("site contact form", e);
    return reply({ ok: false, error: "Something went wrong on our side. Please email us instead." }, 500);
  }
}
