// Facebook page addresses: finding one in a website's HTML and checking one a person types in. Pure (no network), so every rule is tested.
// Only business pages count. Share buttons, plugins, groups, events, single posts and profile photos are not the business's own page.

const HOSTS = /^(?:www\.|m\.|web\.|mbasic\.)?(?:facebook\.com|fb\.com)$/i;
// First path words that are not a page name
const NOT_A_PAGE = new Set(["sharer", "sharer.php", "share", "share.php", "plugins", "dialog", "tr", "login", "login.php", "policies", "policy", "privacy", "help", "business", "ads", "events", "hashtag", "watch", "groups", "marketplace", "l.php", "flx", "public", "people", "photo", "photo.php", "photos", "video", "videos", "reel", "reels", "story.php", "permalink.php", "pages", "profile", "gaming", "stories", "dialog", "common", "legal", "about", "settings", "r.php", "recover", "sdk", "unsupportedbrowser", "ajax"]);

// Returns the canonical page address, or null when the address is not a page. `https://www.facebook.com/<name>` or `.../profile.php?id=<digits>`.
export function normalizeFacebookUrl(raw: string): string | null {
  let u: URL;
  const t = raw.trim().replace(/&amp;/g, "&");
  if (!t || t.length > 300) return null;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : t.startsWith("//") ? `https:${t}` : `https://${t}`); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password || (u.port && u.port !== "80" && u.port !== "443")) return null;
  if (!HOSTS.test(u.hostname)) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  const first = parts[0];
  if (first.toLowerCase() === "profile.php") {
    const id = u.searchParams.get("id") ?? "";
    return /^\d{5,20}$/.test(id) ? `https://www.facebook.com/profile.php?id=${id}` : null;
  }
  if (first.toLowerCase() === "p" && parts[1]) return /^[A-Za-z0-9.\-_%]{3,120}$/.test(parts[1]) ? `https://www.facebook.com/p/${parts[1]}` : null; // new style: /p/Name-100012345
  if (NOT_A_PAGE.has(first.toLowerCase())) return null;
  if (!/^[A-Za-z0-9.\-_%]{3,120}$/.test(first)) return null;
  return `https://www.facebook.com/${first}`;
}

// The first business page linked from a home page (anchor links only; embedded widgets and scripts do not count)
export function findFacebookUrl(html: string): string | null {
  const body = html.replace(/<!--[\s\S]*?-->/g, " ");
  const seen: string[] = [];
  for (const tag of body.match(/<a\b[^>]*>/gi) ?? []) {
    const m = tag.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const href = (m?.[1] ?? m?.[2] ?? m?.[3] ?? "").trim();
    if (!/facebook\.com|fb\.com/i.test(href)) continue;
    const url = normalizeFacebookUrl(href);
    if (url) seen.push(url);
  }
  if (seen.length === 0) return null;
  // The page linked most often is the business's own; ties go to the first one on the page
  const counts = new Map<string, number>();
  for (const s of seen) counts.set(s.toLowerCase(), (counts.get(s.toLowerCase()) ?? 0) + 1);
  return seen.reduce((best, s) => ((counts.get(s.toLowerCase()) ?? 0) > (counts.get(best.toLowerCase()) ?? 0) ? s : best), seen[0]);
}
