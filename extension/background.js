// Hifi One work sites. Visible and simple by design:
//  - It asks Hifi One (using your own sign-in) whether it may report. It reports only while you are clocked in, have accepted the
//    terms, the policy includes websites, it is working hours and you are not on a break.
//  - It sends only the website name (for example "github.com") and seconds. Never the page, path, search, title or tab content.
//  - Nothing is sent or kept when the answer is "no". Private/incognito windows are never read.
const SERVER_KEY = "server";
const TICK_SECONDS = 30;
let current = null; // { domain, since }
let pending = new Map(); // domain -> seconds, only held in memory until the next report

async function server() { return (await chrome.storage.local.get(SERVER_KEY))[SERVER_KEY] || null; }
const call = async (base, method, body) => {
  const r = await fetch(`${base}/api/monitor/sites`, { method, credentials: "include", headers: { "x-hifi-addon": "1", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
};

function hostOf(url) {
  try { const u = new URL(url); return u.protocol === "http:" || u.protocol === "https:" ? u.hostname : null; } catch { return null; }
}

async function activeHost() {
  const idle = await chrome.idle.queryState(60);
  if (idle !== "active") return null;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || tab.incognito || !tab.url) return null;
  return hostOf(tab.url);
}

async function tick() {
  const base = await server();
  if (!base) return setStatus("Not set up. Open the add-on and enter your Hifi One address.");
  let state;
  try { state = await call(base, "GET"); } catch { pending.clear(); return setStatus("Cannot reach Hifi One or you are signed out. Nothing is being recorded."); }
  if (!state.reporting) { pending.clear(); return setStatus(`Not recording: ${state.reason}`); }
  const host = await activeHost();
  if (host) pending.set(host, (pending.get(host) || 0) + TICK_SECONDS);
  const sites = [...pending].map(([domain, seconds]) => ({ domain, seconds: Math.min(seconds, 300) }));
  if (sites.length === 0) return setStatus("Recording is on. Nothing to report right now.");
  try {
    const r = await call(base, "POST", { sites });
    pending.clear();
    setStatus(`Recording is on. Last report: ${r.accepted} site${r.accepted === 1 ? "" : "s"}.`, sites);
  } catch { setStatus("Could not send the last report. It will be tried again."); }
}

function setStatus(text, sent) { chrome.storage.local.set({ status: text, lastSent: sent || [], at: Date.now() }); }

chrome.alarms.create("tick", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "tick") tick(); });
chrome.runtime.onInstalled.addListener(() => tick());
