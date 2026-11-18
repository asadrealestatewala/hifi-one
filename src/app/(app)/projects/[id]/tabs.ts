// Which project-page tab a link or redirect opens. Forms come back with ?tab=… (a redirect after a server
// action drops the #hash); links inside the page use #… . Older section anchors map to the tab that now holds them.
const ALIAS: Record<string, string> = { deliverables: "updates", assets: "files", milestones: "tasks", timeline: "tasks", money: "time" };

export function resolveTab(value: string | null | undefined, keys: string[]): string | null {
  const h = (value ?? "").replace(/^#/, "");
  const k = ALIAS[h] ?? h;
  return keys.includes(k) ? k : null;
}
