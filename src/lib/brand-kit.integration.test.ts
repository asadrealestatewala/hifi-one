import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { addMedia, applySuggestion, listMedia, postCreatives, removeMedia, saveKit, setLogo, suggestFromWebsite, getKit } from "./brand-kit";
import { authorizeOwner, type FileActor } from "./file-access";
import { MemoryStorage } from "./storage";
import type { FetchedPage } from "./safe-fetch";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const storage = new MemoryStorage();
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
let org: string, acme: string, beta: string, pm: string;
let staff: FileActor, viewer: FileActor, acmeUser: FileActor, betaUser: FileActor;

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "MediaItem","BrandKit","StoredFile","ContentItem","Notification","Client","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Brand Org" } })).id;
  const mk = (e: string, extra = {}) => db.user.create({ data: { organizationId: org, email: e, name: e, passwordHash: "x", ...extra } }).then((u) => u.id);
  pm = await mk("pm@b.test");
  acme = (await db.client.create({ data: { organizationId: org, name: "Acme", projectManagerId: pm } })).id;
  beta = (await db.client.create({ data: { organizationId: org, name: "Beta" } })).id;
  const au = await mk("a@acme.test", { userType: "CLIENT", clientId: acme }), bu = await mk("b@beta.test", { userType: "CLIENT", clientId: beta });
  const base = { organizationId: org, vendorId: null };
  staff = { ...base, id: pm, userType: "EMPLOYEE", clientId: null, permissions: new Set(["content.view", "content.manage"]) };
  viewer = { ...base, id: pm, userType: "EMPLOYEE", clientId: null, permissions: new Set(["content.view"]) };
  acmeUser = { ...base, id: au, userType: "CLIENT", clientId: acme, permissions: new Set() };
  betaUser = { ...base, id: bu, userType: "CLIENT", clientId: beta, permissions: new Set() };
});
afterAll(async () => { await db.$disconnect(); });

describe("brand kit", () => {
  it("saves colours, fonts from the list, contact strip and logo rules; refuses a font not in the list or a bad size", async () => {
    const k = await saveKit(db, { organizationId: org, clientId: acme, actorId: pm, input: { colors: [{ role: "PRIMARY", hex: "#e11d48" }], headingFont: "Poppins", bodyFont: "Inter", handle: "acme", logoCorner: "BOTTOM_LEFT", logoSizePct: 12 } });
    expect([k.ownerKey, k.handle, k.logoCorner, k.colors]).toEqual([acme, "@acme", "BOTTOM_LEFT", [{ role: "PRIMARY", hex: "#E11D48" }]]);
    await expect(saveKit(db, { organizationId: org, clientId: acme, actorId: pm, input: { headingFont: "Comic Sans" } })).rejects.toThrow(/from the list/);
    await expect(saveKit(db, { organizationId: org, clientId: acme, actorId: pm, input: { logoSizePct: 80 } })).rejects.toThrow(/between 6%/);
    const own = await saveKit(db, { organizationId: org, clientId: null, actorId: pm, input: {} });
    expect(own.ownerKey).toBe("OWN");
  });
});

