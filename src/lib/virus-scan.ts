// Virus scanning boundary. When a ClamAV daemon is configured (CLAMAV_HOST, optional CLAMAV_PORT, default 3310), every upload is streamed to it
// before anything is stored. Nothing is simulated: with no daemon the status stays UNSCANNED and screens say so. When a daemon is configured but
// cannot be reached, uploads are refused (fail closed) rather than stored unchecked. No dependencies: clamd's INSTREAM protocol over TCP.
import net from "node:net";

export type ScanResult = { status: "CLEAN" } | { status: "INFECTED"; signature: string };
export type Scanner = (bytes: Buffer) => Promise<ScanResult>;

export class ScanUnavailableError extends Error {}

export function scannerFromEnv(env: Record<string, string | undefined> = process.env): Scanner | null {
  const host = env.CLAMAV_HOST?.trim();
  if (!host) return null;
  const port = Number(env.CLAMAV_PORT) || 3310;
  return (bytes) => clamdScan(bytes, { host, port });
}

export function clamdScan(bytes: Buffer, opts: { host: string; port: number; timeoutMs?: number }): Promise<ScanResult> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: opts.host, port: opts.port });
    let reply = "";
    let settled = false;
    const done = (fn: () => void) => { if (settled) return; settled = true; sock.destroy(); fn(); };
    sock.setTimeout(opts.timeoutMs ?? 20_000, () => done(() => reject(new ScanUnavailableError("The virus scanner did not answer in time."))));
    sock.on("error", () => done(() => reject(new ScanUnavailableError("The virus scanner could not be reached."))));
    sock.on("data", (d) => { reply += d.toString("utf8"); });
    sock.on("end", () => {
      const text = reply.replace(/\0/g, "").trim();
      const found = text.match(/^stream:\s*(.+?)\s+FOUND$/);
      if (found) return done(() => resolve({ status: "INFECTED", signature: found[1] }));
      if (/^stream:\s*OK$/.test(text)) return done(() => resolve({ status: "CLEAN" }));
      done(() => reject(new ScanUnavailableError("The virus scanner gave an unexpected answer.")));
    });
    sock.on("connect", () => {
      sock.write("zINSTREAM\0");
      for (let i = 0; i < bytes.length; i += 65_536) {
        const chunk = bytes.subarray(i, i + 65_536);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(chunk.length);
        sock.write(len);
        sock.write(chunk);
      }
      sock.write(Buffer.alloc(4)); // zero-length chunk ends the stream
    });
  });
}
