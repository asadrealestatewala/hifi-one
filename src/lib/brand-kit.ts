// Brand kit and media library per client: colours, fonts, contact strip, logo rules, and a library of images to reuse.
// The kit of our own company uses the key "OWN". Files live as StoredFiles with ownerType BRAND (see file-access.ts).
// Free of Next.js imports so it can be tested.
import { Prisma, type PrismaClient } from "@prisma/client";
import { deleteFile, saveFile, FileError } from "./files";
import type { FileActor } from "./file-access";
import type { StorageProvider } from "./storage";
import { fetchPublicPage, type FetchedPage, type FetchOptions } from "./safe-fetch";
import { notify } from "./notifications";

type Db = PrismaClient;
export class BrandError extends Error {}

export const OWN = "OWN";
export const ownerKeyOf = (clientId: string | null | undefined) => clientId || OWN;

export const COLOR_ROLES = ["PRIMARY", "SECONDARY", "ACCENT", "TEXT", "BACKGROUND"] as const;
export type ColorRole = (typeof COLOR_ROLES)[number];
export const COLOR_LABEL: Record<ColorRole, string> = { PRIMARY: "Primary", SECONDARY: "Secondary", ACCENT: "Accent", TEXT: "Text", BACKGROUND: "Background" };
export type BrandColor = { role: ColorRole; hex: string };

// Google Fonts (open licence) the designs can use. The font files are bundled with the design step, so nothing loads from Google at runtime.
export const FONTS = ["Inter", "Poppins", "Montserrat", "Roboto", "Open Sans", "Lato", "Raleway", "Nunito", "Playfair Display", "Merriweather", "Oswald", "Bebas Neue", "Anton", "DM Sans", "Work Sans", "Rubik", "Lora", "Josefin Sans", "Archivo", "Manrope"] as const;
export const LOGO_CORNERS = ["TOP_LEFT", "TOP_RIGHT", "BOTTOM_LEFT", "BOTTOM_RIGHT"] as const;
export const LOGO_SLOTS = { LOGO: "logoFileId", LOGO_LIGHT: "logoLightFileId", ICON: "iconFileId" } as const;
export type LogoSlot = keyof typeof LOGO_SLOTS;
export const LOGO_SLOT_LABEL: Record<LogoSlot, string> = { LOGO: "Main logo", LOGO_LIGHT: "Logo for dark backgrounds", ICON: "Icon" };
export const MEDIA_FOLDERS = ["Logos", "Products", "Photos", "Team", "Offers", "Past creatives", "General"] as const;

const HEX = /^#[0-9a-f]{6}$/i;
const clip = (v: unknown, max: number, label: string) => {
  const t = String(v ?? "").trim();
  if (t.length > max) throw new BrandError(`${label} is too long (${max} characters at most).`);
  return t || null;
};

export function cleanColors(raw: unknown): BrandColor[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: BrandColor[] = [];
  for (const c of list) {
    const role = String((c as BrandColor)?.role ?? "") as ColorRole;
    const hex = String((c as BrandColor)?.hex ?? "").trim();
    if (!COLOR_ROLES.includes(role) || out.some((x) => x.role === role)) continue;
    if (!HEX.test(hex)) throw new BrandError(`${COLOR_LABEL[role]} colour must look like #1A2B3C.`);
    out.push({ role, hex: hex.toUpperCase() });
  }
  return out;
}

export async function getKit(db: Db, organizationId: string, clientId: string | null) {
  return db.brandKit.findUnique({ where: { organizationId_ownerKey: { organizationId, ownerKey: ownerKeyOf(clientId) } } });
}

async function ensureClient(db: Db, organizationId: string, clientId: string | null) {
  if (!clientId) return;
  if (!(await db.client.findFirst({ where: { id: clientId, organizationId }, select: { id: true } }))) throw new BrandError("Client not found.");
}

export type KitInput = { colors?: BrandColor[]; headingFont?: string; bodyFont?: string; phone?: string; whatsapp?: string; website?: string; handle?: string; logoCorner?: string; logoSizePct?: string | number; rules?: string };

