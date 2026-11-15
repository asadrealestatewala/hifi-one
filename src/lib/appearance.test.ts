import { describe, expect, it } from "vitest";
import { APPEARANCE_SCRIPT, BACKGROUNDS, DEFAULT_BACKGROUND, isBackground } from "./appearance";

// Runs the head script against a fake document and storage, the way the browser would before first paint.
function run(store: Record<string, string>, prefersDark = false) {
  const dataset: Record<string, string> = {};
  const fn = new Function("document", "localStorage", "matchMedia", APPEARANCE_SCRIPT);
  fn({ documentElement: { dataset } }, { getItem: (k: string) => store[k] ?? null }, () => ({ matches: prefersDark }));
  return dataset;
}

describe("appearance settings", () => {
  it("offers cream as the default and four other backgrounds", () => {
    expect(DEFAULT_BACKGROUND).toBe("cream");
    expect(BACKGROUNDS.map((b) => b.key)).toEqual(["cream", "grey", "lavender", "slate", "sage"]);
  });

  it("recognises only listed backgrounds", () => {
    expect(isBackground("grey")).toBe(true);
    expect(isBackground("purple")).toBe(false);
    expect(isBackground(null)).toBe(false);
  });

  it("applies a saved background, theme and density before first paint", () => {
    expect(run({ "hifi.bg": "lavender", "hifi.theme": "dark", "hifi.density": "compact" })).toEqual({ bg: "lavender", theme: "dark", density: "compact" });
  });

  it("leaves the default cream unset and ignores unknown or tampered values", () => {
    expect(run({ "hifi.bg": "cream" })).toEqual({});
    expect(run({ "hifi.bg": "red;background:url(x)" })).toEqual({});
  });

  it("follows the system dark setting when no theme is saved", () => {
    expect(run({}, true)).toEqual({ theme: "dark" });
  });
});
