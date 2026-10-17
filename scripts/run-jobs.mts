// Runs the scheduled jobs once (each runs at most once a day per organization): npm run jobs:run
// Options: --force to run again today, --only=key1,key2 to pick jobs. Schedule it daily (Windows Task Scheduler or cron).
import { PrismaClient } from "@prisma/client";
import { runJobs } from "../src/lib/jobs";

const db = new PrismaClient();
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const results = await runJobs(db, { trigger: "SCRIPT", force: process.argv.includes("--force"), only });
for (const r of results) console.log(`${r.status.padEnd(7)} ${r.key}: ${r.summary}`);
await db.$disconnect();
process.exit(results.some((r) => r.status === "FAILED") ? 1 : 0);
