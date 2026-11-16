// Facebook Pages and Instagram professional accounts: connecting them (Facebook sign-in) and posting approved content to them
// through Meta's Graph API. No outside publishing service: our own Meta app, our own tokens, stored encrypted like the
// integration keys and never shown. Free of Next.js imports so it can be tested with a fake Graph API.
import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { appUrl } from "./email-template-store";
import { signDownload } from "./files";
import { getKey, seal, unseal } from "./integration-keys";
import { notifyMany } from "./notifications";
import { captionFor, PLATFORM_META } from "./content-rules";
import { ContentError, transition } from "./content";
import { companyTimeZone, DEFAULT_POST_TIME, localToUtc } from "./social-time";

type Db = PrismaClient;
type Http = (url: string, init?: RequestInit) => Promise<Response>;
export type MetaDeps = { http?: Http; secret?: string; baseUrl?: string; now?: Date };

export class SocialError extends Error {}
export class GraphError extends Error {
  constructor(message: string, public code: number, public subcode: number | null, public status: number) { super(message); }
}

export const META_PLATFORMS = ["FACEBOOK", "INSTAGRAM"] as const;
export const GRAPH_VERSION = () => process.env.META_GRAPH_VERSION?.trim() || "v23.0";
// What we ask the person signing in for: list their Pages, post to them, read the post link back, and post to the linked Instagram account.
export const META_SCOPES = ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "business_management", "instagram_basic", "instagram_content_publish"];
const MAX_ATTEMPTS = 5;
const VIDEO_WAIT_MINUTES = 30;
const STUCK_MINUTES = 15;

const appSecret = (d?: MetaDeps) => d?.secret ?? process.env.SESSION_SECRET ?? "";
const httpOf = (d?: MetaDeps): Http => d?.http ?? ((u, i) => fetch(u, { ...i, signal: AbortSignal.timeout(60_000) }));
export const callbackUrl = (d?: MetaDeps) => `${d?.baseUrl ?? appUrl()}/api/social/meta/callback`;

// ---------- Graph API ----------

async function graph<T = Record<string, unknown>>(http: Http, method: "GET" | "POST" | "DELETE", path: string, params: Record<string, string>, token?: string): Promise<T> {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION()}/${path.replace(/^\//, "")}`);
  const body = new URLSearchParams({ ...params, ...(token ? { access_token: token } : {}) });
  let res: Response;
  if (method === "GET") { body.forEach((v, k) => url.searchParams.set(k, v)); res = await http(url.toString()); }
  else res = await http(url.toString(), { method, body, headers: { "content-type": "application/x-www-form-urlencoded" } });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number; error_subcode?: number; error_user_msg?: string } } & T;
  if (!res.ok || json.error) {
    const e = json.error ?? {};
    throw new GraphError(e.error_user_msg || e.message || `Meta answered ${res.status}`, e.code ?? 0, e.error_subcode ?? null, res.status);
  }
  return json;
}

// What a Graph error means for us
export function classify(e: unknown): { kind: "EXPIRED" | "PERMISSION" | "RETRY" | "WAIT" | "FAIL"; message: string } {
  if (!(e instanceof GraphError)) return { kind: "RETRY", message: e instanceof Error ? `Could not reach Meta: ${e.message}` : "Could not reach Meta." };
  if (e.code === 190 || e.subcode === 463 || e.subcode === 460) return { kind: "EXPIRED", message: "The connection to this account has expired or was removed. Connect it again under Content → Social accounts." };
  if (e.code === 9007 || e.subcode === 2207027) return { kind: "WAIT", message: "Instagram is still preparing the media." };
  if ([4, 17, 32, 613, 80001, 80002].includes(e.code) || e.subcode === 2207042 || e.status >= 500 || e.code === 1 || e.code === 2) return { kind: "RETRY", message: `Meta is busy or limiting posts (${e.message}). It will try again.` };
  if (e.code === 10 || (e.code >= 200 && e.code < 300)) return { kind: "PERMISSION", message: `The account did not give permission to post (${e.message}). Connect it again and allow posting.` };
  return { kind: "FAIL", message: e.message };
}

// ---------- Connecting accounts ----------

