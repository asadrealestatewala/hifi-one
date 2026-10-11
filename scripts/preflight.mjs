// Checks that a server is configured safely before Hifi One goes live. Run it where the app will run, with the same
// environment, and fix every FAIL:
//   node scripts/preflight.mjs
// It reads environment variables only; it prints no secret values.
import fs from "node:fs";

const env = process.env;
const results = [];
const check = (level, title, detail) => results.push({ level, title, detail });

// Database
if (!env.DATABASE_URL) check("FAIL", "DATABASE_URL", "Not set.");
else {
  let u;
  try { u = new URL(env.DATABASE_URL); } catch { u = null; }
  if (!u) check("FAIL", "DATABASE_URL", "Not a valid connection string.");
  else if (/hifi_local_dev|password|changeme/i.test(decodeURIComponent(u.password))) check("FAIL", "Database password", "Looks like the development password. Use a strong unique password.");
  else if (["localhost", "127.0.0.1"].includes(u.hostname) && env.NODE_ENV === "production") check("WARN", "Database host", "Points at localhost. Fine if the database runs on this same server; otherwise fix it.");
  else check("OK", "DATABASE_URL", "Set, valid, and not the development password.");
}

// Secrets
const s = env.SESSION_SECRET ?? "";
if (!s) check("FAIL", "SESSION_SECRET", "Not set. Generate one: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"");
else if (s.length < 32) check("FAIL", "SESSION_SECRET", `Only ${s.length} characters; use at least 32.`);
else if (/change[-_ ]?me|secret|password|example|dev/i.test(s)) check("FAIL", "SESSION_SECRET", "Looks like a placeholder.");
else check("OK", "SESSION_SECRET", "Set, long enough, not a placeholder.");

// Mode and address
if (env.NODE_ENV !== "production") check("FAIL", "NODE_ENV", "Must be \"production\" so cookies are secure and the strict security headers are on.");
else check("OK", "NODE_ENV", "production");
if (!env.APP_URL) check("WARN", "APP_URL", "Not set. Set it to the public https:// address so links in emails and calendar feeds are right.");
else if (!env.APP_URL.startsWith("https://")) check("FAIL", "APP_URL", "Must start with https:// in production.");
else check("OK", "APP_URL", "https address set.");

// First-run setup is locked behind a token in production
if (!env.SETUP_TOKEN || env.SETUP_TOKEN.length < 16) check("WARN", "SETUP_TOKEN", "Not set (or under 16 characters). Needed only to run first-run setup on a new installation; the setup page closes by itself once a user exists. Remove it afterwards.");
else check("OK", "SETUP_TOKEN", "Set. Remove it from the environment once setup is done.");

// Files
const dir = env.STORAGE_DIR;
if (!dir) check("WARN", "STORAGE_DIR", "Not set; uploads would go inside the application folder. Point it at a persistent, backed-up location.");
else {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = `${dir}/.preflight-${process.pid}`;
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
    check("OK", "STORAGE_DIR", "Exists and is writable.");
  } catch (e) { check("FAIL", "STORAGE_DIR", `Not writable: ${e.message}`); }
}

// Optional integrations: say plainly what is and is not switched on
check(env.SMTP_HOST && env.MAIL_FROM ? "OK" : "WARN", "Email", env.SMTP_HOST && env.MAIL_FROM ? "SMTP settings present (use Settings > Email to prove them)." : "Not configured: documents cannot be emailed.");
check(env.ANTHROPIC_API_KEY ? "OK" : "WARN", "Assistant", env.ANTHROPIC_API_KEY ? "API key present." : "Not configured: the assistant is off.");

const icon = { OK: "OK  ", WARN: "WARN", FAIL: "FAIL" };
for (const r of results) console.log(`${icon[r.level]}  ${r.title}: ${r.detail}`);
const fails = results.filter((r) => r.level === "FAIL").length;
console.log(fails ? `\n${fails} problem${fails === 1 ? "" : "s"} to fix before going live.` : "\nNo blocking problems. Review any WARN lines.");
process.exit(fails ? 1 : 0);
