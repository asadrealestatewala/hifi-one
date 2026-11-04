// Prospector stage 4: how big an opportunity a business is. A PURE function of what we know about it (its Google listing, its website
// check, its Facebook page): no network, no database, no AI. The same facts always give the same score, so it is tested rule by rule.
//
// Higher means weaker online presence, so more for us to fix. Every rule is one visible reason with points and one of our six services,
// and the score is the sum of the points (at most 100). Nothing is guessed: a fact we do not have yet (website not checked, Facebook not
// fetched) scores nothing and is listed under `missing`, so a score can rise once more is known. The weights are one table
// (DEFAULT_WEIGHTS) that `scoreProspect` accepts as an argument, so a screen to edit them can be added without touching the rules.

export const SCORE_VERSION = 1;

export const SERVICES = {
  WEBSITE: { label: "Website development", angle: "Their website is missing, down or not trusted. A fast, mobile-friendly website that turns visitors into enquiries is the first thing to offer." },
  SEO: { label: "SEO and web optimisation", angle: "Their site is slow or hard for Google to read, so customers searching for them do not find or wait for them. Offer a speed and SEO clean-up." },
  SOCIAL: { label: "Social media management and growth", angle: "Their Facebook page is missing, small or quiet. Offer regular posting and growth so customers see them and trust them." },
  BRAND: { label: "Brand building", angle: "Few or weak Google reviews make them look less trusted than competitors. Offer brand and reputation building." },
  ADS: { label: "Meta and Google ads for lead generation", angle: "They cannot measure or retarget visitors (no analytics or Meta Pixel), so any advertising is blind. Offer ads with proper tracking." },
  CRM: { label: "CRM services", angle: "Visitors have no easy way to reach them (no contact form or WhatsApp). Offer lead capture with a CRM so no enquiry is lost." },
} as const;
export type ServiceKey = keyof typeof SERVICES;
export const SERVICE_ORDER = Object.keys(SERVICES) as ServiceKey[];

export type RuleId = "NO_WEBSITE" | "SITE_DOWN" | "NO_HTTPS" | "SLOW_MOBILE" | "LOW_SEO" | "NO_TITLE" | "NO_META_DESCRIPTION" | "NO_ANALYTICS" | "NO_META_PIXEL" | "NO_CONTACT_FORM" | "NO_WHATSAPP" | "NO_FACEBOOK" | "FEW_FOLLOWERS" | "STALE_FACEBOOK" | "FEW_REVIEWS" | "LOW_RATING";
export type Weights = Record<RuleId, number>;
export const RULE_SERVICE: Record<RuleId, ServiceKey> = {
  NO_WEBSITE: "WEBSITE", SITE_DOWN: "WEBSITE", NO_HTTPS: "WEBSITE", SLOW_MOBILE: "SEO", LOW_SEO: "SEO", NO_TITLE: "SEO", NO_META_DESCRIPTION: "SEO",
  NO_ANALYTICS: "ADS", NO_META_PIXEL: "ADS", NO_CONTACT_FORM: "CRM", NO_WHATSAPP: "CRM", NO_FACEBOOK: "SOCIAL", FEW_FOLLOWERS: "SOCIAL", STALE_FACEBOOK: "SOCIAL", FEW_REVIEWS: "BRAND", LOW_RATING: "BRAND",
};
export const DEFAULT_WEIGHTS: Weights = {
  NO_WEBSITE: 35, SITE_DOWN: 25, NO_HTTPS: 8, SLOW_MOBILE: 15, LOW_SEO: 12, NO_TITLE: 6, NO_META_DESCRIPTION: 5, NO_ANALYTICS: 8, NO_META_PIXEL: 8,
  NO_CONTACT_FORM: 8, NO_WHATSAPP: 5, NO_FACEBOOK: 10, FEW_FOLLOWERS: 8, STALE_FACEBOOK: 12, FEW_REVIEWS: 8, LOW_RATING: 8,
};

