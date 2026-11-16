// AI help for the content calendar: a client's content profile, a whole month of draft posts written by Claude,
// and one image per post made by Google's image model. Free of Next.js imports so it can be tested.
//
// Rules this file keeps:
// - AI only ever creates DRAFT posts (and attaches a draft image). Nothing reaches a client until a person moves it on.
// - Dates, post types and platforms come from the client's quota and profile, decided here in code. Claude writes the words.
// - Estimated cost of every AI action is stored, and a client's monthly cap stops further spending.
import type { PrismaClient } from "@prisma/client";
import { ContentError, createContent } from "./content";
import { PLATFORMS } from "./content-rules";
import { getKey } from "./integration-keys";
import { notify } from "./notifications";
import type { FileActor } from "./file-access";
import { saveFile } from "./files";
import type { StorageProvider } from "./storage";

type Db = PrismaClient;
export class ContentAiError extends Error {}

export const PLAN_MODEL = process.env.CONTENT_AI_MODEL ?? "claude-sonnet-5-5";
export const IMAGE_MODEL = process.env.CONTENT_IMAGE_MODEL ?? "gemini-2.5-flash-image";
// Estimated prices in US dollars, used only for the cap and the "spent this month" figure. They are estimates, not invoices.
export const EST_IMAGE_USD = 0.05;
const EST_INPUT_PER_MTOK = 3, EST_OUTPUT_PER_MTOK = 15;
export const estimateTextCost = (u: { inputTokens: number; outputTokens: number }) => Number(((u.inputTokens * EST_INPUT_PER_MTOK + u.outputTokens * EST_OUTPUT_PER_MTOK) / 1_000_000).toFixed(4));

// The three kinds of work a retainer promises, and the post type each plans as
export const PLAN_TYPES = [
  { key: "REEL", postType: "REEL", label: "Reels", time: "18:00" },
  { key: "LONG_VIDEO", postType: "VIDEO", label: "Long videos", time: "20:00" },
  { key: "STATIC_CREATIVE", postType: "STATIC", label: "Static creatives", time: "12:00" },
] as const;
export type PlanCounts = { REEL: number; LONG_VIDEO: number; STATIC_CREATIVE: number };

const PLATFORMS_FOR: Record<string, string[]> = {
  REEL: ["INSTAGRAM", "FACEBOOK", "TIKTOK", "YOUTUBE", "SNAPCHAT"],
  VIDEO: ["YOUTUBE", "FACEBOOK", "LINKEDIN"],
  STATIC: ["INSTAGRAM", "FACEBOOK", "LINKEDIN", "X", "PINTEREST"],
};
// Where a post of this type can go, from the client's platforms; a client with none set gets Instagram and Facebook
export function platformsFor(postType: string, clientPlatforms: string[]): string[] {
  const own = clientPlatforms.filter((p) => (PLATFORMS as readonly string[]).includes(p));
  const fit = own.filter((p) => (PLATFORMS_FOR[postType] ?? []).includes(p));
  if (fit.length) return fit;
  if (own.length) return own.slice(0, 2);
  return ["INSTAGRAM", "FACEBOOK"];
}

