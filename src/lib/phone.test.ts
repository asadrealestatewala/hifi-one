import { describe, expect, it } from "vitest";
import { CALLING_CODES, callingCodeOptions, countryOptions, isCountry, normalizeE164, phoneProblem, phoneTail } from "./phone";

describe("phone numbers to international format", () => {
  it("turns every common Pakistani way of writing a mobile into +92", () => {
    for (const raw of ["0300 1234567", "300-1234567", "92 300 1234567", "+92 (300) 1234567", "0092 300 1234567", "03001234567"]) expect(normalizeE164(raw, "PK")).toBe("+923001234567");
  });
  it("handles a Lahore landline and keeps an international number as given", () => {
    expect(normalizeE164("042 3578 1234", "PK")).toBe("+924235781234");
    expect(normalizeE164("+44 20 7946 0958", "PK")).toBe("+442079460958");
  });
  it("works for other countries and refuses what it cannot anchor", () => {
    expect(normalizeE164("(415) 555-2671", "US")).toBe("+14155552671");
    expect(normalizeE164("020 7946 0958", "GB")).toBe("+442079460958");
    expect(normalizeE164("0300 1234567", "ZZ")).toBeNull();
    expect(normalizeE164("12", "PK")).toBeNull();
    expect(normalizeE164("", "PK")).toBeNull();
    expect(normalizeE164(null, "PK")).toBeNull();
  });
  it("recognises the same number typed locally or internationally", () => {
    expect(phoneTail("0300-1234567")).toBe(phoneTail("+92 300 1234567"));
    expect(phoneTail("12345")).toBeNull();
  });
  it("offers every country, with Pakistan present", () => {
    const all = countryOptions();
    expect(all.length).toBeGreaterThan(200);
    expect(all.find((c) => c.code === "PK")?.name).toBe("Pakistan");
    expect(isCountry("PK")).toBe(true);
    expect(isCountry("pk")).toBe(false);
    expect(isCountry("XX")).toBe(false);
  });
});

describe("why a number was refused", () => {
  it("is silent for a number that works and for an empty box", () => {
    expect(phoneProblem("0300 1234567", "PK")).toBeNull();
    expect(phoneProblem("", "PK")).toBeNull();
  });
  it("says what is wrong in words a salesperson can act on", () => {
    expect(phoneProblem("0300 123", "PK")).toMatch(/too short for Pakistan.*9 to 10 digits.*0300 1234567/);
    expect(phoneProblem("0300 123456789", "PK")).toMatch(/too long for Pakistan/);
    expect(phoneProblem("0300 12345ab", "PK")).toMatch(/digits only/);
    expect(phoneProblem("0300 1234567", "ZZ")).toMatch(/country code/);
    expect(phoneProblem("+92 12", "PK")).toMatch(/international number/);
  });
  it("lists only countries it can read a local number for, with the dial code in the label", () => {
    const all = callingCodeOptions();
    expect(all.find((c) => c.code === "PK")).toMatchObject({ dial: "+92", label: "Pakistan (+92)" });
    expect(all.every((c) => c.code in CALLING_CODES)).toBe(true);
  });
});