const stateSig = (payload: string, secret: string) => crypto.createHmac("sha256", secret).update(`meta-oauth:${payload}`).digest("base64url");
export function signState(p: { userId: string; organizationId: string; clientId: string | null }, secret: string, nowMs = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ u: p.userId, o: p.organizationId, c: p.clientId, n: crypto.randomBytes(8).toString("hex"), e: Math.floor(nowMs / 1000) + 900 })).toString("base64url");
  return `${payload}.${stateSig(payload, secret)}`;
}
export function verifyState(state: string, secret: string, nowMs = Date.now()): { userId: string; organizationId: string; clientId: string | null } | null {
  const [payload, sig] = state.split(".");
  if (!payload || !sig || secret.length < 32) return null;
  const want = stateSig(payload, secret);
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try {
    const v = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { u: string; o: string; c: string | null; e: number };
    if (v.e * 1000 < nowMs) return null;
    return { userId: v.u, organizationId: v.o, clientId: v.c ?? null };
  } catch { return null; }
}

export async function metaApp(db: Db, organizationId: string, d?: MetaDeps) {
  const [appId, appSecretKey] = await Promise.all([getKey(db, organizationId, "META_APP_ID", process.env, appSecret(d)), getKey(db, organizationId, "META_APP_SECRET", process.env, appSecret(d))]);
  return appId && appSecretKey ? { appId, appSecret: appSecretKey } : null;
}

export function loginUrl(appId: string, state: string, d?: MetaDeps) {
  const u = new URL(`https://www.facebook.com/${GRAPH_VERSION()}/dialog/oauth`);
  u.searchParams.set("client_id", appId);
  u.searchParams.set("redirect_uri", callbackUrl(d));
  u.searchParams.set("state", state);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", META_SCOPES.join(","));
  return u.toString();
}

export type ConnectChoice = { kind: "FACEBOOK" | "INSTAGRAM"; id: string; name: string; username?: string; pageId: string };
type PagePayload = { id: string; name: string; token: string; ig?: { id: string; username?: string; name?: string } | null };

// After Facebook sends the person back: swap the code for a long-lived token, list their Pages (and linked Instagram accounts),
// and keep that list, encrypted, for 30 minutes while they choose. Returns the id of that short-lived choice.
export async function finishLogin(db: Db, p: { organizationId: string; userId: string; clientId: string | null; code: string }, d?: MetaDeps): Promise<string> {
  const app = await metaApp(db, p.organizationId, d);
  if (!app) throw new SocialError("The Meta app ID and secret are not set in Settings → Integrations.");
  const http = httpOf(d);
  const short = await graph<{ access_token: string }>(http, "GET", "oauth/access_token", { client_id: app.appId, client_secret: app.appSecret, redirect_uri: callbackUrl(d), code: p.code });
  const long = await graph<{ access_token: string }>(http, "GET", "oauth/access_token", { grant_type: "fb_exchange_token", client_id: app.appId, client_secret: app.appSecret, fb_exchange_token: short.access_token });
  // Page tokens obtained from a long-lived user token do not expire
  const res = await graph<{ data: { id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string; name?: string } }[] }>(
    http, "GET", "me/accounts", { fields: "id,name,access_token,instagram_business_account{id,username,name}", limit: "100" }, long.access_token);
  const pages: PagePayload[] = (res.data ?? []).filter((x) => x.access_token).map((x) => ({ id: x.id, name: x.name, token: x.access_token, ig: x.instagram_business_account ?? null }));
  if (pages.length === 0) throw new SocialError("No Facebook Pages came back. Sign in again and tick the Pages (and their Instagram accounts) you want to use.");
  const s = await db.socialConnectSession.create({
    data: { organizationId: p.organizationId, clientId: p.clientId, userId: p.userId, payloadEnc: seal(JSON.stringify(pages), appSecret(d)), expiresAt: new Date((d?.now ?? new Date()).getTime() + 30 * 60_000) },
  });
  await db.socialConnectSession.deleteMany({ where: { expiresAt: { lt: d?.now ?? new Date() } } });
  return s.id;
}