export const isMonth = (v: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

// Days a post can go out: every day except Sunday, and nothing before `from` (a YYYY-MM-DD, normally today) in the current month
export function postingDays(month: string, from?: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out: string[] = [];
  for (let d = 1; d <= last; d++) {
    const date = `${month}-${String(d).padStart(2, "0")}`;
    if (new Date(date + "T00:00:00Z").getUTCDay() === 0) continue;
    if (from && date < from) continue;
    out.push(date);
  }
  return out;
}

export type Slot = { date: string; time: string; postType: string; platforms: string[] };

// One slot per post to make: types are mixed so the same kind never bunches up, and posts are spread over the month's days.
export function buildSlots(p: { month: string; counts: PlanCounts; platforms: string[]; from?: string }): Slot[] {
  const days = postingDays(p.month, p.from);
  const total = p.counts.REEL + p.counts.LONG_VIDEO + p.counts.STATIC_CREATIVE;
  if (total === 0) return [];
  if (days.length === 0) throw new ContentAiError("There are no days left in that month to plan posts on.");
  const left = PLAN_TYPES.map((t) => ({ ...t, left: p.counts[t.key] }));
  const order: typeof PLAN_TYPES[number][] = [];
  for (let i = 0; i < total; i++) {
    // the type with the most still to place, measured against its share, goes next
    left.sort((a, b) => b.left / (p.counts[b.key] || 1) - a.left / (p.counts[a.key] || 1) || b.left - a.left);
    const t = left.find((x) => x.left > 0)!;
    t.left--;
    order.push(t);
  }
  return order.map((t, i) => ({ date: days[Math.min(days.length - 1, Math.floor((i * days.length) / total))], time: t.time, postType: t.postType, platforms: platformsFor(t.postType, p.platforms) }));
}

// ---------------------------------------------------------------------------------------------------------------------------
// Client content profile
// ---------------------------------------------------------------------------------------------------------------------------
export type ProfileInput = { brandVoice?: string; audience?: string; about?: string; topics?: string; avoid?: string; languages?: string; hashtagRules?: string; visualStyle?: string; platforms?: string[]; monthlyCapUsd?: string | number };
const clip = (v: string | undefined, max: number, label: string) => { const t = (v ?? "").trim(); if (t.length > max) throw new ContentAiError(`${label} is too long (${max} characters at most).`); return t || null; };

export async function saveProfile(db: Db, p: { organizationId: string; clientId: string; actorId: string; input: ProfileInput }) {
  if (!(await db.client.findFirst({ where: { id: p.clientId, organizationId: p.organizationId } }))) throw new ContentAiError("Client not found.");
  const i = p.input;
  const platforms = [...new Set(i.platforms ?? [])];
  if (platforms.some((x) => !(PLATFORMS as readonly string[]).includes(x))) throw new ContentAiError("Choose platforms from the list.");
  const cap = i.monthlyCapUsd === undefined || i.monthlyCapUsd === "" ? 10 : Number(i.monthlyCapUsd);
  if (!Number.isFinite(cap) || cap < 0 || cap > 1000) throw new ContentAiError("Enter a monthly AI limit between 0 and 1000 dollars.");
  const data = {
    brandVoice: clip(i.brandVoice, 1000, "Brand voice"), audience: clip(i.audience, 1000, "Audience"), about: clip(i.about, 4000, "About the business"), topics: clip(i.topics, 2000, "Topics"),
    avoid: clip(i.avoid, 1500, "Things to avoid"), languages: clip(i.languages, 200, "Languages"), hashtagRules: clip(i.hashtagRules, 500, "Hashtag rules"), visualStyle: clip(i.visualStyle, 1000, "Visual style"),
    platforms, monthlyCapUsd: cap.toFixed(2), updatedById: p.actorId,
  };
  return db.clientContentProfile.upsert({ where: { clientId: p.clientId }, update: data, create: { ...data, organizationId: p.organizationId, clientId: p.clientId } });
}

// ---------------------------------------------------------------------------------------------------------------------------
// What a month still needs, and what AI has already cost
// ---------------------------------------------------------------------------------------------------------------------------
const QUOTA_OF_TYPE: Record<string, keyof PlanCounts> = { REEL: "REEL", VIDEO: "LONG_VIDEO", LIVE: "LONG_VIDEO", STATIC: "STATIC_CREATIVE", CAROUSEL: "STATIC_CREATIVE", STORY: "STATIC_CREATIVE" };

// Quota promised by the client's active retainers, posts already planned for that month, and what is left to plan
export async function monthNeeds(db: Db, p: { organizationId: string; clientId: string; month: string }) {
  const quotas = await db.engagementQuota.findMany({ where: { period: "MONTH", key: { in: PLAN_TYPES.map((t) => t.key) }, engagement: { organizationId: p.organizationId, clientId: p.clientId, status: "ACTIVE" } }, select: { key: true, quantity: true } });
  const promised: PlanCounts = { REEL: 0, LONG_VIDEO: 0, STATIC_CREATIVE: 0 };
  for (const q of quotas) promised[q.key as keyof PlanCounts] += q.quantity;
  const posts = await db.contentItem.findMany({ where: { organizationId: p.organizationId, clientId: p.clientId, plannedDate: { startsWith: p.month } }, select: { postType: true } });
  const planned: PlanCounts = { REEL: 0, LONG_VIDEO: 0, STATIC_CREATIVE: 0 };
  for (const x of posts) { const k = QUOTA_OF_TYPE[x.postType]; if (k) planned[k]++; }
  const remaining: PlanCounts = { REEL: Math.max(0, promised.REEL - planned.REEL), LONG_VIDEO: Math.max(0, promised.LONG_VIDEO - planned.LONG_VIDEO), STATIC_CREATIVE: Math.max(0, promised.STATIC_CREATIVE - planned.STATIC_CREATIVE) };
  return { promised, planned, remaining, hasQuota: quotas.length > 0 };
}

export async function aiSpend(db: Db, clientId: string, month: string) {
  const r = await db.contentAiRun.aggregate({ where: { clientId, month }, _sum: { estimatedCostUsd: true } });
  return Number(r._sum.estimatedCostUsd ?? 0);
}
async function assertUnderCap(db: Db, clientId: string, month: string, capUsd: number, adding: number) {
  const spent = await aiSpend(db, clientId, month);
  if (spent + adding > capUsd) throw new ContentAiError(`This client's AI limit for ${month} is $${capUsd.toFixed(2)} and about $${spent.toFixed(2)} is used. Raise the limit in the client's content profile to continue.`);
}

// ---------------------------------------------------------------------------------------------------------------------------
// Monthly plan written by Claude
// ---------------------------------------------------------------------------------------------------------------------------
type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const PLAN_SCHEMA = {
  type: "object", additionalProperties: false, required: ["posts"],
  properties: {
    posts: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["slot", "title", "caption", "hashtags", "brief"],
        properties: { slot: { type: "integer" }, title: { type: "string" }, caption: { type: "string" }, hashtags: { type: "string" }, brief: { type: "string" } },
      },
    },
  },
} as const;

