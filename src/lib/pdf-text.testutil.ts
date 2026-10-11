// Reads the text out of an uncompressed PDF made by pdfkit (standard fonts write text as hex strings)
export function pdfPlainText(buf: Buffer): string {
  const s = buf.toString("latin1");
  const out: string[] = [];
  for (const m of s.matchAll(/\[((?:[^\]])*?)\]\s*TJ|<([0-9a-fA-F]+)>\s*Tj/g)) {
    const part = m[1] ?? `<${m[2]}>`;
    const text = [...part.matchAll(/<([0-9a-fA-F]+)>/g)].map((h) => Buffer.from(h[1], "hex").toString("latin1")).join("");
    out.push(text);
  }
  return out.join("\n");
}

