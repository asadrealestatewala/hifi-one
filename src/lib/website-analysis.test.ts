import { describe, expect, it } from "vitest";
import { analyzeHtml, hasContactForm, hasMetaDescription, hasTitle } from "./website-analysis";

const page = (head = "", body = "") => `<html><head>${head}</head><body>${body}<p>${"We are a friendly dental clinic in Lahore offering check ups and whitening. ".repeat(5)}</p></body></html>`;

describe("title and description", () => {
  it("needs real text", () => {
    expect(hasTitle("<title> Smile Dental </title>")).toBe(true);
    expect(hasTitle("<title>   </title>")).toBe(false);
    expect(hasTitle("<h1>no title tag</h1>")).toBe(false);
    expect(hasMetaDescription('<meta name="description" content="We fix teeth">')).toBe(true);
    expect(hasMetaDescription("<meta content='We fix teeth' name='Description'>")).toBe(true);
    expect(hasMetaDescription('<meta name="description" content="">')).toBe(false);
    expect(hasMetaDescription('<meta property="og:description" content="x">')).toBe(false);
  });
});

describe("analytics and pixel", () => {
  it("finds Google Analytics in its usual forms, and Tag Manager", () => {
    expect(analyzeHtml(page('<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABCDE12345"></script>'), "https://a.test").hasAnalytics).toBe(true);
    expect(analyzeHtml(page("<script>gtag('config', 'G-ABCDE12345');</script>"), "https://a.test").hasAnalytics).toBe(true);
    expect(analyzeHtml(page("<script>ga('create', 'UA-1234567-1', 'auto');</script>"), "https://a.test").hasAnalytics).toBe(true);
    const gtm = analyzeHtml(page("<script src='https://www.googletagmanager.com/gtm.js?id=GTM-ABC1234'></script>"), "https://a.test");
    expect(gtm).toMatchObject({ hasAnalytics: true, hasGtm: true, viaTagManager: true });
  });
  it("reports no analytics when there is none, and ignores a tag that is only in a comment", () => {
    expect(analyzeHtml(page(), "https://a.test")).toMatchObject({ hasAnalytics: false, hasGtm: false, hasMetaPixel: false });
    expect(analyzeHtml(page("<!-- <script src='https://www.googletagmanager.com/gtag/js?id=G-ABCDE12345'></script> -->"), "https://a.test").hasAnalytics).toBe(false);
  });
  it("finds the Meta Pixel", () => {
    expect(analyzeHtml(page("<script src='https://connect.facebook.net/en_US/fbevents.js'></script>"), "https://a.test").hasMetaPixel).toBe(true);
    expect(analyzeHtml(page("<script>fbq('init', '123456789');</script>"), "https://a.test").hasMetaPixel).toBe(true);
    expect(analyzeHtml(page("<a href='https://facebook.com/smile'>Facebook</a>"), "https://a.test").hasMetaPixel).toBe(false);
  });
});

describe("contact forms and WhatsApp", () => {
  it("counts a form that collects a way to reach someone", () => {
    expect(hasContactForm('<form action="/send"><input name="name"><input type="email" name="e"><textarea name="m"></textarea><button>Send</button></form>')).toBe(true);
    expect(hasContactForm('<form><input name="phone"><button>Call me</button></form>')).toBe(true);
    expect(hasContactForm('<form><textarea></textarea></form>')).toBe(true);
  });
  it("does not count search boxes or sign-in forms", () => {
    expect(hasContactForm('<form role="search"><input type="text" name="q"></form>')).toBe(false);
    expect(hasContactForm('<form class="search-form" action="/"><input type="text" name="s"></form>')).toBe(false);
    expect(hasContactForm('<form action="/login"><input type="email"><input type="password"></form>')).toBe(false);
    expect(hasContactForm("<p>no forms here</p>")).toBe(false);
  });
  it("counts forms built by form tools and plugins", () => {
    expect(hasContactForm('<script src="https://js.hsforms.net/forms/embed/v2.js"></script>')).toBe(true);
    expect(hasContactForm('<div class="wpcf7"><form class="wpcf7-form"></form></div>')).toBe(true);
    expect(hasContactForm('<iframe src="https://form.jotform.com/12345"></iframe>')).toBe(true);
  });
  it("finds WhatsApp links only when they are links", () => {
    expect(analyzeHtml(page("", '<a href="https://wa.me/923001234567">Chat</a>'), "https://a.test").hasWhatsapp).toBe(true);
    expect(analyzeHtml(page("", '<a href="https://api.whatsapp.com/send?phone=92300">Chat</a>'), "https://a.test").hasWhatsapp).toBe(true);
    expect(analyzeHtml(page("", "<p>Message us on WhatsApp</p>"), "https://a.test").hasWhatsapp).toBe(false);
  });
});

describe("https and confidence", () => {
  it("reads https from where the site ended up", () => {
    expect(analyzeHtml(page(), "https://a.test/").https).toBe(true);
    expect(analyzeHtml(page(), "http://a.test/").https).toBe(false);
  });
  it("warns when the page is built in the browser", () => {
    const spa = '<html><body><div id="root"></div><script src="a.js"></script><script src="b.js"></script><script src="c.js"></script></body></html>';
    expect(analyzeHtml(spa, "https://a.test").lowConfidence).toBe(true);
    expect(analyzeHtml(page(), "https://a.test").lowConfidence).toBe(false);
  });
});
