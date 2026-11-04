// Google PageSpeed Insights API v5 (runPagespeed). One mobile run with the Performance and SEO categories gives the mobile score,
// the key speed numbers and a basic SEO score in a single request. Free of Next.js imports so it can be tested.
// The key travels in the request address (that is how this API takes it), so no message here ever includes the address.
export const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
export const PSI_SKU = "PSI_RUN_PAGESPEED";

export class PageSpeedError extends Error { constructor(message: string, readonly kind: "KEY" | "LIMIT" | "UNREACHABLE" | "FAILED" = "FAILED") { super(message); } }

export type PageSpeedResult = { mobileScore: number | null; seoScore: number | null; fcpMs: number | null; lcpMs: number | null; tbtMs: number | null; cls: number | null; speedIndexMs: number | null };

type Audit = { numericValue?: number; score?: number | null };
type Body = { lighthouseResult?: { categories?: Record<string, { score?: number | null }>; audits?: Record<string, Audit> } };
const pct = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) : null);
const num = (a: Audit | undefined, round = true) => (typeof a?.numericValue === "number" && Number.isFinite(a.numericValue) ? (round ? Math.round(a.numericValue) : Math.round(a.numericValue * 1000) / 1000) : null);

export function parsePageSpeed(body: unknown): PageSpeedResult {
  const l = (body as Body)?.lighthouseResult;
  if (!l) throw new PageSpeedError("Google returned no speed report for this site.");
  const a = l.audits ?? {};
  return {
    mobileScore: pct(l.categories?.performance?.score), seoScore: pct(l.categories?.seo?.score),
    fcpMs: num(a["first-contentful-paint"]), lcpMs: num(a["largest-contentful-paint"]), tbtMs: num(a["total-blocking-time"]),
    cls: num(a["cumulative-layout-shift"], false), speedIndexMs: num(a["speed-index"]),
  };
}

export async function runPageSpeed(p: { apiKey: string; url: string; fetchImpl?: typeof fetch; timeoutMs?: number }): Promise<PageSpeedResult> {
  const q = new URLSearchParams({ url: p.url, strategy: "mobile", key: p.apiKey });
  q.append("category", "performance"); q.append("category", "seo");
  let res: Response;
  try { res = await (p.fetchImpl ?? fetch)(`${PSI_ENDPOINT}?${q}`, { signal: AbortSignal.timeout(p.timeoutMs ?? 90_000) }); }
  catch { throw new PageSpeedError("The speed test did not finish in time.", "FAILED"); }
  if (!res.ok) {
    let msg = ""; try { msg = ((await res.json()) as { error?: { message?: string } }).error?.message ?? ""; } catch { /* not JSON */ }
    if (res.status === 429) throw new PageSpeedError("Google's speed test is limiting requests right now.", "LIMIT");
    if (res.status === 403 || /api key|API_KEY|not enabled|PERMISSION/i.test(msg)) throw new PageSpeedError("Google refused the PageSpeed key. Check the key in Integrations and that the PageSpeed Insights API is enabled for it.", "KEY");
    if (res.status === 400 && /FAILED_DOCUMENT_REQUEST|ERRORED_DOCUMENT_REQUEST|DNS_FAILURE|Lighthouse returned error|unable to resolve/i.test(msg)) throw new PageSpeedError("Google could not load the site for the speed test.", "UNREACHABLE");
    throw new PageSpeedError(`Google's speed test failed (${res.status}).`);
  }
  return parsePageSpeed(await res.json());
}
