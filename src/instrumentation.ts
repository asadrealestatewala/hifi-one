// Optional in-process scheduler: set JOBS_AUTORUN=1 and the server checks every 15 minutes whether today's jobs have run.
// Each job still runs once a day per organization and is guarded by the database, so several servers or restarts are safe.
// Use the /api/jobs/run endpoint or `npm run jobs:run` instead when the host stops idle servers.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.JOBS_AUTORUN !== "1") return;
  const { db } = await import("./lib/db");
  const { runJobs } = await import("./lib/jobs");
  const tick = () => { void runJobs(db, { trigger: "SCHEDULE" }).catch((e) => console.error("Scheduled jobs failed", e)); };
  setTimeout(tick, 60_000);
  setInterval(tick, 15 * 60_000);
}
