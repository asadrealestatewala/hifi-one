import { describe, expect, it } from "vitest";
import { captionFor, captionIssues, cleanPlatformCopy, countHashtags } from "./content-rules";
import { cleanTags, mergeTags } from "./content-hashtags";
import { redoPrompt, roomFor } from "./content-ai";

describe("captions per platform", () => {
  const item = { copy: "Main words", hashtags: "#a #b", platformCopy: { X: "Short for X", MYSPACE: "dropped", LINKEDIN: "  " }, platforms: ["INSTAGRAM", "X"] };
  it("keeps only known platforms with text", () => { expect(cleanPlatformCopy(item.platformCopy)).toEqual({ X: "Short for X" }); expect(cleanPlatformCopy(null)).toEqual({}); expect(cleanPlatformCopy([1])).toEqual({}); });
  it("uses the platform's own caption, else the main one, with hashtags after a blank line", () => {
    expect(captionFor(item, "X")).toBe("Short for X\n\n#a #b");
    expect(captionFor(item, "INSTAGRAM")).toBe("Main words\n\n#a #b");
    expect(captionFor({ copy: "Hi", hashtags: null }, "FACEBOOK")).toBe("Hi");
  });
  it("flags captions over a platform's limit and too many hashtags", () => {
    expect(captionIssues(item)).toEqual([]);
    const long = { ...item, platformCopy: {}, copy: "x".repeat(300) };
    expect(captionIssues(long).map((i) => i.platform)).toEqual(["X"]);
    const tags = { copy: "Hi", hashtags: Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" "), platforms: ["INSTAGRAM"] };
    expect(captionIssues(tags)[0].message).toMatch(/31 hashtags/);
    expect(countHashtags("a #one b#not #two")).toBe(2);
  });
  it("leaves room for hashtags when asking AI for a platform caption", () => { expect(roomFor("X")).toBe(220); expect(roomFor("INSTAGRAM")).toBe(1900); expect(roomFor("FACEBOOK")).toBe(1900); });
});

describe("hashtag groups", () => {
  it("cleans, de-duplicates and caps tags", () => {
    expect(cleanTags("#Shoes, shoes ##Run lahore! #شوز")).toBe("#Shoes #Run #lahore #شوز");
    expect(cleanTags(Array.from({ length: 40 }, (_, i) => `t${i}`).join(" ")).split(" ")).toHaveLength(30);
    expect(mergeTags("#a #b", "#B #c")).toBe("#a #b #c");
    expect(mergeTags(null, "x")).toBe("#x");
  });
});

describe("redo prompt", () => {
  const item = { title: "Winter sale", copy: "Old caption", hashtags: "#a", brief: "Show boots", postType: "STATIC", platforms: ["INSTAGRAM", "X"], plannedDate: "2026-12-10" };
  const base = { note: "make it funnier", clientName: "Acme", profile: null, item, recentTitles: ["Summer sale"] };
  it("asks for the right change and carries the note", () => {
    expect(redoPrompt({ ...base, mode: "CAPTION" })).toMatch(/same idea/);
    expect(redoPrompt({ ...base, mode: "CAPTION" })).toContain("make it funnier");
    const idea = redoPrompt({ ...base, mode: "IDEA" });
    expect(idea).toMatch(/completely different idea/); expect(idea).toContain("Summer sale");
    expect(redoPrompt({ ...base, mode: "PLATFORMS" })).toMatch(/X \(X \(Twitter\), at most 220/);
  });
});
