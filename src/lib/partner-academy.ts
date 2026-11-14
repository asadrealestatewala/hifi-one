// Hifi Partner Academy, step 1: courses, lessons with videos, quick checks after each lesson, and the training certificate issued
// automatically when a partner finishes the foundations course and a Solution's course. Free of Next.js imports so it can be tested.
//
// Rules enforced here, not in the screens:
// - Partners see the foundations course and the courses of the Solutions they are approved for, published lessons only.
// - Lessons open in order. A Solution's course opens once the foundations course is done (when one is published).
// - A lesson is done when the video is watched to 90% (or the lesson has no video and is read) and its quick check is passed.
//   "What's new" lessons are shown to everyone and are never needed for a certificate.
// - A quick check draws the lesson's quiz size (3 or 5) at random from its published questions and stores what was drawn, so grading
//   uses exactly what was shown. One wrong answer is allowed. Retakes draw a fresh set.
// - A lesson can be published only when its bank holds at least as many published questions as its quick check draws.
// - Questions start as drafts (typed, imported or drafted by Claude); partners never see a draft. Used questions are retired, not deleted.
// - Watching is reported by the partner's browser, so it is a guide, not proof: the quick checks and the final test are the real check.
// - Step 2, the final test of a Solution's course: open to a partner holding that Solution's training certificate and no valid
//   certificate of authorisation. Questions are drawn from every published question of the course's published lessons (including
//   "final test only" ones), shuffled and stored. A timer runs on the server; an attempt not submitted in time is closed as failed
//   with the answers saved so far. Pass mark, length, time, retake wait, tries and pause are settings. Passing issues the
//   certificate of authorisation automatically. Each failed or timed-out try counts; after the last try the test pauses and the
//   partner team is told.
// - Step 3, the refresher test renews the certificate of authorisation (12 months by default). It opens a set number of days before
//   the certificate expires (30 by default), stays open after it has expired (until it is revoked), or at once when the partner team
//   asks every certified partner to take it early after a big Solution change. It draws fewer questions (15) from the same pool, with
//   the same pass mark and retake rules (counted since the last renewal). Passing renews the same certificate, keeping its ID.
import type { Prisma, PrismaClient } from "@prisma/client";
import { getKey } from "./integration-keys";
import { notifyMany, usersWithPermission } from "./notifications";
import { appUrl, firstName, sendTemplateQuietly } from "./email-template-store";
import { getSettings, issueCertificate, renewCertificate } from "./partner-stack";

type Db = PrismaClient;
export class AcademyError extends Error { constructor(message: string, readonly status = 400) { super(message); } }

export const WATCHED_PCT = 90;
export const QUIZ_SIZES = [3, 5] as const;
export const MAX_OPTIONS = 6;
const cut = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const text = (v: unknown, n: number) => String(v ?? "").replace(/\r\n/g, "\n").trim().slice(0, n);

// ---------------------------------------------------------------------------------------------------------------------------
// Video links
// ---------------------------------------------------------------------------------------------------------------------------
export type Video = { provider: "youtube" | "vimeo" | "file"; id: string; embedUrl: string };

// YouTube (watch, youtu.be, embed, shorts, live), Vimeo (including unlisted links with their hash) or a direct https .mp4/.webm file.
export function parseVideoUrl(raw: string | null | undefined): Video | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  let u: URL;
  try { u = new URL(v); } catch { return null; }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.replace(/^www\.|^m\./, "");
  const yt = (id: string | null | undefined): Video | null => (id && /^[\w-]{11}$/.test(id) ? { provider: "youtube", id, embedUrl: `https://www.youtube-nocookie.com/embed/${id}?enablejsapi=1&rel=0&modestbranding=1` } : null);
  if (host === "youtu.be") return yt(u.pathname.slice(1).split("/")[0]);
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (u.pathname === "/watch") return yt(u.searchParams.get("v"));
    const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})/);
    return yt(m?.[1]);
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const m = u.pathname.match(/^\/(?:video\/)?(\d{6,12})(?:\/([0-9a-f]{6,20}))?/);
    if (!m) return null;
    const hash = m[2] ?? u.searchParams.get("h");
    const h = hash && /^[0-9a-f]{6,20}$/.test(hash) ? `h=${hash}&` : "";
    return { provider: "vimeo", id: m[1], embedUrl: `https://player.vimeo.com/video/${m[1]}?${h}dnt=1` };
  }
  if (/\.(mp4|webm)$/i.test(u.pathname)) return { provider: "file", id: u.href, embedUrl: u.href };
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Questions: cleaning, spreadsheet import
// ---------------------------------------------------------------------------------------------------------------------------
export type QuestionInput = { text: string; options: string[]; correct: number[]; explanation: string | null };

export function cleanQuestion(q: { text?: unknown; options?: unknown; correct?: unknown; explanation?: unknown }): QuestionInput {
  const t = text(q.text, 500);
  if (t.length < 5) throw new AcademyError("Write the question (at least 5 characters).");
  const options = (Array.isArray(q.options) ? q.options : []).map((o) => cut(o, 200)).filter(Boolean);
  if (options.length < 2) throw new AcademyError("Give at least two answers.");
  if (options.length > MAX_OPTIONS) throw new AcademyError(`Give at most ${MAX_OPTIONS} answers.`);
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) throw new AcademyError("Two answers are the same. Make each answer different.");
  const correct = [...new Set((Array.isArray(q.correct) ? q.correct : []).map(Number))].filter((n) => Number.isInteger(n)).sort((a, b) => a - b);
  if (correct.length === 0) throw new AcademyError("Mark the correct answer.");
  if (correct.some((n) => n < 0 || n >= options.length)) throw new AcademyError("The correct answer must be one of the answers given.");
  if (correct.length === options.length) throw new AcademyError("At least one answer must be wrong.");
  const explanation = text(q.explanation, 500) || null;
  return { text: t, options, correct, explanation };
}

// "B" -> [1]; "A, C" -> [0, 2]; also accepts 1-based numbers ("2").
export function parseCorrect(raw: string): number[] {
  return raw.split(/[\s,;/&+]+/).filter(Boolean).map((p) => (/^[a-f]$/i.test(p) ? p.toUpperCase().charCodeAt(0) - 65 : /^\d$/.test(p) ? Number(p) - 1 : NaN));
}

function splitRows(src: string): string[][] {
  const body = src.replace(/^﻿/, "");
  const first = body.split(/\r?\n/, 1)[0] ?? "";
  if (first.includes("\t")) return body.split(/\r?\n/).map((l) => l.split("\t")).filter((r) => r.some((c) => c.trim()));
  // Commas or semicolons, with quotes ("..." and "" inside)
  const delimiter = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quoted) { if (c === '"') { if (body[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c; }
    else if (c === '"') quoted = true;
    else if (c === delimiter) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && body[i + 1] === "\n") i++; row.push(field); field = ""; if (row.some((f) => f.trim())) rows.push(row); row = []; }
    else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}