type ProfileRow = Awaited<ReturnType<Db["clientContentProfile"]["findFirstOrThrow"]>>;

export function planPrompt(p: { clientName: string; clientType: string; month: string; monthLabel: string; profile: Pick<ProfileRow, "brandVoice" | "audience" | "about" | "topics" | "avoid" | "languages" | "hashtagRules">; monthBrief: string; slots: Slot[] }) {
  const f = p.profile;
  const line = (k: string, v: string | null) => (v ? `${k}: ${v}` : null);
  return [
    `You plan a month of social media posts for a marketing agency's client. Write every post the agency will make for ${p.clientName} in ${p.monthLabel}.`,
    "",
    "About the client:",
    ...[line("Business", f.about), line("Audience", f.audience), line("Brand voice", f.brandVoice), line("Topics to cover", f.topics), line("Never say or show", f.avoid), line("Languages", f.languages), line("Hashtag rules", f.hashtagRules)].filter(Boolean) as string[],
    "",
    `This month's brief from the project manager (offers, events, dates to use):`,
    p.monthBrief.trim() || "None given. Use the topics above and normal seasonal moments.",
    "",
    `The posts to write, one per slot. The date, type and platforms are already decided; write the content for each:`,
    ...p.slots.map((s, i) => `Slot ${i}: ${s.date}, ${s.postType === "REEL" ? "short video (Reel)" : s.postType === "VIDEO" ? "long video" : "static image post"}, for ${s.platforms.join(" and ")}`),
    "",
    "For every slot return:",
    "- title: a short working title the team will recognise (under 80 characters), not the caption.",
    "- caption: the finished caption, ready to post, in the client's voice and language, written for the platforms listed. No hashtags inside it.",
    "- hashtags: 5 to 10 relevant hashtags separated by spaces (follow the hashtag rules), or an empty string for LinkedIn only.",
    "- brief: instructions for the designer or editor: for a static post the layout, headline text on the image and visual idea; for a video the opening hook, the shot list in order and the closing line, with a length.",
    "Use a mix of themes across the month so the posts do not repeat each other. Tie posts to the brief's dates and offers where it makes sense. Never invent prices, discounts, awards, phone numbers or claims that the client details do not give you. Return exactly one post for each slot, with slot set to its number.",
  ].join("\n");
}

