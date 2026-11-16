// Optional in-process scheduler: set JOBS_AUTORUN=1 and the server checks every 15 minutes whether today's jobs have run,
// and sends any CRM follow-up emails that are due (those run on every tick, not once a day).
// Each job still runs once a day per organization and is guarded by the database, so several servers or restarts are safe.
// Use the /api/jobs/run endpoint or `npm run jobs:run` instead when the host stops idle servers.
export async function register() {
  // The imports stay inside this block so the edge bundle drops them (storage uses node:crypto).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Facebook and Instagram posts go out on time: checked every minute, on by default (SOCIAL_PUBLISH_AUTORUN=0 turns it off,
    // for example on a second server). Each post is claimed in the database first, so two servers never post it twice.
    if (process.env.SOCIAL_PUBLISH_AUTORUN !== "0") {
      const { db } = await import("./lib/db");
      const { runDuePublications } = await import("./lib/social-meta");
      let busy = false;
      setInterval(() => {
        if (busy) return;
        busy = true;
        runDuePublications(db).catch((e) => console.error("Social publishing failed", e)).finally(() => { busy = false; });
      }, 60_000);
    }
    if (process.env.JOBS_AUTORUN !== "1") return;
    const { db } = await import("./lib/db");
    const { runJobs } = await import("./lib/jobs");
    const { runFollowUps } = await import("./lib/followups");
    const { runWebsiteChecks } = await import("./lib/website-checks");
    const tick = () => {
      void runJobs(db, { trigger: "SCHEDULE" }).catch((e) => console.error("Scheduled jobs failed", e));
      void runFollowUps(db).catch((e) => console.error("Follow-up emails failed", e));
      // Prospector website checks that are still waiting (a click normally starts them at once; this picks up anything left over)
      void runWebsiteChecks(db).catch((e) => console.error("Prospector website checks failed", e));
    };
    setTimeout(tick, 60_000);
    setInterval(tick, 15 * 60_000);
  }
}
