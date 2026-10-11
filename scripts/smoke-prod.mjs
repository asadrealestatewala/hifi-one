// A quick check of a running instance's front door: it answers, it sends the security headers, and it does not leak data to
// someone who is not signed in. Run it against staging after every deployment:
//   node scripts/smoke-prod.mjs https://erp.example.com [--dev]
// With --dev the production-only headers (CSP, HSTS) are not required.
const base = (process.argv[2] ?? "").replace(/\/$/, "");
const dev = process.argv.includes("--dev");
if (!base) { console.error("Usage: node scripts/smoke-prod.mjs <base-url> [--dev]"); process.exit(2); }

let failed = 0;
const ok = (pass, msg) => { console.log(`${pass ? "OK  " : "FAIL"}  ${msg}`); if (!pass) failed++; };
const get = (path, init = {}) => fetch(base + path, { redirect: "manual", ...init });

const health = await get("/api/health");
ok(health.status === 200, `/api/health answers 200 (got ${health.status})`);
const hb = await health.text();
ok(hb.length < 200 && !/postgres|password|secret|stack/i.test(hb), "health check reveals nothing beyond ok");

const login = await get("/login");
// A brand-new installation has no users yet and sends everyone to the one-time setup page; that is correct, not a fault.
const firstRun = login.status === 307 && /\/setup/.test(login.headers.get("location") ?? "");
ok(login.status === 200 || firstRun, `/login answers 200${firstRun ? " (this is a new installation, so it points to /setup)" : ""} (got ${login.status})`);
const h = login.headers;
ok(h.get("x-frame-options") === "DENY", "X-Frame-Options: DENY");
ok(h.get("x-content-type-options") === "nosniff", "X-Content-Type-Options: nosniff");
ok(Boolean(h.get("referrer-policy")), "Referrer-Policy set");
ok(!h.get("x-powered-by"), "X-Powered-By is not advertised");
if (!dev) {
  ok(/frame-ancestors 'none'/.test(h.get("content-security-policy") ?? ""), "Content-Security-Policy with frame-ancestors 'none'");
  ok(/max-age=\d{7,}/.test(h.get("strict-transport-security") ?? ""), "Strict-Transport-Security with a long max-age");
}

for (const p of ["/dashboard", "/finance/invoices", "/users", "/settings/security", "/roles", "/audit-logs", "/payroll"]) {
  const r = await get(p);
  const to = r.headers.get("location") ?? "";
  ok([301, 302, 303, 307, 308].includes(r.status) && /\/login/.test(to), `${p} sends a signed-out visitor to the login page`);
}
for (const p of ["/api/files/x?t=y", "/api/calendar/0123456789abcdef0123456789abcdef0123456789abcdef.ics"]) {
  const r = await get(p);
  ok([302, 303, 307, 404].includes(r.status), `${p} gives nothing away (status ${r.status})`);
}
const setup = await get("/setup");
ok([200, 307, 308, 302, 303].includes(setup.status), `/setup is reachable or closed (status ${setup.status})`);

const burst = [];
for (let i = 0; i < 12; i++) {
  burst.push(await get("/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "email=nobody%40example.test&password=wrong" }));
}
ok(!burst.some((r) => r.status >= 500), "repeated bad sign-in attempts never cause a server error");

console.log(failed ? `\n${failed} check${failed === 1 ? "" : "s"} failed.` : "\nAll checks passed.");
process.exit(failed ? 1 : 0);