export type PlanResult = { runId: string; created: number; estimatedCostUsd: number };

export async function generatePlan(db: Db, p: {
  organizationId: string; clientId: string; month: string; counts: PlanCounts; monthBrief?: string; actorId: string; today?: string; fetchImpl?: FetchLike; apiKey?: string;
}): Promise<PlanResult> {
  if (!isMonth(p.month)) throw new ContentAiError("Choose a month.");
  const today = p.today ?? new Date().toISOString().slice(0, 10);
  if (p.month < today.slice(0, 7)) throw new ContentAiError("That month has already passed.");
  const counts = p.counts;
  for (const t of PLAN_TYPES) if (!Number.isInteger(counts[t.key]) || counts[t.key] < 0 || counts[t.key] > 40) throw new ContentAiError(`Enter a number from 0 to 40 for ${t.label.toLowerCase()}.`);
  const total = counts.REEL + counts.LONG_VIDEO + counts.STATIC_CREATIVE;
  if (total < 1) throw new ContentAiError("There is nothing left to plan for this month. Enter how many posts of each kind to write.");
  if (total > 60) throw new ContentAiError("Plan up to 60 posts at a time.");
  if ((p.monthBrief ?? "").length > 4000) throw new ContentAiError("The month's brief is too long.");
  const client = await db.client.findFirst({ where: { id: p.clientId, organizationId: p.organizationId } });
  if (!client) throw new ContentAiError("Client not found.");
  const profile = await db.clientContentProfile.findUnique({ where: { clientId: client.id } });
  if (!profile || (profile.about ?? "").trim().length < 20) throw new ContentAiError("Fill in the client's content profile first: at least what the business does. The better the profile, the better the posts.");
  const key = p.apiKey ?? (await getKey(db, p.organizationId, "ANTHROPIC"));
  if (!key) throw new ContentAiError("AI planning is not configured: a Super Admin adds the Anthropic API key in Settings → Integrations.");
  const slots = buildSlots({ month: p.month, counts, platforms: profile.platforms, from: p.month === today.slice(0, 7) ? today : undefined });
  const costMonth = today.slice(0, 7);
  await assertUnderCap(db, client.id, costMonth, Number(profile.monthlyCapUsd), 0.5);

  const monthLabel = new Date(p.month + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const doFetch: FetchLike = p.fetchImpl ?? (fetch as unknown as FetchLike);
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await doFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: PLAN_MODEL, max_tokens: 32000,
        output_config: { format: { type: "json_schema", schema: PLAN_SCHEMA } },
        messages: [{ role: "user", content: planPrompt({ clientName: client.name, clientType: client.clientType, month: p.month, monthLabel, profile, monthBrief: p.monthBrief ?? "", slots }) }],
      }),
      signal: AbortSignal.timeout(240_000),
    });
  } catch { throw new ContentAiError("Claude could not be reached. Try again in a minute."); }
  const body = (await res.json().catch(() => null)) as { stop_reason?: string; content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } } | null;
  if (!res.ok) throw new ContentAiError(res.status === 401 ? "The Anthropic API key was refused. Check it in Settings → Integrations." : `Claude returned an error (${res.status}). Try again later.`);
  const cost = estimateTextCost({ inputTokens: body?.usage?.input_tokens ?? 4000, outputTokens: body?.usage?.output_tokens ?? total * 400 });
  if (body?.stop_reason === "refusal") throw new ContentAiError("Claude declined to write this plan. Check the client profile and brief, or write the posts by hand.");
  if (body?.stop_reason === "max_tokens") throw new ContentAiError("The plan was cut off. Plan fewer posts at a time.");
  const out = body?.content?.find((c) => c.type === "text")?.text;
  let parsed: { posts?: { slot: number; title: string; caption: string; hashtags: string; brief: string }[] };
  try { parsed = JSON.parse(out ?? ""); } catch { throw new ContentAiError("Claude's answer could not be read. Try again."); }
  const bySlot = new Map((parsed.posts ?? []).filter((x) => Number.isInteger(x.slot) && x.slot >= 0 && x.slot < slots.length && x.title?.trim() && x.caption?.trim()).map((x) => [x.slot, x]));
  if (bySlot.size < slots.length) {
    await db.contentAiRun.create({ data: { organizationId: p.organizationId, clientId: client.id, month: costMonth, kind: "PLAN", planMonth: p.month, postCount: 0, estimatedCostUsd: cost.toFixed(4), createdById: p.actorId } });
    throw new ContentAiError(`Claude wrote ${bySlot.size} of ${slots.length} posts, so nothing was saved. Try again.`);
  }

  const run = await db.contentAiRun.create({ data: { organizationId: p.organizationId, clientId: client.id, month: costMonth, kind: "PLAN", planMonth: p.month, postCount: slots.length, estimatedCostUsd: cost.toFixed(4), createdById: p.actorId } });
  const made: string[] = [];
  try {
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i], x = bySlot.get(i)!;
      const item = await createContent(db, {
        organizationId: p.organizationId, clientId: client.id, createdById: p.actorId, title: x.title.trim().slice(0, 200), copy: x.caption.trim().slice(0, 5000), hashtags: (x.hashtags ?? "").trim().slice(0, 500),
        platforms: s.platforms, postType: s.postType, plannedDate: s.date, plannedTime: s.time, brief: (x.brief ?? "").trim().slice(0, 3000),
      });
      made.push(item.id);
    }
    await db.contentItem.updateMany({ where: { id: { in: made } }, data: { aiRunId: run.id } });
  } catch (e) {
    await db.contentItem.deleteMany({ where: { id: { in: made } } });
    await db.contentAiRun.update({ where: { id: run.id }, data: { postCount: 0, undoneAt: new Date() } });
    if (e instanceof ContentError) throw new ContentAiError(e.message);
    throw e;
  }
  // The client's project manager hears about it when someone else planned the month
  if (client.projectManagerId && client.projectManagerId !== p.actorId) {
    await notify(db, client.projectManagerId, { kind: "content.ai_plan", title: `${slots.length} draft posts planned for ${client.name}`, body: `${monthLabel}: AI drafted the month. Review, assign makers and send them on.`, link: `/content?client=${client.id}&m=${p.month}` }).catch(() => undefined);
  }
  return { runId: run.id, created: made.length, estimatedCostUsd: cost };
}