export type ScoreInput = {
  name: string;
  hasWebsite: boolean;
  rating: number | null;
  ratingCount: number | null;
  check: null | {
    status: string; reachable: boolean | null; https: boolean | null; hasTitle: boolean | null; hasMetaDescription: boolean | null; hasAnalytics: boolean | null; hasGtm: boolean | null;
    hasMetaPixel: boolean | null; hasContactForm: boolean | null; hasWhatsapp: boolean | null; lowConfidence: boolean | null; mobileScore: number | null; seoScore: number | null;
  };
  social: null | { facebookUrl: string | null; status: string; followers: number | null; lastPostAt: Date | null };
  now?: Date;
};
export type Reason = { id: RuleId; service: ServiceKey; points: number; text: string };
export type ServiceScore = { service: ServiceKey; label: string; points: number };
export type ProspectScore = {
  score: number; // 0 to 100, higher = more to fix
  band: "STRONG" | "GOOD" | "SOME" | "WEAK";
  reasons: Reason[]; // biggest first
  services: ServiceScore[]; // only services with points, biggest first
  topService: ServiceKey | null;
  missing: string[]; // what we do not know yet; each could still change the score
  pitch: string;
  version: number;
};

export const BAND_LABEL: Record<ProspectScore["band"], string> = { STRONG: "Strong opportunity", GOOD: "Good opportunity", SOME: "Some opportunity", WEAK: "Little to fix" };
const bandFor = (n: number): ProspectScore["band"] => (n >= 60 ? "STRONG" : n >= 35 ? "GOOD" : n >= 15 ? "SOME" : "WEAK");

// Weights may be overridden one by one (for a later settings screen); anything missing, negative or silly falls back or is clamped
export function mergeWeights(over: Partial<Weights> = {}): Weights {
  const out = { ...DEFAULT_WEIGHTS };
  for (const k of Object.keys(DEFAULT_WEIGHTS) as RuleId[]) { const v = over[k]; if (typeof v === "number" && Number.isFinite(v)) out[k] = Math.min(50, Math.max(0, Math.round(v))); }
  return out;
}

const DAY = 86_400_000;
const ago = (d: number) => (d < 1 ? "today" : d < 2 ? "yesterday" : `${Math.floor(d)} days ago`);

