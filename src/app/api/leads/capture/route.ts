import { db } from "@/lib/db";
import { CaptureError, captureLead } from "@/lib/lead-capture";
import { limiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Public by design: a website form posts here with the form's key (header "x-lead-key" or field "key"). There is no session; the key
// only selects the form, and the origin, size, rate and content rules are enforced in captureLead and below.
const MAX_BYTES = 20_000;

function cors(origin: string | null, allowAny: boolean) {
  return { "access-control-allow-origin": allowAny ? "*" : origin ?? "null", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type, x-lead-key", "access-control-max-age": "600", vary: "Origin" };
}
const reply = (body: unknown, status: number, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: cors(req.headers.get("origin"), true) });
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  if (!limiter("lead-ip", 20, 3_600_000).take(ip)) return reply({ ok: false, error: "Too many submissions. Please try again later." }, 429, cors(origin, true));
  const type = req.headers.get("content-type") ?? "";
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return reply({ ok: false, error: "Too large." }, 413, cors(origin, true));
  let input: Record<string, unknown> = {};
  try {
    if (type.includes("application/json")) input = JSON.parse(raw);
    else if (type.includes("application/x-www-form-urlencoded")) input = Object.fromEntries(new URLSearchParams(raw));
    else return reply({ ok: false, error: "Send JSON or a form." }, 415, cors(origin, true));
  } catch { return reply({ ok: false, error: "Could not read the submission." }, 400, cors(origin, true)); }
  if (typeof input !== "object" || input === null || Array.isArray(input)) return reply({ ok: false, error: "Could not read the submission." }, 400, cors(origin, true));
  const key = req.headers.get("x-lead-key") ?? (typeof input.key === "string" ? input.key : "");
  if (!limiter("lead-key", 600, 3_600_000).take(key.slice(0, 80) || "none")) return reply({ ok: false, error: "Too many submissions." }, 429, cors(origin, true));
  try {
    await captureLead(db, { key, input, origin });
    // Same answer for a new lead and for someone who submitted before, so the form cannot be used to look people up
    return reply({ ok: true }, 200, cors(origin, true));
  } catch (e) {
    if (e instanceof CaptureError) return reply({ ok: false, error: e.message }, e.status, cors(origin, true));
    return reply({ ok: false, error: "Something went wrong." }, 500, cors(origin, true));
  }
}
