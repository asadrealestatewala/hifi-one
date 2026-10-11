import { describe, expect, it } from "vitest";
import { canTransition, isEditable, needsComment } from "./content-rules";

describe("content workflow", () => {
  it("staff walk an item through internal review to the client", () => {
    expect(canTransition("STAFF", "DRAFT", "INTERNAL_REVIEW")).toBe(true);
    expect(canTransition("STAFF", "INTERNAL_REVIEW", "CLIENT_REVIEW")).toBe(true);
  });
  it("staff cannot skip review or approve on the client's behalf", () => {
    expect(canTransition("STAFF", "DRAFT", "CLIENT_REVIEW")).toBe(false);
    expect(canTransition("STAFF", "CLIENT_REVIEW", "APPROVED")).toBe(false);
    expect(canTransition("STAFF", "DRAFT", "PUBLISHED")).toBe(false);
  });
  it("only the client can approve or request changes, and only while in client review", () => {
    expect(canTransition("CLIENT", "CLIENT_REVIEW", "APPROVED")).toBe(true);
    expect(canTransition("CLIENT", "CLIENT_REVIEW", "CHANGES_REQUESTED")).toBe(true);
    expect(canTransition("CLIENT", "DRAFT", "APPROVED")).toBe(false);
    expect(canTransition("CLIENT", "INTERNAL_REVIEW", "CLIENT_REVIEW")).toBe(false);
    expect(canTransition("CLIENT", "APPROVED", "PUBLISHED")).toBe(false);
  });
  it("publishing needs scheduling first and is final", () => {
    expect(canTransition("STAFF", "APPROVED", "PUBLISHED")).toBe(false);
    expect(canTransition("STAFF", "APPROVED", "SCHEDULED")).toBe(true);
    expect(canTransition("STAFF", "SCHEDULED", "PUBLISHED")).toBe(true);
    expect(canTransition("STAFF", "PUBLISHED", "DRAFT")).toBe(false);
  });
  it("requires a reason when sending back or requesting changes", () => {
    expect(needsComment("CLIENT_REVIEW", "CHANGES_REQUESTED")).toBe(true);
    expect(needsComment("INTERNAL_REVIEW", "DRAFT")).toBe(true);
    expect(needsComment("DRAFT", "INTERNAL_REVIEW")).toBe(false);
  });
  it("copy is locked in client review, approved, scheduled and published", () => {
    expect(isEditable("DRAFT")).toBe(true);
    expect(isEditable("CHANGES_REQUESTED")).toBe(true);
    for (const s of ["CLIENT_REVIEW", "APPROVED", "SCHEDULED", "PUBLISHED"]) expect(isEditable(s)).toBe(false);
  });
});