// Columns: Question | Answer A | Answer B | Answer C | Answer D | Correct (A, B, "A,C") | Explanation. A header row is optional.
// Pasted straight from Google Sheets or Excel (tabs) or a saved .csv file. Returns every problem with its row number.
export function parseQuestionSheet(src: string): { questions: QuestionInput[]; errors: string[] } {
  const rows = splitRows(src);
  // A header row names the columns, so its "correct" cell is not a letter
  const head = rows[0];
  if (head && /question/i.test(head[0] ?? "") && parseCorrect((head[5] ?? "").trim()).some((x) => Number.isNaN(x))) rows.shift();
  const questions: QuestionInput[] = [];
  const errors: string[] = [];
  if (rows.length === 0) errors.push("Nothing to import. Paste rows with a question, four answers, the correct letter and an explanation.");
  if (rows.length > 200) errors.push("Import at most 200 questions at a time.");
  rows.slice(0, 200).forEach((r, i) => {
    const cells = r.map((c) => c.trim());
    try {
      if (cells.length < 6) throw new AcademyError("needs at least 6 columns: question, answers A to D, correct letter");
      const answers = cells.slice(1, 5);
      const letters = parseCorrect(cells[5]);
      if (letters.length === 0 || letters.some((n) => Number.isNaN(n))) throw new AcademyError(`the correct answer "${cells[5]}" should be a letter A to D`);
      // Empty answer cells are dropped, so the letters must point at filled cells
      if (letters.some((n) => !answers[n])) throw new AcademyError(`answer ${letters.map((n) => String.fromCharCode(65 + n)).join(", ")} is empty`);
      const kept = answers.map((a, idx) => ({ a, idx })).filter((x) => x.a);
      questions.push(cleanQuestion({ text: cells[0], options: kept.map((x) => x.a), correct: letters.map((n) => kept.findIndex((x) => x.idx === n)), explanation: cells[6] }));
    } catch (e) {
      if (!(e instanceof AcademyError)) throw e;
      errors.push(`Row ${i + 1}: ${e.message.charAt(0).toLowerCase()}${e.message.slice(1).replace(/\.$/, "")}.`);
    }
  });
  return { questions, errors };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Staff: courses, lessons, questions
// ---------------------------------------------------------------------------------------------------------------------------
const STATUSES = ["DRAFT", "PUBLISHED"] as const;
const status = (v: unknown) => ((STATUSES as readonly string[]).includes(String(v)) ? String(v) : "DRAFT");

export async function saveCourse(db: Db, p: { organizationId: string; id?: string; solutionCode: string; title: string; summary: string; status: string; actorId: string }) {
  const title = cut(p.title, 120);
  if (title.length < 3) throw new AcademyError("Give the course a title.");
  const summary = text(p.summary, 1000) || null;
  let productId: string | null = null;
  if (p.solutionCode) {
    const sol = await db.saasProduct.findFirst({ where: { organizationId: p.organizationId, code: p.solutionCode } });
    if (!sol) throw new AcademyError("Choose a Solution, or Foundations for the course every partner takes first.");
    productId = sol.id;
  }
  const clash = await db.academyCourse.findFirst({ where: { organizationId: p.organizationId, productId, ...(p.id ? { id: { not: p.id } } : {}) } });
  if (clash) throw new AcademyError(productId ? "That Solution already has a course. Add lessons to it instead." : "There is already a foundations course. Add lessons to it instead.");
  const st = status(p.status);
  if (p.id) {
    const before = await db.academyCourse.findFirst({ where: { id: p.id, organizationId: p.organizationId } });
    if (!before) throw new AcademyError("Course not found.", 404);
    if (st === "PUBLISHED") await assertCoursePublishable(db, p.id);
    const after = await db.academyCourse.update({ where: { id: p.id }, data: { productId, title, summary, status: st } });
    return { before, after };
  }
  if (st === "PUBLISHED") throw new AcademyError("Add and publish at least one lesson before publishing the course. Save it as a draft first.");
  const after = await db.academyCourse.create({ data: { organizationId: p.organizationId, productId, title, summary, status: st, createdById: p.actorId } });
  return { before: null, after };
}

async function assertCoursePublishable(db: Db, courseId: string) {
  const n = await db.academyLesson.count({ where: { courseId, status: "PUBLISHED", isUpdate: false } });
  if (n === 0) throw new AcademyError("Publish at least one lesson in this course first.");
}

export async function saveLesson(db: Db, p: {
  organizationId: string; courseId: string; id?: string; title: string; videoUrl: string; durationMinutes: string; script: string; notes: string;
  sortOrder: string; quizSize: string; isUpdate: boolean; status: string;
}) {
  const course = await db.academyCourse.findFirst({ where: { id: p.courseId, organizationId: p.organizationId } });
  if (!course) throw new AcademyError("Course not found.", 404);
  const title = cut(p.title, 140);
  if (title.length < 3) throw new AcademyError("Give the lesson a title.");
  const videoUrl = p.videoUrl.trim() || null;
  if (videoUrl && !parseVideoUrl(videoUrl)) throw new AcademyError("Paste a YouTube or Vimeo link (unlisted is fine), or a direct https link to an .mp4 file.");
  const minutesRaw = p.durationMinutes.trim();
  if (minutesRaw && (!/^\d{1,3}$/.test(minutesRaw) || Number(minutesRaw) < 1)) throw new AcademyError("Length is a whole number of minutes.");
  const orderRaw = p.sortOrder.trim();
  if (orderRaw && !/^\d{1,3}$/.test(orderRaw)) throw new AcademyError("Order is a whole number, 1 for the first lesson.");
  const quizSize = Number(p.quizSize);
  if (!(QUIZ_SIZES as readonly number[]).includes(quizSize)) throw new AcademyError("The quick check has 3 or 5 questions.");
  const script = text(p.script, 30_000) || null;
  const notes = text(p.notes, 5000) || null;
  if (!videoUrl && !notes) throw new AcademyError("Add a video link or the lesson notes.");
  const st = status(p.status);
  const sortOrder = orderRaw ? Number(orderRaw) : (await db.academyLesson.count({ where: { courseId: course.id } })) + 1;
  const data = { title, videoUrl, durationMinutes: minutesRaw ? Number(minutesRaw) : null, script, notes, sortOrder, quizSize, isUpdate: p.isUpdate, status: st };
  if (p.id) {
    const before = await db.academyLesson.findFirst({ where: { id: p.id, courseId: course.id } });
    if (!before) throw new AcademyError("Lesson not found.", 404);
    if (st === "PUBLISHED") await assertLessonPublishable(db, before.id, quizSize, p.isUpdate);
    if (st === "DRAFT" && before.status === "PUBLISHED" && !before.isUpdate) await assertNotLastLesson(db, course.id, course.status, before.id);
    const after = await db.academyLesson.update({ where: { id: before.id }, data });
    return { before, after };
  }
  if (st === "PUBLISHED" && !p.isUpdate) throw new AcademyError("Save the lesson as a draft, add its questions, then publish it.");
  const after = await db.academyLesson.create({ data: { ...data, organizationId: p.organizationId, courseId: course.id } });
  return { before: null, after };
}

async function assertLessonPublishable(db: Db, lessonId: string, quizSize: number, isUpdate: boolean) {
  if (isUpdate) return; // What's new lessons have no quick check
  const n = await db.academyQuestion.count({ where: { lessonId, status: "PUBLISHED", finalOnly: false } });
  if (n < quizSize) throw new AcademyError(`Publish at least ${quizSize} quick-check questions for this lesson first (it has ${n}; "final test only" questions do not count). About 10 gives partners a fresh set on a retake.`);
}

async function assertNotLastLesson(db: Db, courseId: string, courseStatus: string, lessonId: string) {
  if (courseStatus !== "PUBLISHED") return;
  const others = await db.academyLesson.count({ where: { courseId, status: "PUBLISHED", isUpdate: false, id: { not: lessonId } } });
  if (others === 0) throw new AcademyError("This is the only published lesson of a published course. Unpublish the course first.");
}

// Only a lesson nobody has started can be deleted; otherwise move it back to draft.
export async function deleteLesson(db: Db, p: { organizationId: string; id: string }) {
  const lesson = await db.academyLesson.findFirst({ where: { id: p.id, organizationId: p.organizationId }, include: { course: true, _count: { select: { progress: true, attempts: true } } } });
  if (!lesson) throw new AcademyError("Lesson not found.", 404);
  if (lesson._count.progress + lesson._count.attempts > 0) throw new AcademyError("Partners have started this lesson, so it cannot be deleted. Move it back to draft to hide it.");
  if (lesson.status === "PUBLISHED" && !lesson.isUpdate) await assertNotLastLesson(db, lesson.courseId, lesson.course.status, lesson.id);
  await db.academyLesson.delete({ where: { id: lesson.id } });
  return lesson;
}

async function lessonOf(db: Db, organizationId: string, lessonId: string) {
  const lesson = await db.academyLesson.findFirst({ where: { id: lessonId, organizationId } });
  if (!lesson) throw new AcademyError("Lesson not found.", 404);
  return lesson;
}

export async function addQuestion(db: Db, p: { organizationId: string; lessonId: string; input: Parameters<typeof cleanQuestion>[0]; finalOnly?: boolean; actorId: string }) {
  const lesson = await lessonOf(db, p.organizationId, p.lessonId);
  const q = cleanQuestion(p.input);
  return db.academyQuestion.create({ data: { ...q, finalOnly: Boolean(p.finalOnly), organizationId: p.organizationId, lessonId: lesson.id, status: "DRAFT", source: "MANUAL", createdById: p.actorId } });
}

// Drafts can be corrected; a published question is retired and replaced, so past attempts keep the wording they were graded on.
export async function updateQuestion(db: Db, p: { organizationId: string; id: string; input: Parameters<typeof cleanQuestion>[0] }) {
  const before = await db.academyQuestion.findFirst({ where: { id: p.id, organizationId: p.organizationId } });
  if (!before) throw new AcademyError("Question not found.", 404);
  if (before.status !== "DRAFT") throw new AcademyError("Only a draft can be edited. Retire this question and add a corrected one.");
  const after = await db.academyQuestion.update({ where: { id: before.id }, data: cleanQuestion(p.input) });
  return { before, after };
}

export async function setQuestionStatus(db: Db, p: { organizationId: string; id: string; action: string }) {
  const q = await db.academyQuestion.findFirst({ where: { id: p.id, organizationId: p.organizationId }, include: { lesson: true } });
  if (!q) throw new AcademyError("Question not found.", 404);
  if (p.action === "publish") {
    if (q.status !== "DRAFT") throw new AcademyError("Only a draft can be published.");
    return db.academyQuestion.update({ where: { id: q.id }, data: { status: "PUBLISHED" } });
  }
  if (p.action === "delete") {
    if (q.status !== "DRAFT") throw new AcademyError("Only a draft can be deleted. Retire a published question instead.");
    await db.academyQuestion.delete({ where: { id: q.id } });
    return q;
  }
  if (p.action === "retire") {
    if (q.status !== "PUBLISHED") throw new AcademyError("Only a published question can be retired.");
    if (q.lesson.status === "PUBLISHED" && !q.lesson.isUpdate) {
      const left = q.finalOnly ? Infinity : await db.academyQuestion.count({ where: { lessonId: q.lessonId, status: "PUBLISHED", finalOnly: false, id: { not: q.id } } });
      if (left < q.lesson.quizSize) throw new AcademyError(`This lesson's quick check needs ${q.lesson.quizSize} published questions. Publish another one first.`);
    }
    return db.academyQuestion.update({ where: { id: q.id }, data: { status: "RETIRED" } });
  }
  throw new AcademyError("Unknown action.");
}

// All or nothing: if any row has a problem, nothing is imported and every problem is listed.
export async function importQuestions(db: Db, p: { organizationId: string; lessonId: string; sheet: string; finalOnly?: boolean; actorId: string }) {
  const lesson = await lessonOf(db, p.organizationId, p.lessonId);
  const { questions, errors } = parseQuestionSheet(p.sheet);
  if (errors.length) throw new AcademyError(`Nothing was imported. ${errors.slice(0, 5).join(" ")}${errors.length > 5 ? ` And ${errors.length - 5} more.` : ""}`);
  await db.academyQuestion.createMany({ data: questions.map((q) => ({ ...q, finalOnly: Boolean(p.finalOnly), organizationId: p.organizationId, lessonId: lesson.id, status: "DRAFT", source: "IMPORT", createdById: p.actorId })) });
  return { count: questions.length };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Drafting questions with Claude (optional; needs the Anthropic key in Settings > Integrations)
// ---------------------------------------------------------------------------------------------------------------------------
export const ACADEMY_MODEL = process.env.ACADEMY_MODEL ?? "claude-opus-5-5";
const DRAFT_SCHEMA = {
  type: "object", additionalProperties: false, required: ["questions"],
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["question", "answers", "correct", "explanation"],
        properties: {
          question: { type: "string" },
          answers: { type: "array", items: { type: "string" } },
          correct: { type: "array", items: { type: "integer" } },
          explanation: { type: "string" },
        },
      },
    },
  },
} as const;

