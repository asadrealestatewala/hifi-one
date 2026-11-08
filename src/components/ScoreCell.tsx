import { SCORE, type ScoreParts } from "@/lib/scorecards";
import { Badge } from "@/components/ui";

const tone = (score: number): "success" | "warning" | "danger" => (score >= 80 ? "success" : score >= 50 ? "warning" : "danger");

// A day score with its four parts beside it and the full breakdown on hover, so the number always explains itself.
export default function ScoreCell({ score, parts }: { score: number; parts: ScoreParts | null }) {
  const title = parts ? `Attendance ${parts.attendance}/${SCORE.attendance} · Punctuality ${parts.punctuality}/${SCORE.punctuality} · Report ${parts.report}/${SCORE.report} · Output ${parts.output}/${SCORE.output} (${parts.outputBasis === "target" ? "daily target" : parts.outputBasis === "rating" ? "manager rating" : parts.outputBasis === "report" ? "report sent, not rated yet" : "nothing to go on"})` : undefined;
  return <span title={title} className="inline-flex items-center gap-1"><Badge tone={tone(score)}>{score}</Badge>{parts && <span className="text-[10px] text-muted">{parts.attendance}·{parts.punctuality}·{parts.report}·{parts.output}</span>}</span>;
}