export async function saveKit(db: Db, p: { organizationId: string; clientId: string | null; actorId: string; input: KitInput }) {
  await ensureClient(db, p.organizationId, p.clientId);
  const i = p.input;
  const font = (f: string | undefined, label: string) => { const v = (f ?? "").trim(); if (v && !(FONTS as readonly string[]).includes(v)) throw new BrandError(`${label}: choose a font from the list.`); return v || null; };
  const website = clip(i.website, 200, "Website");
  if (website && !/^https?:\/\/[^\s]+\.[^\s]+$/i.test(website)) throw new BrandError("Website must start with http:// or https://");
  const corner = i.logoCorner && (LOGO_CORNERS as readonly string[]).includes(i.logoCorner) ? i.logoCorner : "TOP_RIGHT";
  const size = Math.round(Number(i.logoSizePct ?? 14));
  if (!Number.isFinite(size) || size < 6 || size > 30) throw new BrandError("Logo size must be between 6% and 30% of the design's width.");
  const handle = clip(i.handle, 60, "Handle");
  const data = {
    colors: cleanColors(i.colors ?? []), headingFont: font(i.headingFont, "Heading font"), bodyFont: font(i.bodyFont, "Body font"),
    phone: clip(i.phone, 30, "Phone"), whatsapp: clip(i.whatsapp, 30, "WhatsApp"), website, handle: handle ? (handle.startsWith("@") ? handle : `@${handle}`) : null,
    logoCorner: corner, logoSizePct: size, rules: clip(i.rules, 1000, "Brand rules"), updatedById: p.actorId,
  };
  const ownerKey = ownerKeyOf(p.clientId);
  return db.brandKit.upsert({ where: { organizationId_ownerKey: { organizationId: p.organizationId, ownerKey } }, update: data, create: { ...data, organizationId: p.organizationId, ownerKey, clientId: p.clientId } });
}

// ---------- Media library ----------

