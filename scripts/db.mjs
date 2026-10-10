// Local development PostgreSQL (no Docker or system install needed).
// Usage: npm run db:start   (keeps running; Ctrl+C to stop)
import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs";
import path from "node:path";

const dataDir = path.resolve(".data/postgres");
const port = Number(process.env.DB_PORT ?? 54329);
const dbName = "hifi_one";

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "hifi",
  password: "hifi_local_dev",
  port,
  persistent: true,
  // UTF-8 is required for Urdu/Arabic names and any non-Latin text.
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});

const fresh = !fs.existsSync(path.join(dataDir, "PG_VERSION"));
if (fresh) await pg.initialise();
await pg.start();
if (fresh) {
  await pg.createDatabase(dbName);
  await pg.createDatabase("hifi_one_test"); // used by integration tests only
}

console.log(`PostgreSQL ready: postgresql://hifi:hifi_local_dev@localhost:${port}/${dbName}`);

const shutdown = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
setInterval(() => {}, 1 << 30);
