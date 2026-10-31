// The company website's contact form. It is part of this app, so it needs no public key: it posts to /api/site/contact, and
// the lead is captured through a built-in lead source that is created on first use and then managed like any other form
// under Settings > Lead capture (assignment, campaign, switching it off). Free of Next.js imports so it can be tested.
import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { CaptureError, captureForSource, newKey } from "./lead-capture";

export const WEBSITE_SOURCE_NAME = "Company website (contact form)";

const cut = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// The organization that owns the website. Hifi One runs one company per installation: the first organization created.
export async function websiteOrganizationId(db: PrismaClient): Promise<string | null> {
  const org = await db.organization.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  return org?.id ?? null;
}

export async function websiteLeadSource(db: PrismaClient, organizationId: string) {
  const existing = await db.leadSource.findUnique({ where: { organizationId_name: { organizationId, name: WEBSITE_SOURCE_NAME } } });
  if (existing) return existing;
  // Nobody ever needs this key (the website posts without one), so only an unguessable hash is stored. Unassigned leads
  // notify everyone who can see all leads until someone sets up round robin on the lead capture screen.
  const keyHash = crypto.createHash("sha256").update(newKey()).digest("hex");
  return db.leadSource.upsert({
    where: { organizationId_name: { organizationId, name: WEBSITE_SOURCE_NAME } },
    update: {},
    create: { organizationId, name: WEBSITE_SOURCE_NAME, keyHash, assignMode: "NONE", assigneeIds: [] },
  });
}

export type ContactInput = Record<string, unknown>;

export async function submitContact(db: PrismaClient, input: ContactInput, now = new Date()) {
  const message = cut(input.message, 2000);
  const topic = cut(input.topic, 80);
  const plan = cut(input.plan, 80);
  if (!cut(input.name, 120)) throw new CaptureError("Enter your name.", 400, "name");
  if (!cut(input.email, 200)) throw new CaptureError("Enter your email address so we can reply.", 400, "email");
  if (message.length < 5) throw new CaptureError("Tell us a little about what you need.", 400, "message");
  const org = await websiteOrganizationId(db);
  if (!org) throw new CaptureError("Not available right now.", 503);
  const source = await websiteLeadSource(db, org);
  const prefix = [topic && `Topic: ${topic}`, plan && `Plan: ${plan}`].filter(Boolean).join(" · ");
  return captureForSource(db, { source, now, input: { ...input, message: prefix ? `${prefix}\n\n${message}` : message, landing_url: input.page_url } });
}
