import { describe, expect, it } from "vitest";
import { IntegrationKeyError, cleanKey, seal, unseal } from "./integration-keys";

const SECRET = "x".repeat(48);
describe("integration key encryption", () => {
  it("round-trips and never stores the key in the clear", () => {
    const sealed = seal("AIzaSyExampleKey1234567890", SECRET);
    expect(sealed).not.toContain("AIzaSy");
    expect(unseal(sealed, SECRET)).toBe("AIzaSyExampleKey1234567890");
  });
  it("gives a different ciphertext each time and cannot be opened with another secret or after damage", () => {
    expect(seal("AIzaSyExampleKey1234567890", SECRET)).not.toBe(seal("AIzaSyExampleKey1234567890", SECRET));
    const sealed = seal("AIzaSyExampleKey1234567890", SECRET);
    expect(unseal(sealed, "y".repeat(48))).toBeNull();
    expect(unseal(sealed.slice(0, -3) + "AAA", SECRET)).toBeNull();
    expect(unseal("garbage", SECRET)).toBeNull();
  });
  it("refuses to store with a missing or short server secret", () => {
    expect(() => seal("AIzaSyExampleKey1234567890", "")).toThrow(IntegrationKeyError);
    expect(() => seal("AIzaSyExampleKey1234567890", "short")).toThrow(/SESSION_SECRET/);
  });
  it("accepts a pasted key with stray spaces around it and rejects junk", () => {
    expect(cleanKey("  AIzaSyExampleKey1234567890\n")).toBe("AIzaSyExampleKey1234567890");
    expect(() => cleanKey("short")).toThrow(IntegrationKeyError);
    expect(() => cleanKey("two words in a key here ok")).toThrow(/no spaces/);
    expect(() => cleanKey("a".repeat(401))).toThrow(IntegrationKeyError);
  });
});
