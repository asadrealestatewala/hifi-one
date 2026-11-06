import { describe, expect, it } from "vitest";
import { detectSheet, phonesIn, sortLinks } from "./prospect-import";
import { normalizeE164 } from "./phone";

describe("reading the columns of a hand-made sheet", () => {
  it("finds the header and matches columns by their usual names", () => {
    const rows = [
      ["Sr. No.", "Name of Business", "Contact", "Website Link", "Google Map Link", "Status", "Remarks"],
      ["5 Nov 11/5/2026"],
      ["1", "Alpha Estate", "3001234567", "Dont have website", "https://maps.app.goo.gl/aaa", "Warm Lead", "Message sent"],
    ];
    const s = detectSheet(rows);
    expect(s.headerRow).toBe(0);
    expect(s.map).toEqual({ name: 1, phone: 2, website: 3, maps: 4, status: 5, notes: 6 });
  });
  it("takes an unnamed column full of Maps links as the Maps column", () => {
    const rows = [
      ["Sr. No.", "Name of Business", "Contact no.", "Website Link", "", "Remarks"],
      ["1", "A", "3001230001", "", "https://maps.app.goo.gl/1", ""],
      ["2", "B", "3001230002", "", "https://maps.app.goo.gl/2", ""],
      ["3", "C", "3001230003", "", "", ""],
    ];
    expect(detectSheet(rows).map).toMatchObject({ name: 1, phone: 2, website: 3, maps: 4, notes: 5 });
  });
  it("skips lines above the header", () => {
    expect(detectSheet([[""], ["Leads"], ["Business", "Phone"], ["X", "0300 1234567"]]).headerRow).toBe(2);
  });
});

describe("phone cells", () => {
  it("reads numbers typed as a bare number, with a leading 0, dashes or a country code, as Pakistan numbers", () => {
    for (const raw of ["3359275375", "03359275375", "0335-9275375", "  0339-1377777", "+92 335 9275375", "0092 335 9275375", "923359275375"]) {
      expect(normalizeE164(phonesIn(raw)[0], "PK"), raw).toMatch(/^\+923\d{9}$/);
    }
  });
  it("leaves a link written beside the number out of it", () => {
    expect(phonesIn("            03183003332                      https://maps.app.goo.gl/mR7rVZMAaRMbT2dr")).toEqual(["03183003332"]);
  });
  it("returns every number when a cell holds two", () => {
    expect(phonesIn("0300 1234567 / 0321 7654321")).toEqual(["0300 1234567", "0321 7654321"]);
  });
  it("finds nothing in words", () => {
    expect(phonesIn("Dont have whatsapp")).toEqual([]);
  });
});

describe("links in a cell", () => {
  it("ignores the words and sorts the links", () => {
    expect(sortLinks("Dont have website")).toEqual({ website: null, maps: null, facebook: null, other: [] });
    expect(sortLinks(" Dont have a website    https://maps.app.goo.gl/UoxS")).toMatchObject({ website: null, maps: "https://maps.app.goo.gl/UoxS" });
    expect(sortLinks("http://bahriatownnuvo.com/")).toMatchObject({ website: "http://bahriatownnuvo.com" });
    expect(sortLinks("https://www.facebook.com/khanzadapropertyexchange")).toMatchObject({ website: null, facebook: "https://www.facebook.com/khanzadapropertyexchange" });
  });
  it("does not take a YouTube channel for the business website", () => {
    const l = sortLinks("https://www.youtube.com/channel/UCbnBsR_XWpY3jG2a0yPQBxw");
    expect(l.website).toBeNull();
    expect(l.other).toHaveLength(1);
  });
  it("takes a bare domain as a website", () => {
    expect(sortLinks("makkaan.com").website).toBe("https://makkaan.com");
  });
});