async function loadSession(db: Db, p: { organizationId: string; userId: string; sessionId: string }, d?: MetaDeps) {
  const s = await db.socialConnectSession.findFirst({ where: { id: p.sessionId, organizationId: p.organizationId, userId: p.userId } });
  if (!s || s.expiresAt < (d?.now ?? new Date())) throw new SocialError("This sign-in has expired. Connect again.");
  const raw = unseal(s.payloadEnc, appSecret(d));
  if (!raw) throw new SocialError("This sign-in could not be read. Connect again.");
  return { session: s, pages: JSON.parse(raw) as PagePayload[] };
}

// What the person may choose from (never the tokens)
export async function connectChoices(db: Db, p: { organizationId: string; userId: string; sessionId: string }, d?: MetaDeps) {
  const { session, pages } = await loadSession(db, p, d);
  const choices: ConnectChoice[] = [];
  for (const pg of pages) {
    choices.push({ kind: "FACEBOOK", id: pg.id, name: pg.name, pageId: pg.id });
    if (pg.ig) choices.push({ kind: "INSTAGRAM", id: pg.ig.id, name: pg.ig.name || pg.ig.username || pg.name, username: pg.ig.username, pageId: pg.id });
  }
  return { clientId: session.clientId, choices };
}

// Save the ticked accounts for this client. picks: "FACEBOOK:<pageId>" / "INSTAGRAM:<igId>"
export async function connectAccounts(db: Db, p: { organizationId: string; userId: string; sessionId: string; picks: string[] }, d?: MetaDeps) {
  const { session, pages } = await loadSession(db, p, d);
  const secret = appSecret(d);
  let saved = 0;
  for (const pick of [...new Set(p.picks)]) {
    const [kind, id] = pick.split(":");
    const page = kind === "FACEBOOK" ? pages.find((x) => x.id === id) : kind === "INSTAGRAM" ? pages.find((x) => x.ig?.id === id) : undefined;
    if (!page) continue;
    const isIg = kind === "INSTAGRAM";
    const data = {
      clientId: session.clientId, name: isIg ? page.ig?.name || page.ig?.username || page.name : page.name, username: isIg ? page.ig?.username ?? null : null, pageId: page.id,
      tokenEnc: seal(page.token, secret), tokenExpiresAt: null, status: "ACTIVE", lastError: null, connectedById: p.userId,
    };
    await db.socialAccount.upsert({
      where: { organizationId_platform_externalId: { organizationId: p.organizationId, platform: kind, externalId: id } },
      update: { ...data, connectedAt: d?.now ?? new Date() }, create: { organizationId: p.organizationId, platform: kind, externalId: id, ...data },
    });
    saved++;
  }
  await db.socialConnectSession.delete({ where: { id: session.id } });
  if (saved === 0) throw new SocialError("Tick at least one account.");
  return saved;
}

// Stop posting to an account and forget its token. Anything still waiting for it fails with a clear reason.
export async function disconnectAccount(db: Db, p: { organizationId: string; accountId: string }) {
  const a = await db.socialAccount.findFirst({ where: { id: p.accountId, organizationId: p.organizationId } });
  if (!a) throw new SocialError("Account not found.");
  await db.socialAccount.update({ where: { id: a.id }, data: { status: "DISCONNECTED", tokenEnc: "", lastError: null } });
  await db.contentPublication.updateMany({ where: { accountId: a.id, status: "QUEUED" }, data: { status: "FAILED", error: "The account was disconnected." } });
  return a;
}

// Ask Meta whether the token still works
export async function checkAccount(db: Db, p: { organizationId: string; accountId: string }, d?: MetaDeps) {
  const a = await db.socialAccount.findFirst({ where: { id: p.accountId, organizationId: p.organizationId } });
  if (!a || a.status === "DISCONNECTED") throw new SocialError("Account not found.");
  const token = unseal(a.tokenEnc, appSecret(d));
  if (!token) { await db.socialAccount.update({ where: { id: a.id }, data: { status: "EXPIRED", lastError: "The stored token could not be read. Connect again." } }); return false; }
  try {
    await graph(httpOf(d), "GET", a.externalId, { fields: a.platform === "INSTAGRAM" ? "id,username" : "id,name" }, token);
    await db.socialAccount.update({ where: { id: a.id }, data: { status: "ACTIVE", lastError: null } });
    return true;
  } catch (e) {
    const c = classify(e);
    await db.socialAccount.update({ where: { id: a.id }, data: { status: c.kind === "EXPIRED" ? "EXPIRED" : a.status, lastError: c.message } });
    return false;
  }
}

