// Optional in-process scheduler: set JOBS_AUTORUN=1 and the server checks every 15 minutes whether today's jobs have run,
// and sends any CRM follow-up emails that are due (those run on every tick, not once a day).
// Each job still runs once a day per organization and is guarded by the database, so several servers or restarts are safe.
// Use the /api/jobs/run endpoint or `npm run jobs:run` instead when the host stops idle servers.
export async function register() {
  // The imports stay inside this block so the edge bundle drops them (storage uses node:crypto).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.JOBS_AUTORUN !== "1") return;
    const { db } = await import("./lib/db");
    const { runJobs } = await import("./lib/jobs");
    const { runFollowUps } = await import("./lib/followups");
    const tick = () => {
      void runJobs(db, { trigger: "SCHEDULE" }).catch((e) => console.error("Scheduled jobs failed", e));
      void runFollowUps(db).catch((e) => console.error("Follow-up emails failed", e));
    };
    setTimeout(tick, 60_000);
    setInterval(tick, 15 * 60_000);
  }
}
