import crypto from "node:crypto";
import { db } from "@/lib/db";
import { runJobs, jobKeys } from "@/lib/jobs";
import { limiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// For an external scheduler (cron, a hosting platform's scheduled task): POST with "Authorization: Bearer <JOBS_TOKEN>".
// Without JOBS_TOKEN set the endpoint is off. The token is compared in constant time and wrong guesses are rate limited.
export async function POST(req: Request) {
  const expected = process.env.JOBS_TOKEN;
  if (!expected || expected.length < 24) return reply({ error: "Not configured" }, 404);
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  if (!crypto.timingSafeEqual(a, b)) {
    if (!limiter("jobs-bad", 10, 600_000).take(ip)) return reply({ error: "Too many attempts" }, 429);
    return reply({ error: "Unauthorized" }, 401);
  }
  const only = new URL(req.url).searchParams.get("only")?.split(",").filter((k) => jobKeys.includes(k));
  const results = await runJobs(db, { trigger: "SCHEDULE", only: only?.length ? only : undefined });
  return reply({ ok: true, results });
}
