import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { RecordingError, addChunk, closeForMeeting, deleteRecording, isRecording, recordingFile, recordingPath, startRecording, stopRecording } from "./recordings";
import { createMeeting } from "./meetings";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, host: string, guest: string, meeting: string, root: string;
const bytes = (s: string) => Buffer.from(s);

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "rec-"));
  await db.$executeRawUnsafe('TRUNCATE "MeetingRecording","MeetingParticipant","Meeting","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Rec Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other" } })).id;
  host = (await db.user.create({ data: { organizationId: org, email: "h@r.test", name: "Host", passwordHash: "x" } })).id;
  guest = (await db.user.create({ data: { organizationId: org, email: "g@r.test", name: "Colleague", passwordHash: "x" } })).id;
  meeting = (await createMeeting(db, { organizationId: org, hostId: host, title: "Weekly progress", purpose: "TEAM" })).id;
});
afterAll(async () => { await db.$disconnect(); await fs.rm(root, { recursive: true, force: true }); });

describe("starting", () => {
  it("needs a live meeting and the host, and only one recording at a time", async () => {
    await expect(startRecording(db, { organizationId: org, meetingId: meeting, userId: host })).rejects.toThrow(/live/);
    await db.meeting.update({ where: { id: meeting }, data: { status: "LIVE" } });
    await expect(startRecording(db, { organizationId: org, meetingId: meeting, userId: guest })).rejects.toThrow(/host/);
    await expect(startRecording(db, { organizationId: other, meetingId: meeting, userId: host })).rejects.toThrow(/not found/);
    const r = await startRecording(db, { organizationId: org, meetingId: meeting, userId: host });
    expect(await isRecording(db, meeting)).toBe(true);
    await expect(startRecording(db, { organizationId: org, meetingId: meeting, userId: host })).rejects.toThrow(/already/);
    await stopRecording(db, { organizationId: org, meetingId: meeting, recordingId: r.id, userId: host, root });
  });
});

describe("uploading in pieces", () => {
  it("appends in order, ignores a repeated piece, refuses gaps, and only the starter can add", async () => {
    const r = await startRecording(db, { organizationId: org, meetingId: meeting, userId: host });
    const add = (seq: number, b: string, userId = host, orgId = org) => addChunk(db, { organizationId: orgId, meetingId: meeting, recordingId: r.id, userId, seq, bytes: bytes(b), root });
    expect(await add(0, "AAA")).toMatchObject({ chunks: 1, size: 3, duplicate: false });
    expect(await add(0, "AAA")).toMatchObject({ chunks: 1, size: 3, duplicate: true });
    await expect(add(2, "CCC")).rejects.toThrow(/missing/);
    expect(await add(1, "BB")).toMatchObject({ chunks: 2, size: 5 });
    await expect(add(2, "x", guest)).rejects.toThrow(/not found/);
    await expect(add(2, "x", host, other)).rejects.toThrow(/not found/);
    await expect(addChunk(db, { organizationId: org, meetingId: meeting, recordingId: r.id, userId: host, seq: 2, bytes: Buffer.alloc(0), root })).rejects.toThrow(/size/);
    expect((await fs.readFile(recordingPath(r.id, root))).toString()).toBe("AAABB");
    const done = await stopRecording(db, { organizationId: org, meetingId: meeting, recordingId: r.id, userId: host, root });
    expect(done).toMatchObject({ status: "READY", chunks: 2, size: 5 });
    await expect(add(2, "late")).rejects.toThrow(/stopped/);
  });
  it("a recording that got nothing is marked failed and offers no file", async () => {
    const r = await startRecording(db, { organizationId: org, meetingId: meeting, userId: host });
    expect((await stopRecording(db, { organizationId: org, meetingId: meeting, recordingId: r.id, userId: host, root })).status).toBe("FAILED");
    expect(await recordingFile(db, { organizationId: org, meetingId: meeting, recordingId: r.id, root })).toBeNull();
  });
  it("two uploads of the same piece at once write it once", async () => {
    const r = await startRecording(db, { organizationId: org, meetingId: meeting, userId: host });
    await Promise.all([1, 2, 3].map(() => addChunk(db, { organizationId: org, meetingId: meeting, recordingId: r.id, userId: host, seq: 0, bytes: bytes("ZZ"), root })));
    expect((await fs.readFile(recordingPath(r.id, root))).toString()).toBe("ZZ");
    await stopRecording(db, { organizationId: org, meetingId: meeting, recordingId: r.id, userId: host, root });
  });
});

describe("finished recordings", () => {
  it("are only opened for the right organization and meeting, and ending the meeting closes a running one", async () => {
    const ready = await db.meetingRecording.findFirstOrThrow({ where: { meetingId: meeting, status: "READY", chunks: 2 } });
    expect(await recordingFile(db, { organizationId: org, meetingId: meeting, recordingId: ready.id, root })).not.toBeNull();
    expect(await recordingFile(db, { organizationId: other, meetingId: meeting, recordingId: ready.id, root })).toBeNull();
    expect(await recordingFile(db, { organizationId: org, meetingId: "nope", recordingId: ready.id, root })).toBeNull();
    expect(() => recordingPath("../../etc/passwd", root)).toThrow(RecordingError);
    const running = await startRecording(db, { organizationId: org, meetingId: meeting, userId: host });
    await addChunk(db, { organizationId: org, meetingId: meeting, recordingId: running.id, userId: host, seq: 0, bytes: bytes("Q"), root });
    expect(await closeForMeeting(db, meeting, root)).toBe(1);
    expect((await db.meetingRecording.findUniqueOrThrow({ where: { id: running.id } })).status).toBe("READY");
    expect(await isRecording(db, meeting)).toBe(false);
  });
  it("can be deleted, which removes the file", async () => {
    const ready = await db.meetingRecording.findFirstOrThrow({ where: { meetingId: meeting, status: "READY", chunks: 2 } });
    await expect(deleteRecording(db, { organizationId: other, meetingId: meeting, recordingId: ready.id, root })).rejects.toThrow(/not found/);
    await deleteRecording(db, { organizationId: org, meetingId: meeting, recordingId: ready.id, root });
    await expect(fs.stat(recordingPath(ready.id, root))).rejects.toThrow();
  });
});
