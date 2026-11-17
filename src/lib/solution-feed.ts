// Solution feed: live results from the Solutions (Campusly, Velocity ERP, Pharmivo, Agentify ERP) for partner and sales agent portals.
// A Solution posts a signed report of its client workspaces. Only status and usage counts are accepted: the report has no field for
// client records, and unknown fields are dropped. Free of Next.js imports so it can be tested.
import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { seal, unseal } from "./integration-keys";

type Db = PrismaClient;
export class FeedError extends Error { constructor(message: string, readonly status = 400) { super(message); } }

export const FEED_STATUSES = ["TRIAL", "LIVE", "OVERDUE", "SUSPENDED", "CANCELLED"] as const;
export const STATUS_LABEL: Record<string, string> = { TRIAL: "On trial", LIVE: "Live", OVERDUE: "Payment overdue", SUSPENDED: "Suspended", CANCELLED: "Cancelled" };
export const MAX_AGE_MS = 5 * 60_000; // a signed report older (or newer) than this is refused, so a captured one cannot be replayed later
export const STALE_AFTER_MS = 3 * 3_600_000; // no report for this long: the portals say the figures may be out of date
export const MAX_WORKSPACES = 500;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const count = z.number().int().min(0).max(10_000_000);
const workspace = z.object({
  id: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(200),
  status: z.enum(FEED_STATUSES),
  plan: z.string().trim().max(80).optional(),
  paidUntil: day.nullish(),
  activeUsers: count.nullish(),
  units: count.nullish(),
  unitLabel: z.string().trim().max(30).optional(),
  lastActivityAt: z.string().datetime({ offset: true }).nullish(),
  appVersion: z.string().trim().max(40).optional(),
});
export const reportSchema = z.object({
  reportedAt: z.string().datetime({ offset: true }).optional(),
  workspaces: z.array(workspace).min(1).max(MAX_WORKSPACES),
});
export type FeedReport = z.infer<typeof reportSchema>;

export const newSecret = () => `sfk_${crypto.randomBytes(32).toString("hex")}`;
export const sign = (secret: string, timestamp: string, body: string) => crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

