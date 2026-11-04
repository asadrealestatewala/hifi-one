// Facebook page data behind a swappable provider. The rest of the application only knows `SocialProvider`; SocialAPIs is the first one.
// Each outbound request is reserved in the call ledger BEFORE it is made (see api-budget.ts) and given back when the provider
// says nothing was billed. Free of Next.js imports so it can be tested.
//
// SocialAPIs (docs.socialapis.io/api-reference/facebook, read 2026-11-04): GET https://api.socialapis.io, header `x-api-token`.
//   /facebook/pages/details?link=  1 credit (5 with exact_followers_count, which we do not ask for): `followers_count`, no documented likes field.
//   /facebook/pages/posts?link=    1 credit when no limit is given: posts with `created_time`.
// The documentation does not show how the response is wrapped, so the readers below accept the common shapes and say "no data"
// rather than guess. This has NOT been run against the real service.

export type SocialPageData = { name: string | null; followers: number | null; likes: number | null; lastPostAt: Date | null };
export class SocialError extends Error { constructor(message: string, readonly kind: "KEY" | "LIMIT" | "NOT_FOUND" | "FAILED" = "FAILED") { super(message); } }

// The provider asks for permission before every request and gives it back when the request was not billed
export type CallGuard = { reserve: (sku: string) => Promise<{ id: string }>; release: (id: string) => Promise<void> };
export interface SocialProvider {
  readonly id: string;
  readonly label: string;
  readonly requestsPerPage: number; // how many billable requests one business uses, so a screen can say so before asking
  fetchPage(p: { apiKey: string; pageUrl: string; guard: CallGuard }): Promise<SocialPageData>;
}

export const SOCIALAPIS_BASE = "https://api.socialapis.io";
export const SKU_DETAILS = "SOCIAL_FB_PAGE_DETAILS";
export const SKU_POSTS = "SOCIAL_FB_PAGE_POSTS";

// "1,234", "12.5K", "3.2M", 4100 or "4100 followers" -> a whole number, else null
export function parseCount(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
  if (typeof v !== "string") return null;
  const m = v.replace(/,/g, "").trim().match(/^(\d+(?:\.\d+)?)\s*([kmb])?\b/i);
  if (!m) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] ?? "").toLowerCase() as "k" | "m" | "b"] ?? 1;
  const n = Math.round(Number(m[1]) * mult);
  return Number.isFinite(n) ? n : null;
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const inner = (body: unknown) => { const o = obj(body); return obj(o?.data) ?? obj(o?.result) ?? obj(o?.page) ?? o; };

export function parseDetails(body: unknown): { name: string | null; followers: number | null; likes: number | null } {
  const d = inner(body);
  if (!d) return { name: null, followers: null, likes: null };
  const name = [d.title, d.name, d.page_name].find((x) => typeof x === "string" && x.trim()) as string | undefined;
  return { name: name?.trim().slice(0, 200) ?? null, followers: parseCount(d.followers_count ?? d.followers), likes: parseCount(d.likes_count ?? d.page_likes ?? d.likes) };
}

function toDate(v: unknown): Date | null {
  if (typeof v === "number" && Number.isFinite(v)) { const d = new Date(v < 1e12 ? v * 1000 : v); return Number.isNaN(d.getTime()) ? null : d; }
  if (typeof v === "string" && v.trim()) { const d = new Date(/^\d{9,13}$/.test(v.trim()) ? toDate(Number(v.trim())) ?? NaN : v); return Number.isNaN(d.getTime()) ? null : d; }
  return null;
}
// The newest post date: pinned posts can be old and sit first, so the list is not assumed to be in order
export function parsePosts(body: unknown, now = new Date()): Date | null {
  const o = obj(body);
  const d = inner(body);
  const list = [Array.isArray(body) ? body : null, Array.isArray(o?.posts) ? o?.posts : null, Array.isArray(o?.data) ? o?.data : null, Array.isArray(d?.posts) ? d?.posts : null, Array.isArray(o?.results) ? o?.results : null, Array.isArray(d?.results) ? d?.results : null].find(Boolean) as unknown[] | undefined;
  let best: Date | null = null;
  for (const p of list ?? []) {
    const t = toDate(obj(p)?.created_time ?? obj(p)?.timestamp ?? obj(p)?.created_at);
    if (t && t.getTime() <= now.getTime() + 86_400_000 && (!best || t > best)) best = t;
  }
  return best;
}

export function socialApis(fetchImpl: typeof fetch = fetch, timeoutMs = 30_000): SocialProvider {
  async function get(path: string, apiKey: string, pageUrl: string, sku: string, guard: CallGuard): Promise<unknown> {
    const r = await guard.reserve(sku);
    let res: Response;
    try { res = await fetchImpl(`${SOCIALAPIS_BASE}${path}?${new URLSearchParams({ link: pageUrl })}`, { headers: { "x-api-token": apiKey, Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) }); }
    catch { await guard.release(r.id); throw new SocialError("SocialAPIs did not answer in time.", "FAILED"); }
    if (!res.ok) {
      // Failed requests caused by the input, a refused key or a rate limit are documented as not costing credits; a server error is kept on the ledger to stay on the safe side
      if (res.status < 500) await guard.release(r.id);
      if (res.status === 401 || res.status === 403) throw new SocialError("SocialAPIs refused the key. Check the key in Integrations.", "KEY");
      if (res.status === 429) throw new SocialError("SocialAPIs is limiting requests right now. Try again later.", "LIMIT");
      if (res.status === 404 || res.status === 400 || res.status === 422) throw new SocialError("SocialAPIs could not find that Facebook page.", "NOT_FOUND");
      throw new SocialError(`SocialAPIs failed (${res.status}).`, "FAILED");
    }
    try { return await res.json(); } catch { throw new SocialError("SocialAPIs sent an answer we could not read.", "FAILED"); }
  }
  return {
    id: "SOCIALAPIS", label: "SocialAPIs", requestsPerPage: 2,
    async fetchPage({ apiKey, pageUrl, guard }) {
      const d = parseDetails(await get("/facebook/pages/details", apiKey, pageUrl, SKU_DETAILS, guard));
      if (d.followers === null && d.likes === null && d.name === null) throw new SocialError("SocialAPIs returned nothing for that Facebook page.", "NOT_FOUND");
      // A failure of the second request keeps what the first one found: followers are still useful without the last post date
      let lastPostAt: Date | null = null;
      try { lastPostAt = parsePosts(await get("/facebook/pages/posts", apiKey, pageUrl, SKU_POSTS, guard)); }
      catch (e) { if (e instanceof SocialError && (e.kind === "KEY" || e.kind === "LIMIT")) throw e; }
      return { ...d, lastPostAt };
    },
  };
}
