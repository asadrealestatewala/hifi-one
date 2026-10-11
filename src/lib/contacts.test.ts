import { describe, expect, it } from "vitest";
import { mapHeaders, normalizeEmail, normalizePhone, parseCsv } from "./contacts";

describe("parseCsv", () => {
  it("handles quotes, embedded commas, escaped quotes and CRLF", () => {
    const rows = parseCsv('Name,Company\r\n"Smith, John","Acme ""Best"" Ltd"\r\nAmy,Beta\r\n');
    expect(rows).toEqual([["Name", "Company"], ["Smith, John", 'Acme "Best" Ltd'], ["Amy", "Beta"]]);
  });
  it("handles newlines inside quoted fields and skips blank lines", () => {
    expect(parseCsv('a,b\n"line1\nline2",x\n\n\n')).toEqual([["a", "b"], ["line1\nline2", "x"]]);
  });
  it("detects semicolons and strips a BOM", () => {
    expect(parseCsv("﻿name;email\nAmy;amy@x.co")).toEqual([["name", "email"], ["Amy", "amy@x.co"]]);
  });
  it("keeps Urdu and Arabic text intact", () => {
    expect(parseCsv("name\nاحمد خان")[1][0]).toBe("احمد خان");
  });
});

describe("mapHeaders", () => {
  it("recognises common header names in any case", () => {
    expect(mapHeaders(["Full Name", "Business", "E-mail", "Mobile", "Notes"])).toEqual({ name: 0, company: 1, email: 2, phone: 3 });
  });
});

describe("normalizers", () => {
  it("normalises phones and rejects too-short values", () => {
    expect(normalizePhone("+92 (300) 123-4567")).toBe("+923001234567");
    expect(normalizePhone("123")).toBeNull();
  });
  it("lowercases valid emails and rejects invalid ones", () => {
    expect(normalizeEmail("  Amy@Example.COM ")).toBe("amy@example.com");
    expect(normalizeEmail("not-an-email")).toBeNull();
  });
});
