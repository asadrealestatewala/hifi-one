// Prospector stage 2: check each prospect's own website. A queue of ProspectWebsiteCheck rows (QUEUED), a runner that claims rows
// with FOR UPDATE SKIP LOCKED (two servers or two clicks never take the same one) and works through them slowly: two at a time,
// at least a second between PageSpeed requests, and the daily PageSpeed limit from the call ledger. Home page reading goes through
// safe-fetch (public addresses only). Free of Next.js imports so it can be tested against the database.
import { Prisma, type PrismaClient } from "@prisma/client";
import { BudgetError, pageSpeedCaps, releaseCall, reserveCall, usage, type Caps } from "./api-budget";
import { getKey } from "./integration-keys";
import { PSI_SKU, PageSpeedError, runPageSpeed, type PageSpeedResult } from "./pagespeed";
import { SafeFetchError, fetchPublicPage, type FetchedPage } from "./safe-fetch";
import { analyzeHtml } from "./website-analysis";
import { findFacebookUrl } from "./facebook-link";
import { recordDiscoveredLink } from "./prospect-social";
import { canSearch, isManager, prospectScope, type Actor } from "./prospector";

type Db = PrismaClient;
export const FRESH_DAYS = 7; // a finished check is not repeated within a week unless forced
export const MAX_QUEUE_PER_CLICK = 100;
const STUCK_MINUTES = 10;
const MAX_ATTEMPTS = 2;

export type Deps = {
  fetchPage: (url: string) => Promise<FetchedPage>;
  pageSpeed: (p: { apiKey: string; url: string }) => Promise<PageSpeedResult>;
  psiKey: (organizationId: string) => Promise<string | undefined>;
  sleep: (ms: number) => Promise<void>;
  caps: Caps;
};
const realDeps = (db: Db): Deps => ({
  fetchPage: (url) => fetchPublicPage(url),
  pageSpeed: (p) => runPageSpeed(p),
  psiKey: (org) => getKey(db, org, "GOOGLE_PAGESPEED"),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  caps: pageSpeedCaps(),
});

// ---------- queueing ----------
export async function queueChecks(db: Db, actor: Actor, ids: string[], opts: { force?: boolean; now?: Date } = {}) {
  if (!(isManager(actor) || canSearch(actor))) throw new Error("You do not have access to run website checks.");
  const now = opts.now ?? new Date();
  const wanted = [...new Set(ids)].slice(0, MAX_QUEUE_PER_CLICK);
  const rows = await db.prospect.findMany({ where: { AND: [prospectScope(actor), { id: { in: wanted }, status: { not: "DISMISSED" } }] }, select: { id: true, website: true, websiteCheck: { select: { status: true, checkedAt: true } } } });
  let queued = 0, noWebsite = 0, fresh = 0, busy = 0;
  for (const r of rows) {
    const c = r.websiteCheck;
    if (c && (c.status === "QUEUED" || c.status === "RUNNING")) { busy++; continue; }
    if (!r.website) {
      await db.prospectWebsiteCheck.upsert({ where: { prospectId: r.id }, update: { status: "NO_WEBSITE", checkedAt: now, error: null }, create: { prospectId: r.id, organizationId: actor.organizationId, status: "NO_WEBSITE", checkedAt: now } });
      noWebsite++; continue;
    }
    if (!opts.force && c?.status === "DONE" && c.checkedAt && now.getTime() - c.checkedAt.getTime() < FRESH_DAYS * 86_400_000) { fresh++; continue; }
    await db.prospectWebsiteCheck.upsert({
      where: { prospectId: r.id }, update: { status: "QUEUED", queuedAt: now, attempts: 0, error: null, startedAt: null },
      create: { prospectId: r.id, organizationId: actor.organizationId, status: "QUEUED", queuedAt: now },
    });
    queued++;
  }
  return { queued, noWebsite, fresh, busy, skipped: wanted.length - rows.length };
}