// Removes the posts of one AI plan that nobody has touched (still a draft, still the first version). Edited or moved-on posts stay.
export async function undoPlan(db: Db, p: { organizationId: string; runId: string }) {
  const run = await db.contentAiRun.findFirst({ where: { id: p.runId, organizationId: p.organizationId, kind: "PLAN" } });
  if (!run) throw new ContentAiError("Plan not found.");
  if (run.undoneAt) throw new ContentAiError("This plan was already discarded.");
  const r = await db.contentItem.deleteMany({ where: { organizationId: p.organizationId, aiRunId: run.id, status: "DRAFT", version: 1, taskId: null } });
  const left = await db.contentItem.count({ where: { organizationId: p.organizationId, aiRunId: run.id } });
  if (left === 0) await db.contentAiRun.update({ where: { id: run.id }, data: { undoneAt: new Date() } });
  return { removed: r.count, kept: left };
}

// ---------------------------------------------------------------------------------------------------------------------------
// One image per post, made by Google's image model and attached as a draft file
// ---------------------------------------------------------------------------------------------------------------------------
const ASPECT: Record<string, string> = { REEL: "9:16", STORY: "9:16", VIDEO: "16:9", LIVE: "16:9", STATIC: "4:5", CAROUSEL: "1:1" };

export function imagePrompt(item: { title: string; copy: string; brief: string | null; postType: string }, profile: { visualStyle: string | null; avoid: string | null; about: string | null } | null, client: string | null) {
  return [
    `Create one social media image${client ? ` for the brand ${client}` : ""}.`,
    `Post: ${item.title}`,
    item.brief ? `What the designer was asked to make: ${item.brief}` : `Caption it will sit with: ${item.copy.slice(0, 600)}`,
    profile?.about ? `About the business: ${profile.about.slice(0, 600)}` : null,
    profile?.visualStyle ? `Visual style: ${profile.visualStyle}` : null,
    profile?.avoid ? `Never show: ${profile.avoid}` : null,
    "Professional, clean composition with room for a headline. Do not draw any words, letters, numbers, logos or watermarks: the team adds text and the logo afterwards. No real people's faces of public figures.",
  ].filter(Boolean).join("\n");
}