export function draftPrompt(lesson: { title: string; script: string }, solution: string | null, count: number) {
  return [
    `You write quick-check questions for the Hifi Partner Academy, where sales partners learn ${solution ? `to sell ${solution}` : "how the partner programme works"}.`,
    `Write ${count} multiple-choice questions that test the lesson below. Each question:`,
    "- tests one fact or skill a partner needs when talking to a client, taken only from the lesson script (never invent features, prices or policies);",
    "- has four answers, exactly one correct (the correct field holds its index, 0 to 3), with wrong answers that are believable but clearly wrong to someone who watched;",
    "- avoids \"all of the above\", \"none of the above\" and trick wording;",
    "- has a one-sentence explanation of the right answer, written to the partner.",
    "Plain English, short sentences. Vary which position holds the correct answer.",
    "",
    `Lesson title: ${lesson.title}`,
    "Lesson script:",
    "<script>",
    lesson.script,
    "</script>",
  ].join("\n");
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export async function draftQuestionsWithClaude(db: Db, p: { organizationId: string; lessonId: string; actorId: string; count?: number; finalOnly?: boolean; fetchImpl?: FetchLike; apiKey?: string }) {
  const lesson = await db.academyLesson.findFirst({ where: { id: p.lessonId, organizationId: p.organizationId }, include: { course: { include: { product: { select: { name: true } } } } } });
  if (!lesson) throw new AcademyError("Lesson not found.", 404);
  if (!lesson.script || lesson.script.length < 200) throw new AcademyError("Paste the lesson script (what the video says, at least a paragraph) and save the lesson first. The questions are drafted from it.");
  const key = p.apiKey ?? (await getKey(db, p.organizationId, "ANTHROPIC"));
  if (!key) throw new AcademyError("Drafting with Claude is not configured: a Super Admin adds the Anthropic API key in Settings → Integrations. You can import questions from a spreadsheet instead.");
  const count = Math.min(Math.max(p.count ?? 10, 3), 15);
  const doFetch: FetchLike = p.fetchImpl ?? (fetch as unknown as FetchLike);
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await doFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: ACADEMY_MODEL, max_tokens: 16000,
        output_config: { effort: "medium", format: { type: "json_schema", schema: DRAFT_SCHEMA } },
        messages: [{ role: "user", content: draftPrompt({ title: lesson.title, script: lesson.script }, lesson.course.product?.name ?? null, count) }],
      }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch {
    throw new AcademyError("Claude could not be reached. Try again in a minute.");
  }
  const body = (await res.json().catch(() => null)) as { stop_reason?: string; content?: { type: string; text?: string }[]; error?: { message?: string } } | null;
  if (!res.ok) throw new AcademyError(res.status === 401 ? "The Anthropic API key was refused. Check it in Settings → Integrations." : `Claude returned an error (${res.status}). Try again later.`);
  if (body?.stop_reason === "refusal") throw new AcademyError("Claude declined to draft questions for this script. Write them by hand or import them.");
  if (body?.stop_reason === "max_tokens") throw new AcademyError("The answer was cut off. Shorten the script or try again.");
  const out = body?.content?.find((c) => c.type === "text")?.text;
  let parsed: { questions?: { question: string; answers: string[]; correct: number[]; explanation: string }[] };
  try { parsed = JSON.parse(out ?? ""); } catch { throw new AcademyError("Claude's answer could not be read. Try again."); }
  const good: QuestionInput[] = [];
  for (const q of parsed.questions ?? []) {
    try { good.push(cleanQuestion({ text: q.question, options: q.answers, correct: q.correct, explanation: q.explanation })); } catch (e) { if (!(e instanceof AcademyError)) throw e; }
  }
  if (good.length === 0) throw new AcademyError("Claude's questions did not pass the checks. Try again or write them by hand.");
  await db.academyQuestion.createMany({ data: good.map((q) => ({ ...q, finalOnly: Boolean(p.finalOnly), organizationId: p.organizationId, lessonId: lesson.id, status: "DRAFT", source: "CLAUDE", createdById: p.actorId })) });
  return { count: good.length, skipped: (parsed.questions?.length ?? 0) - good.length };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Partners: what they see, watching, quick checks, the automatic training certificate
// ---------------------------------------------------------------------------------------------------------------------------
type EarnerRef = { id: string; organizationId: string; name: string };
export type LessonState = "locked" | "open" | "done";

const liveTraining = (now: Date): Prisma.PartnerCertificateWhereInput => ({ kind: "TRAINING", status: "ACTIVE", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] });

