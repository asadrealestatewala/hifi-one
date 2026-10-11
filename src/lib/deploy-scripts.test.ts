import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const script = path.resolve("scripts/preflight.mjs");
const good = {
  DATABASE_URL: "postgresql://app:Zk39sLw02xQp@db.internal:5432/hifi", SESSION_SECRET: "q8Zr3Lw0Vx9Tn5Kb2Hs7Jd1Fg6Ym4Pc8AeXz", NODE_ENV: "production",
  APP_URL: "https://erp.example.com", SETUP_TOKEN: "a-long-random-setup-token", STORAGE_DIR: path.join(os.tmpdir(), `hifi-pre-${process.pid}`),
};
const run = (env: Record<string, string>) =>
  spawnSync("node", [script], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", ...env } });

describe("preflight check", () => {
  it("passes a sound production configuration and never prints secret values", () => {
    const r = run(good);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain(good.SESSION_SECRET);
    expect(r.stdout).not.toContain("Zk39sLw02xQp");
    fs.rmSync(good.STORAGE_DIR, { recursive: true, force: true });
  });

  it.each([
    ["no database", { ...good, DATABASE_URL: "" }, "DATABASE_URL"],
    ["development database password", { ...good, DATABASE_URL: "postgresql://hifi:hifi_local_dev@db:5432/x" }, "development password"],
    ["missing session secret", { ...good, SESSION_SECRET: "" }, "SESSION_SECRET"],
    ["short session secret", { ...good, SESSION_SECRET: "tooshort" }, "at least 32"],
    ["placeholder session secret", { ...good, SESSION_SECRET: "change-me-change-me-change-me-change-me" }, "placeholder"],
    ["development mode", { ...good, NODE_ENV: "development" }, "production"],
    ["plain http address", { ...good, APP_URL: "http://erp.example.com" }, "https://"],
  ])("refuses %s", (_name, env, text) => {
    const r = run(env as Record<string, string>);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(text);
  });

  it("refuses a file folder it cannot write to", () => {
    const file = path.join(os.tmpdir(), `hifi-not-a-folder-${process.pid}`);
    fs.writeFileSync(file, "x");
    const r = run({ ...good, STORAGE_DIR: path.join(file, "sub") });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("STORAGE_DIR");
    fs.rmSync(file);
  });
});
