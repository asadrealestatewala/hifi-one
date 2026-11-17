// Branded designs for a post: Claude writes the few words that go on the image, our own code draws the design with the
// client's brand kit (logo, colours, fonts, contact details) and the PNGs are attached to the post as files.
// Drawing costs nothing, so a design can be redrawn as often as the team likes; only the AI words and AI photos count
// against the client's monthly AI limit. Free of Next.js imports so it can be tested.
import type { PrismaClient } from "@prisma/client";
import { getKit, ownerKeyOf } from "./brand-kit";
import { ContentAiError, askClaude, assertUnderCap, type FetchLike } from "./content-ai";
import { isEditable } from "./content-rules";
import type { FileActor } from "./file-access";
import { saveFile } from "./files";
import { getKey } from "./integration-keys";
import type { StorageProvider } from "./storage";
import { DESIGN_LAYOUTS, DESIGN_SIZES, drawDesign, type DesignColors, type DesignLayout, type DesignSize } from "./design-render";

type Db = PrismaClient;
export class DesignError extends Error {}

export const LIMITS = { label: 24, headline: 60, sub: 120, cta: 24 } as const;
export const DEFAULT_COLORS: DesignColors = { primary: "#1E3A8A", secondary: "#F59E0B", accent: "#10B981", text: "#111827", background: "#FFFFFF" };
// Urdu, Arabic and other right-to-left scripts cannot be set properly by the drawing engine yet
const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/;

export function defaultSizes(postType: string): DesignSize[] {
  if (postType === "STORY" || postType === "REEL") return ["STORY"];
  if (postType === "STATIC") return ["PORTRAIT"];
  return ["SQUARE"];
}

export type DesignWords = { label: string | null; headline: string; sub: string | null; cta: string | null };

export function cleanWords(raw: { label?: unknown; headline?: unknown; sub?: unknown; cta?: unknown }): DesignWords {
  const field = (v: unknown, max: number, name: string) => {
    const t = String(v ?? "").replace(/\s+/g, " ").trim();
    if (t.length > max) throw new DesignError(`${name} is too long (${max} characters at most).`);
    if (RTL.test(t)) throw new DesignError("Designs cannot show Urdu or Arabic script yet. Use English or Roman Urdu on the image; the caption can stay in Urdu.");
    return t || null;
  };
  const headline = field(raw.headline, LIMITS.headline, "Headline");
  if (!headline) throw new DesignError("Write a headline for the design.");
  return { label: field(raw.label, LIMITS.label, "Small tag"), headline, sub: field(raw.sub, LIMITS.sub, "Sub line"), cta: field(raw.cta, LIMITS.cta, "Button text") };
}

const cleanLayout = (v: unknown): DesignLayout => {
  const s = String(v ?? "");
  if (!(s in DESIGN_LAYOUTS)) throw new DesignError("Choose a layout.");
  return s as DesignLayout;
};
const cleanSizes = (v: unknown): DesignSize[] => {
  const list = (Array.isArray(v) ? v : [v]).map(String).filter((s) => s in DESIGN_SIZES) as DesignSize[];
  const uniq = [...new Set(list)];
  if (!uniq.length) throw new DesignError("Choose at least one size.");
  return uniq;
};

async function editablePost(db: Db, organizationId: string, itemId: string) {
  const item = await db.contentItem.findFirst({ where: { id: itemId, organizationId } });
  if (!item) throw new DesignError("Post not found.");
  if (!isEditable(item.status)) throw new DesignError("This post is with the client or already approved. Withdraw it before changing its design.");
  return item;
}

export async function getDesign(db: Db, organizationId: string, itemId: string) {
  return db.contentDesign.findFirst({ where: { organizationId, itemId } });
}