// ---------- What can be posted automatically ----------

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const VIDEO_TYPES = ["video/mp4", "video/quicktime"];

// Which of a post's platforms we can post to ourselves. A Facebook story and any live video are still posted by hand.
export function autoPlatforms(item: { platforms: string[]; platform: string; postType: string }): string[] {
  if (item.postType === "LIVE") return [];
  const plats = item.platforms.length ? item.platforms : [item.platform];
  return plats.filter((p) => p === "INSTAGRAM" || (p === "FACEBOOK" && item.postType !== "STORY"));
}

type MediaFile = { id: string; contentType: string; filename: string };
// One video wins over images; otherwise up to 10 images in upload order.
export function pickMedia(files: MediaFile[]): { kind: "NONE" } | { kind: "VIDEO"; file: MediaFile } | { kind: "IMAGES"; files: MediaFile[] } {
  const video = files.find((f) => VIDEO_TYPES.includes(f.contentType));
  if (video) return { kind: "VIDEO", file: video };
  const images = files.filter((f) => IMAGE_TYPES.includes(f.contentType)).slice(0, 10);
  return images.length ? { kind: "IMAGES", files: images } : { kind: "NONE" };
}

export function mediaProblem(platform: string, postType: string, media: ReturnType<typeof pickMedia>): string | null {
  if (platform === "INSTAGRAM") {
    if (media.kind === "NONE") return "Instagram needs an image or a video. Attach the creative first.";
    if (postType === "STORY" && media.kind === "IMAGES" && media.files.length > 1) return "An Instagram story takes one image or one video.";
    if ((postType === "REEL" || postType === "VIDEO") && media.kind !== "VIDEO") return "This is a video post: attach the video (MP4 or MOV) first.";
  }
  if (platform === "FACEBOOK" && (postType === "REEL" || postType === "VIDEO") && media.kind !== "VIDEO") return "This is a video post: attach the video (MP4 or MOV) first.";
  return null;
}

const itemFiles = (db: Db, itemId: string, organizationId: string) =>
  db.storedFile.findMany({ where: { organizationId, ownerType: "CONTENT", ownerId: itemId, deletedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, contentType: true, filename: true } });

// A public link Meta can fetch the file from for a day. "social-jpg" asks the media route for a JPEG (Instagram takes JPEG only).
export function mediaUrl(fileId: string, jpeg: boolean, d?: MetaDeps) {
  const t = signDownload(fileId, jpeg ? "social-jpg" : "social", appSecret(d), 86_400, (d?.now ?? new Date()).getTime());
  return `${d?.baseUrl ?? appUrl()}/api/social/media/${t}`;
}

// ---------- Scheduling ----------

