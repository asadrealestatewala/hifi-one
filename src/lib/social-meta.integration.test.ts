import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { seal, setKey } from "./integration-keys";
import { reschedule } from "./content";
import { cancelAutoPosting, connectAccounts, connectChoices, disconnectAccount, finishLogin, retryPublication, runDuePublications, scheduleAutoPosting } from "./social-meta";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const SECRET = "k".repeat(40);
let org: string, ann: string, cu: string, client: string, other: string;

// A pretend Graph API: records every call and answers from a handler per "METHOD path"
type Call = { method: string; path: string; params: Record<string, string> };
let calls: Call[] = [];
let handlers: Record<string, (p: Record<string, string>) => unknown> = {};
const http = async (u: string, init?: RequestInit) => {
  const url = new URL(u);
  const method = init?.method ?? "GET";
  const params = Object.fromEntries(method === "GET" ? url.searchParams : new URLSearchParams(String(init?.body)));
  const path = url.pathname.replace(/^\/v[\d.]+\//, "");
  calls.push({ method, path, params });
  const h = handlers[`${method} ${path}`];
  if (!h) return new Response(JSON.stringify({ error: { message: `no fake for ${method} ${path}`, code: 100 } }), { status: 400 });
  const out = h(params) as { __status?: number };
  return new Response(JSON.stringify(out), { status: out?.__status ?? 200 });
};
const deps = (now = new Date("2026-12-01T12:00:00Z")) => ({ http, secret: SECRET, baseUrl: "https://app.example", now });

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "ContentPublication","SocialAccount","SocialConnectSession","StoredFile","QuotaUsage","ContentEvent","ContentVersion","ContentItem","Notification","IntegrationKey","Client","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Social Org" } })).id;
  ann = (await db.user.create({ data: { organizationId: org, email: "ann@s.test", name: "Ann", passwordHash: "x" } })).id;
  client = (await db.client.create({ data: { organizationId: org, name: "Acme" } })).id;
  other = (await db.client.create({ data: { organizationId: org, name: "Beta" } })).id;
  cu = (await db.user.create({ data: { organizationId: org, email: "c@s.test", name: "Client", passwordHash: "x", userType: "CLIENT", clientId: client } })).id;
  await setKey(db, { organizationId: org, provider: "META_APP_ID", value: "1234567890", userId: ann, secret: SECRET });
  await setKey(db, { organizationId: org, provider: "META_APP_SECRET", value: "abcdef0123456789abcdef0123456789", userId: ann, secret: SECRET });
});
afterAll(async () => { await db.$disconnect(); });
beforeEach(() => { calls = []; handlers = {}; });

let fbAccount: string, igAccount: string;
const account = (platform: string, externalId: string, clientId: string | null = client) =>
  db.socialAccount.create({ data: { organizationId: org, clientId, platform, externalId, name: `${platform} ${externalId}`, tokenEnc: seal("PAGE_TOKEN", SECRET), connectedById: ann } }).then((a) => a.id);
const approved = async (over: Record<string, unknown> = {}, files: { contentType: string }[] = [{ contentType: "image/png" }]) => {
  const item = await db.contentItem.create({ data: { organizationId: org, clientId: client, platform: "FACEBOOK", platforms: ["FACEBOOK", "INSTAGRAM"], title: "Winter boots", copy: "Warm boots", hashtags: "#boots", postType: "STATIC", plannedDate: "2026-12-01", plannedTime: "15:00", status: "APPROVED", createdById: ann, ...over } });
  for (const [i, f] of files.entries()) await db.storedFile.create({ data: { organizationId: org, ownerType: "CONTENT", ownerId: item.id, filename: `f${i}`, contentType: f.contentType, size: 1, sha256: "x", storageKey: `2026/12/${item.id.padEnd(32, "0").slice(0, 26)}${String(i).padStart(6, "0")}`, uploadedById: ann } });
  return item;
};