describe("media library", () => {
  it("staff and the client add images; another client, a viewer, or a non-image is refused; the PM hears about client uploads", async () => {
    await addMedia(db, storage, { actor: staff, clientId: acme, name: "boots.png", bytes: PNG, folder: "Products", tags: "Winter, #boots" });
    const byClient = await addMedia(db, storage, { actor: acmeUser, clientId: acme, name: "logo.png", bytes: PNG, folder: "Logos" });
    expect(byClient.item.byClient).toBe(true);
    expect(await db.notification.count({ where: { userId: pm, kind: "brand.upload" } })).toBe(1);
    await expect(addMedia(db, storage, { actor: betaUser, clientId: acme, name: "x.png", bytes: PNG })).rejects.toThrow();
    await expect(addMedia(db, storage, { actor: viewer, clientId: acme, name: "x.png", bytes: PNG })).rejects.toThrow(/cannot add/);
    await expect(addMedia(db, storage, { actor: staff, clientId: acme, name: "brief.pdf", bytes: Buffer.from("%PDF-1.4\n%%EOF") })).rejects.toThrow(/Only images/);
    expect((await listMedia(db, { organizationId: org, clientId: acme, q: "boots" })).map((m) => m.tags)).toEqual([["winter", "boots"]]);
    expect(await listMedia(db, { organizationId: org, clientId: beta })).toEqual([]);
  });

  it("files follow the brand: the client reads theirs, not another client's; only staff remove what others added", async () => {
    expect(await authorizeOwner(db, acmeUser, "BRAND", acme, "read")).toBe(true);
    expect(await authorizeOwner(db, betaUser, "BRAND", acme, "read")).toBe(false);
    expect(await authorizeOwner(db, acmeUser, "BRAND", "OWN", "read")).toBe(false);
    expect(await authorizeOwner(db, acmeUser, "BRAND", acme, "delete")).toBe(false);
    const staffItem = (await listMedia(db, { organizationId: org, clientId: acme, folder: "Products" }))[0];
    await expect(removeMedia(db, { actor: acmeUser, id: staffItem.id })).rejects.toThrow();
  });

  it("a library image becomes the logo; removing it clears the kit", async () => {
    const logo = (await listMedia(db, { organizationId: org, clientId: acme, folder: "Logos" }))[0];
    expect((await setLogo(db, { organizationId: org, clientId: acme, mediaId: logo.id, slot: "LOGO", actorId: pm })).logoFileId).toBe(logo.fileId);
    await expect(setLogo(db, { organizationId: org, clientId: beta, mediaId: logo.id, slot: "LOGO", actorId: pm })).rejects.toThrow(/this client's library/);
    await removeMedia(db, { actor: staff, id: logo.id });
    expect((await getKit(db, org, acme))?.logoFileId).toBeNull();
  });

  it("images already on the client's posts show as post creatives", async () => {
    const item = await db.contentItem.create({ data: { organizationId: org, clientId: acme, platform: "INSTAGRAM", title: "Boots", copy: "x", createdById: pm } });
    await db.storedFile.create({ data: { organizationId: org, ownerType: "CONTENT", ownerId: item.id, filename: "ai.png", contentType: "image/png", size: 1, sha256: "x", storageKey: "2026/11/" + "a".repeat(32), uploadedById: pm } });
    expect((await postCreatives(db, { organizationId: org, clientId: acme })).map((c) => c.post.title)).toEqual(["Boots"]);
    expect(await postCreatives(db, { organizationId: org, clientId: beta })).toEqual([]);
  });
});

describe("fill from website", () => {
  const page = (u: string, body: string | Buffer, type = "text/html"): FetchedPage => ({ finalUrl: u, status: 200, html: String(body), truncated: false, redirects: 0, bytes: Buffer.isBuffer(body) ? body : Buffer.from(body), contentType: type });
  const fetcher = async (u: string) => {
    if (u === "https://beta.pk") return page(u, `<meta name="theme-color" content="#7C3AED"><link rel="stylesheet" href="/site.css"><link rel="stylesheet" href="https://cdn.other.com/x.css"><img id="logo" src="/logo.png"><a href="https://wa.me/923001112223">wa</a>`);
    if (u === "https://beta.pk/site.css") return page(u, "h1{font-family:'Montserrat'} .b{background:#F59E0B}", "text/css");
    if (u === "https://beta.pk/logo.png") return page(u, PNG, "image/png");
    throw new Error(`unexpected fetch ${u}`);
  };
  it("suggests, then applies colours, fonts, contact and downloads the logo into the library", async () => {
    const s = await suggestFromWebsite(db, { organizationId: org, clientId: beta, url: "beta.pk", actorId: pm, fetcher });
    expect([s.colors.slice(0, 2), s.fonts, s.logoUrl, s.whatsapp]).toEqual([["#7C3AED", "#F59E0B"], ["Montserrat"], "https://beta.pk/logo.png", "+923001112223"]);
    expect((await getKit(db, org, beta))?.colors).toEqual([]); // nothing applied yet
    const r = await applySuggestion(db, storage, { actor: staff, clientId: beta, colors: true, fonts: true, contact: true, logo: true, icon: false, fetcher });
    expect(r.problems).toEqual([]);
    const kit = await getKit(db, org, beta);
    expect([kit?.colors, kit?.headingFont, kit?.whatsapp, kit?.suggestion]).toEqual([[{ role: "PRIMARY", hex: "#7C3AED" }, { role: "SECONDARY", hex: "#F59E0B" }], "Montserrat", "+923001112223", null]);
    const logos = await listMedia(db, { organizationId: org, clientId: beta, folder: "Logos" });
    expect(logos[0].fileId).toBe(kit?.logoFileId);
  });
});
