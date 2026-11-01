import { describe, expect, it } from "vitest";
import { mailDomain, staffMailDomain } from "./mailboxes";

describe("mail domains", () => {
  it("defaults both to the company domain", () => {
    expect(mailDomain({})).toBe("hifimarketing.co");
    expect(staffMailDomain({})).toBe("hifimarketing.co");
  });
  it("staff domain follows MAIL_DOMAIN when STAFF_MAIL_DOMAIN is not set", () => {
    expect(staffMailDomain({ MAIL_DOMAIN: "Example.com" })).toBe("example.com");
  });
  it("staff domain can differ from the shared domain", () => {
    const env = { MAIL_DOMAIN: "hifimarketing.co", STAFF_MAIL_DOMAIN: "Mail.HifiMarketing.co" };
    expect(mailDomain(env)).toBe("hifimarketing.co");
    expect(staffMailDomain(env)).toBe("mail.hifimarketing.co");
  });
});