// Lesson locks for one course: required lessons open one after another; What's new lessons are always open.
export function lessonStates(lessons: { id: string; isUpdate: boolean }[], doneIds: ReadonlySet<string>, courseOpen: boolean): Map<string, LessonState> {
  const states = new Map<string, LessonState>();
  let gate = courseOpen;
  for (const l of lessons) {
    if (l.isUpdate) { states.set(l.id, doneIds.has(l.id) ? "done" : "open"); continue; }
    if (doneIds.has(l.id)) { states.set(l.id, "done"); continue; }
    states.set(l.id, gate ? "open" : "locked");
    gate = false;
  }
  return states;
}

export async function academyFor(db: Db, earner: EarnerRef, now = new Date()) {
  const sols = await db.earnerSolution.findMany({ where: { earnerId: earner.id }, select: { productId: true } });
  const courses = await db.academyCourse.findMany({
    where: { organizationId: earner.organizationId, status: "PUBLISHED", OR: [{ productId: null }, { productId: { in: sols.map((s) => s.productId) } }] },
    include: { product: { select: { id: true, name: true, sortOrder: true } }, lessons: { where: { status: "PUBLISHED" }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
  });
  courses.sort((a, b) => (a.productId === null ? -1 : b.productId === null ? 1 : (a.product?.sortOrder ?? 0) - (b.product?.sortOrder ?? 0)));
  const lessonIds = courses.flatMap((c) => c.lessons.map((l) => l.id));
  const [progress, certs] = await Promise.all([
    db.academyLessonProgress.findMany({ where: { earnerId: earner.id, lessonId: { in: lessonIds } } }),
    db.partnerCertificate.findMany({ where: { earnerId: earner.id, ...liveTraining(now) }, select: { productId: true, publicId: true } }),
  ]);
  const byLesson = new Map(progress.map((p) => [p.lessonId, p]));
  const done = new Set(progress.filter((p) => p.completedAt).map((p) => p.lessonId));
  const required = (c: (typeof courses)[number]) => c.lessons.filter((l) => !l.isUpdate);
  const foundations = courses.find((c) => c.productId === null);
  const foundationsDone = !foundations || required(foundations).every((l) => done.has(l.id));
  return courses.map((c) => {
    const open = c.productId === null || foundationsDone;
    const states = lessonStates(c.lessons, done, open);
    const req = required(c);
    return {
      course: c, open, isFoundations: c.productId === null,
      lessons: c.lessons.map((l) => ({ lesson: l, state: states.get(l.id)!, progress: byLesson.get(l.id) ?? null })),
      doneCount: req.filter((l) => done.has(l.id)).length, requiredCount: req.length,
      certificate: c.productId ? certs.find((x) => x.productId === c.productId) ?? null : null,
    };
  });
}

// The lesson a partner opened, if it is theirs to see and open. Locked or hidden lessons answer as not found.
export async function lessonForPartner(db: Db, earner: EarnerRef, lessonId: string, now = new Date()) {
  for (const c of await academyFor(db, earner, now)) {
    const hit = c.lessons.find((x) => x.lesson.id === lessonId);
    if (hit) {
      if (hit.state === "locked") throw new AcademyError(c.open ? "Finish the lessons before this one first." : "Finish the foundations course first.", 403);
      const next = c.lessons.find((x, i) => i > c.lessons.indexOf(hit) && !x.lesson.isUpdate);
      return { ...hit, course: c.course, isFoundations: c.isFoundations, nextLessonId: next?.lesson.id ?? null };
    }
  }
  throw new AcademyError("Lesson not found.", 404);
}

const needsQuiz = (l: { isUpdate: boolean }) => !l.isUpdate;

// Called by the player as the partner watches (and by "Mark as read" for a lesson without a video, with 100).
export async function recordWatch(db: Db, p: { earner: EarnerRef; lessonId: string; pct: number; now?: Date }) {
  const now = p.now ?? new Date();
  const { lesson, progress } = await lessonForPartner(db, p.earner, p.lessonId, now);
  const pct = Math.max(0, Math.min(100, Math.round(Number.isFinite(p.pct) ? p.pct : 0)));
  if (progress && pct <= progress.watchedPct) return { progress, certificates: [] as string[] };
  const watchedAt = progress?.watchedAt ?? (pct >= WATCHED_PCT ? now : null);
  const completedAt = progress?.completedAt ?? (watchedAt && (!needsQuiz(lesson) || progress?.quizPassedAt) ? now : null);
  const row = await db.academyLessonProgress.upsert({
    where: { earnerId_lessonId: { earnerId: p.earner.id, lessonId: lesson.id } },
    create: { organizationId: p.earner.organizationId, earnerId: p.earner.id, lessonId: lesson.id, watchedPct: pct, watchedAt, completedAt },
    update: { watchedPct: pct, watchedAt, completedAt },
  });
  const certificates = completedAt && !progress?.completedAt ? await issueEarnedTraining(db, p.earner, now) : [];
  return { progress: row, certificates };
}

export type QuizQuestion = { id: string; text: string; options: string[]; multiple: boolean };

function shuffle<T>(a: T[], rand: () => number): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}

// Starting (or resuming, within 30 minutes) a quick check. Reloading the page shows the same questions, so it cannot be used to fish.
export async function startQuiz(db: Db, p: { earner: EarnerRef; lessonId: string; now?: Date; rand?: () => number }) {
  const now = p.now ?? new Date();
  const { lesson, progress } = await lessonForPartner(db, p.earner, p.lessonId, now);
  if (!needsQuiz(lesson)) throw new AcademyError("This lesson has no quick check.");
  if (!progress?.watchedAt) throw new AcademyError(lesson.videoUrl ? `Watch the video to the end (at least ${WATCHED_PCT}%) first.` : "Read the lesson and mark it as read first.");
  const open = await db.academyQuizAttempt.findFirst({ where: { earnerId: p.earner.id, lessonId: lesson.id, submittedAt: null, startedAt: { gt: new Date(now.getTime() - 30 * 60_000) } }, orderBy: { startedAt: "desc" } });
  let attempt = open;
  if (!attempt) {
    const bank = await db.academyQuestion.findMany({ where: { lessonId: lesson.id, status: "PUBLISHED", finalOnly: false }, select: { id: true } });
    if (bank.length === 0) throw new AcademyError("This lesson's quick check is not ready yet. The partner team has been told.");
    const ids = shuffle(bank.map((b) => b.id), p.rand ?? Math.random).slice(0, lesson.quizSize);
    attempt = await db.academyQuizAttempt.create({ data: { organizationId: p.earner.organizationId, earnerId: p.earner.id, lessonId: lesson.id, questionIds: ids, startedAt: now } });
  }
  const qs = await db.academyQuestion.findMany({ where: { id: { in: attempt.questionIds } } });
  const byId = new Map(qs.map((q) => [q.id, q]));
  const questions: QuizQuestion[] = attempt.questionIds.map((id) => byId.get(id)).filter((q) => q !== undefined).map((q) => ({ id: q.id, text: q.text, options: q.options, multiple: q.correct.length > 1 }));
  return { attemptId: attempt.id, questions };
}

// One wrong answer is allowed. Partners see which questions they missed and why, never the right option itself.
export const quizPassed = (correct: number, total: number) => total > 0 && total - correct <= 1;

export async function submitQuiz(db: Db, p: { earner: EarnerRef; attemptId: string; answers: Record<string, number[]>; now?: Date }) {
  const now = p.now ?? new Date();
  const attempt = await db.academyQuizAttempt.findFirst({ where: { id: p.attemptId, earnerId: p.earner.id } });
  if (!attempt) throw new AcademyError("Quick check not found.", 404);
  if (attempt.submittedAt) throw new AcademyError("This quick check was already submitted. Start a new one.");
  await lessonForPartner(db, p.earner, attempt.lessonId, now); // still visible and open
  const qs = await db.academyQuestion.findMany({ where: { id: { in: attempt.questionIds } } });
  const byId = new Map(qs.map((q) => [q.id, q]));
  const results = attempt.questionIds.map((id) => {
    const q = byId.get(id);
    const chosen = [...new Set((p.answers[id] ?? []).map(Number))].sort((a, b) => a - b);
    const right = !!q && chosen.length === q.correct.length && chosen.every((n, i) => n === q.correct[i]);
    return { id, text: q?.text ?? "", right, explanation: right ? null : q?.explanation ?? null, answered: chosen.length > 0 };
  });
  const correctCount = results.filter((r) => r.right).length;
  const passed = quizPassed(correctCount, results.length);
  // Only the first submit counts if two arrive together
  const marked = await db.academyQuizAttempt.updateMany({ where: { id: attempt.id, submittedAt: null }, data: { submittedAt: now, answers: p.answers, correctCount, passed } });
  if (marked.count === 0) throw new AcademyError("This quick check was already submitted. Start a new one.");
  let certificates: string[] = [];
  if (passed) {
    const prev = await db.academyLessonProgress.findUnique({ where: { earnerId_lessonId: { earnerId: p.earner.id, lessonId: attempt.lessonId } } });
    if (prev && !prev.quizPassedAt) {
      const completedAt = prev.completedAt ?? (prev.watchedAt ? now : null);
      await db.academyLessonProgress.update({ where: { id: prev.id }, data: { quizPassedAt: now, quizScore: `${correctCount}/${results.length}`, completedAt } });
      if (completedAt && !prev.completedAt) certificates = await issueEarnedTraining(db, p.earner, now);
    }
  }
  return { correctCount, total: results.length, passed, results, certificates };
}

// Issues the training certificate for every Solution whose course (and the foundations course) the partner has now finished and
// for which they do not already hold a live one. Returns the certificate ids issued.
export async function issueEarnedTraining(db: Db, earner: EarnerRef, now = new Date()): Promise<string[]> {
  const view = await academyFor(db, earner, now);
  const foundations = view.find((c) => c.isFoundations);
  if (foundations && foundations.doneCount < foundations.requiredCount) return [];
  const issued: string[] = [];
  for (const c of view) {
    if (c.isFoundations || !c.course.product || c.certificate || c.requiredCount === 0 || c.doneCount < c.requiredCount) continue;
    const product = await db.saasProduct.findUniqueOrThrow({ where: { id: c.course.product.id }, select: { code: true, name: true } });
    const cert = await issueCertificate(db, { organizationId: earner.organizationId, earnerId: earner.id, solutionCode: product.code, kind: "TRAINING", actorId: null, now });
    issued.push(cert.id);
    await notifyMany(db, await usersWithPermission(db, earner.organizationId, "partners.manage"), {
      kind: "partner.academy_completed", title: `${earner.name} finished the ${product.name} training`, body: "The training certificate was issued automatically.",
      link: "/partner-stack/academy", dedupeKey: `partner-academy-done:${earner.id}:${c.course.id}`,
    });
  }
  return issued;
}

// Staff view: every active partner's progress per published course.
// show "renewal": only partners with a certificate of authorisation that expires within 30 days or has expired (not revoked).
export async function academyProgress(db: Db, organizationId: string, p: { q?: string; show?: string; skip: number; take: number; now?: Date }) {
  const now = p.now ?? new Date();
  const where: Prisma.EarnerWhereInput = {
    organizationId, status: "ACTIVE", ...(p.q ? { OR: [{ name: { contains: p.q, mode: "insensitive" } }, { email: { contains: p.q, mode: "insensitive" } }] } : {}),
    ...(p.show === "renewal" ? { certificates: { some: { kind: "AUTHORISATION", status: "ACTIVE", expiresAt: { lte: new Date(now.getTime() + 30 * 86_400_000) } } } } : {}),
  };
  const [earners, total, courses] = await Promise.all([
    db.earner.findMany({ where, orderBy: { partnerNumber: "asc" }, skip: p.skip, take: p.take, include: { solutions: { select: { productId: true } }, type: { select: { name: true } } } }),
    db.earner.count({ where }),
    db.academyCourse.findMany({ where: { organizationId, status: "PUBLISHED" }, include: { product: { select: { name: true, sortOrder: true } }, lessons: { where: { status: "PUBLISHED", isUpdate: false }, select: { id: true } } } }),
  ]);
  // Foundations first, then the Solutions in their usual order
  courses.sort((a, b) => (a.productId === null ? -1 : b.productId === null ? 1 : (a.product?.sortOrder ?? 0) - (b.product?.sortOrder ?? 0)));
  const ids = earners.map((e) => e.id);
  const [done, tests, certs] = await Promise.all([
    db.academyLessonProgress.findMany({ where: { earnerId: { in: ids }, completedAt: { not: null } }, select: { earnerId: true, lessonId: true, completedAt: true } }),
    db.academyTestAttempt.findMany({ where: { organizationId, earnerId: { in: ids }, status: { not: "IN_PROGRESS" } }, orderBy: { startedAt: "desc" }, select: { earnerId: true, productId: true, kind: true, scorePct: true, passed: true } }),
    db.partnerCertificate.findMany({ where: { organizationId, earnerId: { in: ids }, kind: "AUTHORISATION", status: "ACTIVE" }, orderBy: { issuedAt: "desc" }, select: { earnerId: true, productId: true, expiresAt: true } }),
  ]);
  const rows = earners.map((e) => {
    const mine = done.filter((d) => d.earnerId === e.id);
    const lessonIds = new Set(mine.map((d) => d.lessonId));
    const last = mine.reduce<Date | null>((m, d) => (d.completedAt && (!m || d.completedAt > m) ? d.completedAt : m), null);
    const per = courses.filter((c) => c.productId === null || e.solutions.some((s) => s.productId === c.productId)).map((c) => ({
      title: c.product?.name ?? "Foundations", done: c.lessons.filter((l) => lessonIds.has(l.id)).length, of: c.lessons.length,
      test: c.productId ? (() => { const t = tests.filter((x) => x.earnerId === e.id && x.productId === c.productId && x.kind === "FINAL"); return t.length ? { tries: t.length, last: t[0].scorePct, passed: t.some((x) => x.passed) } : null; })() : null,
      // The certificate of authorisation they hold (valid or expired) and when it runs out
      expiresAt: c.productId ? certs.find((x) => x.earnerId === e.id && x.productId === c.productId)?.expiresAt ?? null : null,
    }));
    return { earner: e, courses: per, lastActivity: last };
  });
  return { rows, total };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Step 2: the final test
// ---------------------------------------------------------------------------------------------------------------------------
export type TestKind = "FINAL" | "REFRESHER";
export type TestRules = { questions: number; passPct: number; minutes: number; retakeHours: number; maxTries: number; pauseDays: number };
const num = (v: string | undefined, fallback: number) => { const n = Number.parseInt(v ?? "", 10); return Number.isFinite(n) ? n : fallback; };
export function testRules(settings: Record<string, string>): TestRules {
  return {
    questions: num(settings.academy_test_questions, 30), passPct: num(settings.academy_test_pass_pct, 75), minutes: num(settings.academy_test_minutes, 45),
    retakeHours: num(settings.academy_retake_hours, 24), maxTries: num(settings.academy_max_tries, 3), pauseDays: num(settings.academy_pause_days, 7),
  };
}
// The refresher: its own length and time; the pass mark and retake rules are the final test's.
export function refresherRules(settings: Record<string, string>): TestRules & { windowDays: number } {
  return { ...testRules(settings), questions: num(settings.academy_refresher_questions, 15), minutes: num(settings.academy_refresher_minutes, 20), windowDays: num(settings.academy_refresher_window_days, 30) };
}
// When the refresher opens for a certificate: the window before expiry, or earlier if the partner team asked for it after the
// certificate was last issued or renewed.
export function refresherOpensAt(cert: { issuedAt: Date; expiresAt: Date | null }, windowDays: number, askedAt: Date | null): Date | null {
  const byExpiry = cert.expiresAt ? new Date(cert.expiresAt.getTime() - windowDays * 86_400_000) : null;
  const asked = askedAt && askedAt > cert.issuedAt ? askedAt : null;
  if (byExpiry && asked) return byExpiry < asked ? byExpiry : asked;
  return byExpiry ?? asked;
}
const SUBMIT_GRACE_MS = 60_000; // a submit that left the browser just before the deadline still counts

// Whether a partner may start the test now, from the times of their failed tries (oldest first). After maxTries failures the test
// pauses for pauseDays from the last one, then the count starts again.
export function testGate(failedAt: Date[], now: Date, r: Pick<TestRules, "retakeHours" | "maxTries" | "pauseDays">) {
  let tries = 0;
  let pausedUntil: Date | null = null;
  for (const f of failedAt) {
    if (pausedUntil && f >= pausedUntil) pausedUntil = null;
    tries++;
    if (tries >= r.maxTries) { pausedUntil = new Date(f.getTime() + r.pauseDays * 86_400_000); tries = 0; }
  }
  if (pausedUntil && now < pausedUntil) return { canStart: false, paused: true, nextAt: pausedUntil, triesLeft: r.maxTries };
  const last = failedAt.at(-1);
  const retakeAt = last ? new Date(last.getTime() + r.retakeHours * 3_600_000) : null;
  const triesLeft = r.maxTries - (pausedUntil ? 0 : tries);
  if (retakeAt && now < retakeAt) return { canStart: false, paused: false, nextAt: retakeAt, triesLeft };
  return { canStart: true, paused: false, nextAt: null as Date | null, triesLeft };
}

export const scorePct = (correct: number, total: number) => (total > 0 ? Math.floor((correct * 100) / total) : 0);

const isRight = (q: { correct: number[] } | undefined, chosen: number[] | undefined) => {
  if (!q) return false;
  const c = [...new Set((chosen ?? []).map(Number))].sort((a, b) => a - b);
  return c.length === q.correct.length && c.every((n, i) => n === q.correct[i]);
};

async function solutionCourse(db: Db, earner: EarnerRef, courseId: string) {
  const course = await db.academyCourse.findFirst({ where: { id: courseId, organizationId: earner.organizationId, status: "PUBLISHED", productId: { not: null } }, include: { product: true } });
  if (!course?.product || !course.productId) throw new AcademyError("Test not found.", 404);
  const approved = await db.earnerSolution.findFirst({ where: { earnerId: earner.id, productId: course.productId } });
  if (!approved) throw new AcademyError("Test not found.", 404);
  return { course, product: course.product };
}

// The course's final-test pool: every published question of its published lessons (quick-check and final-only).
async function testPool(db: Db, courseId: string) {
  return db.academyQuestion.findMany({ where: { status: "PUBLISHED", lesson: { courseId, status: "PUBLISHED" } }, select: { id: true } });
}

// Closes the partner's attempts whose time ran out, grading the answers saved so far.
async function closeExpired(db: Db, earnerId: string, now: Date) {
  const late = await db.academyTestAttempt.findMany({ where: { earnerId, status: "IN_PROGRESS", deadlineAt: { lt: new Date(now.getTime() - SUBMIT_GRACE_MS) } } });
  for (const a of late) await grade(db, a, (a.answers ?? {}) as Record<string, number[]>, "EXPIRED", a.deadlineAt);
}

async function grade(db: Db, a: { id: string; questionIds: string[]; total: number; passMark: number }, answers: Record<string, number[]>, status: "SUBMITTED" | "EXPIRED", at: Date) {
  const qs = await db.academyQuestion.findMany({ where: { id: { in: a.questionIds } }, select: { id: true, correct: true, lessonId: true } });
  const byId = new Map(qs.map((q) => [q.id, q]));
  const correctCount = a.questionIds.filter((id) => isRight(byId.get(id), answers[id])).length;
  const pct = scorePct(correctCount, a.total);
  const passed = status === "SUBMITTED" && pct >= a.passMark;
  // Only the first close counts if two arrive together
  const done = await db.academyTestAttempt.updateMany({ where: { id: a.id, status: "IN_PROGRESS" }, data: { status, answers, correctCount, scorePct: pct, passed, submittedAt: at } });
  return { closed: done.count === 1, correctCount, scorePct: pct, passed, byId };
}

export type TestState =
  | { state: "no_training" } // finish the course first
  | { state: "certified"; publicId: string; expiresAt: Date | null; renewOpensAt: Date | null } // nothing to take yet
  | { state: "not_ready"; have: number; need: number } // the partner team has not published enough questions
  | { state: "wait"; nextAt: Date; paused: boolean; triesLeft: number }
  | { state: "ready"; triesLeft: number }
  | { state: "in_progress"; attemptId: string; deadlineAt: Date };

// Which test the partner faces for a Solution: the final test (no certificate of authorisation yet, or the last one was revoked) or
// the refresher (they hold one, valid or expired, that is not revoked).
export async function testStatus(db: Db, earner: EarnerRef, courseId: string, now = new Date()) {
  const { course, product } = await solutionCourse(db, earner, courseId);
  await closeExpired(db, earner.id, now);
  const settings = await getSettings(db, earner.organizationId);
  const [training, cert, open, attempts, pool] = await Promise.all([
    db.partnerCertificate.findFirst({ where: { earnerId: earner.id, productId: product.id, ...liveTraining(now) } }),
    db.partnerCertificate.findFirst({ where: { earnerId: earner.id, productId: product.id, kind: "AUTHORISATION" }, orderBy: { issuedAt: "desc" } }),
    db.academyTestAttempt.findFirst({ where: { earnerId: earner.id, productId: product.id, status: "IN_PROGRESS" } }),
    db.academyTestAttempt.findMany({ where: { earnerId: earner.id, productId: product.id, status: { not: "IN_PROGRESS" } }, orderBy: { startedAt: "asc" } }),
    testPool(db, course.id),
  ]);
  const last = attempts.at(-1) ?? null;
  const renewing = cert && cert.status === "ACTIVE" ? cert : null;
  const kind: TestKind = open ? (open.kind as TestKind) : renewing ? "REFRESHER" : "FINAL";
  const rules = kind === "REFRESHER" ? refresherRules(settings) : testRules(settings);
  let state: TestState;
  if (open) state = { state: "in_progress", attemptId: open.id, deadlineAt: open.deadlineAt };
  else if (renewing) {
    const opensAt = refresherOpensAt(renewing, refresherRules(settings).windowDays, course.refresherAskedAt);
    if (!opensAt || now < opensAt) state = { state: "certified", publicId: renewing.publicId, expiresAt: renewing.expiresAt, renewOpensAt: opensAt };
    else if (pool.length < rules.questions) state = { state: "not_ready", have: pool.length, need: rules.questions };
    else {
      // Refresher tries count since the certificate was last issued or renewed
      const fails = attempts.filter((a) => a.kind === "REFRESHER" && !a.passed && a.startedAt > renewing.issuedAt).map((a) => a.submittedAt ?? a.deadlineAt);
      const g = testGate(fails, now, rules);
      state = g.canStart ? { state: "ready", triesLeft: g.triesLeft } : { state: "wait", nextAt: g.nextAt!, paused: g.paused, triesLeft: g.triesLeft };
    }
  }
  else if (!training) state = { state: "no_training" };
  else if (pool.length < rules.questions) state = { state: "not_ready", have: pool.length, need: rules.questions };
  else {
    // Final-test tries count from the latest certificate of authorisation (a revoked one starts a fresh count)
    const fails = attempts.filter((a) => a.kind === "FINAL" && !a.passed && (!cert || a.startedAt > cert.issuedAt)).map((a) => a.submittedAt ?? a.deadlineAt);
    const g = testGate(fails, now, rules);
    state = g.canStart ? { state: "ready", triesLeft: g.triesLeft } : { state: "wait", nextAt: g.nextAt!, paused: g.paused, triesLeft: g.triesLeft };
  }
  return { course, product, kind, rules, state, last, certificate: renewing ? { id: renewing.id, publicId: renewing.publicId, expiresAt: renewing.expiresAt } : null };
}

export const testName = (kind: TestKind | string) => (kind === "REFRESHER" ? "refresher test" : "final test");

export const HONESTY_DECLARATION = "I will take this test on my own, without help from anyone and without notes, and I will not share the questions.";

export async function startTest(db: Db, p: { earner: EarnerRef; courseId: string; declared: boolean; now?: Date; rand?: () => number }) {
  const now = p.now ?? new Date();
  const st = await testStatus(db, p.earner, p.courseId, now);
  if (st.state.state === "in_progress") return { attemptId: st.state.attemptId };
  if (st.state.state === "certified") {
    throw new AcademyError(st.state.renewOpensAt ? `Your certificate of authorisation is valid. The refresher test opens on ${st.state.renewOpensAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Karachi" })}.` : "You already hold a valid certificate of authorisation for this Solution.");
  }
  if (st.state.state === "no_training") throw new AcademyError("Finish the course first. The final test opens with your training certificate.");
  if (st.state.state === "not_ready") {
    await notifyMany(db, await usersWithPermission(db, p.earner.organizationId, "partners.manage"), {
      kind: "partner.academy_test_not_ready", title: `The ${st.product.name} ${testName(st.kind)} needs more questions`, body: `It draws ${st.state.need} and the course has ${st.state.have} published.`,
      link: `/partner-stack/academy/${st.course.id}`, dedupeKey: `partner-academy-test-short:${st.course.id}:${st.state.have}`,
    });
    throw new AcademyError(`The ${testName(st.kind)} is not ready yet. The partner team has been told.`);
  }
  if (st.state.state === "wait") throw new AcademyError(st.state.paused ? "You have used all your tries. The test opens again on the date shown." : "You can retake the test after the wait shown.");
  if (!p.declared) throw new AcademyError("Tick the declaration to start.");
  const pool = await testPool(db, st.course.id);
  const ids = shuffle(pool.map((q) => q.id), p.rand ?? Math.random).slice(0, st.rules.questions);
  const a = await db.academyTestAttempt.create({
    data: {
      organizationId: p.earner.organizationId, earnerId: p.earner.id, courseId: st.course.id, productId: st.product.id, kind: st.kind, questionIds: ids, total: ids.length,
      certificateId: st.kind === "REFRESHER" ? st.certificate?.id ?? null : null, // the certificate this refresher renews
      passMark: st.rules.passPct, declaredAt: now, startedAt: now, deadlineAt: new Date(now.getTime() + st.rules.minutes * 60_000),
    },
  });
  return { attemptId: a.id };
}

// The questions of an attempt in progress, without the answers, plus what the partner has saved so far.
export async function testPaper(db: Db, earner: EarnerRef, attemptId: string, now = new Date()) {
  await closeExpired(db, earner.id, now);
  const a = await db.academyTestAttempt.findFirst({ where: { id: attemptId, earnerId: earner.id } });
  if (!a) throw new AcademyError("Test not found.", 404);
  if (a.status !== "IN_PROGRESS") return { attempt: a, questions: [] as QuizQuestion[], saved: {} as Record<string, number[]> };
  const qs = await db.academyQuestion.findMany({ where: { id: { in: a.questionIds } } });
  const byId = new Map(qs.map((q) => [q.id, q]));
  const questions = a.questionIds.map((id) => byId.get(id)).filter((q) => q !== undefined).map((q) => ({ id: q.id, text: q.text, options: q.options, multiple: q.correct.length > 1 }));
  return { attempt: a, questions, saved: (a.answers ?? {}) as Record<string, number[]> };
}

const cleanAnswers = (ids: string[], answers: Record<string, unknown>) => {
  const out: Record<string, number[]> = {};
  for (const id of ids) {
    const v = answers[id];
    if (Array.isArray(v)) out[id] = [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < 6))].slice(0, 6);
  }
  return out;
};