export function scoreProspect(input: ScoreInput, weights: Partial<Weights> = DEFAULT_WEIGHTS): ProspectScore {
  const w = mergeWeights(weights);
  const now = (input.now ?? new Date()).getTime();
  const reasons: Reason[] = [];
  const missing: string[] = [];
  const add = (id: RuleId, factor: number, text: string) => { const points = Math.round(w[id] * factor * 10) / 10; if (points > 0) reasons.push({ id, service: RULE_SERVICE[id], points, text }); };

  // ---- Google listing: always known ----
  if (input.ratingCount !== null) {
    if (input.ratingCount < 20) add("FEW_REVIEWS", 1, `Only ${input.ratingCount} Google review${input.ratingCount === 1 ? "" : "s"}`);
    else if (input.ratingCount < 50) add("FEW_REVIEWS", 0.5, `Only ${input.ratingCount} Google reviews`);
  } else add("FEW_REVIEWS", 1, "No Google reviews");
  if (input.rating !== null && input.rating < 4) add("LOW_RATING", 1, `Rated ${input.rating.toFixed(1)} out of 5 on Google`);

  // ---- Website ----
  const c = input.check;
  let siteRead = false; // did we actually read a home page
  if (!input.hasWebsite) add("NO_WEBSITE", 1, "No website at all");
  else if (!c || c.status === "QUEUED" || c.status === "RUNNING" || c.status === "NO_WEBSITE" || c.status === "FAILED") missing.push("Website not checked yet");
  else if (c.reachable === false) add("SITE_DOWN", 1, "Website could not be reached");
  else if (c.reachable === null) missing.push("Website refused our check, so its page could not be read");
  else {
    siteRead = true;
    // A page built in the browser hides tags and forms from us, so what we could not see counts for half
    const hidden = c.lowConfidence ? 0.5 : 1;
    if (c.https === false) add("NO_HTTPS", 1, "Website is not on HTTPS");
    if (c.hasTitle === false) add("NO_TITLE", 1, "Home page has no title");
    if (c.hasMetaDescription === false) add("NO_META_DESCRIPTION", 1, "Home page has no search description");
    if (c.hasAnalytics === false) add("NO_ANALYTICS", hidden, "No Google Analytics or Tag Manager");
    // With a tag manager the pixel may sit inside it, where we cannot see
    if (c.hasMetaPixel === false && !c.hasGtm) add("NO_META_PIXEL", hidden, "No Meta Pixel");
    if (c.hasContactForm === false) add("NO_CONTACT_FORM", hidden, "No contact form");
    if (c.hasWhatsapp === false) add("NO_WHATSAPP", hidden, "No WhatsApp link");
    if (c.mobileScore !== null) {
      if (c.mobileScore < 50) add("SLOW_MOBILE", 1, `Slow on mobile (speed score ${c.mobileScore} of 100)`);
      else if (c.mobileScore < 90) add("SLOW_MOBILE", 0.5, `Could be faster on mobile (speed score ${c.mobileScore} of 100)`);
    } else missing.push("Speed score not available");
    if (c.seoScore !== null) {
      if (c.seoScore < 70) add("LOW_SEO", 1, `Weak search optimisation (SEO score ${c.seoScore} of 100)`);
      else if (c.seoScore < 90) add("LOW_SEO", 0.5, `SEO could be better (score ${c.seoScore} of 100)`);
    }
  }

  // ---- Facebook ----
  const s = input.social;
  if (s?.facebookUrl) {
    if (s.status === "OK") {
      if (s.followers !== null) {
        if (s.followers < 500) add("FEW_FOLLOWERS", 1, `Facebook page has only ${s.followers} followers`);
        else if (s.followers < 2000) add("FEW_FOLLOWERS", 0.5, `Facebook page has ${s.followers} followers`);
      }
      if (s.lastPostAt) {
        const d = (now - s.lastPostAt.getTime()) / DAY;
        if (d > 90) add("STALE_FACEBOOK", 1, `Facebook page last posted ${ago(d)}`);
        else if (d > 30) add("STALE_FACEBOOK", 0.5, `Facebook page last posted ${ago(d)}`);
      } else missing.push("Facebook last post date not available");
    } else missing.push("Facebook numbers not fetched yet");
  } else if (siteRead) add("NO_FACEBOOK", 1, "No Facebook page found on their website");
  else missing.push("Facebook page not looked for yet");

  reasons.sort((a, b) => b.points - a.points || a.id.localeCompare(b.id));
  const total = Math.min(100, Math.round(reasons.reduce((n, r) => n + r.points, 0)));
  const byService = new Map<ServiceKey, number>();
  for (const r of reasons) byService.set(r.service, (byService.get(r.service) ?? 0) + r.points);
  const services = SERVICE_ORDER.filter((k) => (byService.get(k) ?? 0) > 0).map((k) => ({ service: k, label: SERVICES[k].label, points: Math.round((byService.get(k) ?? 0) * 10) / 10 })).sort((a, b) => b.points - a.points || SERVICE_ORDER.indexOf(a.service) - SERVICE_ORDER.indexOf(b.service));
  const topService = services[0]?.service ?? null;
  const base = { score: total, band: bandFor(total), reasons, services, topService, missing, version: SCORE_VERSION };
  return { ...base, pitch: buildPitch(input.name, base) };
}

// A short note for the salesperson: what to lead with, why, and what else to raise. Plain text, so it can become a CRM note unchanged.
function buildPitch(name: string, p: Pick<ProspectScore, "score" | "band" | "reasons" | "services" | "topService" | "missing">): string {
  if (!p.topService) {
    return `${name}: nothing obvious to fix from what we know (score ${p.score} of 100).${p.missing.length ? ` Not known yet: ${p.missing.join("; ")}.` : ""} Check them by hand before reaching out.`;
  }
  const lines: string[] = [`${name}: ${BAND_LABEL[p.band].toLowerCase()} (score ${p.score} of 100). Lead with ${SERVICES[p.topService].label}.`, "", "What we found:"];
  for (const r of p.reasons.slice(0, 5)) lines.push(`- ${r.text}`);
  lines.push("", `Why it matters: ${SERVICES[p.topService].angle}`);
  const others = p.services.slice(1, 3);
  if (others.length) lines.push("", `Also worth raising: ${others.map((o) => o.label).join("; ")}.`);
  if (p.missing.length) lines.push("", `Not known yet: ${p.missing.join("; ")}.`);
  return lines.join("\n");
}
