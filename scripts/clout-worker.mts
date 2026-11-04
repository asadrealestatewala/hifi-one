// Clout Leader background worker: keeps tracked influencer posts up to date. Run by pm2 as "hifi-clout-worker" (see docs/CLOUT_LEADER.md).
// Every few seconds it picks the posts that are due and reads a small batch, with random pauses, a limit on parallel requests and
// a minimum gap per platform; platforms that start refusing us are left alone for longer and longer. Once a week it updates yt-dlp.
// `npm run clout:worker -- --once` runs one batch and exits (for a check by hand).
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { runDueBatch } from "../src/lib/clout";
import { updateYtDlp, ytDlpVersion } from "../src/lib/clout-providers";

const db = new PrismaClient();
const once = process.argv.includes("--once");
const stampFile = path.join(process.env.STORAGE_DIR || path.resolve(".data"), "clout-ytdlp-updated");
const WEEK = 7 * 86_400_000;
let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { stopping = true; });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function weeklyUpdate() {
  try {
    const last = fs.existsSync(stampFile) ? fs.statSync(stampFile).mtimeMs : 0;
    if (Date.now() - last < WEEK) return;
    console.log("[clout] updating yt-dlp:", await updateYtDlp());
    fs.mkdirSync(path.dirname(stampFile), { recursive: true });
    fs.writeFileSync(stampFile, new Date().toISOString());
    console.log("[clout] yt-dlp version:", (await ytDlpVersion()) ?? "not found");
  } catch (e) { console.error("[clout] yt-dlp update failed", e); }
}

console.log("[clout] worker started; yt-dlp version:", (await ytDlpVersion()) ?? "not found");
let nextUpdateCheck = 0;
do {
  try {
    if (Date.now() >= nextUpdateCheck) { await weeklyUpdate(); nextUpdateCheck = Date.now() + 3_600_000; }
    const r = await runDueBatch(db);
    if (r.picked > 0) console.log(`[clout] checked ${r.picked}: ${r.ok} ok, ${r.failed} failed, ${r.gone} not found${r.skippedPlatforms.length ? `; paused platforms: ${r.skippedPlatforms.join(", ")}` : ""}`);
    if (once) break;
    await sleep(r.picked > 0 ? 1000 : 5000);
  } catch (e) {
    console.error("[clout] batch failed", e);
    if (once) break;
    await sleep(15_000);
  }
} while (!stopping);
await db.$disconnect();
