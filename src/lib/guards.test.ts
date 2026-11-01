// Authorization coverage. Hiding a menu item is never protection, so this test scans the source and
// fails if any page or server action in a protected area forgets to check who is calling.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "app");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}
const files = walk(root).map((f) => f.replace(/\\/g, "/"));
const rel = (f: string) => f.slice(root.replace(/\\/g, "/").length + 1);
const read = (f: string) => fs.readFileSync(f, "utf8");

// Which guard each protected area must use
const AREAS: { prefix: string; guard: RegExp; label: string }[] = [
  { prefix: "(app)/", guard: /require(Permission|User)\(/, label: "requirePermission/requireUser" },
  { prefix: "portal/", guard: /requireClientUser\(/, label: "requireClientUser" },
  { prefix: "vendor/", guard: /requireVendorUser\(/, label: "requireVendorUser" },
  { prefix: "room/", guard: /requirePermission\(/, label: "requirePermission" },
];

// Pages that are intentionally public or only redirect
const PUBLIC = new Set(["onboarding/[token]/page.tsx", "unsubscribe/[token]/page.tsx", "login/page.tsx", "login/verify/page.tsx", "login/forgot/page.tsx", "forbidden/page.tsx", "invite/[token]/page.tsx", "setup/page.tsx", "reset/[token]/page.tsx", "join/[token]/page.tsx", "sign/[token]/page.tsx"]);

// Pages that only need a signed-in employee because they show the caller's own data and check
// record ownership or permissions themselves. Everything else in (app) must call requirePermission.
const OWN_DATA_PAGES = new Set(["(app)/account/password/page.tsx", "(app)/account/security/page.tsx", "(app)/notifications/page.tsx", "(app)/me/profile/page.tsx", "(app)/me/help/page.tsx", "(app)/me/tasks/page.tsx", "(app)/payslips/[id]/page.tsx", "(app)/expenses/[id]/page.tsx", "(app)/mail/page.tsx", "(app)/mail/[id]/page.tsx", "(app)/mail/compose/page.tsx"]);

describe("every protected page checks the caller", () => {
  const pages = files.filter((f) => f.endsWith("/page.tsx"));
  for (const f of pages) {
    const r = rel(f);
    // The public website (route group "(site)") has its own rules, checked below
    if (PUBLIC.has(r) || r.startsWith("(site)/")) continue;
    const area = AREAS.find((a) => r.startsWith(a.prefix));
    it(`${r} is guarded`, () => {
      expect(area, `${r} is outside every known area`).toBeDefined();
      const src = read(f);
      if (r.startsWith("(app)/")) {
        // The layout only proves the caller is a signed-in employee. The page itself must check a permission.
        const ok = OWN_DATA_PAGES.has(r) ? /requireUser\(/.test(src) : /requirePermission\(/.test(src);
        expect(ok, `${r} must call ${OWN_DATA_PAGES.has(r) ? "requireUser" : "requirePermission"} itself`).toBe(true);
      } else {
        expect(area!.guard.test(src), `${r} must call ${area!.label}`).toBe(true);
      }
    });
  }
});

// Split a file into server action bodies: inline ("use server" inside a function) and top-level actions files
function actionBodies(src: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const topLevel = /^\s*["']use server["'];?\s*$/m.test(src.split("\n").slice(0, 3).join("\n"));
  const fnRe = /(export\s+)?async function (\w+)\s*\([^)]*\)[^{]*\{/g;
  let m: RegExpExecArray | null;
  while ((m = fnRe.exec(src))) {
    const exported = Boolean(m[1]);
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    while (i < src.length && depth > 0) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
      i++;
    }
    const body = src.slice(start, i);
    // In a "use server" file only exported functions are reachable as actions; inline actions declare it inside the body
    if ((topLevel && exported) || /^\s*["']use server["']/.test(body)) out.push({ name: m[2], body });
  }
  return out;
}

// Pre-sign-in screens. Each is protected by something else: a password, a code, an emailed or handed-over secret token, or the one-time empty-system check.
// join/[token] is the guest entrance to a meeting: protected by the secret in the link, the host's waiting room and a rate limit.
// onboarding/[token] needs the emailed link plus the 6-digit code from it; unsubscribe/[token] a signed token. Both are rate limited.
const PUBLIC_ACTIONS = new Set(["onboarding/[token]/page.tsx", "unsubscribe/[token]/page.tsx", "login/page.tsx", "login/verify/page.tsx", "login/forgot/page.tsx", "invite/[token]/page.tsx", "setup/page.tsx", "reset/[token]/page.tsx", "join/[token]/page.tsx", "sign/[token]/page.tsx"]);

describe("every server action checks the caller", () => {
  for (const f of files.filter((x) => /\.(tsx?|ts)$/.test(x) && !x.endsWith(".test.ts"))) {
    const src = read(f);
    if (!/["']use server["']/.test(src)) continue;
    const r = rel(f);
    for (const a of actionBodies(src)) {
      // Public by design: sign-in, and accepting an emailed invitation (protected by a secret token)
      if (PUBLIC_ACTIONS.has(r)) continue;
      it(`${r} › ${a.name}`, () => {
        expect(/require(Permission|User|ClientUser|VendorUser|Session)\(|\blogout\(/.test(a.body), `${r} ${a.name} must call a require* guard`).toBe(true);
      });
    }
  }
  it("found the actions it is meant to protect", () => {
    const n = files.filter((f) => /["']use server["']/.test(read(f))).length;
    expect(n).toBeGreaterThan(20);
  });
});

describe("every route handler checks the caller", () => {
  // Public by design: the health check returns nothing but "ok"
  // The calendar feed is opened by calendar apps that cannot sign in; it is protected by a long secret address instead
  // and must resolve that secret through eventsForToken (which refuses unknown, switched-off and inactive-user tokens).
  // The desktop agent endpoints sign in with a device token instead of a browser session (see the agent test below).
  // The website's contact and apply forms are public by design: same-site, rate limited and validated (see the website tests below)
  const PUBLIC_ROUTES = new Set(["api/site/contact/route.ts", "api/site/apply/route.ts", "api/health/route.ts", "api/calendar/[token]/route.ts", "api/agent/enroll/route.ts", "api/agent/policy/route.ts", "api/agent/ingest/route.ts", "api/agent/screenshot/route.ts", "api/jobs/run/route.ts", "api/leads/capture/route.ts", "api/meetings/[id]/events/route.ts", "api/meetings/[id]/signal/route.ts", "api/meetings/[id]/chat/route.ts", "api/meetings/[id]/admin/route.ts", "api/mail/inbound/route.ts", "api/unsubscribe/route.ts"]);
  for (const f of files.filter((x) => x.endsWith("/route.ts"))) {
    const r = rel(f);
    if (PUBLIC_ROUTES.has(r)) continue;
    it(`${r} is guarded`, () => {
      expect(/require(Permission|User|ClientUser|VendorUser|Session)\(/.test(read(f)), `${r} must call a require* guard`).toBe(true);
    });
  }
});

describe("the public website", () => {
  // Route group "(site)": "/" for visitors and every page under /site. Only "/" may read the session (to send staff to the ERP);
  // every other website file is static content and must never touch the database, a session or write anything.
  const siteFiles = files.filter((x) => rel(x).startsWith("(site)/") && /\.(ts|tsx)$/.test(x));
  it("found the website pages", () => {
    expect(siteFiles.filter((x) => x.endsWith("/page.tsx")).length).toBeGreaterThan(10);
  });
  for (const f of siteFiles) {
    if (rel(f) === "(site)/page.tsx") continue;
    it(`${rel(f)} is static content, without the database or a session`, () => {
      const src = read(f);
      expect(src).not.toMatch(/@\/lib\/(db|auth|session|guards)|prisma|cookies\(|headers\(|["']use server["']/);
      expect(src).not.toMatch(/export const dynamic = "force-dynamic"/);
    });
  }
  it('"/" only decides between setup, the ERP and the website', () => {
    const src = read(path.join(root, "(site)/page.tsx"));
    expect(src).toContain("homeDestination(");
    expect(src).not.toMatch(/["']use server["']|export async function (POST|PUT|PATCH|DELETE)/);
  });
  it("the form endpoints only accept same-site, rate-limited submissions", () => {
    for (const r of ["api/site/contact/route.ts", "api/site/apply/route.ts"]) {
      const src = read(path.join(root, r));
      expect(src, r).toContain("sameSite(req)");
      expect(src, r).toMatch(/limiter\(/);
      expect(src, r).not.toMatch(/export (async )?function (GET|PUT|PATCH|DELETE)/);
    }
  });
});

describe("the secret-address calendar feed", () => {
  it("only serves what eventsForToken returns, and says nothing useful for a bad token", () => {
    const src = read(path.resolve(__dirname, "../app/api/calendar/[token]/route.ts"));
    expect(src).toContain("eventsForToken(");
    expect(src).toMatch(/status:\s*404/);
    expect(src).toContain("no-store");
  });
});

describe("the desktop agent endpoints", () => {
  it("authenticate the device (or redeem a one-time code) before doing anything", () => {
    for (const r of ["policy", "ingest", "screenshot"]) {
      const src = read(path.resolve(__dirname, `../app/api/agent/${r}/route.ts`));
      expect(src, r).toContain("deviceFrom(req)");
      expect(src, r).toMatch(/401/);
    }
    expect(read(path.resolve(__dirname, "../app/api/agent/enroll/route.ts"))).toContain("enrollDevice(");
    expect(read(path.resolve(__dirname, "../lib/agent-http.ts"))).toContain("authenticateDevice(");
  });
});

describe("the inbound mail webhook", () => {
  it("checks the Resend signature before reading anything, and fetches the email from Resend instead of trusting the request", () => {
    const src = read(path.resolve(__dirname, "../app/api/mail/inbound/route.ts"));
    expect(src).toContain("verifyWebhook(");
    expect(src).toMatch(/401/);
    expect(src.indexOf("verifyWebhook(")).toBeLessThan(src.indexOf("JSON.parse("));
    expect(src).toContain("resendFetcher(");
    expect(src).not.toMatch(/export (async )?function (GET|PUT|PATCH|DELETE)/);
  });
});

describe("the live meeting endpoints", () => {
  it("identify the caller by their participant ticket before doing anything", () => {
    for (const r of ["events", "signal", "chat", "admin"]) {
      const src = read(path.resolve(__dirname, `../app/api/meetings/[id]/${r}/route.ts`));
      expect(src, r).toContain("authenticateParticipant(");
      expect(src, r).toMatch(/404/);
    }
  });
});

describe("secrets never live in source", () => {
  const srcFiles = walk(path.resolve(__dirname, "..")).filter((f) => /\.(tsx?|json|mjs)$/.test(f) && !/\.test\./.test(f));
  it("has no hard-coded keys, tokens or passwords", () => {
    const bad = srcFiles.filter((f) => /(sk_live_|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC )?PRIVATE KEY-----|api[_-]?key\s*[:=]\s*["'][A-Za-z0-9]{16,})/i.test(read(f)));
    expect(bad).toEqual([]);
  });
  it(".env files are ignored by git and only the example is committed", () => {
    const gi = fs.readFileSync(path.resolve(__dirname, "..", "..", ".gitignore"), "utf8");
    expect(gi).toMatch(/^\.env$/m);
    expect(gi).toMatch(/^!\.env\.example$/m);
  });
});