// Saving as the partner goes, so a lost connection or closed tab still grades what was answered when the time runs out.
export async function saveTestAnswers(db: Db, p: { earner: EarnerRef; attemptId: string; answers: Record<string, unknown>; now?: Date }) {
  const now = p.now ?? new Date();
  const a = await db.academyTestAttempt.findFirst({ where: { id: p.attemptId, earnerId: p.earner.id } });
  if (!a) throw new AcademyError("Test not found.", 404);
  if (a.status !== "IN_PROGRESS" || now.getTime() > a.deadlineAt.getTime() + SUBMIT_GRACE_MS) throw new AcademyError("Time is up. Your saved answers were marked.");
  await db.academyTestAttempt.updateMany({ where: { id: a.id, status: "IN_PROGRESS" }, data: { answers: cleanAnswers(a.questionIds, p.answers) } });
  return { ok: true as const };
}

export async function submitTest(db: Db, p: { earner: EarnerRef; attemptId: string; answers: Record<string, unknown>; now?: Date }) {
  const now = p.now ?? new Date();
  const a = await db.academyTestAttempt.findFirst({ where: { id: p.attemptId, earnerId: p.earner.id }, include: { course: { include: { product: true } } } });
  if (!a) throw new AcademyError("Test not found.", 404);
  if (a.status !== "IN_PROGRESS") throw new AcademyError("This test was already marked.");
  const late = now.getTime() > a.deadlineAt.getTime() + SUBMIT_GRACE_MS;
  const answers = late ? ((a.answers ?? {}) as Record<string, number[]>) : cleanAnswers(a.questionIds, p.answers);
  const r = await grade(db, a, answers, late ? "EXPIRED" : "SUBMITTED", late ? a.deadlineAt : now);
  if (!r.closed) throw new AcademyError("This test was already marked.");
  const product = a.course.product!;
  let certificateId: string | null = null;
  let renewError: string | null = null;
  const managers = async () => usersWithPermission(db, p.earner.organizationId, "partners.manage");
  if (r.passed && a.kind === "REFRESHER" && a.certificateId) {
    // Renews the same certificate (same ID, fresh validity). If the partner team revoked it meanwhile, the pass is kept but nothing renews.
    try {
      await renewCertificate(db, { organizationId: p.earner.organizationId, id: a.certificateId, actorId: null, now });
      certificateId = a.certificateId;
    } catch (e) { renewError = e instanceof Error ? e.message : "The certificate could not be renewed."; }
    await notifyMany(db, await managers(), {
      kind: "partner.academy_refresher_passed", title: `${p.earner.name} passed the ${product.name} refresher test (${r.scorePct}%)`,
      body: renewError ? `Not renewed: ${renewError}` : "The certificate of authorisation was renewed automatically.", link: "/partner-stack/academy", dedupeKey: `partner-academy-refresher-pass:${a.id}`,
    });
  } else if (r.passed) {
    const cert = await issueCertificate(db, { organizationId: p.earner.organizationId, earnerId: p.earner.id, solutionCode: product.code, kind: "AUTHORISATION", actorId: null, via: "ACADEMY", now });
    certificateId = cert.id;
    await db.academyTestAttempt.update({ where: { id: a.id }, data: { certificateId } });
    await notifyMany(db, await managers(), {
      kind: "partner.academy_test_passed", title: `${p.earner.name} passed the ${product.name} final test (${r.scorePct}%)`, body: "The certificate of authorisation was issued automatically.",
      link: "/partner-stack/academy", dedupeKey: `partner-academy-test-pass:${a.id}`,
    });
  } else {
    const st = await testStatus(db, p.earner, a.courseId, now);
    if (st.state.state === "wait" && st.state.paused) {
      await notifyMany(db, await managers(), {
        kind: "partner.academy_test_paused", title: `${p.earner.name} failed the ${product.name} ${testName(a.kind)} ${st.rules.maxTries} times`, body: `Last score ${r.scorePct}%. The test is paused for ${st.rules.pauseDays} days; they may need help.`,
        link: "/partner-stack/academy", dedupeKey: `partner-academy-test-paused:${a.id}`,
      });
    }
  }
  return { kind: a.kind as TestKind, scorePct: r.scorePct, passMark: a.passMark, passed: r.passed, expired: late, certificateId, renewError };
}