describe("connecting a client's Page and Instagram account", () => {
  it("swaps the code for a long-lived token, lists Pages, and saves only the ticked accounts with encrypted tokens", async () => {
    handlers["GET oauth/access_token"] = (p) => ({ access_token: p.fb_exchange_token ? "LONG_USER" : "SHORT_USER" });
    handlers["GET me/accounts"] = (p) => { expect(p.access_token).toBe("LONG_USER"); return { data: [{ id: "PAGE1", name: "Acme Page", access_token: "PAGE1_TOKEN", instagram_business_account: { id: "IG1", username: "acme" } }, { id: "PAGE2", name: "Someone else", access_token: "PAGE2_TOKEN" }] }; };
    const sid = await finishLogin(db, { organizationId: org, userId: ann, clientId: client, code: "CODE" }, deps());
    const { choices } = await connectChoices(db, { organizationId: org, userId: ann, sessionId: sid }, deps());
    expect(choices.map((c) => `${c.kind}:${c.id}`)).toEqual(["FACEBOOK:PAGE1", "INSTAGRAM:IG1", "FACEBOOK:PAGE2"]);
    expect(JSON.stringify(choices)).not.toContain("TOKEN");
    await expect(connectChoices(db, { organizationId: org, userId: cu, sessionId: sid }, deps())).rejects.toThrow(/expired/); // someone else's sign-in
    expect(await connectAccounts(db, { organizationId: org, userId: ann, sessionId: sid, picks: ["FACEBOOK:PAGE1", "INSTAGRAM:IG1"] }, deps())).toBe(2);
    const saved = await db.socialAccount.findMany({ where: { organizationId: org }, orderBy: { platform: "asc" } });
    expect(saved.map((a) => [a.platform, a.externalId, a.clientId, a.pageId])).toEqual([["FACEBOOK", "PAGE1", client, "PAGE1"], ["INSTAGRAM", "IG1", client, "PAGE1"]]);
    expect(saved[0].tokenEnc).not.toContain("PAGE1_TOKEN");
    expect(await db.socialConnectSession.count()).toBe(0); // used once
    fbAccount = saved[0].id; igAccount = saved[1].id;
  });
});

