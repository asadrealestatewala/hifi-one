// Builds dist/HifiOneAgent.exe: a single Windows program that carries its own Node runtime, so staff install nothing.
//   node agent/build.mjs --server https://hifimarketing.co
// Works on Windows (CI) and, for checking the build, on Linux/macOS (downloads the Windows node.exe of the same version).
// The result is NOT code-signed. Windows SmartScreen will warn until it is signed with a code-signing certificate.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const server = (args[args.indexOf("--server") + 1] ?? process.env.HIFI_SERVER ?? "").replace(/\/$/, "");
if (!/^https:\/\//.test(server)) { console.error("Give the live address: node agent/build.mjs --server https://your-address"); process.exit(2); }

const work = fs.mkdtempSync(path.join(os.tmpdir(), "hifi-agent-build-"));
const dist = path.join(here, "dist");
fs.mkdirSync(dist, { recursive: true });
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const sh = (cmd, a, o = {}) => execFileSync(cmd, a, { stdio: "inherit", shell: process.platform === "win32", ...o });

// 1. One CommonJS file (Node's single-executable support loads CommonJS), with the live address baked in
const bundle = path.join(work, "agent.cjs");
sh(npx, ["--yes", "esbuild@0.24.2", path.join(here, "hifi-agent.mjs"), "--bundle", "--platform=node", "--format=cjs", "--target=node22", `--outfile=${bundle}`]);
const src = fs.readFileSync(bundle, "utf8");
if (!src.includes('DEFAULT_SERVER = ""')) throw new Error("DEFAULT_SERVER marker not found");
fs.writeFileSync(bundle, src.replace('DEFAULT_SERVER = ""', `DEFAULT_SERVER = ${JSON.stringify(server)}`));

// 2. The Node runtime to embed it in: always the Windows one
let nodeExe = process.execPath;
if (process.platform !== "win32") {
  nodeExe = path.join(work, "node.exe");
  const url = `https://nodejs.org/dist/${process.version}/win-x64/node.exe`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download ${url}`);
  fs.writeFileSync(nodeExe, Buffer.from(await res.arrayBuffer()));
}

// 3. Blob + injection
const cfg = path.join(work, "sea-config.json");
fs.writeFileSync(cfg, JSON.stringify({ main: bundle, output: path.join(work, "sea.blob"), disableExperimentalSEAWarning: true }));
sh(process.execPath, ["--experimental-sea-config", cfg]);
const out = path.join(dist, "HifiOneAgent.exe");
fs.copyFileSync(nodeExe, out);
sh(npx, ["--yes", "postject@1.0.0-alpha.6", out, "NODE_SEA_BLOB", path.join(work, "sea.blob"), "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"]);
console.log(`Built ${out} (${(fs.statSync(out).size / 1048576).toFixed(0)} MB) for ${server}`);
fs.rmSync(work, { recursive: true, force: true });