// After marking: the score and, per lesson, how many were right, so the partner knows what to review. Never the answers.
export async function testResult(db: Db, earner: EarnerRef, attemptId: string) {
  const a = await db.academyTestAttempt.findFirst({ where: { id: attemptId, earnerId: earner.id } });
  if (!a || a.status === "IN_PROGRESS") throw new AcademyError("Result not found.", 404);
  const qs = await db.academyQuestion.findMany({ where: { id: { in: a.questionIds } }, select: { id: true, correct: true, lessonId: true, lesson: { select: { title: true, sortOrder: true } } } });
  const answers = (a.answers ?? {}) as Record<string, number[]>;
  const per = new Map<string, { title: string; order: number; right: number; of: number }>();
  for (const q of qs) {
    const row = per.get(q.lessonId) ?? { title: q.lesson.title, order: q.lesson.sortOrder, right: 0, of: 0 };
    row.of++; if (isRight(q, answers[q.id])) row.right++;
    per.set(q.lessonId, row);
  }
  return { attempt: a, byLesson: [...per.values()].sort((x, y) => x.order - y.order) };
}

// Staff: each partner's final-test history per Solution (latest first).
export async function testHistory(db: Db, organizationId: string, earnerIds: string[]) {
  return db.academyTestAttempt.findMany({ where: { organizationId, earnerId: { in: earnerIds } }, orderBy: { startedAt: "desc" }, select: { earnerId: true, productId: true, kind: true, status: true, scorePct: true, passed: true, startedAt: true } });
}

