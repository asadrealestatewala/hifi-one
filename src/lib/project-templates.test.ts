// Template plans: shape rules checked before anything is saved or applied.
import { describe, expect, it } from "vitest";
import { parseTemplateBody, STARTER_TEMPLATES } from "./project-templates";

const task = (over: Record<string, unknown> = {}) => ({ title: "Write captions", ...over });

describe("parseTemplateBody", () => {
  it("accepts both starter templates as they are", () => {
    for (const t of STARTER_TEMPLATES) expect(parseTemplateBody(t.body)).toMatchObject({ ok: true });
  });

  it("fills defaults and reads numbers typed as text", () => {
    const r = parseTemplateBody({ tasks: [task({ day: "4", hours: "2.5" })] });
    expect(r.ok && r.value.tasks[0]).toMatchObject({ day: 4, hours: 2.5, priority: "MEDIUM", role: "", milestone: "", clientVisible: false, labels: [], subtasks: [] });
    expect(r.ok && r.value.roles).toEqual([]);
  });

  it("refuses a task pointing at a role or milestone the template doesn't have", () => {
    expect(parseTemplateBody({ roles: ["Writer"], tasks: [task({ role: "Designer" })] })).toEqual({ ok: false, error: 'Task 1 (Write captions) uses the role "Designer", which isn\'t in the template\'s roles.' });
    expect(parseTemplateBody({ milestones: [{ name: "Plan" }], tasks: [task({ milestone: "Launch" })] })).toMatchObject({ ok: false, error: expect.stringMatching(/milestone that isn't in the template/) });
  });

  it("refuses repeated roles or milestones, bad days and bad repeat values", () => {
    expect(parseTemplateBody({ roles: ["Writer", "Writer"] })).toMatchObject({ ok: false, error: "Two roles have the same name." });
    expect(parseTemplateBody({ milestones: [{ name: "Plan" }, { name: "Plan" }] })).toMatchObject({ ok: false, error: "Two milestones have the same name." });
    expect(parseTemplateBody({ tasks: [task({ day: -1 })] }).ok).toBe(false);
    expect(parseTemplateBody({ tasks: [task({ day: 731 })] }).ok).toBe(false);
    expect(parseTemplateBody({ tasks: [task({ repeat: "HOURLY" })] }).ok).toBe(false);
    expect(parseTemplateBody({ tasks: [task({ title: "  " })] }).ok).toBe(false);
    expect(parseTemplateBody({ tasks: [task({ labels: ["a", "b", "c", "d", "e", "f", "g"] })] }).ok).toBe(false);
  });
});