// Images this post's design may use: the post's own image files and the client's media library
export async function designPhotos(db: Db, p: { organizationId: string; itemId: string; clientId: string | null }) {
  const outputs = (await getDesign(db, p.organizationId, p.itemId))?.outputFileIds ?? [];
  const [post, library] = await Promise.all([
    db.storedFile.findMany({ where: { organizationId: p.organizationId, ownerType: "CONTENT", ownerId: p.itemId, deletedAt: null, contentType: { startsWith: "image/" }, id: { notIn: outputs } }, orderBy: { createdAt: "desc" }, take: 30 }),
    db.mediaItem.findMany({ where: { organizationId: p.organizationId, ownerKey: ownerKeyOf(p.clientId) }, orderBy: { createdAt: "desc" }, take: 60 }),
  ]);
  const libFiles = library.length ? await db.storedFile.findMany({ where: { id: { in: library.map((m) => m.fileId) }, deletedAt: null, contentType: { startsWith: "image/" } } }) : [];
  const byId = new Map(libFiles.map((f) => [f.id, f]));
  return {
    post: post.map((f) => ({ id: f.id, name: f.filename })),
    library: library.filter((m) => byId.has(m.fileId)).map((m) => ({ id: m.fileId, name: m.title || byId.get(m.fileId)!.filename, folder: m.folder })),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Claude writes the words on the image
// ---------------------------------------------------------------------------------------------------------------------------
const WORDS_SCHEMA = {
  type: "object", additionalProperties: false, required: ["layout", "label", "headline", "sub", "cta"],
  properties: { layout: { type: "string", enum: Object.keys(DESIGN_LAYOUTS) }, label: { type: "string" }, headline: { type: "string" }, sub: { type: "string" }, cta: { type: "string" } },
} as const;

export function wordsPrompt(p: { clientName: string | null; profile: { brandVoice: string | null; audience: string | null; about: string | null; avoid: string | null } | null; item: { title: string; copy: string; brief: string | null; postType: string }; note: string; hasPhoto: boolean }) {
  const f = p.profile;
  const line = (k: string, v: string | null | undefined) => (v ? `${k}: ${v.slice(0, 600)}` : null);
  return [
    `You write the words that go ON a branded social media image${p.clientName ? ` for ${p.clientName}` : ""}. The caption is posted separately, so the image needs only a few strong words.`,
    line("Business", f?.about), line("Audience", f?.audience), line("Brand voice", f?.brandVoice), line("Never say or show", f?.avoid),
    "", `Post: ${p.item.title}`, `Type: ${p.item.postType}`, `Caption: ${p.item.copy.slice(0, 1200)}`, p.item.brief ? `Brief for the designer: ${p.item.brief.slice(0, 600)}` : null,
    "",
    "Return:",
    `- headline: 8 words or fewer, at most ${LIMITS.headline} characters. The one idea people must get at a glance.`,
    `- sub: one short supporting line, at most ${LIMITS.sub} characters, or empty.`,
    `- cta: button text of 1 to 3 words such as "Order now" or "Book a visit", at most ${LIMITS.cta} characters, or empty when the post is not asking people to act.`,
    `- label: a small tag such as "New", "Limited offer" or a date, at most ${LIMITS.label} characters, or empty.`,
    `- layout: the best fit from ${Object.entries(DESIGN_LAYOUTS).map(([k, v]) => `${k} (${v.hint})`).join("; ")}.${p.hasPhoto ? "" : " There is no photo yet, so prefer QUOTE, TIP or BOLD."}`,
    "Write in English or Roman Urdu only (Latin letters): Urdu and Arabic script cannot be drawn on the image yet.",
    "Never invent prices, discounts, dates, phone numbers or claims the post does not give you.",
    p.note.trim() ? `The team asked: ${p.note.trim()}` : null,
  ].filter((x) => x !== null).join("\n");
}

export async function writeDesignWords(db: Db, p: { organizationId: string; itemId: string; actorId: string; note?: string; today?: string; fetchImpl?: FetchLike; apiKey?: string }) {
  const note = (p.note ?? "").trim();
  if (note.length > 300) throw new DesignError("Keep the note under 300 characters.");
  const item = await editablePost(db, p.organizationId, p.itemId);
  const key = p.apiKey ?? (await getKey(db, p.organizationId, "ANTHROPIC"));
  if (!key) throw new DesignError("AI is not configured: a Super Admin adds the Anthropic API key in Settings → Integrations.");
  const profile = item.clientId ? await db.clientContentProfile.findUnique({ where: { clientId: item.clientId } }) : null;
  const client = item.clientId ? await db.client.findUnique({ where: { id: item.clientId }, select: { name: true } }) : null;
  const month = (p.today ?? new Date().toISOString().slice(0, 10)).slice(0, 7);
  if (item.clientId) {
    try { await assertUnderCap(db, item.clientId, month, Number(profile?.monthlyCapUsd ?? 10), 0.03); } catch (e) { if (e instanceof ContentAiError) throw new DesignError(e.message); throw e; }
  }
  const existing = await getDesign(db, p.organizationId, item.id);
  const photos = await designPhotos(db, { organizationId: p.organizationId, itemId: item.id, clientId: item.clientId });
  let res: { data: { layout: string; label: string; headline: string; sub: string; cta: string }; cost: number };
  try {
    res = await askClaude({ key, maxTokens: 2000, schema: WORDS_SCHEMA, fetchImpl: p.fetchImpl, timeoutMs: 60_000, prompt: wordsPrompt({ clientName: client?.name ?? null, profile, item, note, hasPhoto: Boolean(existing?.photoFileId || photos.post.length) }) });
  } catch (e) { if (e instanceof ContentAiError) throw new DesignError(e.message); throw e; }
  await db.contentAiRun.create({ data: { organizationId: p.organizationId, clientId: item.clientId ?? "OWN", month, kind: "DESIGN_WORDS", itemId: item.id, postCount: 1, estimatedCostUsd: res.cost.toFixed(4), createdById: p.actorId } });
  // Claude's words are trimmed to the limits rather than refused, so one long word never wastes a paid call
  const cut = (v: string, max: number) => { const t = (v ?? "").replace(/\s+/g, " ").trim(); return t.length > max ? t.slice(0, max).replace(/\s+\S*$/, "") : t; };
  const words = cleanWords({ label: cut(res.data.label, LIMITS.label), headline: cut(res.data.headline, LIMITS.headline) || item.title.slice(0, LIMITS.headline), sub: cut(res.data.sub, LIMITS.sub), cta: cut(res.data.cta, LIMITS.cta) });
  const layout = (res.data.layout in DESIGN_LAYOUTS ? res.data.layout : "BOLD") as DesignLayout;
  const data = { ...words, layout: existing?.outputFileIds.length ? existing.layout : layout };
  const design = existing
    ? await db.contentDesign.update({ where: { id: existing.id }, data })
    : await db.contentDesign.create({ data: { organizationId: p.organizationId, itemId: item.id, sizes: defaultSizes(item.postType), createdById: p.actorId, photoFileId: photos.post[0]?.id ?? null, ...data } });
  return { design, suggestedLayout: layout, cost: res.cost };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Draw the design and attach the PNGs to the post
// ---------------------------------------------------------------------------------------------------------------------------
async function readFile(db: Db, storage: StorageProvider, organizationId: string, id: string | null | undefined, where: object = {}) {
  if (!id) return null;
  const f = await db.storedFile.findFirst({ where: { id, organizationId, deletedAt: null, ...where } });
  return f ? { file: f, bytes: await storage.get(f.storageKey) } : null;
}

export function kitColors(raw: unknown): DesignColors {
  const list = Array.isArray(raw) ? (raw as { role?: string; hex?: string }[]) : [];
  const pick = (role: string, fallback: string) => list.find((c) => c.role === role && /^#[0-9a-f]{6}$/i.test(c.hex ?? ""))?.hex ?? fallback;
  return { primary: pick("PRIMARY", DEFAULT_COLORS.primary), secondary: pick("SECONDARY", DEFAULT_COLORS.secondary), accent: pick("ACCENT", DEFAULT_COLORS.accent), text: pick("TEXT", DEFAULT_COLORS.text), background: pick("BACKGROUND", DEFAULT_COLORS.background) };
}

export function contactLine(kit: { phone: string | null; whatsapp: string | null; website: string | null; handle: string | null } | null): string[] {
  if (!kit) return [];
  const site = kit.website?.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "") ?? null;
  const handle = kit.handle ? (kit.handle.startsWith("@") ? kit.handle : `@${kit.handle}`) : null;
  return [kit.phone || kit.whatsapp, site, handle].filter((x): x is string => Boolean(x));
}

export type MakeInput = { layout: unknown; sizes: unknown; label?: unknown; headline: unknown; sub?: unknown; cta?: unknown; photoFileId?: string | null };

export async function makeDesign(db: Db, storage: StorageProvider, p: { actor: FileActor; itemId: string; input: MakeInput }) {
  const org = p.actor.organizationId;
  const item = await editablePost(db, org, p.itemId);
  const layout = cleanLayout(p.input.layout);
  const sizes = cleanSizes(p.input.sizes);
  const words = cleanWords(p.input);
  const ownerKey = ownerKeyOf(item.clientId);
  // A photo must be one of this post's files or one from this client's own media library
  let photo: Awaited<ReturnType<typeof readFile>> = null;
  if (p.input.photoFileId) {
    photo = await readFile(db, storage, org, p.input.photoFileId, { contentType: { startsWith: "image/" }, OR: [{ ownerType: "CONTENT", ownerId: item.id }, { ownerType: "BRAND", ownerId: ownerKey }] });
    if (!photo) throw new DesignError("That photo is not available for this post. Pick another one.");
  }
  if (DESIGN_LAYOUTS[layout].photo && !photo) throw new DesignError(`The ${DESIGN_LAYOUTS[layout].label} layout needs a photo. Pick a photo, or choose Quote, Tip or Bold.`);

  const kit = await getKit(db, org, item.clientId);
  const brandFile = { ownerType: "BRAND", ownerId: ownerKey };
  const [logo, logoLight] = await Promise.all([readFile(db, storage, org, kit?.logoFileId, brandFile), readFile(db, storage, org, kit?.logoLightFileId, brandFile)]);
  const shared = {
    layout, colors: kitColors(kit?.colors), headingFont: kit?.headingFont ?? "Poppins", bodyFont: kit?.bodyFont ?? "Inter",
    label: words.label ?? undefined, headline: words.headline, sub: words.sub ?? undefined, cta: words.cta ?? undefined,
    photo: photo?.bytes, logo: logo?.bytes, logoLight: logoLight?.bytes, logoCorner: (kit?.logoCorner ?? "TOP_RIGHT") as never, logoSizePct: kit?.logoSizePct ?? 14,
    contact: contactLine(kit),
  };
  let pngs: { size: DesignSize; bytes: Buffer }[];
  try {
    pngs = [];
    for (const size of sizes) pngs.push({ size, bytes: await drawDesign({ ...shared, size }) });
  } catch (e) {
    console.error("design draw failed", e);
    throw new DesignError("The design could not be drawn. If the logo or photo is an unusual file, try a PNG or JPG.");
  }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T-]/g, "");
  const saved = [];
  for (const png of pngs) {
    saved.push(await saveFile(db, storage, { actor: p.actor, ownerType: "CONTENT", ownerId: item.id, name: `design-${layout.toLowerCase()}-${png.size.toLowerCase()}-${stamp}.png`, bytes: png.bytes, category: "Design", media: true }));
  }
  // The previous drawing of this design is replaced (soft deleted, so it can still be recovered)
  const existing = await getDesign(db, org, item.id);
  const old = (existing?.outputFileIds ?? []).filter((id) => id !== p.input.photoFileId);
  if (old.length) await db.storedFile.updateMany({ where: { id: { in: old }, organizationId: org, ownerType: "CONTENT", ownerId: item.id, deletedAt: null }, data: { deletedAt: new Date(), deletedById: p.actor.id } });
  const data = { layout, sizes, ...words, photoFileId: photo?.file.id ?? null, outputFileIds: saved.map((f) => f.id) };
  const design = existing
    ? await db.contentDesign.update({ where: { id: existing.id }, data })
    : await db.contentDesign.create({ data: { organizationId: org, itemId: item.id, createdById: p.actor.id, ...data } });
  return { design, files: saved };
}