// ---------------------------------------------------------------------------------------------------------------------------
// Step 3: renewal and reports
// ---------------------------------------------------------------------------------------------------------------------------

// After a big change to a Solution, the partner team asks everyone who holds its certificate of authorisation to take the refresher
// now. It opens at once for them (passing renews for a fresh 12 months); their certificates keep their current expiry. Each holder
// is emailed once per request.
export async function askEarlyRefresher(db: Db, p: { organizationId: string; courseId: string; now?: Date }) {
  const now = p.now ?? new Date();
  const course = await db.academyCourse.findFirst({ where: { id: p.courseId, organizationId: p.organizationId }, include: { product: true } });
  if (!course?.product || !course.productId) throw new AcademyError("Only a Solution's course has a refresher test.");
  if (course.status !== "PUBLISHED") throw new AcademyError("Publish the course first.");
  const pool = await testPool(db, course.id);
  const need = refresherRules(await getSettings(db, p.organizationId)).questions;
  if (pool.length < need) throw new AcademyError(`The refresher draws ${need} questions and this course has ${pool.length} published. Add questions first.`);
  const before = course.refresherAskedAt;
  await db.academyCourse.update({ where: { id: course.id }, data: { refresherAskedAt: now } });
  const holders = await db.partnerCertificate.findMany({
    where: { organizationId: p.organizationId, productId: course.productId, kind: "AUTHORISATION", status: "ACTIVE", earner: { status: "ACTIVE" } },
    include: { earner: true },
  });
  const link = `${appUrl()}/partner/academy/test/${course.id}`;
  for (const c of holders) {
    await sendTemplateQuietly(db, {
      organizationId: p.organizationId, key: "partner_refresher_requested", to: c.earner.email, relatedType: "PartnerCertificate", relatedId: c.id, buttonUrl: link,
      vars: { first_name: firstName(c.earner.name), solution: course.product.name, certificate_id: c.publicId, link },
    });
  }
  return { before, after: now, emailed: holders.length, course };
}

