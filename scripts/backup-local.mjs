// Backup and restore for the LOCAL development database (the embedded PostgreSQL in .data/postgres).
// The database must be stopped first so the files are consistent. Production uses pg_dump: see docs/DEPLOYMENT.md.
//   node scripts/backup-local.mjs backup
//   node scripts/backup-local.mjs restore <backup-folder-name> --yes
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const dataDir = path.resolve(".data/postgres");
const backupRoot = path.resolve(".data/backups");
const port = Number(process.env.DB_PORT ?? 54329);

function isRunning() {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: "127.0.0.1" });
    s.on("connect", () => { s.destroy(); resolve(true); });
    s.on("error", () => resolve(false));
  });
}

const [, , cmd, arg, flag] = process.argv;
if (await isRunning()) {
  console.error(`The database is running on port ${port}. Stop it first (Ctrl+C in the db:start window), then run this again.`);
  process.exit(1);
}

if (cmd === "backup") {
  if (!fs.existsSync(dataDir)) { console.error("No local database found."); process.exit(1); }
  const name = new Date().toISOString().replace(/[:.]/g, "-");
  fs.mkdirSync(backupRoot, { recursive: true });
  fs.cpSync(dataDir, path.join(backupRoot, name), { recursive: true });
  console.log(`Backup saved: .data/backups/${name}`);
} else if (cmd === "restore") {
  const src = arg && path.join(backupRoot, path.basename(arg)); // basename: no path tricks
  if (!src || !fs.existsSync(src)) {
    console.error("Usage: restore <backup-folder-name> --yes\nAvailable:", fs.existsSync(backupRoot) ? fs.readdirSync(backupRoot).join(", ") : "none");
    process.exit(1);
  }
  if (flag !== "--yes") { console.error("Restore replaces the current database. Re-run with --yes to confirm. The current data is kept as a safety copy."); process.exit(1); }
  if (fs.existsSync(dataDir)) fs.renameSync(dataDir, path.join(backupRoot, `before-restore-${Date.now()}`)); // never deleted, only moved aside
  fs.cpSync(src, dataDir, { recursive: true });
  console.log(`Restored from ${path.basename(src)}. Start the database again with npm run db:start.`);
} else {
  console.error("Usage: backup | restore <backup-folder-name> --yes");
  process.exit(1);
}
