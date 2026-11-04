import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { postScope } from "@/lib/clout";
import { postsCsv, snapshotsCsv } from "@/lib/clout-views";
import { PLATFORMS, POST_STATUSES } from "@/lib/clout-rules";
import { csvDownload } from "@/lib/ledger-csv";
import { audit } from "@/lib/auth";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

// Posts or saved snapshots as CSV, for the whole scope the person can see or for one campaign. Same permission and scope as the screen.
export async function GET(req: Request) {
  const user = await requirePermission("clout.view");
  const q = new URL(req.url).searchParams;
  const id = /^[A-Za-z0-9_-]{1,40}$/;
  const and: Prisma.CloutPostWhereInput[] = [postScope(user)];
  const cc = q.get("cc"); if (cc && id.test(cc)) and.push({ cloutCampaignId: cc });
  const campaign = q.get("campaign"); if (campaign && id.test(campaign)) and.push({ cloutCampaignId: campaign });
  const influencer = q.get("influencer"); if (influencer && id.test(influencer)) and.push({ influencerId: influencer });
  const platform = q.get("platform"); if (platform && (PLATFORMS as readonly string[]).includes(platform)) and.push({ platform });
  const status = q.get("status"); if (status && (POST_STATUSES as readonly string[]).includes(status)) and.push({ status });
  const text = (q.get("q") ?? "").trim().slice(0, 100);
  if (text) and.push({ OR: [{ caption: { contains: text, mode: "insensitive" } }, { authorHandle: { contains: text, mode: "insensitive" } }, { url: { contains: text, mode: "insensitive" } }, { influencer: { name: { contains: text, mode: "insensitive" } } }, { trackingCode: { contains: text, mode: "insensitive" } }] });
  const where: Prisma.CloutPostWhereInput = { AND: and };
  const kind = q.get("kind") === "snapshots" ? "snapshots" : "posts";
  await audit(user, { action: `clout.export.${kind}`, entity: "CloutPost", after: { campaign: cc ?? campaign ?? null } });
  const day = new Date().toISOString().slice(0, 10);
  return csvDownload(kind === "posts" ? await postsCsv(db, where) : await snapshotsCsv(db, where), `clout-${kind}-${day}`);
}
