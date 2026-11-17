"use server";
// The Design panel on a post: AI words, an AI photo, and drawing the branded design
import { redirect } from "next/navigation";
import { audit, requirePermission, toFileActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { ContentAiError, generateImage } from "@/lib/content-ai";
import { DesignError, makeDesign, writeDesignWords } from "@/lib/design";
import { defaultStorage } from "@/lib/storage";

const back = (id: string, m: string): never => redirect(`/content/${id}?designError=${encodeURIComponent(m)}#design`);
const s = (f: FormData, k: string) => String(f.get(k) ?? "");

export async function designWords(formData: FormData) {
  const user = await requirePermission("content.manage");
  const id = s(formData, "id");
  try {
    await writeDesignWords(db, { organizationId: user.organizationId, itemId: id, actorId: user.id, note: s(formData, "designNote") });
  } catch (e) {
    if (e instanceof DesignError) back(id, e.message);
    throw e;
  }
  await audit(user, { action: "content.design_words", entity: "ContentItem", entityId: id });
  redirect(`/content/${id}?design=words#design`);
}

export async function designAiPhoto(formData: FormData) {
  const user = await requirePermission("content.manage");
  const id = s(formData, "id");
  let fileId: string;
  try {
    const f = await generateImage(db, defaultStorage(), { organizationId: user.organizationId, itemId: id, actor: toFileActor(user), note: s(formData, "designNote") });
    fileId = f.id;
  } catch (e) {
    if (e instanceof ContentAiError) back(id, e.message);
    throw e;
  }
  await audit(user, { action: "content.ai_image", entity: "ContentItem", entityId: id, after: { forDesign: true } });
  redirect(`/content/${id}?design=photo&photo=${fileId!}#design`);
}

export async function drawPostDesign(formData: FormData) {
  const user = await requirePermission("content.manage");
  const id = s(formData, "id");
  try {
    const r = await makeDesign(db, defaultStorage(), {
      actor: toFileActor(user), itemId: id,
      input: { layout: s(formData, "layout"), sizes: formData.getAll("sizes").map(String), label: s(formData, "label"), headline: s(formData, "headline"), sub: s(formData, "sub"), cta: s(formData, "cta"), photoFileId: s(formData, "photo") || null },
    });
    await audit(user, { action: "content.design", entity: "ContentItem", entityId: id, after: { layout: r.design.layout, sizes: r.design.sizes } });
  } catch (e) {
    if (e instanceof DesignError) back(id, e.message);
    throw e;
  }
  redirect(`/content/${id}?design=drawn#design`);
}