// ---------- running ----------
async function reapStuck(db: Db, now: Date) {
  const cutoff = new Date(now.getTime() - STUCK_MINUTES * 60_000);
  await db.prospectWebsiteCheck.updateMany({ where: { status: "RUNNING", startedAt: { lt: cutoff }, attempts: { lt: MAX_ATTEMPTS } }, data: { status: "QUEUED" } });
  await db.prospectWebsiteCheck.updateMany({ where: { status: "RUNNING", startedAt: { lt: cutoff }, attempts: { gte: MAX_ATTEMPTS } }, data: { status: "FAILED", error: "The check did not finish." } });
}

async function claim(db: Db, n: number, organizationId?: string) {
  return db.$queryRaw<{ prospectId: string; organizationId: string; attempts: number }[]>(Prisma.sql`
    UPDATE "ProspectWebsiteCheck" SET "status" = 'RUNNING', "startedAt" = now(), "attempts" = "attempts" + 1
    WHERE "prospectId" IN (
      SELECT "prospectId" FROM "ProspectWebsiteCheck" WHERE "status" = 'QUEUED' ${organizationId ? Prisma.sql`AND "organizationId" = ${organizationId}` : Prisma.empty}
      ORDER BY "queuedAt" LIMIT ${n} FOR UPDATE SKIP LOCKED)
    RETURNING "prospectId", "organizationId", "attempts"`);
}

export type RunSummary = { claimed: number; done: number; requeued: number; failed: number };

export async function runWebsiteChecks(db: Db, opts: { organizationId?: string; batch?: number; concurrency?: number; now?: Date; deps?: Partial<Deps> } = {}): Promise<RunSummary> {
  const deps = { ...realDeps(db), ...opts.deps };
  await reapStuck(db, opts.now ?? new Date());
  const claimed = await claim(db, opts.batch ?? 20, opts.organizationId);
  const out: RunSummary = { claimed: claimed.length, done: 0, requeued: 0, failed: 0 };
  let nextPsiAt = 0;
  const psiGate = async () => { const wait = nextPsiAt - Date.now(); nextPsiAt = Math.max(Date.now(), nextPsiAt) + 1200; if (wait > 0) await deps.sleep(wait); };
  const queue = [...claimed];
  const worker = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      try { const r = await processOne(db, c, deps, psiGate, opts.now); out[r]++; }
      catch (e) {
        console.error("Website check failed", e instanceof Error ? e.name : "error");
        await db.prospectWebsiteCheck.update({ where: { prospectId: c.prospectId }, data: { status: "FAILED", error: "Something went wrong while checking this site." } }).catch(() => undefined);
        out.failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 2) }, worker));
  return out;
}

// Keeps going while there is work, up to `maxBatches`, so one click can check a whole page of prospects
export async function drainWebsiteChecks(db: Db, opts: { organizationId?: string; maxBatches?: number; deps?: Partial<Deps> } = {}) {
  const total: RunSummary = { claimed: 0, done: 0, requeued: 0, failed: 0 };
  for (let i = 0; i < (opts.maxBatches ?? 6); i++) {
    const r = await runWebsiteChecks(db, { organizationId: opts.organizationId, deps: opts.deps });
    total.claimed += r.claimed; total.done += r.done; total.requeued += r.requeued; total.failed += r.failed;
    if (r.claimed === 0) break;
  }
  return total;
}

