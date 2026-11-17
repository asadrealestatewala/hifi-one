import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { addMedia, saveKit, setLogo } from "./brand-kit";
import type { FileActor } from "./file-access";
import { MemoryStorage } from "./storage";
import { designPhotos, makeDesign, writeDesignWords } from "./design";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const storage = new MemoryStorage();
const NOW = "2026-11-17";
let org: string, acme: string, beta: string, pm: string, item: string;
let staff: FileActor;
let photo: Buffer, logo: Buffer;
const claude = (data: object) => async () => ({ ok: true, status: 200, json: async () => ({ stop_reason: "end_turn", usage: { input_tokens: 1500, output_tokens: 200 }, content: [{ type: "text", text: JSON.stringify(data) }] }) });

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "ContentDesign","ContentAiRun","MediaItem","BrandKit","StoredFile","ContentItem","ClientContentProfile","Notification","Client","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Design Org" } })).id;
  pm = (await db.user.create({ data: { organizationId: org, email: "pm@d.test", name: "PM", passwordHash: "x" } })).id;
  acme = (await db.client.create({ data: { organizationId: org, name: "Acme", projectManagerId: pm } })).id;
  beta = (await db.client.create({ data: { organizationId: org, name: "Beta" } })).id;
  staff = { organizationId: org, vendorId: null, id: pm, userType: "EMPLOYEE", clientId: null, permissions: new Set(["content.view", "content.manage"]) };
  item = (await db.contentItem.create({ data: { organizationId: org, clientId: acme, platform: "INSTAGRAM", platforms: ["INSTAGRAM"], title: "Winter boots", copy: "Our boots are back", postType: "STATIC", createdById: pm } })).id;
  photo = await sharp({ create: { width: 900, height: 600, channels: 3, background: { r: 40, g: 120, b: 200 } } }).jpeg().toBuffer();
  logo = await sharp({ create: { width: 300, height: 100, channels: 4, background: { r: 220, g: 30, b: 60, alpha: 1 } } }).png().toBuffer();
  await saveKit(db, { organizationId: org, clientId: acme, actorId: pm, input: { colors: [{ role: "PRIMARY", hex: "#1E3A8A" }], headingFont: "Montserrat", bodyFont: "Inter", phone: "0300 1234567", website: "https://acme.pk", logoCorner: "TOP_LEFT" } });
  const l = await addMedia(db, storage, { actor: staff, clientId: acme, name: "logo.png", bytes: logo, folder: "Logos" });
  await setLogo(db, { organizationId: org, clientId: acme, mediaId: l.item.id, slot: "LOGO", actorId: pm });
}, 30000);
afterAll(async () => { await db.$disconnect(); });

describe("design words", () => {
  it("Claude's words are saved on the post's design, trimmed to the limits, and the cost is recorded", async () => {
    const r = await writeDesignWords(db, { organizationId: org, itemId: item, actorId: pm, today: NOW, apiKey: "k", fetchImpl: claude({ layout: "TIP", label: "New season", headline: "Winter boots are back in every size today for you", sub: "Warm, waterproof and made to last.", cta: "Shop now" }) });
    expect(r.design.headline.length).toBeLessThanOrEqual(60);
    expect([r.design.layout, r.design.cta, r.design.sizes]).toEqual(["TIP", "Shop now", ["PORTRAIT"]]);
    expect(await db.contentAiRun.count({ where: { itemId: item, kind: "DESIGN_WORDS" } })).toBe(1);
    await expect(writeDesignWords(db, { organizationId: org, itemId: item, actorId: pm, today: NOW, fetchImpl: claude({}) })).rejects.toThrow(/not configured/);
  });
  it("stops at the client's monthly AI limit", async () => {
    await db.clientContentProfile.create({ data: { clientId: acme, organizationId: org, monthlyCapUsd: "0.01", updatedById: pm } }).catch(async () => db.clientContentProfile.update({ where: { clientId: acme }, data: { monthlyCapUsd: "0.01" } }));
    await expect(writeDesignWords(db, { organizationId: org, itemId: item, actorId: pm, today: NOW, apiKey: "k", fetchImpl: claude({}) })).rejects.toThrow(/AI limit/);
    await db.clientContentProfile.update({ where: { clientId: acme }, data: { monthlyCapUsd: "10" } });
  });
});

describe("drawing a design", () => {
  it("draws each size as a PNG on the post with the brand logo; a redraw replaces the old files", async () => {
    const lib = await addMedia(db, storage, { actor: staff, clientId: acme, name: "boots.jpg", bytes: photo, folder: "Products" });
    const photos = await designPhotos(db, { organizationId: org, itemId: item, clientId: acme });
    expect(photos.library.map((p) => p.id)).toContain(lib.file.id);
    const r = await makeDesign(db, storage, { actor: staff, itemId: item, input: { layout: "OFFER", sizes: ["SQUARE", "STORY"], headline: "Winter boots are back", cta: "Shop now", photoFileId: lib.file.id } });
    expect(r.files.map((f) => [f.ownerType, f.ownerId, f.contentType])).toEqual([["CONTENT", item, "image/png"], ["CONTENT", item, "image/png"]]);
    const meta = await sharp(await storage.get(r.files[1].storageKey)).metadata();
    expect([meta.width, meta.height]).toEqual([1080, 1920]);
    const again = await makeDesign(db, storage, { actor: staff, itemId: item, input: { layout: "BOLD", sizes: ["SQUARE"], headline: "Winter boots are back" } });
    expect(again.design.outputFileIds).toHaveLength(1);
    expect(await db.storedFile.count({ where: { id: { in: r.files.map((f) => f.id) }, deletedAt: null } })).toBe(0);
    expect((await designPhotos(db, { organizationId: org, itemId: item, clientId: acme })).post.map((p) => p.id)).not.toContain(again.files[0].id);
  }, 60000);

  it("refuses another client's photo, a photo layout with no photo, no size, and a post with the client", async () => {
    const other = await addMedia(db, storage, { actor: staff, clientId: beta, name: "x.jpg", bytes: photo });
    await expect(makeDesign(db, storage, { actor: staff, itemId: item, input: { layout: "OFFER", sizes: ["SQUARE"], headline: "Hi", photoFileId: other.file.id } })).rejects.toThrow(/not available/);
    await expect(makeDesign(db, storage, { actor: staff, itemId: item, input: { layout: "OFFER", sizes: ["SQUARE"], headline: "Hi" } })).rejects.toThrow(/needs a photo/);
    await expect(makeDesign(db, storage, { actor: staff, itemId: item, input: { layout: "BOLD", sizes: [], headline: "Hi" } })).rejects.toThrow(/size/);
    const viewer = { ...staff, permissions: new Set(["content.view"]) };
    await expect(makeDesign(db, storage, { actor: viewer, itemId: item, input: { layout: "BOLD", sizes: ["SQUARE"], headline: "Hi" } })).rejects.toThrow();
    await db.contentItem.update({ where: { id: item }, data: { status: "CLIENT_REVIEW" } });
    await expect(makeDesign(db, storage, { actor: staff, itemId: item, input: { layout: "BOLD", sizes: ["SQUARE"], headline: "Hi" } })).rejects.toThrow(/Withdraw/);
  }, 60000);
});