// "Post automatically": the approved post is queued for each chosen account at its planned date and time (company time).
// accounts: { FACEBOOK: accountId, INSTAGRAM: accountId }. A time already passed means "post now".
export async function scheduleAutoPosting(db: Db, p: { organizationId: string; itemId: string; userId: string; accounts: Record<string, string> }, d?: MetaDeps) {
  const now = d?.now ?? new Date();
  const item = await db.contentItem.findFirst({ where: { id: p.itemId, organizationId: p.organizationId } });
  if (!item) throw new SocialError("Content not found.");
  if (item.status !== "APPROVED") throw new SocialError("Only an approved post can be scheduled.");
  if (!item.plannedDate) throw new SocialError("Give the post a date first.");
  const allowed = autoPlatforms(item);
  const chosen = Object.entries(p.accounts).filter(([plat, id]) => id && allowed.includes(plat));
  if (chosen.length === 0) throw new SocialError("Choose an account for at least one platform.");
  const media = pickMedia(await itemFiles(db, item.id, p.organizationId));
  const accounts = [];
  for (const [platform, accountId] of chosen) {
    const a = await db.socialAccount.findFirst({ where: { id: accountId, organizationId: p.organizationId, platform } });
    if (!a || (a.clientId ?? null) !== (item.clientId ?? null)) throw new SocialError(`That ${PLATFORM_META[platform]?.label ?? platform} account does not belong to this client.`);
    if (a.status !== "ACTIVE") throw new SocialError(`${a.name} is not connected. Connect it again under Social accounts.`);
    const problem = mediaProblem(platform, item.postType, media);
    if (problem) throw new SocialError(problem);
    accounts.push({ platform, accountId: a.id });
  }
  const at = localToUtc(item.plannedDate, item.plannedTime ?? DEFAULT_POST_TIME, await companyTimeZone(db, p.organizationId));
  const scheduledFor = at < now ? now : at;
  try {
    await transition(db, { organizationId: p.organizationId, id: item.id, actor: { id: p.userId, type: "STAFF" }, to: "SCHEDULED", quiet: true });
  } catch (e) {
    if (e instanceof ContentError) throw new SocialError(e.message);
    throw e;
  }
  for (const a of accounts) {
    const data = { accountId: a.accountId, status: "QUEUED", scheduledFor, attempts: 0, containerId: null, externalPostId: null, permalink: null, error: null, publishedAt: null, scheduledById: p.userId };
    const existing = await db.contentPublication.findUnique({ where: { itemId_platform: { itemId: item.id, platform: a.platform } } });
    if (existing?.status === "PUBLISHED") continue; // already live there
    await db.contentPublication.upsert({ where: { itemId_platform: { itemId: item.id, platform: a.platform } }, update: data, create: { organizationId: p.organizationId, itemId: item.id, platform: a.platform, ...data } });
  }
  return { scheduledFor, now: scheduledFor.getTime() === now.getTime() };
}

// Stop what has not gone out yet. If nothing went out, the post goes back to Approved.
export async function cancelAutoPosting(db: Db, p: { organizationId: string; itemId: string; userId: string }) {
  const item = await db.contentItem.findFirst({ where: { id: p.itemId, organizationId: p.organizationId }, include: { publications: true } });
  if (!item) throw new SocialError("Content not found.");
  if (item.publications.some((x) => x.status === "PUBLISHING")) throw new SocialError("A post is going out right now. Try again in a minute.");
  const n = (await db.contentPublication.updateMany({ where: { itemId: item.id, status: { in: ["QUEUED", "FAILED"] } }, data: { status: "CANCELLED" } })).count;
  if (item.status === "SCHEDULED" && !item.publications.some((x) => x.status === "PUBLISHED")) {
    await transition(db, { organizationId: p.organizationId, id: item.id, actor: { id: p.userId, type: "STAFF" }, to: "APPROVED", quiet: true });
  }
  return n;
}

export async function retryPublication(db: Db, p: { organizationId: string; publicationId: string; userId: string }, d?: MetaDeps) {
  const pub = await db.contentPublication.findFirst({ where: { id: p.publicationId, organizationId: p.organizationId }, include: { account: true, item: true } });
  if (!pub) throw new SocialError("Not found.");
  if (pub.status !== "FAILED" && pub.status !== "CANCELLED") throw new SocialError("Only a failed or cancelled post can be tried again.");
  if (pub.account.status !== "ACTIVE") throw new SocialError(`${pub.account.name} is not connected. Connect it again first.`);
  if (pub.item.status !== "SCHEDULED") {
    if (pub.item.status !== "APPROVED") throw new SocialError("The post is no longer approved.");
    await transition(db, { organizationId: p.organizationId, id: pub.itemId, actor: { id: p.userId, type: "STAFF" }, to: "SCHEDULED", quiet: true });
  }
  return db.contentPublication.update({ where: { id: pub.id }, data: { status: "QUEUED", scheduledFor: d?.now ?? new Date(), attempts: 0, containerId: null, error: null, scheduledById: p.userId } });
}

// ---------- Posting ----------

type Pub = { id: string; organizationId: string; itemId: string; platform: string; accountId: string; attempts: number; containerId: string | null; scheduledById: string; scheduledFor: Date };
type Outcome = { done: true; postId: string; permalink: string | null } | { done: false; containerId: string };