// Which questions partners miss most in the final and refresher tests of a course, so the lesson or the question can be fixed.
export async function questionReport(db: Db, organizationId: string, courseId: string) {
  const attempts = await db.academyTestAttempt.findMany({ where: { organizationId, courseId, status: { not: "IN_PROGRESS" } }, select: { questionIds: true, answers: true } });
  const qs = await db.academyQuestion.findMany({ where: { lesson: { courseId, course: { organizationId } } }, select: { id: true, text: true, correct: true, status: true, lesson: { select: { id: true, title: true } } } });
  const byId = new Map(qs.map((q) => [q.id, q]));
  const tally = new Map<string, { served: number; right: number }>();
  for (const a of attempts) {
    const answers = (a.answers ?? {}) as Record<string, number[]>;
    for (const id of a.questionIds) {
      const t = tally.get(id) ?? { served: 0, right: 0 };
      t.served++; if (isRight(byId.get(id), answers[id])) t.right++;
      tally.set(id, t);
    }
  }
  const rows = [...tally.entries()].flatMap(([id, t]) => {
    const q = byId.get(id);
    return q ? [{ id, text: q.text, status: q.status, lessonId: q.lesson.id, lessonTitle: q.lesson.title, served: t.served, right: t.right, pct: scorePct(t.right, t.served) }] : [];
  });
  rows.sort((x, y) => x.pct - y.pct || y.served - x.served);
  return { attempts: attempts.length, rows };
}

// The week in the Academy, for the Partner Managers' Monday email: what happened in the last 7 days and what is coming up.
export async function academyWeek(db: Db, organizationId: string, now = new Date()) {
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const soon = new Date(now.getTime() + 30 * 86_400_000);
  const [training, tests, expiring, expired, courses] = await Promise.all([
    db.partnerCertificate.count({ where: { organizationId, kind: "TRAINING", issuedAt: { gte: since }, issuedById: null } }),
    db.academyTestAttempt.findMany({ where: { organizationId, status: { not: "IN_PROGRESS" }, submittedAt: { gte: since } }, select: { kind: true, passed: true, scorePct: true } }),
    db.partnerCertificate.count({ where: { organizationId, kind: "AUTHORISATION", status: "ACTIVE", expiresAt: { gt: now, lte: soon }, earner: { status: "ACTIVE" } } }),
    db.partnerCertificate.count({ where: { organizationId, kind: "AUTHORISATION", status: "ACTIVE", expiresAt: { gt: since, lte: now }, earner: { status: "ACTIVE" } } }),
    db.academyCourse.findMany({ where: { organizationId, status: "PUBLISHED", productId: { not: null } }, select: { id: true, product: { select: { name: true } } } }),
  ]);
  const settings = await getSettings(db, organizationId);
  const need = Math.max(testRules(settings).questions, refresherRules(settings).questions);
  const short: string[] = [];
  for (const c of courses) if ((await testPool(db, c.id)).length < need) short.push(c.product?.name ?? "");
  const finals = tests.filter((t) => t.kind === "FINAL");
  const refreshers = tests.filter((t) => t.kind === "REFRESHER");
  return {
    trainingIssued: training,
    finalTaken: finals.length, finalPassed: finals.filter((t) => t.passed).length,
    refresherTaken: refreshers.length, refresherPassed: refreshers.filter((t) => t.passed).length,
    expiringIn30: expiring, expiredThisWeek: expired, coursesShort: short.filter(Boolean),
  };
}

// Monday's email to everyone who manages partners. Sent once a week: a second run in the same week (from the Jobs screen) is skipped.
export async function sendAcademyWeekly(db: Db, organizationId: string, p: { now: Date; weekKey: string }) {
  const w = await academyWeek(db, organizationId, p.now);
  const managers = await usersWithPermission(db, organizationId, "partners.manage");
  const people = await db.user.findMany({ where: { id: { in: managers }, active: true, email: { not: null } }, select: { id: true, name: true, email: true } });
  const link = `${appUrl()}/partner-stack/academy`;
  const vars = {
    training: String(w.trainingIssued), final_tests: `${w.finalPassed} passed of ${w.finalTaken}`, refreshers: `${w.refresherPassed} passed of ${w.refresherTaken}`,
    expiring: String(w.expiringIn30), expired: String(w.expiredThisWeek), short: w.coursesShort.length ? w.coursesShort.join(", ") : "None", link,
  };
  let sent = 0;
  for (const u of people) {
    const already = await db.notification.findFirst({ where: { userId: u.id, dedupeKey: `partner-academy-weekly:${p.weekKey}` }, select: { id: true } });
    if (already) continue;
    await sendTemplateQuietly(db, { organizationId, key: "partner_academy_weekly", to: u.email!, relatedType: "AcademyWeekly", relatedId: p.weekKey, buttonUrl: link, vars: { first_name: firstName(u.name), ...vars } });
    sent++;
  }
  await notifyMany(db, people.map((u) => u.id), {
    kind: "partner.academy_weekly", title: "Partner Academy: your week", body: `${w.finalPassed} final test${w.finalPassed === 1 ? "" : "s"} passed, ${w.refresherPassed} renewed, ${w.expiringIn30} certificate${w.expiringIn30 === 1 ? "" : "s"} expiring in 30 days`,
    link: "/partner-stack/academy", dedupeKey: `partner-academy-weekly:${p.weekKey}`,
  });
  return { ...w, sent };
}
