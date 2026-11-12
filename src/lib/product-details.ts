// Product details: the pitch information agents need for each SaaS product, and the link to the project whose asset library
// holds the product's brand guide, logos, videos and creatives. Free of Next.js imports so it can be tested against the database.
import type { PrismaClient } from "@prisma/client";
import { canReview } from "./field-visits";
import { ProspectorError, type Actor } from "./prospector";

type Db = PrismaClient;

const text = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max) || null;
const line = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) || null;

export type DetailsInput = { tagline?: string; description?: string; targetCustomers?: string; keyFeatures?: string; pricing?: string; demoUrl?: string; pitchNotes?: string };

async function ownProduct(db: Db, actor: Actor, productId: string, what: string) {
  if (!canReview(actor)) throw new ProspectorError(`Only a sales manager can ${what}.`);
  const row = await db.saasProduct.findFirst({ where: { id: productId, organizationId: actor.organizationId } });
  if (!row) throw new ProspectorError("That product no longer exists.");
  return row;
}

export async function saveProductDetails(db: Db, actor: Actor, productId: string, input: DetailsInput) {
  const row = await ownProduct(db, actor, productId, "change product details");
  const demoUrl = line(input.demoUrl, 300);
  if (demoUrl && !/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(demoUrl)) throw new ProspectorError("The demo link must start with http:// or https://.", "demoUrl");
  return db.saasProduct.update({
    where: { id: row.id },
    data: { tagline: line(input.tagline, 140), description: text(input.description, 4000), targetCustomers: text(input.targetCustomers, 1500), keyFeatures: text(input.keyFeatures, 4000), pricing: text(input.pricing, 2000), demoUrl, pitchNotes: text(input.pitchNotes, 4000) },
  });
}

// Creates a project named after the product (the actor manages it) and links it as the product's asset library.
export async function createAssetsProject(db: Db, actor: Actor, productId: string) {
  const row = await ownProduct(db, actor, productId, "set up brand assets");
  if (row.assetsProjectId) throw new ProspectorError("This product already has a brand assets library.");
  return db.$transaction(async (tx) => {
    const seq = await tx.numberSequence.upsert({
      where: { organizationId_key: { organizationId: actor.organizationId, key: "PRJ" } },
      create: { organizationId: actor.organizationId, key: "PRJ", next: 2 },
      update: { next: { increment: 1 } },
    });
    const project = await tx.project.create({
      data: {
        organizationId: actor.organizationId, managerId: actor.id, number: `PRJ-${String(seq.next - 1).padStart(4, "0")}`,
        name: `${row.name} brand assets`, scope: `Brand guide, logos, videos and creatives for ${row.name}.`,
        members: { create: { userId: actor.id, role: "Project Manager" } },
      },
    });
    await tx.saasProduct.update({ where: { id: row.id }, data: { assetsProjectId: project.id } });
    return project;
  });
}

// Uses a project that already exists (for example one a designer already fills) as the product's asset library.
export async function linkAssetsProject(db: Db, actor: Actor, productId: string, projectId: string | null) {
  const row = await ownProduct(db, actor, productId, "link brand assets");
  if (projectId) {
    const p = await db.project.findFirst({ where: { id: projectId, organizationId: actor.organizationId }, select: { id: true } });
    if (!p) throw new ProspectorError("Choose one of the listed projects.", "projectId");
  }
  return db.saasProduct.update({ where: { id: row.id }, data: { assetsProjectId: projectId } });
}