async function postToFacebook(http: Http, token: string, pageId: string, caption: string, media: ReturnType<typeof pickMedia>, d?: MetaDeps): Promise<Outcome> {
  let postId: string;
  if (media.kind === "VIDEO") {
    postId = (await graph<{ id: string }>(http, "POST", `${pageId}/videos`, { file_url: mediaUrl(media.file.id, false, d), description: caption }, token)).id;
  } else if (media.kind === "IMAGES" && media.files.length === 1) {
    const r = await graph<{ id: string; post_id?: string }>(http, "POST", `${pageId}/photos`, { url: mediaUrl(media.files[0].id, false, d), caption }, token);
    postId = r.post_id ?? r.id;
  } else if (media.kind === "IMAGES") {
    const ids: string[] = [];
    for (const f of media.files) ids.push((await graph<{ id: string }>(http, "POST", `${pageId}/photos`, { url: mediaUrl(f.id, false, d), published: "false" }, token)).id);
    const params: Record<string, string> = { message: caption };
    ids.forEach((id, i) => { params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id }); });
    postId = (await graph<{ id: string }>(http, "POST", `${pageId}/feed`, params, token)).id;
  } else {
    postId = (await graph<{ id: string }>(http, "POST", `${pageId}/feed`, { message: caption }, token)).id;
  }
  const link = await graph<{ permalink_url?: string }>(http, "GET", postId, { fields: "permalink_url" }, token).catch(() => ({ permalink_url: undefined }));
  return { done: true, postId, permalink: link.permalink_url ? (link.permalink_url.startsWith("http") ? link.permalink_url : `https://www.facebook.com${link.permalink_url}`) : null };
}

async function instagramContainer(http: Http, token: string, igId: string, caption: string, postType: string, media: ReturnType<typeof pickMedia>, d?: MetaDeps): Promise<{ id: string; video: boolean }> {
  const story = postType === "STORY";
  if (media.kind === "VIDEO") {
    const r = await graph<{ id: string }>(http, "POST", `${igId}/media`, { media_type: story ? "STORIES" : "REELS", video_url: mediaUrl(media.file.id, false, d), ...(story ? {} : { caption }) }, token);
    return { id: r.id, video: true };
  }
  if (media.kind !== "IMAGES") throw new SocialError("Instagram needs an image or a video.");
  if (media.files.length === 1 || story) {
    const r = await graph<{ id: string }>(http, "POST", `${igId}/media`, { image_url: mediaUrl(media.files[0].id, true, d), ...(story ? { media_type: "STORIES" } : { caption }) }, token);
    return { id: r.id, video: false };
  }
  const children: string[] = [];
  for (const f of media.files) children.push((await graph<{ id: string }>(http, "POST", `${igId}/media`, { image_url: mediaUrl(f.id, true, d), is_carousel_item: "true" }, token)).id);
  const r = await graph<{ id: string }>(http, "POST", `${igId}/media`, { media_type: "CAROUSEL", children: children.join(","), caption }, token);
  return { id: r.id, video: false };
}

async function instagramPublish(http: Http, token: string, igId: string, containerId: string): Promise<Outcome> {
  const r = await graph<{ id: string }>(http, "POST", `${igId}/media_publish`, { creation_id: containerId }, token);
  const link = await graph<{ permalink?: string }>(http, "GET", r.id, { fields: "permalink" }, token).catch(() => ({ permalink: undefined }));
  return { done: true, postId: r.id, permalink: link.permalink ?? null };
}

