import { describe, expect, it } from "vitest";
import { STARTER_FOLLOW_UPS, FOLLOW_UP_VARIABLES, SYSTEM_TEMPLATES, bodyHtml, fill, fillUrl, parseHighlights, renderEmail, safeUrl, variablesIn } from "./email-templates";

const brand = { company: "Hifi Marketing", appUrl: "https://hifimarketing.co/", address: "Lahore", phone: "+92 42 111", email: "hello@hifimarketing.co", website: "hifimarketing.co" };

describe("email renderer", () => {
  it("fills variables, leaves unknown ones blank and escapes every value, so a name can never inject markup", () => {
    expect(fill("Hi {{ First_Name }}, {{missing}}!", { first_name: "Sara" })).toBe("Hi Sara, !");
    const r = renderEmail({ content: { subject: "Hello {{name}}", heading: "Hi {{name}}", body: "Dear {{name}}" }, vars: { name: `<script>alert(1)</script>"x"` }, brand });
    expect(r.html).not.toContain("<script>alert");
    expect(r.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;&quot;x&quot;");
    expect(r.subject).toBe(`Hello <script>alert(1)</script>"x"`); // the subject is a header, not HTML
  });

  it("turns body text into paragraphs, bullets, bold and links", () => {
    const h = bodyHtml("First line\nsecond line\n\n- one\n- **two**\n\nSee https://hifimarketing.co/x.");
    expect(h).toContain("First line<br>second line");
    expect(h.match(/&#9679;/g)).toHaveLength(2);
    expect(h).toContain(">two</strong>");
    expect(h).toContain('href="https://hifimarketing.co/x"');
  });

  it("only accepts web and mail links for buttons", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html,x")).toBeNull();
    expect(safeUrl("https://a.test/x")).toBe("https://a.test/x");
    expect(safeUrl("mailto:a@b.test")).toBe("mailto:a@b.test");
    const r = renderEmail({ content: { subject: "s", heading: "h", body: "b", buttonLabel: "Go", buttonUrl: "javascript:alert(1)" }, vars: {}, brand });
    expect(r.html).not.toContain("javascript:");
  });

  it("encodes variables inside a link but keeps a variable that is the whole address", () => {
    expect(fillUrl("mailto:{{owner_email}}?subject=About {{service}}", { owner_email: "bilal@hifi.test", service: "Ads & SEO" })).toBe("mailto:bilal@hifi.test?subject=About%20Ads%20%26%20SEO");
    expect(fillUrl("{{website}}", { website: "https://hifimarketing.co" })).toBe("https://hifimarketing.co");
  });

  it("builds an email-client-safe layout with the logo, a plain-text twin and an unsubscribe link when asked", () => {
    const r = renderEmail({ content: { subject: "s", heading: "Welcome", body: "Body", highlights: "A | one\nB | two\nC | three\nD | four" }, vars: {}, brand, unsubscribeUrl: "https://hifimarketing.co/unsubscribe/t" });
    expect(r.html).toContain('src="https://hifimarketing.co/logo.png"');
    expect(r.html).toContain('class="container" width="600"');
    expect(r.html).toContain("@media only screen and (max-width:620px)");
    expect(r.html).toContain("/unsubscribe/t");
    expect(r.html).not.toMatch(/<script|<link /i);
    expect(r.text).toContain("Unsubscribe: https://hifimarketing.co/unsubscribe/t");
    expect(parseHighlights("A | one\nB | two\nC | three\nD | four")).toHaveLength(3);
  });

  it("shows the code box, details card and progress of built-in templates, and leaves out empty detail rows", () => {
    const def = SYSTEM_TEMPLATES.find((t) => t.key === "onboarding_code")!;
    const r = renderEmail({ content: def.defaults, vars: def.variables, brand, blocks: def.blocks, buttonUrl: def.variables.link });
    expect(r.html).toContain("Your verification code");
    expect(r.text).toContain("Your verification code: 482913");
    expect(r.html).toContain("25%");
    const task = SYSTEM_TEMPLATES.find((t) => t.key === "task_assigned")!;
    const t = renderEmail({ content: task.defaults, vars: { ...task.variables, project: "" }, brand, blocks: task.blocks });
    expect(t.text).toContain("Task: Call back Acme");
    expect(t.text).not.toContain("Project:");
  });

  it("every built-in and starter template uses only variables it declares", () => {
    for (const t of SYSTEM_TEMPLATES) {
      const text = Object.values(t.defaults).filter(Boolean).join("\n") + (t.blocks?.details ?? []).map((d) => d[1]).join("\n");
      for (const v of variablesIn(text)) expect([...Object.keys(t.variables), "company_name"], `${t.key} uses {{${v}}}`).toContain(v);
    }
    for (const s of STARTER_FOLLOW_UPS) {
      for (const v of variablesIn(Object.values(s.content).filter(Boolean).join("\n"))) expect(Object.keys(FOLLOW_UP_VARIABLES), `${s.key} uses {{${v}}}`).toContain(v);
    }
    expect(STARTER_FOLLOW_UPS.map((s) => s.delayDays)).toEqual([0, 2, 5, 10]);
  });
});
