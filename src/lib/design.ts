// Branded designs for a post: Claude writes the few words that go on the image, our own code draws the design with the
// client's brand kit (logo, colours, fonts, contact details) and the PNGs are attached to the post as files.
// Drawing costs nothing, so a design can be redrawn as often as the team likes; only the AI words and AI photos count
// against the client's monthly AI limit. Free of Next.js imports so it can be tested.
import { Prisma, type PrismaClient } from "@prisma/client";
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

export const LIMITS = { label: 24, headline: 60, sub: 120, cta: 24, slideSub: 160, slidesMin: 3, slidesMax: 8 } as const;
export const DESIGN_KINDS = ["SINGLE", "CAROUSEL"] as const;
export type DesignKind = (typeof DESIGN_KINDS)[number];
export type Slide = { headline: string; sub: string | null };
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

export const defaultKind = (postType: string): DesignKind => (postType === "CAROUSEL" ? "CAROUSEL" : "SINGLE");

const noRtl = (t: string) => { if (RTL.test(t)) throw new DesignError("Designs cannot show Urdu or Arabic script yet. Use English or Roman Urdu on the image; the caption can stay in Urdu."); return t; };

// Carousel slides: 3 to 8, each a headline and an optional line or two. Empty rows are dropped.
export function cleanSlides(raw: unknown): Slide[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: Slide[] = [];
  for (const [i, r] of list.entries()) {
    const headline = noRtl(String((r as Slide)?.headline ?? "").replace(/\s+/g, " ").trim());
    const sub = noRtl(String((r as Slide)?.sub ?? "").replace(/\s+/g, " ").trim());
    if (!headline && !sub) continue;
    if (!headline) throw new DesignError(`Slide ${i + 1} needs a headline.`);
    if (headline.length > LIMITS.headline) throw new DesignError(`Slide ${i + 1}'s headline is too long (${LIMITS.headline} characters at most).`);
    if (sub.length > LIMITS.slideSub) throw new DesignError(`Slide ${i + 1}'s text is too long (${LIMITS.slideSub} characters at most).`);
    out.push({ headline, sub: sub || null });
  }
  if (out.length < LIMITS.slidesMin || out.length > LIMITS.slidesMax) throw new DesignError(`A carousel has ${LIMITS.slidesMin} to ${LIMITS.slidesMax} slides: the cover, the points and a closing slide.`);
  return out;
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
const CAROUSEL_SCHEMA = {
  type: "object", additionalProperties: false, required: ["layout", "label", "cta", "slides"],
  properties: {
    layout: { type: "string", enum: Object.keys(DESIGN_LAYOUTS) }, label: { type: "string" }, cta: { type: "string" },
    slides: { type: "array", items: { type: "object", additionalProperties: false, required: ["headline", "sub"], properties: { headline: { type: "string" }, sub: { type: "string" } } } },
  },
} as const;

type Profile = { brandVoice: string | null; audience: string | null; about: string | null; avoid: string | null } | null;

export function wordsPrompt(p: { clientName: string | null; profile: Profile; item: { title: string; copy: string; brief: string | null; postType: string }; note: string; hasPhoto: boolean; kind?: DesignKind }) {
  const f = p.profile;
  const line = (k: string, v: string | null | undefined) => (v ? `${k}: ${v.slice(0, 600)}` : null);
  const layouts = `${Object.entries(DESIGN_LAYOUTS).map(([k, v]) => `${k} (${v.hint})`).join("; ")}.${p.hasPhoto ? "" : " There is no photo yet, so prefer QUOTE, TIP or BOLD."}`;
  const ask = p.kind === "CAROUSEL"
    ? [
      `You write the words for a branded social media CAROUSEL${p.clientName ? ` for ${p.clientName}` : ""}: ${LIMITS.slidesMin} to ${LIMITS.slidesMax} slides people swipe through. The caption is posted separately.`,
      "Return:",
      `- slides: slide 1 is the cover (a hook headline that makes people swipe), then one slide per point, then a closing slide that tells people what to do. Each slide: headline of 8 words or fewer (at most ${LIMITS.headline} characters) and sub, one or two short sentences of at most ${LIMITS.slideSub} characters (may be empty on the cover).`,
      `- cta: button text for the closing slide, 1 to 3 words, at most ${LIMITS.cta} characters, or empty.`,
      `- label: a small tag for the cover such as "5 tips" or "New", at most ${LIMITS.label} characters, or empty.`,
      `- layout: the cover's layout, from ${layouts}`,
    ]
    : [
      `You write the words that go ON a branded social media image${p.clientName ? ` for ${p.clientName}` : ""}. The caption is posted separately, so the image needs only a few strong words.`,
      "Return:",
      `- headline: 8 words or fewer, at most ${LIMITS.headline} characters. The one idea people must get at a glance.`,
      `- sub: one short supporting line, at most ${LIMITS.sub} characters, or empty.`,
      `- cta: button text of 1 to 3 words such as "Order now" or "Book a visit", at most ${LIMITS.cta} characters, or empty when the post is not asking people to act.`,
      `- label: a small tag such as "New", "Limited offer" or a date, at most ${LIMITS.label} characters, or empty.`,
      `- layout: the best fit from ${layouts}`,
    ];
  return [
    ask[0],
    line("Business", f?.about), line("Audience", f?.audience), line("Brand voice", f?.brandVoice), line("Never say or show", f?.avoid),
    "", `Post: ${p.item.title}`, `Type: ${p.item.postType}`, `Caption: ${p.item.copy.slice(0, 1200)}`, p.item.brief ? `Brief for the designer: ${p.item.brief.slice(0, 600)}` : null,
    "", ...ask.slice(1),
    "Write in English or Roman Urdu only (Latin letters): Urdu and Arabic script cannot be drawn on the image yet.",
    "Never invent prices, discounts, dates, phone numbers or claims the post does not give you.",
    p.note.trim() ? `The team asked: ${p.note.trim()}` : null,
  ].filter((x) => x !== null).join("\n");
}

// Claude's words are trimmed to the limits rather than refused, so one long word never wastes a paid call
const cut = (v: string, max: number) => { const t = (v ?? "").replace(/\s+/g, " ").trim(); return t.length > max ? t.slice(0, max).replace(/\s+\S*$/, "") : t; };

export async function writeDesignWords(db: Db, p: { organizationId: string; itemId: string; actorId: string; note?: string; kind?: string; today?: string; fetchImpl?: FetchLike; apiKey?: string }) {
  const note = (p.note ?? "").trim();
  if (note.length > 300) throw new DesignError("Keep the note under 300 characters.");
  const item = await editablePost(db, p.organizationId, p.itemId);
  const kind: DesignKind = p.kind === "CAROUSEL" || p.kind === "SINGLE" ? p.kind : defaultKind(item.postType);
  const key = p.apiKey ?? (await getKey(db, p.organizationId, "ANTHROPIC"));
  if (!key) throw new DesignError("AI is not configured: a Super Admin adds the Anthropic API key in Settings → Integrations.");
  const profile = item.clientId ? await db.clientContentProfile.findUnique({ where: { clientId: item.clientId } }) : null;
  const client = item.clientId ? await db.client.findUnique({ where: { id: item.clientId }, select: { name: true } }) : null;
  const month = (p.today ?? new Date().toISOString().slice(0, 10)).slice(0, 7);
  if (item.clientId) {
    try { await assertUnderCap(db, item.clientId, month, Number(profile?.monthlyCapUsd ?? 10), kind === "CAROUSEL" ? 0.06 : 0.03); } catch (e) { if (e instanceof ContentAiError) throw new DesignError(e.message); throw e; }
  }
  const existing = await getDesign(db, p.organizationId, item.id);
  const photos = await designPhotos(db, { organizationId: p.organizationId, itemId: item.id, clientId: item.clientId });
  const prompt = wordsPrompt({ clientName: client?.name ?? null, profile, item, note, kind, hasPhoto: Boolean(existing?.photoFileId || photos.post.length) });
  let res: { data: { layout: string; label: string; headline?: string; sub?: string; cta: string; slides?: { headline: string; sub: string }[] }; cost: number };
  try {
    res = await askClaude({ key, maxTokens: kind === "CAROUSEL" ? 4000 : 2000, schema: kind === "CAROUSEL" ? CAROUSEL_SCHEMA : WORDS_SCHEMA, fetchImpl: p.fetchImpl, timeoutMs: 90_000, prompt });
  } catch (e) { if (e instanceof ContentAiError) throw new DesignError(e.message); throw e; }
  await db.contentAiRun.create({ data: { organizationId: p.organizationId, clientId: item.clientId ?? "OWN", month, kind: kind === "CAROUSEL" ? "DESIGN_CAROUSEL" : "DESIGN_WORDS", itemId: item.id, postCount: 1, estimatedCostUsd: res.cost.toFixed(4), createdById: p.actorId } });
  const layout = (res.data.layout in DESIGN_LAYOUTS ? res.data.layout : "BOLD") as DesignLayout;
  let data;
  if (kind === "CAROUSEL") {
    const slides = cleanSlides((res.data.slides ?? []).slice(0, LIMITS.slidesMax).map((x) => ({ headline: cut(x.headline, LIMITS.headline), sub: cut(x.sub, LIMITS.slideSub) })));
    data = { kind, slides, headline: slides[0].headline, sub: slides[0].sub, label: cleanWords({ headline: "x", label: cut(res.data.label, LIMITS.label) }).label, cta: cleanWords({ headline: "x", cta: cut(res.data.cta, LIMITS.cta) }).cta };
  } else {
    data = { kind, ...cleanWords({ label: cut(res.data.label, LIMITS.label), headline: cut(res.data.headline ?? "", LIMITS.headline) || item.title.slice(0, LIMITS.headline), sub: cut(res.data.sub ?? "", LIMITS.sub), cta: cut(res.data.cta, LIMITS.cta) }) };
  }
  const withLayout = { ...data, layout: existing?.outputFileIds.length ? existing.layout : layout };
  const sizes = kind === "CAROUSEL" ? ["SQUARE"] : defaultSizes(item.postType);
  const design = existing
    ? await db.contentDesign.update({ where: { id: existing.id }, data: { ...withLayout, ...(existing.kind !== kind ? { sizes } : {}) } })
    : await db.contentDesign.create({ data: { organizationId: p.organizationId, itemId: item.id, sizes, createdById: p.actorId, photoFileId: photos.post[0]?.id ?? null, ...withLayout } });
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

export type MakeInput = { kind?: unknown; layout: unknown; sizes: unknown; label?: unknown; headline?: unknown; sub?: unknown; cta?: unknown; slides?: unknown; photoFileId?: string | null };

export async function makeDesign(db: Db, storage: StorageProvider, p: { actor: FileActor; itemId: string; input: MakeInput }) {
  const org = p.actor.organizationId;
  const item = await editablePost(db, org, p.itemId);
  const kind: DesignKind = p.input.kind === "CAROUSEL" ? "CAROUSEL" : "SINGLE";
  const layout = cleanLayout(p.input.layout);
  const sizes = cleanSizes(p.input.sizes);
  const slides = kind === "CAROUSEL" ? cleanSlides(p.input.slides) : null;
  if (kind === "CAROUSEL" && (sizes.length !== 1 || sizes[0] === "STORY")) throw new DesignError("A carousel uses one size for every slide: pick Square or Portrait.");
  const words = slides ? { ...cleanWords({ headline: slides[0].headline, label: p.input.label, cta: p.input.cta }), sub: slides[0].sub } : cleanWords(p.input);
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
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T-]/g, "");
  let pngs: { name: string; bytes: Buffer }[];
  try {
    pngs = [];
    if (slides) {
      // Cover in the chosen layout with the photo, numbered points, and a closing slide with the button
      const n = slides.length, size = sizes[0];
      for (const [i, sl] of slides.entries()) {
        const last = i === n - 1;
        const slide = { ...shared, size, slide: { index: i, total: n }, headline: sl.headline, sub: sl.sub ?? undefined,
          label: i === 0 ? shared.label : undefined, cta: last ? shared.cta : undefined, layout: i === 0 ? layout : ("BOLD" as DesignLayout), photo: i === 0 ? shared.photo : undefined };
        pngs.push({ name: `carousel-${String(i + 1).padStart(2, "0")}-of-${String(n).padStart(2, "0")}-${size.toLowerCase()}-${stamp}.png`, bytes: await drawDesign(slide) });
      }
    } else {
      for (const size of sizes) pngs.push({ name: `design-${layout.toLowerCase()}-${size.toLowerCase()}-${stamp}.png`, bytes: await drawDesign({ ...shared, size }) });
    }
  } catch (e) {
    console.error("design draw failed", e);
    throw new DesignError("The design could not be drawn. If the logo or photo is an unusual file, try a PNG or JPG.");
  }
  const saved = [];
  for (const png of pngs) saved.push(await saveFile(db, storage, { actor: p.actor, ownerType: "CONTENT", ownerId: item.id, name: png.name, bytes: png.bytes, category: "Design", media: true }));
  // The previous drawing of this design is replaced (soft deleted, so it can still be recovered)
  const existing = await getDesign(db, org, item.id);
  const old = (existing?.outputFileIds ?? []).filter((id) => id !== p.input.photoFileId);
  if (old.length) await db.storedFile.updateMany({ where: { id: { in: old }, organizationId: org, ownerType: "CONTENT", ownerId: item.id, deletedAt: null }, data: { deletedAt: new Date(), deletedById: p.actor.id } });
  const data = { kind, layout, sizes, ...words, slides: slides ?? Prisma.DbNull, photoFileId: photo?.file.id ?? null, outputFileIds: saved.map((f) => f.id) };
  const design = existing
    ? await db.contentDesign.update({ where: { id: existing.id }, data })
    : await db.contentDesign.create({ data: { organizationId: org, itemId: item.id, createdById: p.actor.id, ...data } });
  return { design, files: saved };
}