export function signatureOk(secret: string, p: { timestamp: string; body: string; signature: string; now?: number }): boolean {
  const ts = Number(p.timestamp);
  if (!Number.isFinite(ts) || Math.abs((p.now ?? Date.now()) - ts) > MAX_AGE_MS) return false;
  const given = Buffer.from(p.signature.replace(/^sha256=/i, "").toLowerCase(), "hex");
  const want = Buffer.from(sign(secret, p.timestamp, p.body), "hex");
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

// Creates or replaces a Solution's secret. The plain value is returned once; only the sealed copy is stored.
export async function createFeedKey(db: Db, p: { productId: string; userId: string; secret?: string; appSecret?: string }) {
  const plain = newSecret();
  const sealed = seal(plain, p.appSecret ?? process.env.SESSION_SECRET ?? "");
  const hint = plain.slice(-4);
  await db.solutionFeedKey.upsert({
    where: { productId: p.productId },
    create: { productId: p.productId, secretEnc: sealed, hint, createdById: p.userId },
    update: { secretEnc: sealed, hint, rotatedAt: new Date(), lastReportAt: null },
  });
  return { secret: plain, hint };
}

export async function removeFeedKey(db: Db, productId: string) {
  return (await db.solutionFeedKey.deleteMany({ where: { productId } })).count;
}

export type IngestResult = { accepted: number; created: number; updated: number; skipped: number };

// Checks the signature, then stores the newest report of each workspace. Failures never say which part was wrong beyond the status.
export async function ingestReport(db: Db, p: { productCode: string; body: string; timestamp: string; signature: string; now?: Date; appSecret?: string }): Promise<IngestResult> {
  const now = p.now ?? new Date();
  const product = await db.saasProduct.findFirst({ where: { code: p.productCode.toUpperCase(), active: true }, include: { feedKey: true } });
  if (!product?.feedKey) throw new FeedError("Unknown Solution or no key set.", 401);
  const secret = unseal(product.feedKey.secretEnc, p.appSecret ?? process.env.SESSION_SECRET ?? "");
  if (!secret || !signatureOk(secret, { timestamp: p.timestamp, body: p.body, signature: p.signature, now: now.getTime() })) throw new FeedError("Signature check failed.", 401);
  let json: unknown;
  try { json = JSON.parse(p.body); } catch { throw new FeedError("The report is not valid JSON."); }
  const r = await storeReport(db, product, json, now);
  await db.solutionFeedKey.update({ where: { productId: product.id }, data: { lastReportAt: now } });
  return r;
}

// Validates a report (pushed or pulled) and stores the newest figures of each workspace. Unknown fields are dropped.
export async function storeReport(db: Db, product: { id: string; organizationId: string }, json: unknown, now: Date): Promise<IngestResult> {
  const parsed = reportSchema.safeParse(json);
  if (!parsed.success) throw new FeedError(`The report is not in the expected shape: ${parsed.error.issues[0]?.path.join(".") || "body"}.`);
  const reportedDefault = new Date(parsed.data.reportedAt ?? now);
  let created = 0, updated = 0, skipped = 0;
  for (const w of parsed.data.workspaces) {
    const data = {
      name: w.name, status: w.status, planName: w.plan ?? null, paidUntil: w.paidUntil ?? null,
      activeUsers: w.activeUsers ?? null, units: w.units ?? null, unitLabel: w.unitLabel ?? null,
      lastActivityAt: w.lastActivityAt ? new Date(w.lastActivityAt) : null, appVersion: w.appVersion ?? null,
      reportedAt: reportedDefault, receivedAt: now,
    };
    const existing = await db.solutionWorkspace.findUnique({ where: { productId_externalId: { productId: product.id, externalId: w.id } } });
    if (!existing) {
      await db.solutionWorkspace.create({ data: { ...data, organizationId: product.organizationId, productId: product.id, externalId: w.id, firstSeenAt: now } });
      created++;
    } else if (existing.reportedAt > reportedDefault) {
      skipped++; // an older report arriving late never overwrites a newer one
    } else {
      await db.solutionWorkspace.update({ where: { id: existing.id }, data });
      updated++;
    }
  }
  return { accepted: parsed.data.workspaces.length, created, updated, skipped };
}

export const isStale = (receivedAt: Date, now = new Date()) => now.getTime() - receivedAt.getTime() > STALE_AFTER_MS;

export type LiveRow = {
  id: string; productId: string; product: string; name: string; clientId: string | null; status: string; planName: string | null; paidUntil: string | null;
  activeUsers: number | null; units: number | null; unitLabel: string | null; lastActivityAt: Date | null; receivedAt: Date; stale: boolean;
};
const SELECT = { id: true, productId: true, name: true, clientId: true, status: true, planName: true, paidUntil: true, activeUsers: true, units: true, unitLabel: true, lastActivityAt: true, receivedAt: true, product: { select: { name: true } } } as const;
const toRow = (w: { product: { name: string }; receivedAt: Date } & Omit<LiveRow, "product" | "stale">, now: Date): LiveRow => ({ ...w, product: w.product.name, stale: isStale(w.receivedAt, now) });

// The live results of the clients a partner resells to. Only linked workspaces of that partner's own schools are returned.
export async function liveForPartner(db: Db, organizationId: string, earnerId: string, now = new Date()): Promise<LiveRow[]> {
  const schools = await db.resaleSchool.findMany({ where: { organizationId, earnerId, endedAt: null }, select: { clientId: true, productId: true } });
  if (schools.length === 0) return [];
  const rows = await db.solutionWorkspace.findMany({ where: { organizationId, OR: schools.map((s) => ({ clientId: s.clientId, productId: s.productId })) }, select: SELECT, orderBy: { name: "asc" }, take: 500 });
  return rows.map((r) => toRow(r, now));
}

// The live results of the clients a sales agent converted. Ownership follows the converted lead, the same rule commissions use.
export async function liveForAgent(db: Db, organizationId: string, userId: string, now = new Date()): Promise<LiveRow[]> {
  const leads = await db.lead.findMany({ where: { organizationId, assignedToId: userId, convertedAt: { not: null }, clientId: { not: null } }, select: { clientId: true } });
  const clientIds = [...new Set(leads.map((l) => l.clientId!))];
  if (clientIds.length === 0) return [];
  const rows = await db.solutionWorkspace.findMany({ where: { organizationId, clientId: { in: clientIds } }, select: SELECT, orderBy: { name: "asc" }, take: 500 });
  return rows.map((r) => toRow(r, now));
}

// Staff link a reported workspace to the Hifi One Client it belongs to (or unlink it with clientId null).
export async function linkWorkspace(db: Db, p: { organizationId: string; workspaceId: string; clientId: string | null; actorId: string; now?: Date }) {
  const ws = await db.solutionWorkspace.findFirst({ where: { id: p.workspaceId, organizationId: p.organizationId } });
  if (!ws) throw new FeedError("That workspace was not found.", 404);
  if (p.clientId && !(await db.client.findFirst({ where: { id: p.clientId, organizationId: p.organizationId }, select: { id: true } }))) throw new FeedError("That client was not found.", 404);
  await db.solutionWorkspace.update({ where: { id: ws.id }, data: { clientId: p.clientId, linkedById: p.clientId ? p.actorId : null, linkedAt: p.clientId ? (p.now ?? new Date()) : null } });
  return ws;
}

// Daily: tells the partner team about Solutions whose feed has gone quiet and workspaces still waiting to be linked.
export async function feedHealthAlerts(db: Db, organizationId: string, now: Date, dayKey: string, notify: (title: string, body: string, dedupeKey: string) => Promise<void>) {
  const [keys, conns] = await Promise.all([
    db.solutionFeedKey.findMany({ where: { product: { organizationId, active: true } }, include: { product: { select: { name: true } } } }),
    db.solutionConnection.findMany({ where: { product: { organizationId, active: true } }, include: { product: { select: { name: true } } } }),
  ]);
  const quietKeys = keys.filter((k) => (k.lastReportAt ? isStale(k.lastReportAt, now) : now.getTime() - (k.rotatedAt ?? k.createdAt).getTime() > 86_400_000));
  const quietConns = conns.filter((c) => !c.lastOkAt || isStale(c.lastOkAt, now));
  const quiet = [...new Map([...quietKeys, ...quietConns].map((k) => [k.productId, k])).values()];
  const unlinked = await db.solutionWorkspace.count({ where: { organizationId, clientId: null } });
  if (quiet.length) await notify(`${quiet.length === 1 ? "A Solution is" : `${quiet.length} Solutions are`} not reporting`, `${quiet.map((k) => k.product.name).join(", ")}: partners and sales agents may see out-of-date figures.`, `feed-quiet:${organizationId}:${dayKey}`);
  if (unlinked) await notify(`${unlinked} Solution workspace${unlinked === 1 ? "" : "s"} to link`, "Link each workspace to its Hifi One client so partners and sales agents see it.", `feed-unlinked:${organizationId}:${dayKey}`);
  return `${quiet.length} quiet, ${unlinked} unlinked`;
}

// ---------- Pull: Hifi One reads the summary with the API key generated in the Solution's own console ----------

export const PULL_EVERY_MS = 15 * 60_000;
export const SUMMARY_PATH = "/api/hifi-one/summary";
export type Fetcher = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

// The Solution's address as a Super Admin typed it, reduced to https://host[:port]. Plain http is refused outside local testing.
export function cleanBaseUrl(raw: string): string {
  // A browser's saved sign-in can fill this field with an email address; say so plainly instead of failing on the "@"
  if (/^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/.test(raw.trim())) throw new FeedError("The address field holds an email address (your browser may have filled it in). Enter only the Solution's web address, for example https://campusly.co.");
  if (/^[a-z]{3}_hifi_/i.test(raw.trim())) throw new FeedError("That is the API key. Put it in the API key field, and the Solution's web address (for example https://campusly.co) in the address field.");
  let u: URL;
  try { u = new URL(raw.trim().includes("://") ? raw.trim() : `https://${raw.trim()}`); } catch { throw new FeedError("Enter the Solution's web address, for example https://campusly.co."); }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(local && u.protocol === "http:")) throw new FeedError("The address must start with https://.");
  if (u.username || u.password) throw new FeedError("The address contains an \"@\" (your browser may have filled in a saved sign-in). Enter only the Solution's web address, for example https://campusly.co.");
  return `${u.protocol}//${u.host}`;
}

