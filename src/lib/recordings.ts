// Meeting recordings. The host's browser records the call (everyone's audio plus the video tiles on the host's screen) and uploads it
// in ordered pieces while it runs, so a closed tab loses at most the last few seconds. The pieces are appended to one file on the
// server's disk (not the object-storage interface, which cannot append). Rules:
//  - only the meeting's host, and only while the meeting is live, can start or add to a recording;
//  - everyone in the call is told (the room shows a recording banner) and each start and stop is audited by the route;
//  - a piece must arrive in order; a repeated piece is acknowledged without writing it twice;
//  - the file is capped, and the recording is closed when the meeting ends.
import fs from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";

export class RecordingError extends Error {}
type Db = PrismaClient;

export const MAX_CHUNK_BYTES = 16 * 1024 * 1024;
export const MAX_RECORDING_BYTES = 1_500_000_000;

export const recordingsRoot = () => path.resolve(process.env.STORAGE_DIR ?? path.resolve(process.cwd(), ".data", "files"), "recordings");
const idOk = (id: string) => /^[a-z0-9]{20,40}$/.test(id);
export const recordingPath = (id: string, root = recordingsRoot()) => {
  if (!idOk(id)) throw new RecordingError("Recording not found.");
  return path.join(root, `${id}.webm`);
};

export async function startRecording(db: Db, p: { organizationId: string; meetingId: string; userId: string }) {
  const m = await db.meeting.findFirst({ where: { id: p.meetingId, organizationId: p.organizationId } });
  if (!m) throw new RecordingError("Meeting not found.");
  if (m.hostId !== p.userId) throw new RecordingError("Only the host can record the meeting.");
  if (m.status !== "LIVE") throw new RecordingError("A meeting can only be recorded while it is live.");
  const running = await db.meetingRecording.findFirst({ where: { meetingId: m.id, status: "RECORDING" } });
  if (running) throw new RecordingError("This meeting is already being recorded.");
  return db.meetingRecording.create({ data: { organizationId: p.organizationId, meetingId: m.id, startedById: p.userId } });
}

export async function addChunk(db: Db, p: { organizationId: string; meetingId: string; recordingId: string; userId: string; seq: number; bytes: Buffer; root?: string }) {
  if (!Number.isInteger(p.seq) || p.seq < 0) throw new RecordingError("Bad piece number.");
  if (p.bytes.length === 0 || p.bytes.length > MAX_CHUNK_BYTES) throw new RecordingError("Bad piece size.");
  const r = await db.meetingRecording.findFirst({ where: { id: p.recordingId, meetingId: p.meetingId, organizationId: p.organizationId, startedById: p.userId } });
  if (!r) throw new RecordingError("Recording not found.");
  if (r.status !== "RECORDING") throw new RecordingError("This recording has stopped.");
  if (p.seq < r.chunks) return { chunks: r.chunks, size: r.size, duplicate: true };
  if (p.seq > r.chunks) throw new RecordingError(`Piece ${r.chunks} is missing.`);
  if (r.size + p.bytes.length > MAX_RECORDING_BYTES) throw new RecordingError("This recording reached the size limit. Stop it and start a new one.");
  const m = await db.meeting.findUnique({ where: { id: p.meetingId }, select: { status: true } });
  if (m?.status !== "LIVE") throw new RecordingError("The meeting is not live.");
  const file = recordingPath(r.id, p.root);
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Claim the piece number first so two uploads of the same piece cannot both append
  const claimed = await db.meetingRecording.updateMany({ where: { id: r.id, chunks: p.seq, status: "RECORDING" }, data: { chunks: { increment: 1 }, size: { increment: p.bytes.length } } });
  if (claimed.count === 0) return { chunks: r.chunks, size: r.size, duplicate: true };
  await fs.appendFile(file, p.bytes);
  return { chunks: p.seq + 1, size: r.size + p.bytes.length, duplicate: false };
}

// Close a recording. With nothing uploaded it is marked failed, so nobody is offered an empty file.
export async function stopRecording(db: Db, p: { organizationId: string; meetingId: string; recordingId: string; userId?: string; root?: string }) {
  const r = await db.meetingRecording.findFirst({ where: { id: p.recordingId, meetingId: p.meetingId, organizationId: p.organizationId, ...(p.userId ? { startedById: p.userId } : {}) } });
  if (!r) throw new RecordingError("Recording not found.");
  if (r.status !== "RECORDING") return r;
  const now = new Date();
  const ok = r.chunks > 0;
  const done = await db.meetingRecording.update({ where: { id: r.id }, data: { status: ok ? "READY" : "FAILED", stoppedAt: now, durationSec: Math.max(0, Math.round((now.getTime() - r.startedAt.getTime()) / 1000)) } });
  if (!ok) await fs.rm(recordingPath(r.id, p.root), { force: true });
  return done;
}

// The meeting ended: close whatever was still recording.
export async function closeForMeeting(db: Db, meetingId: string, root?: string) {
  const open = await db.meetingRecording.findMany({ where: { meetingId, status: "RECORDING" } });
  for (const r of open) await stopRecording(db, { organizationId: r.organizationId, meetingId, recordingId: r.id, root });
  return open.length;
}

export const isRecording = async (db: Db, meetingId: string) => (await db.meetingRecording.count({ where: { meetingId, status: "RECORDING" } })) > 0;

export async function recordingFile(db: Db, p: { organizationId: string; meetingId: string; recordingId: string; root?: string }) {
  const r = await db.meetingRecording.findFirst({ where: { id: p.recordingId, meetingId: p.meetingId, organizationId: p.organizationId, status: "READY" } });
  if (!r) return null;
  const file = recordingPath(r.id, p.root);
  try { await fs.stat(file); } catch { return null; }
  return { recording: r, file };
}

export async function deleteRecording(db: Db, p: { organizationId: string; meetingId: string; recordingId: string; root?: string }) {
  const r = await db.meetingRecording.findFirst({ where: { id: p.recordingId, meetingId: p.meetingId, organizationId: p.organizationId } });
  if (!r) throw new RecordingError("Recording not found.");
  if (r.status === "RECORDING") throw new RecordingError("Stop the recording first.");
  await fs.rm(recordingPath(r.id, p.root), { force: true });
  await db.meetingRecording.delete({ where: { id: r.id } });
}
