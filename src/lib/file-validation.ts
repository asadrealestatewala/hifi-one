// Upload validation. The server decides what a file is by looking inside it. The extension must agree with the
// contents, and anything that could run in a browser (html, svg, scripts) or on a computer (exe, bat) is refused.
export class FileError extends Error {}

export const MAX_BYTES = 15 * 1024 * 1024;

type Rule = { type: string; check: (b: Buffer) => boolean };
const startsWith = (b: Buffer, hex: string, offset = 0) => b.subarray(offset, offset + hex.length / 2).toString("hex").toLowerCase() === hex;

const zip = (b: Buffer) => startsWith(b, "504b0304");
// Plain text: valid UTF-8, no NUL bytes, no control characters other than tab, newline, carriage return
const text = (b: Buffer) => {
  if (b.includes(0)) return false;
  for (const byte of b.subarray(0, 100_000)) if (byte < 9 || (byte > 13 && byte < 32)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(b.subarray(0, 100_000 - (b.length > 100_000 ? 3 : 0)));
    return true;
  } catch {
    return b.length > 100_000; // a multi-byte character may be cut at the 100 KB boundary
  }
};

const RULES: Record<string, Rule> = {
  pdf: { type: "application/pdf", check: (b) => startsWith(b, "255044462d") },
  png: { type: "image/png", check: (b) => startsWith(b, "89504e470d0a1a0a") },
  jpg: { type: "image/jpeg", check: (b) => startsWith(b, "ffd8ff") },
  jpeg: { type: "image/jpeg", check: (b) => startsWith(b, "ffd8ff") },
  gif: { type: "image/gif", check: (b) => startsWith(b, "47494638") },
  webp: { type: "image/webp", check: (b) => startsWith(b, "52494646") && startsWith(b, "57454250", 8) },
  mp4: { type: "video/mp4", check: (b) => startsWith(b, "66747970", 4) },
  docx: { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", check: zip },
  xlsx: { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", check: zip },
  csv: { type: "text/csv", check: text },
  txt: { type: "text/plain", check: text },
};

export const ALLOWED_EXTENSIONS = Object.keys(RULES);

// Display names are cleaned for the screen and for the Content-Disposition header. They never touch the file system.
export function safeName(name: string): string {
  const base = name.replace(/[\\/]+/g, "/").split("/").pop() ?? "file";
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|?*:;]/g, "_").replace(/^\.+/, "").trim().slice(0, 120);
  return cleaned || "file";
}

export function validateUpload(name: string, buffer: Buffer): { contentType: string; filename: string } {
  const filename = safeName(name);
  if (buffer.length === 0) throw new FileError("The file is empty.");
  if (buffer.length > MAX_BYTES) throw new FileError(`The file is too large (limit ${Math.round(MAX_BYTES / 1024 / 1024)} MB).`);
  const ext = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
  const rule = RULES[ext];
  if (!rule) throw new FileError(`This file type is not allowed. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}.`);
  // Programs and scripts are refused even when renamed
  if (startsWith(buffer, "4d5a") || startsWith(buffer, "7f454c46") || startsWith(buffer, "2321") || startsWith(buffer, "cafebabe")) throw new FileError("Program files are not allowed.");
  if (!rule.check(buffer)) throw new FileError(`The contents do not match a .${ext} file.`);
  // Office files are zip containers; refuse macro-enabled or script content hidden inside
  if (zip(buffer) && /vbaProject\.bin|\.js\b|\.vbs\b/i.test(buffer.toString("latin1", 0, Math.min(buffer.length, 2_000_000)))) throw new FileError("Files with macros or scripts are not allowed.");
  return { contentType: rule.type, filename };
}
