// Shared plumbing for the desktop agent endpoints: bearer authentication, rate limits and uniform errors.
import { db } from "./db";
import { authenticateDevice, MonitorError } from "./monitoring";
import { limiter } from "./rate-limit";

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function deviceFrom(req: Request) {
  const h = req.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : null;
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  // Bad tokens are limited per address so the endpoint cannot be used to guess them
  if (!token) { limiter("agent-anon", 30, 600_000).take(ip); return null; }
  const auth = await authenticateDevice(db, token);
  if (!auth) { if (!limiter("agent-bad", 20, 600_000).take(ip)) throw new MonitorError("Too many attempts."); return null; }
  if (!limiter("agent-device", 600, 3_600_000).take(auth.device.id)) throw new MonitorError("Too many requests from this device.");
  return auth;
}

export async function guarded(fn: () => Promise<Response>): Promise<Response> {
  try { return await fn(); } catch (e) {
    if (e instanceof MonitorError) return json({ error: e.message }, 400);
    return json({ error: "Something went wrong." }, 500);
  }
}