async function postOne(db: Db, pub: Pub, d?: MetaDeps): Promise<Outcome> {
  const http = httpOf(d);
  const [item, account] = await Promise.all([
    db.contentItem.findUniqueOrThrow({ where: { id: pub.itemId } }),
    db.socialAccount.findUniqueOrThrow({ where: { id: pub.accountId } }),
  ]);
  if (account.status !== "ACTIVE") throw new SocialError(`${account.name} is not connected. Connect it again under Social accounts, then try again.`);
  const token = unseal(account.tokenEnc, appSecret(d));
  if (!token) throw new SocialError("The stored token could not be read. Connect the account again.");
  const caption = captionFor(item, pub.platform);
  if (pub.platform === "FACEBOOK") return postToFacebook(http, token, account.externalId, caption, pickMedia(await itemFiles(db, item.id, item.organizationId)), d);
  if (pub.platform !== "INSTAGRAM") throw new SocialError(`${pub.platform} is not posted automatically.`);
  if (pub.containerId) {
    // A video was handed over earlier: publish once Instagram has finished processing it
    const s = await graph<{ status_code?: string; status?: string }>(http, "GET", pub.containerId, { fields: "status_code,status" }, token);
    if (s.status_code === "FINISHED") return instagramPublish(http, token, account.externalId, pub.containerId);
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new SocialError(`Instagram could not process the video (${s.status ?? s.status_code}). Check it is an MP4 or MOV between 3 seconds and 15 minutes, 9:16, then try again.`);
    return { done: false, containerId: pub.containerId };
  }
  const c = await instagramContainer(http, token, account.externalId, caption, item.postType, pickMedia(await itemFiles(db, item.id, item.organizationId)), d);
  if (c.video) return { done: false, containerId: c.id };
  try { return await instagramPublish(http, token, account.externalId, c.id); }
  catch (e) { if (classify(e).kind === "WAIT") return { done: false, containerId: c.id }; throw e; }
}

async function firstComment(db: Db, pub: Pub, postId: string, d?: MetaDeps) {
  const item = await db.contentItem.findUnique({ where: { id: pub.itemId }, select: { firstComment: true, postType: true } });
  if (!item?.firstComment || item.postType === "STORY") return null;
  const account = await db.socialAccount.findUnique({ where: { id: pub.accountId } });
  const token = account ? unseal(account.tokenEnc, appSecret(d)) : null;
  if (!token) return null;
  try { await graph(httpOf(d), "POST", `${postId}/comments`, { message: item.firstComment }, token); return null; }
  catch (e) { return `Posted, but the first comment could not be added (${classify(e).message}). Add it by hand.`; }
}

async function staffToTell(db: Db, pub: Pub) {
  const item = await db.contentItem.findUnique({ where: { id: pub.itemId }, select: { createdById: true, assignedToId: true, title: true } });
  return { title: item?.title ?? "A post", ids: [...new Set([pub.scheduledById, item?.createdById, item?.assignedToId].filter((x): x is string => Boolean(x)))] };
}

// When every automatic post is out: the post becomes Published (and counts against the quota) unless some platforms are posted by hand.
async function settleItem(db: Db, itemId: string) {
  const item = await db.contentItem.findUnique({ where: { id: itemId }, include: { publications: true } });
  if (!item || item.status !== "SCHEDULED") return;
  const pubs = item.publications.filter((x) => x.status !== "CANCELLED");
  if (pubs.some((x) => x.status === "QUEUED" || x.status === "PUBLISHING" || x.status === "FAILED")) return;
  const live = pubs.filter((x) => x.status === "PUBLISHED");
  if (live.length === 0) return;
  const plats = item.platforms.length ? item.platforms : [item.platform];
  const byHand = plats.filter((p) => !live.some((x) => x.platform === p));
  const by = live[0].scheduledById;
  const names = live.map((x) => PLATFORM_META[x.platform]?.label ?? x.platform).join(" and ");
  if (byHand.length) {
    await notifyMany(db, [by], { kind: "content.published", title: `Posted on ${names}`, body: `${item.title}: post it on ${byHand.map((p) => PLATFORM_META[p]?.label ?? p).join(", ")} yourself, then press “Confirm it was published”.`, link: `/content/${item.id}`, dedupeKey: `content:${item.id}:auto-partial` });
    return;
  }
  await transition(db, { organizationId: item.organizationId, id: item.id, actor: { id: by, type: "STAFF" }, to: "PUBLISHED", quiet: true }).catch(() => undefined);
  const staff = [...new Set([by, item.createdById, item.assignedToId].filter((x): x is string => Boolean(x)))];
  await notifyMany(db, staff, { kind: "content.published", title: `Live on ${names}`, body: item.title, link: `/content/${item.id}`, dedupeKey: `content:${item.id}:live` });
  if (item.clientId) {
    const clientUsers = await db.user.findMany({ where: { clientId: item.clientId, active: true }, select: { id: true } });
    await notifyMany(db, clientUsers.map((u) => u.id), { kind: "content.published", title: `Your post is live on ${names}`, body: item.title, link: "/portal/content", dedupeKey: `content:${item.id}:live` });
  }
}