export const slidesOf = (raw: unknown): Slide[] => (Array.isArray(raw) ? (raw as Slide[]).filter((x) => x && typeof x.headline === "string") : []);

// After "Plan the month with AI" with "also design the static posts": draw every planned design that has no drawing yet.
// A post that cannot be drawn is skipped; the team can still press Make design on it.
export async function drawPlanDesigns(db: Db, storage: StorageProvider, p: { actor: FileActor; runId: string }) {
  const items = await db.contentItem.findMany({ where: { organizationId: p.actor.organizationId, aiRunId: p.runId }, select: { id: true } });
  const designs = await db.contentDesign.findMany({ where: { organizationId: p.actor.organizationId, itemId: { in: items.map((i) => i.id) }, outputFileIds: { isEmpty: true } } });
  let drawn = 0, failed = 0;
  for (const d of designs) {
    try {
      await makeDesign(db, storage, { actor: p.actor, itemId: d.itemId, input: { kind: "SINGLE", layout: d.layout, sizes: d.sizes, headline: d.headline, sub: d.sub, cta: d.cta, label: d.label } });
      drawn++;
    } catch (e) {
      if (!(e instanceof DesignError)) console.error("plan design failed", d.itemId, e);
      failed++;
    }
  }
  return { drawn, failed };
}

