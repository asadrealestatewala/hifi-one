import { NextResponse } from "next/server";
import { audit, requirePermission, toFileActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { attachVisitPhotos, MAX_PHOTOS_PER_VISIT, recordVisit, type VisitInput } from "@/lib/field-visits";
import { ProspectorError } from "@/lib/prospector";
import { defaultStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// A field agent's phone sends one visit per request: the details as form fields and up to 6 photos as files. The same request can be sent
// again after a lost connection: the visit's clientRef makes the second save a no-op and the photos are matched by their hash.
// Answers are JSON so the offline queue can tell a refusal (keep it for the agent to fix: 4xx with error and field) from a server or network
// problem (try again later: 5xx or no answer). A missing sign-in is 401, never a redirect to the login page.
const TEXT_FIELDS: (keyof VisitInput)[] = ["clientRef", "prospectId", "productId", "name", "ownerName", "phone", "country", "email", "address", "city", "outcome", "reason", "note", "followUpOn", "visitedAt", "lat", "lng", "accuracyM"];
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

export async function POST(req: Request) {
  const user = await requirePermission("field.capture", { json: true });
  if (user instanceof Response) return user;
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "The visit could not be read." }, { status: 400 }); }
  const input: VisitInput = {};
  for (const k of TEXT_FIELDS) { const v = form.get(k); if (typeof v === "string" && v !== "") (input as Record<string, unknown>)[k] = v; }
  input.differentBusiness = form.get("differentBusiness") === "1";
  const files = form.getAll("photo").filter((f): f is File => f instanceof File && f.size > 0).slice(0, MAX_PHOTOS_PER_VISIT);
  const categories = form.getAll("photoCategory").map(String);
  for (const f of files) if (f.size > MAX_PHOTO_BYTES) return NextResponse.json({ error: "A photo is larger than 6 MB. The app resizes photos before sending; try taking it again.", field: "photos" }, { status: 400 });

  try {
    const r = await recordVisit(db, user, input);
    const photos = await attachVisitPhotos(db, defaultStorage(), toFileActor(user), r.visitId, await Promise.all(files.map(async (f, i) => ({ name: f.name, bytes: Buffer.from(await f.arrayBuffer()), category: categories[i] ?? "PREMISES" }))));
    if (!r.replayed) await audit(user, { action: "field.visit", entity: "ProspectVisit", entityId: r.visitId, after: { prospectId: r.prospectId, outcome: r.outcome, created: r.created, photos: photos.saved } });
    return NextResponse.json({ ok: true, ...r, photos });
  } catch (e) {
    if (e instanceof ProspectorError) return NextResponse.json({ error: e.message, field: e.field ?? null }, { status: 409 });
    throw e;
  }
}
