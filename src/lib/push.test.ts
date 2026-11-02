import { describe, expect, it } from "vitest";
import { isExpoPushToken } from "./push";

describe("push tokens", () => {
  it("accepts Expo push tokens only", () => {
    expect(isExpoPushToken("ExponentPushToken[abc123_XYZ-9]")).toBe(true);
    expect(isExpoPushToken("ExpoPushToken[abc123_XYZ-9]")).toBe(true);
    for (const bad of ["", "abc", "ExponentPushToken[]", "ExponentPushToken[a b c d e f]", "https://evil.example/x", "fcm:APA91b..."]) expect(isExpoPushToken(bad), bad).toBe(false);
  });
});
