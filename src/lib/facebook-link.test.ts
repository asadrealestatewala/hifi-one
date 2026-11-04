import { describe, expect, it } from "vitest";
import { findFacebookUrl, normalizeFacebookUrl } from "./facebook-link";

describe("checking a Facebook page address", () => {
  it("accepts page addresses in their usual forms and gives one canonical form", () => {
    expect(normalizeFacebookUrl("https://www.facebook.com/SmileDental")).toBe("https://www.facebook.com/SmileDental");
    expect(normalizeFacebookUrl("facebook.com/smile.dental/")).toBe("https://www.facebook.com/smile.dental");
    expect(normalizeFacebookUrl("http://m.facebook.com/smile.dental?ref=page_internal")).toBe("https://www.facebook.com/smile.dental");
    expect(normalizeFacebookUrl("https://fb.com/smiledental/posts/123")).toBe("https://www.facebook.com/smiledental");
    expect(normalizeFacebookUrl("https://www.facebook.com/profile.php?id=100012345678901")).toBe("https://www.facebook.com/profile.php?id=100012345678901");
    expect(normalizeFacebookUrl("https://www.facebook.com/p/Smile-Dental-100012345678901/")).toBe("https://www.facebook.com/p/Smile-Dental-100012345678901");
  });
  it("refuses share buttons, plugins, groups, events and other things that are not a business page", () => {
    for (const u of ["https://www.facebook.com/sharer/sharer.php?u=x", "https://www.facebook.com/sharer.php", "https://www.facebook.com/plugins/like.php", "https://www.facebook.com/groups/123", "https://www.facebook.com/events/123", "https://www.facebook.com/tr?id=1", "https://www.facebook.com/", "https://www.facebook.com/profile.php", "https://www.facebook.com/profile.php?id=abc", "https://www.facebook.com/watch/?v=1", "https://www.facebook.com/ab"]) expect(normalizeFacebookUrl(u), u).toBeNull();
  });
  it("refuses other sites, look-alike hosts, other schemes, logins, odd ports and junk", () => {
    for (const u of ["https://notfacebook.com/smile", "https://facebook.com.evil.example/smile", "https://evil.example/facebook.com/smile", "javascript:alert(1)", "ftp://facebook.com/smile", "https://user:pw@facebook.com/smile", "https://facebook.com:8443/smile", "", "   ", "x".repeat(400)]) expect(normalizeFacebookUrl(u), u).toBeNull();
  });
});

describe("finding the business's own page on a home page", () => {
  const a = (href: string) => `<a href="${href}">x</a>`;
  it("takes a linked business page", () => {
    expect(findFacebookUrl(`<footer>${a("https://www.facebook.com/SmileDental")}${a("https://instagram.com/smile")}</footer>`)).toBe("https://www.facebook.com/SmileDental");
  });
  it("ignores share buttons, comments, scripts and the pixel", () => {
    const html = `<!-- ${a("https://facebook.com/commented")} --><script>fbq('init','1'); var u="https://facebook.com/inscript"</script><img src="https://www.facebook.com/tr?id=1">${a("https://www.facebook.com/sharer/sharer.php?u=x")}`;
    expect(findFacebookUrl(html)).toBeNull();
  });
  it("prefers the page linked most often, else the first", () => {
    expect(findFacebookUrl(a("https://facebook.com/first") + a("https://facebook.com/second") + a("https://www.facebook.com/second/"))).toBe("https://www.facebook.com/second");
    expect(findFacebookUrl(a("https://facebook.com/first") + a("https://facebook.com/second"))).toBe("https://www.facebook.com/first");
  });
  it("copes with single quotes, unquoted attributes and encoded ampersands", () => {
    expect(findFacebookUrl(`<a class=x href='https://facebook.com/quoted'>`)).toBe("https://www.facebook.com/quoted");
    expect(findFacebookUrl(`<a href=https://facebook.com/bare>`)).toBe("https://www.facebook.com/bare");
    expect(findFacebookUrl(`<a href="https://www.facebook.com/profile.php?id=100012345678901&amp;ref=x">`)).toBe("https://www.facebook.com/profile.php?id=100012345678901");
  });
  it("returns nothing for a page with no Facebook link", () => {
    expect(findFacebookUrl("<p>Follow us</p>")).toBeNull();
    expect(findFacebookUrl("")).toBeNull();
  });
});
