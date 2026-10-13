// Colours for each content status, shared by the calendar, the sheet and the legend.
export const STATUS_STYLE: Record<string, { label: string; chip: string }> = {
  DRAFT: { label: "Draft", chip: "bg-hover text-muted border-border" },
  INTERNAL_REVIEW: { label: "Internal review", chip: "bg-warning/10 text-warning border-warning/30" },
  CLIENT_REVIEW: { label: "Client review", chip: "bg-primary/10 text-primary border-primary/30" },
  CHANGES_REQUESTED: { label: "Changes requested", chip: "bg-brand/10 text-brand border-brand/30" },
  APPROVED: { label: "Approved", chip: "bg-success/10 text-success border-success/30" },
  SCHEDULED: { label: "Scheduled", chip: "bg-accent/30 text-primary border-primary/30" },
  PUBLISHED: { label: "Published", chip: "bg-success text-white border-success" },
};
