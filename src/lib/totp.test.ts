import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, decryptSecret, encryptSecret, generateRecoveryCodes, generateSecret, hashRecoveryCode, hotp, otpauthUri, totp, verifyTotp } from "./totp";

// RFC 6238 test secret: ASCII "12345678901234567890"
const RFC = base32Encode(Buffer.from("12345678901234567890"));

describe("TOTP (RFC test vectors)", () => {
  it("matches the RFC 4226 HOTP values", () => {
    expect(RFC).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect([0, 1, 2].map((c) => hotp(RFC, c))).toEqual(["755224", "287082", "359152"]);
  });
  it("matches the RFC 6238 SHA-1 value at t=59 (last 6 digits)", () => {
    expect(totp(RFC, 59_000)).toBe("287082");
    expect(totp(RFC, 1111111109_000)).toBe("081804");
  });
  it("round-trips base32", () => {
    const b = Buffer.from([0, 1, 2, 250, 255, 128, 7]);
    expect(base32Decode(base32Encode(b))).toEqual(b);
    expect(() => base32Decode("not valid!")).toThrow();
  });
});

describe("verifyTotp", () => {
  const s = generateSecret();
  const now = 1_700_000_000_000;
  it("accepts the current code and one step of drift, nothing else", () => {
    expect(verifyTotp(s, totp(s, now), now)).not.toBeNull();
    expect(verifyTotp(s, totp(s, now - 30_000), now)).not.toBeNull();
    expect(verifyTotp(s, totp(s, now + 30_000), now)).not.toBeNull();
    expect(verifyTotp(s, totp(s, now - 90_000), now)).toBeNull();
  });
  it("rejects malformed input and wrong codes", () => {
    expect(verifyTotp(s, "12345", now)).toBeNull();
    expect(verifyTotp(s, "abcdef", now)).toBeNull();
    expect(verifyTotp(s, totp(s, now) === "000000" ? "111111" : "000000", now)).toBeNull();
  });
  it("returns the matched step so the caller can refuse a replay", () => {
    const step = verifyTotp(s, totp(s, now), now)!;
    expect(step).toBe(Math.floor(now / 30_000));
  });
});

describe("secret storage and recovery codes", () => {
  it("encrypts so the stored value is not the secret, and only the right key decrypts it", () => {
    const s = generateSecret();
    const stored = encryptSecret(s, "app-secret-1");
    expect(stored).not.toContain(s);
    expect(decryptSecret(stored, "app-secret-1")).toBe(s);
    expect(() => decryptSecret(stored, "another-secret")).toThrow();
  });
  it("makes unique, easy-to-type recovery codes and hashes them case- and dash-insensitively", () => {
    const codes = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(8);
    expect(codes[0]).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/);
    expect(hashRecoveryCode(codes[0].toUpperCase())).toBe(hashRecoveryCode(codes[0].replace(/-/g, "")));
  });
  it("builds a standard otpauth link", () => {
    expect(otpauthUri("ABC", "a@b.co")).toBe("otpauth://totp/Hifi%20One%3Aa%40b.co?secret=ABC&issuer=Hifi%20One&algorithm=SHA1&digits=6&period=30");
  });
});