// The client's designs from the last 3 months, newest first, so a new design can follow the same look
export async function recentDesigns(db: Db, p: { organizationId: string; clientId: string | null; exceptItemId?: string; now?: Date; take?: number }) {
  const since = new Date((p.now ?? new Date()).getTime() - 92 * 86400000);
  const posts = await db.contentItem.findMany({ where: { organizationId: p.organizationId, clientId: p.clientId ?? null, ...(p.exceptItemId ? { id: { not: p.exceptItemId } } : {}) }, select: { id: true, title: true } });
  if (!posts.length) return [];
  const title = new Map(posts.map((x) => [x.id, x.title]));
  const designs = await db.contentDesign.findMany({ where: { organizationId: p.organizationId, itemId: { in: posts.map((x) => x.id) }, updatedAt: { gte: since }, NOT: { outputFileIds: { isEmpty: true } } }, orderBy: { updatedAt: "desc" }, take: p.take ?? 8 });
  const live = new Set((await db.storedFile.findMany({ where: { id: { in: designs.map((d) => d.outputFileIds[0]) }, deletedAt: null }, select: { id: true } })).map((f) => f.id));
  return designs.filter((d) => live.has(d.outputFileIds[0])).map((d) => ({ id: d.id, itemId: d.itemId, title: title.get(d.itemId) ?? "", kind: d.kind, layout: d.layout, sizes: d.sizes, fileId: d.outputFileIds[0] }));
}
