"use server";

import { redirect } from "next/navigation";
import { audit, requirePermission, toFileActor, type SessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { BrandError, COLOR_ROLES, LOGO_SLOTS, addMedia, applySuggestion, dismissSuggestion, removeMedia, saveKit, setLogo, suggestFromWebsite, updateMedia, type LogoSlot } from "@/lib/brand-kit";
import { defaultStorage } from "@/lib/storage";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const clientOf = (f: FormData) => { const c = s(f, "client"); return c && c !== "own" ? c : null; };
const page = (f: FormData, tab: string, q: string): never => redirect(`/content/brand?client=${encodeURIComponent(s(f, "client") || "own")}&tab=${tab}&${q}`);

async function run(user: SessionUser, f: FormData, tab: string, work: () => Promise<string>) {
  let msg: string;
  try { msg = await work(); }
  catch (e) { if (e instanceof BrandError) page(f, tab, `error=${encodeURIComponent(e.message)}`); throw e; }
  page(f, tab, `ok=${encodeURIComponent(msg)}`);
}

export async function saveKitAction(f: FormData): Promise<void> {
  const user = await requirePermission("content.manage");
  return run(user, f, "kit", async () => {
    const colors = COLOR_ROLES.filter((r) => s(f, `c_${r}_on`) === "1").map((role) => ({ role, hex: s(f, `c_${role}`) }));
    const kit = await saveKit(db, { organizationId: user.organizationId, clientId: clientOf(f), actorId: user.id, input: {
      colors, headingFont: s(f, "headingFont"), bodyFont: s(f, "bodyFont"), phone: s(f, "phone"), whatsapp: s(f, "whatsapp"), website: s(f, "website"), handle: s(f, "handle"),
      logoCorner: s(f, "logoCorner"), logoSizePct: s(f, "logoSizePct"), rules: String(f.get("rules") ?? "") } });
    await audit(user, { action: "brand.save", entity: "BrandKit", entityId: kit.id });
    return "Brand kit saved.";
  });
}

export async function uploadMediaAction(f: FormData): Promise<void> {
  const user = await requirePermission("content.manage");
  const files = f.getAll("file").filter((x): x is File => x instanceof File && x.size > 0);
  const slot = s(f, "slot") as LogoSlot | "";
  return run(user, f, slot ? "kit" : "media", async () => {
    if (!files.length) throw new BrandError("Choose a file to upload.");
    const clientId = clientOf(f);
    for (const file of files.slice(0, 10)) {
      const { item } = await addMedia(db, defaultStorage(), { actor: toFileActor(user), clientId, name: file.name, bytes: Buffer.from(await file.arrayBuffer()), folder: slot ? "Logos" : s(f, "folder"), tags: s(f, "tags"), title: s(f, "title") });
      if (slot && slot in LOGO_SLOTS) await setLogo(db, { organizationId: user.organizationId, clientId, mediaId: item.id, slot, actorId: user.id });
      await audit(user, { action: "brand.media_add", entity: "MediaItem", entityId: item.id });
    }
    return slot ? "Logo saved." : `${Math.min(files.length, 10)} file${files.length === 1 ? "" : "s"} added to the library.`;
  });
}

export async function updateMediaAction(f: FormData): Promise<void> {
  const user = await requirePermission("content.manage");
  return run(user, f, "media", async () => {
    await updateMedia(db, { organizationId: user.organizationId, id: s(f, "id"), folder: s(f, "folder"), tags: s(f, "tags"), title: s(f, "title") });
    return "Saved.";
  });
}

export async function removeMediaAction(f: FormData): Promise<void> {
  const user = await requirePermission("content.manage");
  return run(user, f, "media", async () => {
    const m = await removeMedia(db, { actor: toFileActor(user), id: s(f, "id") });
    await audit(user, { action: "brand.media_remove", entity: "MediaItem", entityId: m.id });
    return "Removed from the library.";
  });
}

export async function useAsLogoAction(f: FormData): Promise<void> {
  const user = await requirePermission("content.manage");
  return run(user, f, "media", async () => {
    await setLogo(db, { organizationId: user.organizationId, clientId: clientOf(f), mediaId: s(f, "id"), slot: s(f, "slot") as LogoSlot, actorId: user.id });
    return "Set on the brand kit.";
  });
}

export async function suggestAction(f: FormData): Promise<void> {
  const user = await requirePermission("content.manage");
  return run(user, f, "kit", async () => {
    await suggestFromWebsite(db, { organizationId: user.organizationId, clientId: clientOf(f), url: s(f, "url"), actorId: user.id });
    return "Here is what the website suggests. Tick what to use and press Apply.";
  });
}

export async function applySuggestionAction(f: FormData): Promise<void> {
  const user = await requirePermission("content.manage");
  return run(user, f, "kit", async () => {
    const r = await applySuggestion(db, defaultStorage(), { actor: toFileActor(user), clientId: clientOf(f), colors: f.has("colors"), fonts: f.has("fonts"), contact: f.has("contact"), logo: f.has("logo"), icon: f.has("icon") });
    await audit(user, { action: "brand.apply_website", entity: "BrandKit", entityId: s(f, "client") || "own" });
    return ["Applied. Check the colours below and save if you change anything.", ...r.problems].join(" ");
  });
}

export async function dismissSuggestionAction(f: FormData): Promise<void> {
  const user = await requirePermission("content.manage");
  return run(user, f, "kit", async () => { await dismissSuggestion(db, { organizationId: user.organizationId, clientId: clientOf(f) }); return "Suggestion dismissed."; });
}