const cleanTags = (raw: string | string[] | undefined) =>
  [...new Set((Array.isArray(raw) ? raw : String(raw ?? "").split(",")).map((t) => t.trim().toLowerCase().replace(/^#/, "")).filter((t) => t && t.length <= 30))].slice(0, 12);
const cleanFolder = (f: string | undefined) => { const v = (f ?? "").trim() || "General"; if (v.length > 40) throw new BrandError("Folder name is too long."); return v; };

// Add an image to a client's library. Staff and the client's own users may add; the client's project manager hears about client uploads.
export async function addMedia(db: Db, storage: StorageProvider, p: { actor: FileActor; clientId: string | null; name: string; bytes: Buffer; folder?: string; tags?: string | string[]; title?: string }) {
  await ensureClient(db, p.actor.organizationId, p.clientId);
  if (p.actor.userType !== "EMPLOYEE" && p.actor.clientId !== p.clientId) throw new BrandError("You cannot add files here.");
  let file;
  try {
    file = await saveFile(db, storage, { actor: p.actor, ownerType: "BRAND", ownerId: ownerKeyOf(p.clientId), name: p.name, bytes: p.bytes, svg: true, category: "MEDIA" });
  } catch (e) { if (e instanceof FileError) throw new BrandError(e.message); throw e; }
  if (!file.contentType.startsWith("image/")) {
    await deleteFile(db, p.actor, file.id).catch(() => undefined);
    throw new BrandError("Only images can go in the media library (JPG, PNG, WebP, GIF or SVG).");
  }
  const byClient = p.actor.userType === "CLIENT";
  const item = await db.mediaItem.create({
    data: { organizationId: p.actor.organizationId, ownerKey: ownerKeyOf(p.clientId), clientId: p.clientId, fileId: file.id, folder: cleanFolder(p.folder), tags: cleanTags(p.tags), title: clip(p.title, 120, "Title"), uploadedById: p.actor.id, byClient },
  });
  if (byClient && p.clientId) {
    const c = await db.client.findUnique({ where: { id: p.clientId }, select: { name: true, projectManagerId: true } });
    if (c?.projectManagerId) await notify(db, c.projectManagerId, { kind: "brand.upload", title: `${c.name} added files to their media library`, body: item.folder, link: `/content/brand?client=${p.clientId}&tab=media`, dedupeKey: `brand-upload:${p.clientId}:${new Date().toISOString().slice(0, 10)}` });
  }
  return { item, file };
}

export async function updateMedia(db: Db, p: { organizationId: string; id: string; folder?: string; tags?: string | string[]; title?: string }) {
  const m = await db.mediaItem.findFirst({ where: { id: p.id, organizationId: p.organizationId } });
  if (!m) throw new BrandError("Not found.");
  return db.mediaItem.update({ where: { id: m.id }, data: { folder: cleanFolder(p.folder ?? m.folder), tags: p.tags === undefined ? m.tags : cleanTags(p.tags), title: p.title === undefined ? m.title : clip(p.title, 120, "Title") } });
}

// Remove from the library (the file is soft-deleted like every other file). If it was a logo of the kit, the kit forgets it.
export async function removeMedia(db: Db, p: { actor: FileActor; id: string }) {
  const m = await db.mediaItem.findFirst({ where: { id: p.id, organizationId: p.actor.organizationId } });
  if (!m) throw new BrandError("Not found.");
  try { await deleteFile(db, p.actor, m.fileId); } catch (e) { if (e instanceof FileError) throw new BrandError(e.message); throw e; }
  await db.mediaItem.delete({ where: { id: m.id } });
  const kit = await db.brandKit.findUnique({ where: { organizationId_ownerKey: { organizationId: m.organizationId, ownerKey: m.ownerKey } } });
  if (kit) {
    const clear = Object.fromEntries(Object.values(LOGO_SLOTS).filter((f) => kit[f] === m.fileId).map((f) => [f, null]));
    if (Object.keys(clear).length) await db.brandKit.update({ where: { id: kit.id }, data: clear });
  }
  return m;
}

// "Use as main logo" on a library image
export async function setLogo(db: Db, p: { organizationId: string; clientId: string | null; mediaId: string; slot: LogoSlot; actorId: string }) {
  if (!(p.slot in LOGO_SLOTS)) throw new BrandError("Unknown logo slot.");
  const m = await db.mediaItem.findFirst({ where: { id: p.mediaId, organizationId: p.organizationId, ownerKey: ownerKeyOf(p.clientId) } });
  if (!m) throw new BrandError("Choose an image from this client's library.");
  const ownerKey = ownerKeyOf(p.clientId);
  const field = LOGO_SLOTS[p.slot];
  return db.brandKit.upsert({
    where: { organizationId_ownerKey: { organizationId: p.organizationId, ownerKey } },
    update: { [field]: m.fileId, updatedById: p.actorId }, create: { organizationId: p.organizationId, ownerKey, clientId: p.clientId, [field]: m.fileId, updatedById: p.actorId },
  });
}

export async function listMedia(db: Db, p: { organizationId: string; clientId: string | null; folder?: string; q?: string; take?: number }) {
  const q = (p.q ?? "").trim().toLowerCase();
  return db.mediaItem.findMany({
    where: {
      organizationId: p.organizationId, ownerKey: ownerKeyOf(p.clientId), ...(p.folder ? { folder: p.folder } : {}),
      ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { tags: { has: q.replace(/^#/, "") } }, { folder: { contains: q, mode: "insensitive" } }] } : {}),
    },
    orderBy: { createdAt: "desc" }, take: p.take ?? 120,
  });
}

// Images already made for this client's posts (attached creatives and AI images): shown in the library as "Post creatives", nothing is copied.
export async function postCreatives(db: Db, p: { organizationId: string; clientId: string | null; take?: number }) {
  const items = await db.contentItem.findMany({ where: { organizationId: p.organizationId, clientId: p.clientId }, select: { id: true, title: true }, orderBy: { createdAt: "desc" }, take: 300 });
  if (items.length === 0) return [];
  const files = await db.storedFile.findMany({ where: { organizationId: p.organizationId, ownerType: "CONTENT", ownerId: { in: items.map((i) => i.id) }, deletedAt: null, contentType: { startsWith: "image/" } }, orderBy: { createdAt: "desc" }, take: p.take ?? 60 });
  return files.map((f) => ({ file: f, post: items.find((i) => i.id === f.ownerId)! }));
}

// One line for the AI image prompt
export function brandPromptLine(kit: { colors: unknown } | null): string | null {
  const colors = kit ? cleanColors(kit.colors) : [];
  if (!colors.length) return null;
  return `Use the brand's colours: ${colors.map((c) => `${COLOR_LABEL[c.role].toLowerCase()} ${c.hex}`).join(", ")}.`;
}

// ---------- Fill from website ----------

export type Suggestion = { from: string; colors: string[]; fonts: string[]; otherFonts: string[]; logoUrl: string | null; iconUrl: string | null; phone: string | null; whatsapp: string | null; handle: string | null; at: string };

const toHex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase();
function hsl(hex: string) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  const s = max === min ? 0 : l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
  return { s, l };
}
const dist = (a: string, b: string) => { const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16); return Math.hypot((x >> 16) - (y >> 16), ((x >> 8) & 255) - ((y >> 8) & 255), (x & 255) - (y & 255)); };

// The brand-looking colours on a page: most used first, without whites, blacks, greys or near-duplicates. theme-color comes first.
export function pageColors(html: string, css: string[] = []): string[] {
  const text = [html, ...css].join("\n");
  const counts = new Map<string, number>();
  const add = (hex: string, w = 1) => counts.set(hex, (counts.get(hex) ?? 0) + w);
  for (const m of text.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
    add("#" + h.toUpperCase());
  }
  for (const m of text.matchAll(/rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/gi)) add(toHex(+m[1], +m[2], +m[3]));
  const theme = html.match(/<meta[^>]+name=["']theme-color["'][^>]*content=["'](#[0-9a-f]{6})["']/i) ?? html.match(/<meta[^>]+content=["'](#[0-9a-f]{6})["'][^>]*name=["']theme-color["']/i);
  if (theme) add(theme[1].toUpperCase(), 1000);
  const picked: string[] = [];
  for (const [hex] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    const { s, l } = hsl(hex);
    if (s < 0.18 || l > 0.94 || l < 0.08) continue; // white, black, grey
    if (picked.some((p) => dist(p, hex) < 40)) continue;
    picked.push(hex);
    if (picked.length === 5) break;
  }
  return picked;
}

export function pageFonts(html: string, css: string[] = []): { fonts: string[]; other: string[] } {
  const text = [html, ...css].join("\n");
  const names = new Set<string>();
  for (const m of text.matchAll(/fonts\.googleapis\.com\/css2?\?([^"'\s)>]+)/gi)) for (const f of m[1].replace(/&amp;/g, "&").split("&")) if (f.startsWith("family=")) names.add(decodeURIComponent(f.slice(7).split(":")[0].replace(/\+/g, " ")));
  for (const m of text.matchAll(/font-family\s*:\s*([^;}{]+)/gi)) { const first = m[1].split(",")[0].trim().replace(/^["']|["']$/g, ""); if (first && !/^(var\(|inherit|initial|sans-serif|serif|monospace|system-ui|-apple-system)/i.test(first)) names.add(first); }
  const fonts: string[] = [], other: string[] = [];
  for (const n of names) { const hit = FONTS.find((f) => f.toLowerCase() === n.toLowerCase()); if (hit) { if (!fonts.includes(hit)) fonts.push(hit); } else if (n.length < 40 && other.length < 5) other.push(n); }
  return { fonts: fonts.slice(0, 2), other };
}

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1] ?? null;
const abs = (u: string | null, base: string) => { if (!u || u.startsWith("data:")) return null; try { const x = new URL(u, base); return /^https?:$/.test(x.protocol) ? x.toString() : null; } catch { return null; } };

export function pageDetails(html: string, base: string) {
  let logoUrl: string | null = null;
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    if (/logo/i.test(`${attr(tag, "src") ?? ""} ${attr(tag, "alt") ?? ""} ${attr(tag, "class") ?? ""} ${attr(tag, "id") ?? ""}`)) { logoUrl = abs(attr(tag, "src") ?? attr(tag, "data-src"), base); if (logoUrl) break; }
  }
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  const icon = links.find((l) => /rel=["'][^"']*apple-touch-icon/i.test(l)) ?? links.find((l) => /rel=["'][^"']*icon/i.test(l) && /\.png|\.svg/i.test(attr(l, "href") ?? ""));
  const iconUrl = icon ? abs(attr(icon, "href"), base) : null;
  if (!logoUrl) logoUrl = abs(html.match(/<meta[^>]+property=["']og:logo["'][^>]*content=["']([^"']+)["']/i)?.[1] ?? null, base);
  const phone = html.match(/href=["']tel:([+\d][\d\s\-()]{6,20})["']/i)?.[1]?.trim() ?? null;
  const wa = html.match(/(?:wa\.me|api\.whatsapp\.com\/send\?phone=)\/?(\+?\d{8,15})/i)?.[1] ?? null;
  const ig = html.match(/instagram\.com\/([A-Za-z0-9_.]{2,30})\/?["'?]/i)?.[1] ?? null;
  return { logoUrl, iconUrl, phone, whatsapp: wa ? (wa.startsWith("+") ? wa : `+${wa}`) : null, handle: ig && !["p", "reel", "explore", "accounts"].includes(ig) ? `@${ig}` : null };
}

type Fetcher = (url: string, opts?: FetchOptions) => Promise<FetchedPage>;

// Read the client's website and keep what looks like their brand as a suggestion. Nothing changes until someone applies it.
export async function suggestFromWebsite(db: Db, p: { organizationId: string; clientId: string | null; url: string; actorId: string; fetcher?: Fetcher }) {
  await ensureClient(db, p.organizationId, p.clientId);
  const fetcher = p.fetcher ?? fetchPublicPage;
  let page: FetchedPage;
  try { page = await fetcher(/^https?:\/\//i.test(p.url.trim()) ? p.url.trim() : `https://${p.url.trim()}`); }
  catch (e) { throw new BrandError(e instanceof Error ? `Could not read the website: ${e.message}` : "Could not read the website."); }
  // Up to three of the site's own stylesheets, for colours and fonts
  const sheets = [...page.html.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi)].map((m) => abs(attr(m[0], "href"), page.finalUrl)).filter((u): u is string => Boolean(u) && new URL(u!).host === new URL(page.finalUrl).host).slice(0, 3);
  const css: string[] = [];
  for (const s of sheets) { try { css.push((await fetcher(s, { types: /css|text\/plain/i, maxBytes: 800_000, timeoutMs: 8000 })).html); } catch { /* a missing stylesheet is fine */ } }
  const f = pageFonts(page.html, css);
  const d = pageDetails(page.html, page.finalUrl);
  const suggestion: Suggestion = { from: page.finalUrl, colors: pageColors(page.html, css), fonts: f.fonts, otherFonts: f.other, ...d, at: new Date().toISOString() };
  const ownerKey = ownerKeyOf(p.clientId);
  await db.brandKit.upsert({
    where: { organizationId_ownerKey: { organizationId: p.organizationId, ownerKey } },
    update: { suggestion, website: (await getKit(db, p.organizationId, p.clientId))?.website ?? page.finalUrl, updatedById: p.actorId },
    create: { organizationId: p.organizationId, ownerKey, clientId: p.clientId, suggestion, website: page.finalUrl, updatedById: p.actorId },
  });
  return suggestion;
}

const extOf = (type: string) => ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg", "image/gif": "gif" })[type.split(";")[0].trim().toLowerCase()];

// Apply the ticked parts of the suggestion. Logos are downloaded into the library (folder Logos) and set on the kit.
export async function applySuggestion(db: Db, storage: StorageProvider, p: { actor: FileActor; clientId: string | null; colors: boolean; fonts: boolean; contact: boolean; logo: boolean; icon: boolean; fetcher?: Fetcher }) {
  const kit = await getKit(db, p.actor.organizationId, p.clientId);
  const s = kit?.suggestion as Suggestion | null | undefined;
  if (!kit || !s) throw new BrandError("Nothing to apply. Press Fill from website first.");
  const fetcher = p.fetcher ?? fetchPublicPage;
  const data: Record<string, unknown> = { suggestion: Prisma.DbNull, updatedById: p.actor.id };
  if (p.colors && s.colors.length) {
    const roles: ColorRole[] = ["PRIMARY", "SECONDARY", "ACCENT"];
    const keep = cleanColors(kit.colors).filter((c) => c.role === "TEXT" || c.role === "BACKGROUND");
    data.colors = [...s.colors.slice(0, 3).map((hex, i) => ({ role: roles[i], hex })), ...keep];
  }
  if (p.fonts && s.fonts.length) { data.headingFont = s.fonts[0]; data.bodyFont = s.fonts[1] ?? s.fonts[0]; }
  if (p.contact) { if (s.phone) data.phone = s.phone; if (s.whatsapp) data.whatsapp = s.whatsapp; if (s.handle) data.handle = s.handle; }
  const problems: string[] = [];
  for (const [want, url, slot] of [[p.logo, s.logoUrl, "LOGO"], [p.icon, s.iconUrl, "ICON"]] as const) {
    if (!want || !url) continue;
    try {
      const img = await fetcher(url, { types: /^image\/(png|jpeg|webp|svg\+xml|gif)/i, maxBytes: 3_000_000, timeoutMs: 10_000 });
      const ext = extOf(img.contentType ?? "");
      if (!ext || img.truncated || !img.bytes) throw new BrandError("not a usable image");
      const { item } = await addMedia(db, storage, { actor: p.actor, clientId: p.clientId, name: `${slot === "LOGO" ? "logo" : "icon"}-from-website.${ext}`, bytes: img.bytes, folder: "Logos", title: slot === "LOGO" ? "Logo from website" : "Icon from website" });
      data[LOGO_SLOTS[slot]] = item.fileId;
    } catch (e) {
      problems.push(`${slot === "LOGO" ? "The logo" : "The icon"} could not be downloaded (${e instanceof Error ? e.message : "error"}). Upload it instead.`);
    }
  }
  await db.brandKit.update({ where: { id: kit.id }, data });
  return { problems };
}

export async function dismissSuggestion(db: Db, p: { organizationId: string; clientId: string | null }) {
  await db.brandKit.updateMany({ where: { organizationId: p.organizationId, ownerKey: ownerKeyOf(p.clientId) }, data: { suggestion: Prisma.DbNull } });
}
