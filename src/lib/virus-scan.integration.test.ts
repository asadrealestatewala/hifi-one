// The virus-scan boundary, against a small fake clamd that speaks the real INSTREAM protocol, and the file service wired to it.
import net from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { FileError, saveFile } from "./files";
import { MemoryStorage } from "./storage";
import { clamdScan, scannerFromEnv } from "./virus-scan";
import type { FileActor } from "./file-access";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const storage = new MemoryStorage();
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

// A fake daemon: reads "zINSTREAM", length-prefixed chunks and the zero terminator, then answers like clamd does
function fakeClamd(): Promise<{ port: number; close: () => void }> {
  const server = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      const head = "zINSTREAM\0";
      if (buf.length < head.length || buf.subarray(0, head.length).toString() !== head) return;
      let off = head.length;
      const parts: Buffer[] = [];
      for (;;) {
        if (buf.length < off + 4) return;
        const len = buf.readUInt32BE(off);
        off += 4;
        if (len === 0) break;
        if (buf.length < off + len) return;
        parts.push(buf.subarray(off, off + len));
        off += len;
      }
      const body = Buffer.concat(parts).toString("latin1");
      sock.end(body.includes(EICAR) ? "stream: Win.Test.EICAR_HDB-1 FOUND\0" : "stream: OK\0");
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ port: (server.address() as net.AddressInfo).port, close: () => server.close() })));
}

let daemon: Awaited<ReturnType<typeof fakeClamd>>;
let org: string, vendor: string;
const pdf = (extra = "") => Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(40, 1), Buffer.from(extra)]);
const actor = (): FileActor => ({ id: "u", organizationId: org, userType: "EMPLOYEE", clientId: null, vendorId: null, permissions: new Set(["vendors.manage"]) });

beforeAll(async () => {
  daemon = await fakeClamd();
  await db.$executeRawUnsafe('TRUNCATE "StoredFile","Vendor","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Scan Org" } })).id;
  vendor = (await db.vendor.create({ data: { organizationId: org, code: "V-9", name: "Scan Vendor" } })).id;
});
afterAll(async () => { daemon.close(); await db.$disconnect(); });

describe("clamd client", () => {
  it("reports clean and infected content, including content larger than one chunk", async () => {
    expect(await clamdScan(pdf(), { host: "127.0.0.1", port: daemon.port })).toEqual({ status: "CLEAN" });
    expect(await clamdScan(Buffer.from(EICAR), { host: "127.0.0.1", port: daemon.port })).toEqual({ status: "INFECTED", signature: "Win.Test.EICAR_HDB-1" });
    expect(await clamdScan(Buffer.concat([Buffer.alloc(200_000, 65), Buffer.from(EICAR)]), { host: "127.0.0.1", port: daemon.port })).toMatchObject({ status: "INFECTED" });
  });
  it("fails when the daemon cannot be reached", async () => {
    await expect(clamdScan(pdf(), { host: "127.0.0.1", port: 1, timeoutMs: 500 })).rejects.toThrow(/could not be reached/);
  });
  it("is off unless a host is configured", () => {
    expect(scannerFromEnv({})).toBeNull();
    expect(scannerFromEnv({ CLAMAV_HOST: "  " })).toBeNull();
    expect(scannerFromEnv({ CLAMAV_HOST: "clam.internal" })).toBeTypeOf("function");
  });
});

describe("file service with a scanner", () => {
  const save = (bytes: Buffer, scanner: Parameters<typeof saveFile>[2]["scanner"]) => saveFile(db, storage, { actor: actor(), ownerType: "VENDOR_DOC", ownerId: vendor, name: "doc.pdf", bytes, scanner });
  const scanner = (port: number) => (b: Buffer) => clamdScan(b, { host: "127.0.0.1", port, timeoutMs: 500 });

  it("stores a clean file marked CLEAN", async () => {
    expect((await save(pdf("a"), scanner(daemon.port))).scanStatus).toBe("CLEAN");
  });
  it("stores nothing for an infected file", async () => {
    const before = await db.storedFile.count();
    await expect(save(pdf(EICAR), scanner(daemon.port))).rejects.toThrow(/blocked/);
    expect(await db.storedFile.count()).toBe(before);
  });
  it("refuses the file when the scanner is configured but down", async () => {
    const before = await db.storedFile.count();
    await expect(save(pdf("b"), scanner(1))).rejects.toThrow(FileError);
    expect(await db.storedFile.count()).toBe(before);
  });
  it("saves as UNSCANNED when no scanner is configured, never claiming otherwise", async () => {
    expect((await save(pdf("c"), null)).scanStatus).toBe("UNSCANNED");
  });
});
