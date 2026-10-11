#!/usr/bin/env node
// Hifi One desktop agent for Windows (Node 18 or newer). It is deliberately small, visible and honest:
//   - It runs in a console window that always shows what it is doing. Closing the window stops it.
//   - It only records when the server's policy says so, for a person who has accepted that policy in Hifi One,
//     during working hours, and never during a break. The server checks every upload again.
//   - It sends: seconds active and idle, and the NAME of the application in front (for example "chrome").
//     It never sends window titles, web addresses, what you type, or where the pointer is.
//   - Screenshots are only taken when the policy turns them on, and are shown to you under My Time & Activity.
//   - It does not count key presses or clicks (that would need a system-wide keyboard hook); activity is measured
//     from how long the computer has gone without input.
//
//   node hifi-agent.mjs enroll --server https://erp.example.com --code ABCDE-12345
//   node hifi-agent.mjs run [--no-screenshots] [--simulate] [--once]
//   node hifi-agent.mjs status
//   node hifi-agent.mjs forget        (removes the saved sign-in from this computer)
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const VERSION = "1.0.0";
const dir = path.join(process.env.APPDATA ?? path.join(os.homedir(), ".config"), "HifiOneAgent");
const cfgPath = path.join(dir, "config.json");
const args = process.argv.slice(2);
const cmd = args[0] ?? "run";
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };

const loadCfg = () => { try { return JSON.parse(fs.readFileSync(cfgPath, "utf8")); } catch { return null; } };
const say = (m) => console.log(`[${new Date().toLocaleTimeString()}] ${m}`);

async function api(cfg, method, route, body, raw = false) {
  const res = await fetch(cfg.server + route, {
    method, headers: { authorization: `Bearer ${cfg.token}`, ...(body ? { "content-type": raw ? "image/png" : "application/json" } : {}) },
    body: body ? (raw ? body : JSON.stringify(body)) : undefined, signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error ?? `HTTP ${res.status}`), { status: res.status });
  return json;
}

// ---------- samplers (Windows, through PowerShell) ----------
const PS_SAMPLE = `
Add-Type @"
using System; using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [StructLayout(LayoutKind.Sequential)] public struct LII { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LII p);
  public static double Idle() { LII l = new LII(); l.cbSize = (uint)Marshal.SizeOf(l); GetLastInputInfo(ref l); return ((uint)Environment.TickCount - l.dwTime) / 1000.0; }
}
"@
$pid2 = 0; [void][W]::GetWindowThreadProcessId([W]::GetForegroundWindow(), [ref]$pid2)
$name = try { (Get-Process -Id $pid2 -ErrorAction Stop).ProcessName } catch { "unknown" }
Write-Output ("{0}|{1}" -f $name, [math]::Round([W]::Idle()))
`;
const run = (file, a) => new Promise((resolve, reject) => execFile(file, a, { windowsHide: true, timeout: 20_000, maxBuffer: 1 << 24, encoding: "buffer" }, (e, out) => (e ? reject(e) : resolve(out))));
async function sampleReal() {
  const out = (await run("powershell", ["-NoProfile", "-NonInteractive", "-Command", PS_SAMPLE])).toString("utf8").trim().split("|");
  return { app: (out[0] || "unknown").slice(0, 60), idleFor: Number(out[1]) || 0 };
}
let simTick = 0;
const sampleSim = async () => ({ app: ["chrome", "code", "figma"][Math.floor(simTick++ / 3) % 3], idleFor: simTick % 7 === 0 ? 900 : 1 });

async function shotReal() {
  const file = path.join(os.tmpdir(), `hifi-shot-${process.pid}.png`);
  const ps = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.SystemInformation]::VirtualScreen; $bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Left,$b.Top,0,0,$bmp.Size); $s=New-Object System.Drawing.Bitmap ([int]($b.Width/2)),([int]($b.Height/2)); $g2=[System.Drawing.Graphics]::FromImage($s); $g2.DrawImage($bmp,0,0,$s.Width,$s.Height); $s.Save('${file.replace(/'/g, "''")}',[System.Drawing.Imaging.ImageFormat]::Png)`;
  await run("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps]);
  const bytes = fs.readFileSync(file);
  fs.unlinkSync(file); // the picture exists on this computer only for the instant it is sent
  return bytes;
}
// A tiny valid PNG for simulation runs (no real screen is captured)
const shotSim = async () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(600, 1)]);

