const $ = (id) => document.getElementById(id);
async function show() {
  const v = await chrome.storage.local.get(["server", "status", "lastSent"]);
  $("server").value = v.server || "";
  $("status").textContent = v.status || "Waiting for the first check.";
  $("sent").innerHTML = (v.lastSent || []).length ? "<small>Last sent:</small><ul>" + v.lastSent.map((s) => `<li>${s.domain.replace(/[<>&]/g, "")}, ${s.seconds}s</li>`).join("") + "</ul>" : "";
}
$("save").onclick = async () => {
  let base = $("server").value.trim().replace(/\/+$/, "");
  try { const u = new URL(base); if (u.protocol !== "https:") throw 0; base = u.origin; } catch { $("status").textContent = "Enter an https:// address."; return; }
  const granted = await chrome.permissions.request({ origins: [base + "/*"] });
  if (!granted) { $("status").textContent = "Permission was not given."; return; }
  await chrome.storage.local.set({ server: base });
  show();
};
show();
