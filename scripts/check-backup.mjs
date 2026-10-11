// Checks that a recent, readable database backup exists. Run it from a scheduler and alert on a non-zero exit.
//   node scripts/check-backup.mjs <backup-folder> [--max-hours 26] [--files <uploads-backup-folder>]
// A backup file passes when it is the newest one, is not older than the limit, is not empty, and starts the way a real
// dump does (custom format "PGDMP", or plain SQL from pg_dump). A backup that cannot be opened is not a backup.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const dir = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--max-hours" && args[args.indexOf(a) - 1] !== "--files") ?? process.env.BACKUP_DIR;
const maxHours = Number(flag("--max-hours", process.env.BACKUP_MAX_HOURS ?? 26));
const filesDir = flag("--files", process.env.FILES_BACKUP_DIR);

let failed = false;
const say = (ok, msg) => { console.log(`${ok ? "OK   " : "FAIL "} ${msg}`); if (!ok) failed = true; };

function newest(folder, pattern) {
  if (!fs.existsSync(folder)) return null;
  const items = fs.readdirSync(folder).map((n) => ({ name: n, full: path.join(folder, n), stat: fs.statSync(path.join(folder, n)) })).filter((i) => pattern.test(i.name));
  return items.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0] ?? null;
}

function looksLikeDump(file) {
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(512);
  const n = fs.readSync(fd, buf, 0, 512, 0);
  fs.closeSync(fd);
  const head = buf.subarray(0, n).toString("latin1");
  return head.startsWith("PGDMP") || head.includes("PostgreSQL database dump") || head.startsWith("--") || head.includes("SET statement_timeout");
}

if (!dir) {
  console.error("Usage: node scripts/check-backup.mjs <backup-folder> [--max-hours 26] [--files <uploads-backup-folder>]");
  process.exit(2);
}

const db = newest(dir, /\.(dump|sql|backup|gz)$/i);
if (!db) say(false, `No database backup found in ${dir}`);
else {
  const ageH = (Date.now() - db.stat.mtimeMs) / 3_600_000;
  say(ageH <= maxHours, `Newest backup ${db.name} is ${ageH.toFixed(1)} hours old (limit ${maxHours})`);
  say(db.stat.size > 1024, `Backup size ${db.stat.size} bytes`);
  if (/\.gz$/i.test(db.name)) {
    const fd = fs.openSync(db.full, "r"); const b = Buffer.alloc(2); fs.readSync(fd, b, 0, 2, 0); fs.closeSync(fd);
    say(b[0] === 0x1f && b[1] === 0x8b, "Compressed file has a valid gzip header");
  } else say(looksLikeDump(db.full), "File starts like a PostgreSQL dump");
}

if (filesDir) {
  const f = newest(filesDir, /./);
  if (!f) say(false, `No uploads backup found in ${filesDir}`);
  else say((Date.now() - f.stat.mtimeMs) / 3_600_000 <= maxHours, `Newest uploads backup ${f.name} is ${((Date.now() - f.stat.mtimeMs) / 3_600_000).toFixed(1)} hours old`);
}

console.log(failed ? "Backup check FAILED. A restore drill is also due at least once a quarter." : "Backup check passed.");
process.exit(failed ? 1 : 0);
