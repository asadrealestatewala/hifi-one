// Content approval workflow rules. Pure, so the UI, the actions and the tests share one definition.
export const CONTENT_STATUSES = ["DRAFT", "INTERNAL_REVIEW", "CLIENT_REVIEW", "CHANGES_REQUESTED", "APPROVED", "SCHEDULED", "PUBLISHED"] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];
export type Actor = "STAFF" | "CLIENT";

// What each kind of person may do from each status.
const STAFF: Record<string, ContentStatus[]> = {
  DRAFT: ["INTERNAL_REVIEW"],
  INTERNAL_REVIEW: ["CLIENT_REVIEW", "DRAFT"],
  CLIENT_REVIEW: ["INTERNAL_REVIEW"], // withdraw from the client
  CHANGES_REQUESTED: ["INTERNAL_REVIEW", "DRAFT"],
  APPROVED: ["SCHEDULED"],
  SCHEDULED: ["PUBLISHED", "APPROVED"],
  PUBLISHED: [],
};
const CLIENT: Record<string, ContentStatus[]> = { CLIENT_REVIEW: ["APPROVED", "CHANGES_REQUESTED"] };

export function canTransition(actor: Actor, from: string, to: string): boolean {
  return ((actor === "CLIENT" ? CLIENT : STAFF)[from] ?? []).includes(to as ContentStatus);
}

// A reason is needed whenever someone sends work back or rejects it.
export function needsComment(from: string, to: string): boolean {
  return to === "CHANGES_REQUESTED" || (to === "DRAFT" && from !== "DRAFT");
}

// Copy can only change while it is not in front of the client or already approved.
export const EDITABLE = ["DRAFT", "INTERNAL_REVIEW", "CHANGES_REQUESTED"];
export const isEditable = (status: string) => EDITABLE.includes(status);

export const PLATFORMS = ["FACEBOOK", "INSTAGRAM", "TIKTOK", "LINKEDIN", "YOUTUBE", "OTHER"] as const;
