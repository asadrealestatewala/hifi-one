// Sends the CRM follow-up emails that are due and enrols new leads in running sequences: npm run followups:run
// Safe to run as often as you like (every 5 to 15 minutes is typical) and from several places at once: each step is sent once.
// Not needed when the server runs with JOBS_AUTORUN=1, which does the same every 15 minutes.
import { PrismaClient } from "@prisma/client";
import { runFollowUps } from "../src/lib/followups";

const db = new PrismaClient();
const results = await runFollowUps(db);
if (!results.length) console.log("No follow-up sequence is switched on.");
for (const r of results) console.log(`${r.organizationId}: ${r.enrolled} enrolled, ${r.sent} sent, ${r.stopped} stopped, ${r.failed} failed${r.skipped ? ` (${r.skipped})` : ""}`);
await db.$disconnect();