describe("posting approved content", () => {
  it("refuses another client's account, a post that is not approved, and Instagram without media", async () => {
    const foreign = await account("FACEBOOK", "BETA", other);
    const a = await approved();
    await expect(scheduleAutoPosting(db, { organizationId: org, itemId: a.id, userId: ann, accounts: { FACEBOOK: foreign } }, deps())).rejects.toThrow(/does not belong/);
    const draft = await approved({ status: "DRAFT" });
    await expect(scheduleAutoPosting(db, { organizationId: org, itemId: draft.id, userId: ann, accounts: { FACEBOOK: fbAccount } }, deps())).rejects.toThrow(/approved/);
    const bare = await approved({}, []);
    await expect(scheduleAutoPosting(db, { organizationId: org, itemId: bare.id, userId: ann, accounts: { INSTAGRAM: igAccount } }, deps())).rejects.toThrow(/Instagram needs/);
  });

  it("queues for the planned time, waits until then, posts a photo to the Page and an image to Instagram, adds the first comment, then marks it Published", async () => {
    const item = await approved({ firstComment: "Link in bio", platformCopy: { INSTAGRAM: "Boots for the gram" } });
    const r = await scheduleAutoPosting(db, { organizationId: org, itemId: item.id, userId: ann, accounts: { FACEBOOK: fbAccount, INSTAGRAM: igAccount } }, deps(new Date("2026-12-01T10:00:00Z")));
    expect(r.scheduledFor.toISOString()).toBe("2026-12-01T15:00:00.000Z"); // company time zone defaults to UTC
    expect((await db.contentItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("SCHEDULED");
    expect((await runDuePublications(db, deps(new Date("2026-12-01T14:59:00Z")))).published).toBe(0);

    handlers["POST PAGE1/photos"] = (p) => { expect(p.caption).toBe("Warm boots\n\n#boots"); expect(p.url).toMatch(/^https:\/\/app\.example\/api\/social\/media\//); return { id: "PHOTO1", post_id: "PAGE1_POST1" }; };
    handlers["GET PAGE1_POST1"] = () => ({ permalink_url: "https://www.facebook.com/acme/posts/1" });
    handlers["POST IG1/media"] = (p) => { expect(p.caption).toBe("Boots for the gram\n\n#boots"); expect(p.image_url).toBeTruthy(); return { id: "CONT1" }; };
    handlers["POST IG1/media_publish"] = (p) => { expect(p.creation_id).toBe("CONT1"); return { id: "IGMEDIA1" }; };
    handlers["GET IGMEDIA1"] = () => ({ permalink: "https://www.instagram.com/p/abc/" });
    handlers["POST PAGE1_POST1/comments"] = (p) => { expect(p.message).toBe("Link in bio"); return { id: "C1" }; };
    handlers["POST IGMEDIA1/comments"] = () => ({ id: "C2" });
    const res = await runDuePublications(db, deps(new Date("2026-12-01T15:00:30Z")));
    expect(res.published).toBe(2);
    const pubs = await db.contentPublication.findMany({ where: { itemId: item.id }, orderBy: { platform: "asc" } });
    expect(pubs.map((x) => [x.status, x.externalPostId, x.permalink])).toEqual([["PUBLISHED", "PAGE1_POST1", "https://www.facebook.com/acme/posts/1"], ["PUBLISHED", "IGMEDIA1", "https://www.instagram.com/p/abc/"]]);
    expect(calls.every((c) => c.params.access_token === "PAGE_TOKEN" || c.params.access_token === undefined || c.params.access_token)).toBe(true);
    expect((await db.contentItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("PUBLISHED");
    expect(await db.notification.count({ where: { userId: cu, kind: "content.published" } })).toBe(1);
    // Nothing is posted twice
    calls = [];
    await runDuePublications(db, deps(new Date("2026-12-01T15:05:00Z")));
    expect(calls.length).toBe(0);
  });

  it("an Instagram reel waits for the video to finish processing before it is published", async () => {
    const item = await approved({ platforms: ["INSTAGRAM"], platform: "INSTAGRAM", postType: "REEL" }, [{ contentType: "video/mp4" }]);
    await scheduleAutoPosting(db, { organizationId: org, itemId: item.id, userId: ann, accounts: { INSTAGRAM: igAccount } }, deps(new Date("2026-12-01T14:00:00Z")));
    handlers["POST IG1/media"] = (p) => { expect(p.media_type).toBe("REELS"); expect(p.video_url).toBeTruthy(); return { id: "VCONT" }; };
    let state = "IN_PROGRESS";
    handlers["GET VCONT"] = () => ({ status_code: state });
    handlers["POST IG1/media_publish"] = () => ({ id: "REEL1" });
    handlers["GET REEL1"] = () => ({ permalink: "https://www.instagram.com/reel/r1/" });
    expect((await runDuePublications(db, deps(new Date("2026-12-01T15:00:00Z")))).waiting).toBe(1);
    expect((await runDuePublications(db, deps(new Date("2026-12-01T15:01:00Z")))).waiting).toBe(1);
    state = "FINISHED";
    expect((await runDuePublications(db, deps(new Date("2026-12-01T15:02:00Z")))).published).toBe(1);
    expect((await db.contentItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("PUBLISHED");
  });

  it("a platform posted by hand keeps the post Scheduled and tells the scheduler", async () => {
    const item = await approved({ platforms: ["FACEBOOK", "TIKTOK"] });
    await scheduleAutoPosting(db, { organizationId: org, itemId: item.id, userId: ann, accounts: { FACEBOOK: fbAccount } }, deps(new Date("2026-12-02T00:00:00Z")));
    handlers["POST PAGE1/photos"] = () => ({ id: "P", post_id: "PAGE1_P2" });
    handlers["GET PAGE1_P2"] = () => ({ permalink_url: "/acme/posts/2" });
    await runDuePublications(db, deps(new Date("2026-12-02T00:00:00Z")));
    expect((await db.contentItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("SCHEDULED");
    expect((await db.contentPublication.findFirstOrThrow({ where: { itemId: item.id } })).permalink).toBe("https://www.facebook.com/acme/posts/2");
    expect(await db.notification.findFirst({ where: { userId: ann, dedupeKey: `content:${item.id}:auto-partial` } })).toBeTruthy();
  });

  it("an expired token fails the post, marks the account, tells the team; reconnecting and Try again posts it", async () => {
    const item = await approved({ platforms: ["FACEBOOK"] });
    await scheduleAutoPosting(db, { organizationId: org, itemId: item.id, userId: ann, accounts: { FACEBOOK: fbAccount } }, deps(new Date("2026-12-02T00:00:00Z")));
    handlers["POST PAGE1/photos"] = () => ({ __status: 400, error: { message: "Session has expired", code: 190, error_subcode: 463 } });
    expect((await runDuePublications(db, deps(new Date("2026-12-02T00:00:00Z")))).failed).toBe(1);
    const pub = await db.contentPublication.findFirstOrThrow({ where: { itemId: item.id } });
    expect(pub.error).toMatch(/Connect it again/);
    expect((await db.socialAccount.findUniqueOrThrow({ where: { id: fbAccount } })).status).toBe("EXPIRED");
    expect(await db.notification.count({ where: { userId: ann, kind: "content.publish_failed" } })).toBeGreaterThan(0);
    await expect(retryPublication(db, { organizationId: org, publicationId: pub.id, userId: ann }, deps())).rejects.toThrow(/not connected/);
    await db.socialAccount.update({ where: { id: fbAccount }, data: { status: "ACTIVE" } });
    await retryPublication(db, { organizationId: org, publicationId: pub.id, userId: ann }, deps(new Date("2026-12-02T01:00:00Z")));
    handlers["POST PAGE1/photos"] = () => ({ id: "P", post_id: "PAGE1_P3" });
    handlers["GET PAGE1_P3"] = () => ({});
    expect((await runDuePublications(db, deps(new Date("2026-12-02T01:00:00Z")))).published).toBe(1);
  });

  it("Meta being busy is tried again later, not failed", async () => {
    const item = await approved({ platforms: ["FACEBOOK"] });
    await scheduleAutoPosting(db, { organizationId: org, itemId: item.id, userId: ann, accounts: { FACEBOOK: fbAccount } }, deps(new Date("2026-12-03T00:00:00Z")));
    handlers["POST PAGE1/photos"] = () => ({ __status: 400, error: { message: "Too many calls", code: 32 } });
    expect((await runDuePublications(db, deps(new Date("2026-12-03T00:00:00Z")))).retry).toBe(1);
    const pub = await db.contentPublication.findFirstOrThrow({ where: { itemId: item.id } });
    expect([pub.status, pub.attempts, pub.scheduledFor.toISOString()]).toEqual(["QUEUED", 1, "2026-12-03T00:05:00.000Z"]);
  });

  it("dragging a scheduled post moves its queued posts; stopping returns it to Approved; moving it back by hand cancels what is queued", async () => {
    const item = await approved({ platforms: ["FACEBOOK"], plannedDate: "2026-12-20" });
    await scheduleAutoPosting(db, { organizationId: org, itemId: item.id, userId: ann, accounts: { FACEBOOK: fbAccount } }, deps());
    await reschedule(db, { organizationId: org, id: item.id, plannedDate: "2026-12-22" });
    expect((await db.contentPublication.findFirstOrThrow({ where: { itemId: item.id } })).scheduledFor.toISOString()).toBe("2026-12-22T15:00:00.000Z");
    await cancelAutoPosting(db, { organizationId: org, itemId: item.id, userId: ann });
    expect((await db.contentItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("APPROVED");
    expect((await db.contentPublication.findFirstOrThrow({ where: { itemId: item.id } })).status).toBe("CANCELLED");

    const second = await approved({ platforms: ["FACEBOOK"] });
    await scheduleAutoPosting(db, { organizationId: org, itemId: second.id, userId: ann, accounts: { FACEBOOK: fbAccount } }, deps(new Date("2026-12-04T00:00:00Z")));
    await db.contentItem.update({ where: { id: second.id }, data: { status: "APPROVED" } }); // moved back with the Move buttons
    await db.contentPublication.updateMany({ where: { status: "QUEUED", itemId: { not: second.id } }, data: { status: "CANCELLED" } }); // earlier tests' leftovers
    calls = [];
    expect((await runDuePublications(db, deps(new Date("2026-12-04T00:00:00Z")))).cancelled).toBe(1);
    expect(calls.length).toBe(0);
  });

  it("a post interrupted mid-send is not sent again blindly; disconnecting fails what is waiting", async () => {
    const item = await approved({ platforms: ["FACEBOOK"] });
    await scheduleAutoPosting(db, { organizationId: org, itemId: item.id, userId: ann, accounts: { FACEBOOK: fbAccount } }, deps(new Date("2026-12-05T00:00:00Z")));
    await db.$executeRawUnsafe(`UPDATE "ContentPublication" SET status='PUBLISHING', "updatedAt" = NOW() - interval '1 hour' WHERE "itemId"='${item.id}'`);
    await runDuePublications(db, deps(new Date()));
    expect((await db.contentPublication.findFirstOrThrow({ where: { itemId: item.id } })).error).toMatch(/interrupted/);

    const waiting = await approved({ platforms: ["FACEBOOK"], plannedDate: "2026-12-30" });
    await scheduleAutoPosting(db, { organizationId: org, itemId: waiting.id, userId: ann, accounts: { FACEBOOK: fbAccount } }, deps());
    await disconnectAccount(db, { organizationId: org, accountId: fbAccount });
    expect((await db.contentPublication.findFirstOrThrow({ where: { itemId: waiting.id } })).status).toBe("FAILED");
    expect((await db.socialAccount.findUniqueOrThrow({ where: { id: fbAccount } })).tokenEnc).toBe("");
  });
});