export async function generateImage(db: Db, storage: StorageProvider, p: { organizationId: string; itemId: string; actor: FileActor; today?: string; fetchImpl?: FetchLike; apiKey?: string }) {
  const item = await db.contentItem.findFirst({ where: { id: p.itemId, organizationId: p.organizationId } });
  if (!item) throw new ContentAiError("Post not found.");
  if (!["DRAFT", "INTERNAL_REVIEW", "CHANGES_REQUESTED"].includes(item.status)) throw new ContentAiError("Files can only be added while the post is still being worked on.");
  const key = p.apiKey ?? (await getKey(db, p.organizationId, "GEMINI"));
  if (!key) throw new ContentAiError("AI images are not configured: a Super Admin adds the Google Gemini API key in Settings → Integrations.");
  const profile = item.clientId ? await db.clientContentProfile.findUnique({ where: { clientId: item.clientId } }) : null;
  const client = item.clientId ? await db.client.findUnique({ where: { id: item.clientId }, select: { name: true } }) : null;
  const month = (p.today ?? new Date().toISOString().slice(0, 10)).slice(0, 7);
  if (item.clientId) await assertUnderCap(db, item.clientId, month, Number(profile?.monthlyCapUsd ?? 10), EST_IMAGE_USD);
  const doFetch: FetchLike = p.fetchImpl ?? (fetch as unknown as FetchLike);
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: imagePrompt(item, profile, client?.name ?? null) }] }],
        generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: ASPECT[item.postType] ?? "1:1" } },
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch { throw new ContentAiError("Google could not be reached. Try again in a minute."); }
  type Part = { inlineData?: { mimeType?: string; data?: string }; inline_data?: { mime_type?: string; data?: string } };
  const body = (await res.json().catch(() => null)) as { candidates?: { content?: { parts?: Part[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } } | null;
  if (!res.ok) throw new ContentAiError(res.status === 400 || res.status === 403 ? "Google refused the key or the request. Check the Gemini key in Settings → Integrations." : res.status === 429 ? "Google says too many requests or the quota is used up. Try again later." : `Google returned an error (${res.status}). Try again later.`);
  const part = body?.candidates?.[0]?.content?.parts?.find((x) => x.inlineData?.data || x.inline_data?.data);
  const b64 = part?.inlineData?.data ?? part?.inline_data?.data;
  if (!b64) throw new ContentAiError(body?.promptFeedback?.blockReason ? "Google would not make an image for this post. Change the brief and try again." : "Google did not return an image. Try again.");
  const bytes = Buffer.from(b64, "base64");
  const mime = part?.inlineData?.mimeType ?? part?.inline_data?.mime_type ?? "image/png";
  const ext = mime.includes("jpeg") ? "jpg" : "png";
  const file = await saveFile(db, storage, { actor: p.actor, ownerType: "CONTENT", ownerId: item.id, name: `ai-image-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}.${ext}`, bytes, category: "AI generated", media: true });
  await db.contentAiRun.create({ data: { organizationId: p.organizationId, clientId: item.clientId ?? "OWN", month, kind: "IMAGE", itemId: item.id, postCount: 1, estimatedCostUsd: EST_IMAGE_USD.toFixed(4), createdById: p.actor.id } });
  return file;
}
