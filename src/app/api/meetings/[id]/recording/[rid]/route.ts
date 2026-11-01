import fs from "node:fs";
import { Readable } from "node:stream";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { recordingFile } from "@/lib/recordings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Download one finished recording. A recording you may not open looks exactly like one that does not exist.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; rid: string }> }) {
  const user = await requirePermission("meetings.recordings");
  const { id, rid } = await params;
  const found = await recordingFile(db, { organizationId: user.organizationId, meetingId: id, recordingId: rid });
  if (!found) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  await audit(user, { action: "meeting.recording_download", entity: "Meeting", entityId: id, after: { recordingId: rid } });
  const body = Readable.toWeb(fs.createReadStream(found.file)) as unknown as ReadableStream;
  return new Response(body, { headers: { "content-type": "video/webm", "content-length": String(found.recording.size), "content-disposition": `attachment; filename="meeting-${id.slice(0, 8)}-${found.recording.startedAt.toISOString().slice(0, 10)}.webm"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
}