const MAX_PAGES = 20;

// Reads every page of the summary and stores it. Records success or the reason it failed on the connection.
export async function pullSolution(db: Db, productId: string, p: { fetcher?: Fetcher; now?: Date; appSecret?: string } = {}): Promise<IngestResult> {
  const now = p.now ?? new Date();
  const conn = await db.solutionConnection.findUnique({ where: { productId }, include: { product: { select: { id: true, organizationId: true } } } });
  if (!conn) throw new FeedError("This Solution is not connected.", 404);
  const key = unseal(conn.apiKeyEnc, p.appSecret ?? process.env.SESSION_SECRET ?? "");
  const fetcher: Fetcher = p.fetcher ?? ((url, init) => fetch(url, init));
  const total: IngestResult = { accepted: 0, created: 0, updated: 0, skipped: 0 };
  try {
    if (!key) throw new FeedError("The saved API key can no longer be read (the server's secret changed). Connect again.");
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = `${conn.baseUrl}${SUMMARY_PATH}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;
      let res;
      try { res = await fetcher(url, { headers: { authorization: `Bearer ${key}`, accept: "application/json" }, signal: AbortSignal.timeout(20_000) }); }
      catch { throw new FeedError("The Solution could not be reached. Check the address."); }
      if (res.status === 401 || res.status === 403) throw new FeedError("The Solution refused the API key. Generate a new key in the Solution's console and connect again.");
      if (res.status === 404) throw new FeedError("This address has no Hifi One summary. Check the address, or the Solution may need updating.");
      if (!res.ok) throw new FeedError(`The Solution answered with an error (${res.status}).`);
      const json = await res.json().catch(() => null) as { workspaces?: unknown[]; next?: unknown } | null;
      if (!json || !Array.isArray(json.workspaces)) throw new FeedError("The Solution's answer is not a summary.");
      if (json.workspaces.length > 0) {
        const r = await storeReport(db, conn.product, json, now);
        total.accepted += r.accepted; total.created += r.created; total.updated += r.updated; total.skipped += r.skipped;
      }
      cursor = typeof json.next === "string" && json.next ? json.next : null;
      if (!cursor) break;
    }
    await db.solutionConnection.update({ where: { productId }, data: { lastPullAt: now, lastOkAt: now, lastError: null } });
    return total;
  } catch (e) {
    const msg = e instanceof FeedError ? e.message : "Reading the summary failed.";
    await db.solutionConnection.update({ where: { productId }, data: { lastPullAt: now, lastError: msg } });
    throw e instanceof FeedError ? e : new FeedError(msg, 502);
  }
}

// Saves the address and key, then reads the summary once so a wrong address or key shows at once. Nothing is saved when that fails.
export async function connectSolution(db: Db, p: { productId: string; baseUrl: string; apiKey: string; userId: string; fetcher?: Fetcher; now?: Date; appSecret?: string }) {
  const baseUrl = cleanBaseUrl(p.baseUrl);
  const key = p.apiKey.trim();
  if (key.length < 20 || key.length > 400 || !/^[\x21-\x7e]+$/.test(key)) throw new FeedError("That does not look like an API key. Copy it again from the Solution's console.");
  const sealed = seal(key, p.appSecret ?? process.env.SESSION_SECRET ?? "");
  const before = await db.solutionConnection.findUnique({ where: { productId: p.productId } });
  await db.solutionConnection.upsert({
    where: { productId: p.productId },
    create: { productId: p.productId, baseUrl, apiKeyEnc: sealed, hint: key.slice(-4), connectedById: p.userId },
    update: { baseUrl, apiKeyEnc: sealed, hint: key.slice(-4), connectedById: p.userId, connectedAt: p.now ?? new Date(), lastError: null },
  });
  try {
    return { baseUrl, hint: key.slice(-4), result: await pullSolution(db, p.productId, p) };
  } catch (e) {
    // Put back what was there (or nothing), so a typo never replaces a working connection
    if (before) await db.solutionConnection.update({ where: { productId: p.productId }, data: { baseUrl: before.baseUrl, apiKeyEnc: before.apiKeyEnc, hint: before.hint, connectedById: before.connectedById, connectedAt: before.connectedAt, lastError: before.lastError } });
    else await db.solutionConnection.delete({ where: { productId: p.productId } });
    throw e;
  }
}

export async function disconnectSolution(db: Db, productId: string) {
  return (await db.solutionConnection.deleteMany({ where: { productId } })).count;
}

// Called every minute by the server: reads each connected Solution whose last read is 15 minutes old. Errors are recorded, never thrown.
export async function pullDue(db: Db, p: { fetcher?: Fetcher; now?: Date; appSecret?: string } = {}) {
  const now = p.now ?? new Date();
  const due = await db.solutionConnection.findMany({ where: { product: { active: true }, OR: [{ lastPullAt: null }, { lastPullAt: { lt: new Date(now.getTime() - PULL_EVERY_MS) } }] }, select: { productId: true } });
  let ok = 0, failed = 0;
  for (const c of due) {
    try { await pullSolution(db, c.productId, { ...p, now }); ok++; } catch { failed++; }
  }
  return { ok, failed };
}