async function handle(db: Db, pub: Pub, d?: MetaDeps) {
  const now = d?.now ?? new Date();
  try {
    const out = await postOne(db, pub, d);
    if (!out.done) {
      // stays PUBLISHING with its container and is checked again on the next tick; scheduledFor now holds when the container was made
      if (pub.containerId && (now.getTime() - pub.scheduledFor.getTime()) / 60_000 > VIDEO_WAIT_MINUTES) throw new SocialError("Instagram took too long to process the video. Try again.");
      if (!pub.containerId) await db.contentPublication.update({ where: { id: pub.id }, data: { containerId: out.containerId, scheduledFor: now } });
      return "waiting" as const;
    }
    const note = await firstComment(db, pub, out.postId, d);
    await db.contentPublication.update({ where: { id: pub.id }, data: { status: "PUBLISHED", externalPostId: out.postId, permalink: out.permalink, publishedAt: now, error: note, containerId: null } });
    await settleItem(db, pub.itemId);
    return "published" as const;
  } catch (e) {
    const c = e instanceof SocialError ? { kind: "FAIL" as const, message: e.message } : classify(e);
    if (c.kind === "EXPIRED") await db.socialAccount.update({ where: { id: pub.accountId }, data: { status: "EXPIRED", lastError: c.message } });
    if (c.kind === "RETRY" && pub.attempts + 1 < MAX_ATTEMPTS && !pub.containerId) {
      await db.contentPublication.update({ where: { id: pub.id }, data: { status: "QUEUED", attempts: pub.attempts + 1, error: c.message, scheduledFor: new Date(now.getTime() + 5 * 60_000 * (pub.attempts + 1)) } });
      return "retry" as const;
    }
    if (c.kind === "WAIT" && pub.containerId) return "waiting" as const;
    await db.contentPublication.update({ where: { id: pub.id }, data: { status: "FAILED", attempts: pub.attempts + 1, error: c.message, containerId: null } });
    const t = await staffToTell(db, pub);
    await notifyMany(db, t.ids, { kind: "content.publish_failed", title: `Could not post on ${PLATFORM_META[pub.platform]?.label ?? pub.platform}`, body: `${t.title}: ${c.message}`, link: `/content/${pub.itemId}`, dedupeKey: `pub:${pub.id}:${pub.attempts + 1}` });
    return "failed" as const;
  }
}

// Runs every minute. Each due post is claimed by moving it QUEUED -> PUBLISHING in one statement, so two servers never post it twice.
export async function runDuePublications(db: Db, d?: MetaDeps) {
  const now = d?.now ?? new Date();
  const result = { published: 0, waiting: 0, retry: 0, failed: 0, cancelled: 0 };
  // A post that was being sent when the server stopped: we cannot know whether Meta got it, so we do not send it again blindly
  await db.contentPublication.updateMany({
    where: { status: "PUBLISHING", containerId: null, updatedAt: { lt: new Date(now.getTime() - STUCK_MINUTES * 60_000) } },
    data: { status: "FAILED", error: "Sending was interrupted. Check the page: if the post is not there, press Try again." },
  });
  const due = await db.contentPublication.findMany({ where: { status: "QUEUED", scheduledFor: { lte: now } }, orderBy: { scheduledFor: "asc" }, take: 20, include: { item: { select: { status: true } } } });
  const waiting = await db.contentPublication.findMany({ where: { status: "PUBLISHING", containerId: { not: null } }, take: 20, include: { item: { select: { status: true } } } });
  for (const pub of due) {
    if (pub.item.status !== "SCHEDULED") { // moved back or published by hand meanwhile
      result.cancelled += (await db.contentPublication.updateMany({ where: { id: pub.id, status: "QUEUED" }, data: { status: "CANCELLED" } })).count;
      continue;
    }
    const claimed = await db.contentPublication.updateMany({ where: { id: pub.id, status: "QUEUED" }, data: { status: "PUBLISHING" } });
    if (claimed.count !== 1) continue;
    result[await handle(db, pub, d)]++;
  }
  for (const pub of waiting) result[await handle(db, pub, d)]++;
  return result;
}
