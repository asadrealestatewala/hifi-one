// The /setup token is optional: which token, if any, first-run setup checks.
import { describe, expect, it } from "vitest";
import { setupTokenToCheck } from "./bootstrap";

describe("setup token", () => {
  it("is never checked outside production", () => {
    expect(setupTokenToCheck({ isProd: false, configured: "a-long-random-setup-token", entered: "wrong" })).toBeUndefined();
  });
  it("is not needed when the server has no SETUP_TOKEN", () => {
    expect(setupTokenToCheck({ isProd: true, configured: undefined, entered: "" })).toBeUndefined();
    expect(setupTokenToCheck({ isProd: true, configured: "   ", entered: "anything" })).toBeUndefined();
  });
  it("is not needed when the field is left blank, even if SETUP_TOKEN is set", () => {
    expect(setupTokenToCheck({ isProd: true, configured: "a-long-random-setup-token", entered: "" })).toBeUndefined();
    expect(setupTokenToCheck({ isProd: true, configured: "a-long-random-setup-token", entered: "  " })).toBeUndefined();
  });
  it("is checked when SETUP_TOKEN is set and a value is entered", () => {
    expect(setupTokenToCheck({ isProd: true, configured: "a-long-random-setup-token", entered: "wrong" })).toBe("a-long-random-setup-token");
  });
});
