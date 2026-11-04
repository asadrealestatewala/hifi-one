// What a website's own home page HTML tells us: https, title, description, analytics, Meta Pixel, a contact form, WhatsApp.
// Pure (no network), so every rule is tested. It reads the HTML the server sent, so anything a site only adds with JavaScript after
// loading (or through a tag manager) is invisible: `lowConfidence` says when the page looks like that, and `viaTagManager` says
// a tag manager is present, so "no Meta Pixel" is then only a weaker hint.

export type WebsiteSignals = {
  https: boolean;
  hasTitle: boolean;
  hasMetaDescription: boolean;
  hasAnalytics: boolean; // Google Analytics (gtag, analytics.js, UA or G- ids) or Google Tag Manager
  hasGtm: boolean;
  hasMetaPixel: boolean;
  hasContactForm: boolean;
  hasWhatsapp: boolean;
  viaTagManager: boolean;
  lowConfidence: boolean;
};

const strip = (html: string) => html.replace(/<!--[\s\S]*?-->/g, " ");
const attr = (tag: string, name: string) => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return (m?.[1] ?? m?.[2] ?? m?.[3] ?? "").trim();
};

export function hasTitle(html: string) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return Boolean(m && m[1].replace(/&nbsp;|\s+/g, " ").trim().length > 0);
}
export function hasMetaDescription(html: string) {
  for (const t of html.match(/<meta\b[^>]*>/gi) ?? []) if (attr(t, "name").toLowerCase() === "description" && attr(t, "content").length > 0) return true;
  return false;
}

const GA = [/googletagmanager\.com\/gtag\/js/i, /google-analytics\.com\/(analytics|ga)\.js/i, /google-analytics\.com\/g\/collect/i, /gtag\(\s*['"]config['"]\s*,\s*['"](G|UA|AW)-/i, /\bga\(\s*['"]create['"]/i, /['"]G-[A-Z0-9]{8,12}['"]/, /['"]UA-\d{4,10}-\d+['"]/];
const GTM = [/googletagmanager\.com\/gtm\.js/i, /googletagmanager\.com\/ns\.html\?id=GTM-/i, /['"]GTM-[A-Z0-9]{4,10}['"]/];
const PIXEL = [/connect\.facebook\.net\/[a-z_A-Z]+\/fbevents\.js/i, /\bfbq\(\s*['"]init['"]/i, /facebook\.com\/tr\?id=\d+/i];
const WHATSAPP = [/(?:href|data-href|data-url)\s*=\s*["'][^"']*(?:wa\.me\/|api\.whatsapp\.com\/|web\.whatsapp\.com\/send|whatsapp:\/\/|chat\.whatsapp\.com\/)/i];
// Form builders whose forms are rendered by their own script or iframe
const FORM_EMBEDS = [/js\.hsforms\.net|forms\.hubspot\.com|hbspt\.forms\.create/i, /typeform\.com\/to\/|embed\.typeform\.com/i, /jotform\.com\/(?:form|jsform)|form\.jotform/i, /wufoo\.com\/forms/i, /formspree\.io/i, /tally\.so\/embed/i, /forms\.gle\/|docs\.google\.com\/forms/i, /\bwpcf7\b|wpcf7-form/i, /\bgform_wrapper\b|gravityforms/i, /\bnf-form-cont\b|ninja-forms/i, /elementor-form|\bfluentform\b|\bwpforms-form\b|\bformidable\b/i, /calendly\.com\/[a-z0-9_-]+|assets\.calendly\.com/i];

const any = (res: RegExp[], s: string) => res.some((r) => r.test(s));

// A form counts as a contact form when it collects a way to reach someone (email, phone or a message box), and is not a search box,
// a sign-in or a newsletter-only box with nothing else. Newsletter sign-ups still count as capture, so they are accepted.
export function hasContactForm(html: string): boolean {
  if (any(FORM_EMBEDS, html)) return true;
  for (const f of html.match(/<form\b[\s\S]*?<\/form>/gi) ?? []) {
    const open = f.match(/<form\b[^>]*>/i)?.[0] ?? "";
    if (attr(open, "role").toLowerCase() === "search" || /\bsearch(form|-form)?\b/i.test(attr(open, "class") + " " + attr(open, "id") + " " + attr(open, "action"))) continue;
    const inputs = f.match(/<(?:input|textarea|select)\b[^>]*>/gi) ?? [];
    if (inputs.some((i) => attr(i, "type").toLowerCase() === "password")) continue; // sign-in
    const textarea = /<textarea\b/i.test(f);
    const reach = inputs.some((i) => {
      const t = attr(i, "type").toLowerCase(), n = (attr(i, "name") + " " + attr(i, "id") + " " + attr(i, "placeholder")).toLowerCase();
      return t === "email" || t === "tel" || /e-?mail|phone|mobile|whatsapp|contact|message|enquiry|inquiry/.test(n);
    });
    if (textarea || reach) return true;
  }
  return false;
}

export function analyzeHtml(html: string, finalUrl: string): WebsiteSignals {
  const h = strip(html);
  const hasGtm = any(GTM, h);
  const hasGa = any(GA, h);
  const text = h.replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const scripts = (h.match(/<script\b/gi) ?? []).length;
  return {
    https: /^https:/i.test(finalUrl),
    hasTitle: hasTitle(h),
    hasMetaDescription: hasMetaDescription(h),
    hasAnalytics: hasGa || hasGtm,
    hasGtm,
    hasMetaPixel: any(PIXEL, h),
    hasContactForm: hasContactForm(h),
    hasWhatsapp: any(WHATSAPP, h),
    viaTagManager: hasGtm,
    // A page that is almost all script and almost no words is built in the browser: what we read is not what visitors see
    lowConfidence: text.length < 200 && scripts >= 3,
  };
}
