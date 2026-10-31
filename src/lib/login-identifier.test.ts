import { describe, expect, it } from "vitest";
import { parseLoginIdentifier } from "./login-identifier";
import { normalizeCnic, normalizeStaffPhone } from "./staff";

describe("sign-in identifier", () => {
  it("lower-cases emails", () => {
    expect(parseLoginIdentifier("  Asad@Example.COM ")).toEqual({ kind: "email", value: "asad@example.com" });
  });
  it("finds the same phone account however the number is typed", () => {
    for (const raw of ["+923007654321", "+92 300 7654321", "0092-300-7654321", "03007654321", "(+92) 300-765-4321"]) {
      expect(parseLoginIdentifier(raw)).toEqual({ kind: "phone", value: "+923007654321" });
    }
  });
  it("refuses junk instead of guessing", () => {
    for (const raw of ["", "   ", "abc", "12345", "3007654321", "not@valid"]) expect(parseLoginIdentifier(raw)).toBeNull();
  });
});

describe("staff normalisers", () => {
  it("requires a country code unless the number is a local 0-prefixed one", () => {
    expect(normalizeStaffPhone("03001112223")).toBe("+923001112223");
    expect(normalizeStaffPhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizeStaffPhone("")).toBeNull();
    expect(() => normalizeStaffPhone("3001112223")).toThrow(/country code/);
  });
  it("formats a 13-digit CNIC and rejects a wrong length", () => {
    expect(normalizeCnic("1234512345671")).toBe("12345-1234567-1");
    expect(normalizeCnic("12345-1234567-1")).toBe("12345-1234567-1");
    expect(() => normalizeCnic("1234512")).toThrow(/13 digits/);
    expect(normalizeCnic(" ")).toBeNull();
  });
});
