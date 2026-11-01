import { db } from "@/lib/db";
import { receiveInbound, receivingConfig, resendFetcher, verifyWebhook } from "@/lib/mailboxes";

export const dynamic = "force-dynamic";

// Public by design: Resend calls this when an email arrives for a receiving domain. There is no session; every request must
// carry a valid Resend (Svix) signature made with RESEND_WEBHOOK_SECRET, and the email body is then fetched from Resend's API
// with RESEND_API_KEY rather than trusted from the request. Without both settings the endpoint refuses everything.
const MAX_BYTES = 256_000;
const reply = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function POST(req: Request) {
  const cfg = receivingConfig();
  if (!cfg.configured) return reply({ ok: false, error: "Receiving is not configured." }, 503);
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return reply({ ok: false, error: "Too large." }, 413);
  const signed = verifyWebhook(cfg.secret!, { id: req.headers.get("svix-id"), timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature") }, raw);
  if (!signed) return reply({ ok: false, error: "Bad signature." }, 401);
  let event: { type?: string; data?: { email_id?: string } };
  try { event = JSON.parse(raw); } catch { return reply({ ok: false, error: "Bad JSON." }, 400); }
  try {
    const r = await receiveInbound(db, event, resendFetcher(cfg.apiKey!));
    return reply({ ok: true, ...r }, 200);
  } catch (e) {
    // A 500 makes Resend retry later; storing is idempotent so a retry never duplicates a message.
    console.error("mail inbound failed", e instanceof Error ? e.message : e);
    return reply({ ok: false, error: "Could not store the email." }, 500);
  }
}
