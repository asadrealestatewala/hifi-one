// Pure contact helpers shared by lead capture and CSV import.
export function normalizePhone(p: string | null | undefined): string | null {
  const d = (p ?? "").replace(/[^\d+]/g, "");
  return d.length >= 6 ? d : null;
}

export function normalizeEmail(e: string | null | undefined): string | null {
  const v = (e ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

// Minimal RFC 4180 style CSV parser: quoted fields, escaped quotes, CRLF or LF, BOM, comma or semicolon.
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

const SYNONYMS: Record<string, string[]> = {
  name: ["name", "full name", "contact", "contact name", "person"],
  company: ["company", "business", "business name", "organization", "organisation"],
  email: ["email", "e-mail", "email address"],
  phone: ["phone", "mobile", "telephone", "tel", "phone number", "contact number"],
  country: ["country"],
  source: ["source"],
};

// Maps CSV headers to fields by common names. Unknown columns are kept in the raw record.
export function mapHeaders(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  headers.forEach((h, i) => {
    const key = h.trim().toLowerCase();
    for (const [field, names] of Object.entries(SYNONYMS)) if (!(field in map) && names.includes(key)) map[field] = i;
  });
  return map;
}
