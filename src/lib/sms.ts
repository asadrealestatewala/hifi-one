// Text-message boundary. No SMS provider is connected in this installation, so nothing is ever sent and the
// screens say "not configured". To connect one later: set SMS_PROVIDER, SMS_API_KEY and SMS_FROM, and implement
// the provider in `providerFor` below (see docs/STAFF_AND_CAMPAIGNS.md). Until then phone numbers are verified by an administrator.
export type SmsResult = { status: "SENT" } | { status: "NOT_CONFIGURED" };

export function smsConfig(env: Record<string, string | undefined> = process.env) {
  const provider = env.SMS_PROVIDER?.trim() || null;
  return { provider, configured: Boolean(provider && env.SMS_API_KEY && env.SMS_FROM && providerFor(provider)) };
}

// Known providers, by SMS_PROVIDER name. Empty on purpose: none has been implemented or tested yet.
const PROVIDERS: Record<string, (to: string, text: string) => Promise<void>> = {};
function providerFor(name: string): ((to: string, text: string) => Promise<void>) | null {
  return PROVIDERS[name] ?? null;
}

export const isSmsConfigured = () => smsConfig().configured;

export async function sendSms(to: string, text: string): Promise<SmsResult> {
  const c = smsConfig();
  const send = c.provider ? providerFor(c.provider) : null;
  if (!c.configured || !send) return { status: "NOT_CONFIGURED" };
  await send(to, text);
  return { status: "SENT" };
}