async function processOne(db: Db, c: { prospectId: string; organizationId: string; attempts: number }, deps: Deps, psiGate: () => Promise<void>, now?: Date): Promise<"done" | "requeued" | "failed"> {
  const p = await db.prospect.findUnique({ where: { id: c.prospectId }, select: { website: true } });
  if (!p?.website) { await db.prospectWebsiteCheck.update({ where: { prospectId: c.prospectId }, data: { status: "NO_WEBSITE", checkedAt: now ?? new Date() } }); return "done"; }
  const data: Prisma.ProspectWebsiteCheckUpdateInput = { url: p.website.slice(0, 500), error: null };
  let page: FetchedPage | null = null;
  try { page = await deps.fetchPage(p.website); }
  catch (e) {
    if (!(e instanceof SafeFetchError)) throw e;
    // A site that is down is useful to know; only a passing network or timeout problem is tried once more
    if ((e.code === "NETWORK" || e.code === "TIMEOUT") && c.attempts < MAX_ATTEMPTS) { await db.prospectWebsiteCheck.update({ where: { prospectId: c.prospectId }, data: { status: "QUEUED", error: e.message } }); return "requeued"; }
    Object.assign(data, { reachable: false, error: e.message });
  }
  if (page) {
    const s = page.status;
    data.finalUrl = page.finalUrl.slice(0, 500); data.httpStatus = s;
    if (s >= 200 && s < 400) {
      const a = analyzeHtml(page.html, page.finalUrl);
      // The business's own Facebook page, if the home page links to it (stage 3 reads its numbers when someone asks)
      await recordDiscoveredLink(db, { prospectId: c.prospectId, organizationId: c.organizationId, url: findFacebookUrl(page.html) });
      Object.assign(data, { reachable: true, https: a.https, hasTitle: a.hasTitle, hasMetaDescription: a.hasMetaDescription, hasAnalytics: a.hasAnalytics, hasGtm: a.hasGtm, hasMetaPixel: a.hasMetaPixel, hasContactForm: a.hasContactForm, hasWhatsapp: a.hasWhatsapp, lowConfidence: a.lowConfidence });
    } else {
      // 401, 403 and 429 usually mean the site refuses automatic visitors, not that it is down
      Object.assign(data, { reachable: s === 401 || s === 403 || s === 429 ? null : false, https: /^https:/i.test(page.finalUrl), error: s === 401 || s === 403 || s === 429 ? `The website refused our check (${s}), so its page could not be read.` : `The website answered with an error (${s}).` });
    }
  }
  // Speed and SEO from Google, unless the site could not be reached or the key or the daily limit is missing
  const reachableForPsi = !page ? false : data.reachable !== false;
  if (reachableForPsi) {
    const key = await deps.psiKey(c.organizationId);
    if (!key) Object.assign(data, { psiStatus: "NOT_CONFIGURED", psiNote: "No PageSpeed key is saved, so speed and SEO scores were skipped." });
    else {
      let reservation: { id: string } | null = null;
      try {
        reservation = await reserveCall(db, { organizationId: c.organizationId, provider: "GOOGLE_PAGESPEED", sku: PSI_SKU, caps: deps.caps, now });
        await psiGate();
        const r = await deps.pageSpeed({ apiKey: key, url: page?.finalUrl ?? p.website });
        Object.assign(data, { psiStatus: "OK", psiNote: null, mobileScore: r.mobileScore, seoScore: r.seoScore, fcpMs: r.fcpMs, lcpMs: r.lcpMs, tbtMs: r.tbtMs, cls: r.cls, speedIndexMs: r.speedIndexMs });
      } catch (e) {
        if (e instanceof BudgetError) Object.assign(data, { psiStatus: "LIMIT", psiNote: "The daily PageSpeed limit is used up. Run the check again tomorrow for speed and SEO scores." });
        else if (e instanceof PageSpeedError) {
          if ((e.kind === "KEY" || e.kind === "LIMIT") && reservation) await releaseCall(db, reservation.id);
          Object.assign(data, { psiStatus: e.kind === "LIMIT" ? "LIMIT" : e.kind === "UNREACHABLE" ? "UNREACHABLE" : "FAILED", psiNote: e.message });
        } else throw e;
      }
    }
  }
  await db.prospectWebsiteCheck.update({ where: { prospectId: c.prospectId }, data: { ...data, status: "DONE", checkedAt: now ?? new Date() } });
  return "done";
}

export const pageSpeedUsage = (db: Db, organizationId: string) => usage(db, organizationId, "GOOGLE_PAGESPEED", pageSpeedCaps());
