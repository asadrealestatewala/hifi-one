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
  await db.solutionFeedKey.update({ where: { productId: product.id }, data: { lastReportAt: now } });
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
  const keys = await db.solutionFeedKey.findMany({ where: { product: { organizationId, active: true } }, include: { product: { select: { name: true } } } });
  const quiet = keys.filter((k) => (k.lastReportAt ? isStale(k.lastReportAt, now) : now.getTime() - (k.rotatedAt ?? k.createdAt).getTime() > 86_400_000));
  const unlinked = await db.solutionWorkspace.count({ where: { organizationId, clientId: null } });
  if (quiet.length) await notify(`${quiet.length === 1 ? "A Solution is" : `${quiet.length} Solutions are`} not reporting`, `${quiet.map((k) => k.product.name).join(", ")}: partners and sales agents may see out-of-date figures.`, `feed-quiet:${organizationId}:${dayKey}`);
  if (unlinked) await notify(`${unlinked} Solution workspace${unlinked === 1 ? "" : "s"} to link`, "Link each workspace to its Hifi One client so partners and sales agents see it.", `feed-unlinked:${organizationId}:${dayKey}`);
  return `${quiet.length} quiet, ${unlinked} unlinked`;
}
