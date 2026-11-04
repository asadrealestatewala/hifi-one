// API keys of outside services, entered by a Super Admin in Settings > Integrations. Stored encrypted (AES-256-GCM, key derived from
// SESSION_SECRET with its own label), never returned to a browser and never written to the audit log. A key set in the server
// environment is the fallback when nothing was entered in the app. Free of Next.js imports so it can be tested.
import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";

type Db = PrismaClient;
export class IntegrationKeyError extends Error {}

export const INTEGRATIONS = {
  GOOGLE_PLACES: { label: "Google Places", env: "GOOGLE_PLACES_API_KEY", usedFor: "Prospector: finding businesses by type and city (stage 1). Enable “Places API (New)” and billing for the key.", stage: "In use" },
  GOOGLE_PAGESPEED: { label: "Google PageSpeed Insights", env: "GOOGLE_PAGESPEED_API_KEY", usedFor: "Prospector: website speed and SEO checks (stage 2).", stage: "In use" },
  SOCIALAPIS: { label: "SocialAPIs", env: "SOCIALAPIS_API_KEY", usedFor: "Prospector: Facebook followers and last post date (stage 3). The free plan allows 200 requests a month; each business uses 2.", stage: "In use" },
} as const;
export type IntegrationProvider = keyof typeof INTEGRATIONS;
export const PROVIDER_KEYS = Object.keys(INTEGRATIONS) as IntegrationProvider[];
export const isProvider = (v: string): v is IntegrationProvider => v in INTEGRATIONS;

const appSecret = () => process.env.SESSION_SECRET ?? "";
const derive = (secret: string) => crypto.createHash("sha256").update(`integration-key:${secret}`).digest();

export function seal(plain: string, secret: string): string {
  if (secret.length < 32) throw new IntegrationKeyError("SESSION_SECRET is missing or shorter than 32 characters on the server, so keys cannot be stored safely.");
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", derive(secret), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}
export function unseal(stored: string, secret: string): string | null {
  try {
    const [iv, tag, enc] = stored.split(".").map((p) => Buffer.from(p, "base64"));
    const d = crypto.createDecipheriv("aes-256-gcm", derive(secret), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
  } catch { return null; } // wrong secret or damaged value
}

// What a person may paste: one token with no spaces, 16 to 400 visible characters
export function cleanKey(raw: string): string {
  const v = raw.trim();
  if (v.length < 16 || v.length > 400) throw new IntegrationKeyError("That does not look like an API key (it should be 16 to 400 characters).");
  if (!/^[\x21-\x7e]+$/.test(v)) throw new IntegrationKeyError("The key must be one piece with no spaces or line breaks. Paste it again.");
  return v;
}

export async function setKey(db: Db, p: { organizationId: string; provider: IntegrationProvider; value: string; userId: string; secret?: string }) {
  const value = cleanKey(p.value);
  const valueEnc = seal(value, p.secret ?? appSecret());
  const hint = value.slice(-4);
  await db.integrationKey.upsert({
    where: { organizationId_provider: { organizationId: p.organizationId, provider: p.provider } },
    update: { valueEnc, hint, updatedById: p.userId }, create: { organizationId: p.organizationId, provider: p.provider, valueEnc, hint, updatedById: p.userId },
  });
  return { hint };
}
export async function clearKey(db: Db, p: { organizationId: string; provider: IntegrationProvider }) {
  return (await db.integrationKey.deleteMany({ where: { organizationId: p.organizationId, provider: p.provider } })).count;
}

// The key to use for a call: the one entered in the app, else the server environment's. Undefined means "not configured".
export async function getKey(db: Db, organizationId: string, provider: IntegrationProvider, env: Record<string, string | undefined> = process.env, secret = appSecret()): Promise<string | undefined> {
  const row = await db.integrationKey.findUnique({ where: { organizationId_provider: { organizationId, provider } } });
  if (row) { const v = unseal(row.valueEnc, secret); if (v) return v; }
  return env[INTEGRATIONS[provider].env]?.trim() || undefined;
}

export type KeyStatus = { provider: IntegrationProvider; source: "app" | "server" | null; hint: string | null; updatedAt: Date | null; unreadable: boolean };
// For the settings screen: where each key comes from. Never the key itself.
export async function keyStatuses(db: Db, organizationId: string, env: Record<string, string | undefined> = process.env, secret = appSecret()): Promise<KeyStatus[]> {
  const rows = await db.integrationKey.findMany({ where: { organizationId } });
  return PROVIDER_KEYS.map((provider) => {
    const row = rows.find((r) => r.provider === provider);
    const readable = row ? unseal(row.valueEnc, secret) !== null : false;
    if (row && readable) return { provider, source: "app", hint: row.hint, updatedAt: row.updatedAt, unreadable: false };
    if (env[INTEGRATIONS[provider].env]?.trim()) return { provider, source: "server", hint: null, updatedAt: null, unreadable: Boolean(row) };
    return { provider, source: null, hint: null, updatedAt: row?.updatedAt ?? null, unreadable: Boolean(row) };
  });
}
export const isConfigured = async (db: Db, organizationId: string, provider: IntegrationProvider) => (await getKey(db, organizationId, provider)) !== undefined;
