import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { publish } from "@/lib/meeting-hub";
import { json } from "@/lib/meeting-http";
import { MAX_CHUNK_BYTES, RecordingError, addChunk, startRecording, stopRecording } from "@/lib/recordings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The host's browser starts, feeds and stops the recording. Signed-in staff only, with the recordings permission, and only the meeting's host.
// POST {action:"start"|"stop", recordingId?} controls it; PUT ?rid=&seq= with the raw bytes adds the next piece.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("meetings.recordings");
  const { id } = await params;
  const b = (await req.json().catch(() => ({}))) as { action?: string; recordingId?: string };
  try {
    if (b.action === "start") {
      const r = await startRecording(db, { organizationId: user.organizationId, meetingId: id, userId: user.id });
      await audit(user, { action: "meeting.recording_start", entity: "Meeting", entityId: id, after: { recordingId: r.id } });
      publish(id, "recording", { on: true });
      return json({ recordingId: r.id });
    }
    if (b.action === "stop" && b.recordingId) {
      const r = await stopRecording(db, { organizationId: user.organizationId, meetingId: id, recordingId: b.recordingId, userId: user.id });
      await audit(user, { action: "meeting.recording_stop", entity: "Meeting", entityId: id, after: { recordingId: r.id, status: r.status, size: r.size, seconds: r.durationSec } });
      publish(id, "recording", { on: false });
      return json({ status: r.status });
    }
    return json({ error: "Bad request" }, 400);
  } catch (e) {
    if (e instanceof RecordingError) return json({ error: e.message }, 400);
    throw e;
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("meetings.recordings");
  const { id } = await params;
  const url = new URL(req.url);
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_CHUNK_BYTES) return json({ error: "Piece too large" }, 413);
  try {
    const bytes = Buffer.from(await req.arrayBuffer());
    const r = await addChunk(db, { organizationId: user.organizationId, meetingId: id, recordingId: url.searchParams.get("rid") ?? "", userId: user.id, seq: Number(url.searchParams.get("seq")), bytes });
    return json(r);
  } catch (e) {
    if (e instanceof RecordingError) return json({ error: e.message }, 400);
    throw e;
  }
}