// ---------- commands ----------
async function enroll() {
  const server = (opt("server") ?? "").replace(/\/$/, "");
  const code = opt("code");
  if (!/^https?:\/\//.test(server) || !code) { console.error("Usage: node hifi-agent.mjs enroll --server https://your-address --code ABCDE-12345"); process.exit(2); }
  const res = await fetch(`${server}/api/agent/enroll`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name: os.hostname(), os: `${os.type()} ${os.release()}`, version: VERSION }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { console.error(`Enrolment failed: ${j.error ?? res.status}`); process.exit(1); }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(cfgPath, JSON.stringify({ server, token: j.token }), { mode: 0o600 });
  console.log("This computer is enrolled.");
  describe(j.policy);
}

function describe(p) {
  console.log("\nWhat this app does, according to your organization's policy:");
  console.log(p.active ? " - Recording is ON for you." : ` - Recording is OFF: ${p.reason}`);
  console.log(` - Activity (active and idle time): ${p.trackActivity ? "yes" : "no"}`);
  console.log(` - Application names: ${p.trackApps ? "yes" : "no"}`);
  console.log(` - Screenshots: ${p.screenshots ? `yes, about every ${p.screenshotIntervalMin} minutes` : "no"}`);
  console.log(` - Working hours only: ${p.schedule.start} to ${p.schedule.end} (${p.schedule.timezone}). Never during breaks.`);
  console.log(" - Never recorded: what you type, window titles, web addresses, passwords.\n");
}

async function status() {
  const cfg = loadCfg();
  if (!cfg) return console.log("Not enrolled. Run: node hifi-agent.mjs enroll --server <address> --code <code>");
  describe(await api(cfg, "GET", "/api/agent/policy"));
}

async function main() {
  const cfg = loadCfg();
  if (!cfg) { console.error("Not enrolled yet. Run the enroll command first."); process.exit(2); }
  const sim = flag("simulate");
  const sample = sim ? sampleSim : sampleReal, shot = sim ? shotSim : shotReal;
  const wantShots = !flag("no-screenshots");
  let policy = await api(cfg, "GET", "/api/agent/policy");
  describe(policy);
  console.log("This window shows everything the app does. Close it to stop.\n");

  let acc = { active: 0, idle: 0, apps: new Map(), since: Date.now() };
  let lastShot = 0, lastPolicy = Date.now(), lastFlush = Date.now();
  const STEP = sim ? 1 : 10;

  for (;;) {
    if (Date.now() - lastPolicy > 60_000) { try { policy = await api(cfg, "GET", "/api/agent/policy"); } catch (e) { say(`Could not reach the server (${e.message}); will retry.`); } lastPolicy = Date.now(); }
    const recording = policy.active && policy.inWorkingHours && !policy.onBreak;
    if (!recording) {
      say(`Not recording: ${!policy.active ? policy.reason : policy.onBreak ? "you are on a break" : "outside working hours"}.`);
      acc = { active: 0, idle: 0, apps: new Map(), since: Date.now() };
    } else {
      try {
        const s = await sample();
        const idle = s.idleFor >= policy.idleThresholdMin * 60;
        if (idle) acc.idle += STEP; else { acc.active += STEP; acc.apps.set(s.app, (acc.apps.get(s.app) ?? 0) + STEP); }
        say(`Recording (${idle ? "idle" : "active"})${policy.trackApps && !idle ? ` · app: ${s.app}` : ""}${policy.screenshots && wantShots ? ` · next screenshot in ${Math.max(0, Math.ceil((policy.screenshotIntervalMin * 60_000 - (Date.now() - lastShot)) / 60_000))} min` : ""}`);
      } catch (e) { say(`Could not sample this computer (${e.message}).`); }

      if (Date.now() - lastFlush >= (sim ? 3_000 : 60_000) && acc.active + acc.idle > 0) {
        const body = {
          buckets: policy.trackActivity ? [{ start: new Date(acc.since).toISOString(), active: Math.min(acc.active, 300), idle: Math.min(acc.idle, 300 - Math.min(acc.active, 300)) }] : [],
          apps: policy.trackApps ? [...acc.apps].map(([name, seconds]) => ({ name, seconds: Math.min(seconds, 300) })) : [],
        };
        try { const r = await api(cfg, "POST", "/api/agent/ingest", body); say(`Sent: ${r.accepted} accepted, ${r.dropped} dropped by the server.`); } catch (e) { say(`Upload failed (${e.message}); the figures were discarded, not stored.`); }
        acc = { active: 0, idle: 0, apps: new Map(), since: Date.now() };
        lastFlush = Date.now();
      }
      if (policy.screenshots && wantShots && Date.now() - lastShot >= policy.screenshotIntervalMin * 60_000 - (sim ? 0 : 5_000)) {
        try { const b = await shot(); await api(cfg, "POST", "/api/agent/screenshot", b, true); say("Screenshot sent. You can see it under My Time & Activity in Hifi One."); } catch (e) { say(`Screenshot not stored: ${e.message}`); }
        lastShot = Date.now();
      }
    }
    if (flag("once")) { if (acc.active + acc.idle > 0) { const r = await api(cfg, "POST", "/api/agent/ingest", { buckets: [{ start: new Date(acc.since).toISOString(), active: Math.min(acc.active, 300), idle: Math.min(acc.idle, 300) }], apps: [...acc.apps].map(([name, seconds]) => ({ name, seconds })) }).catch(() => null); if (r) say(`Sent: ${r.accepted} accepted, ${r.dropped} dropped.`); } break; }
    await new Promise((r) => setTimeout(r, STEP * 1000));
  }
}

if (cmd === "enroll") await enroll();
else if (cmd === "status") await status();
else if (cmd === "forget") { fs.rmSync(cfgPath, { force: true }); console.log("Removed the saved sign-in from this computer. Ask your administrator to revoke the device too."); }
else if (cmd === "selftest") { const s = await sampleReal(); console.log(`Sampler works: foreground app name "${s.app}", idle for ${s.idleFor}s. (Nothing was sent.)`); const b = await shotReal(); console.log(`Screen capture works: ${b.length} bytes (not saved, not sent).`); }
else if (cmd === "run") await main();
else { console.error("Commands: enroll, run, status, forget, selftest"); process.exit(2); }
