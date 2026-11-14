import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { setTransportForTests, type Outgoing } from "./mailer";
import {
  AcademyError, academyWeek, askEarlyRefresher, questionReport, sendAcademyWeekly, saveTestAnswers, startTest, submitTest, testPaper, testResult, testStatus, academyFor, academyProgress, addQuestion, deleteLesson, draftQuestionsWithClaude, importQuestions, lessonForPartner, recordWatch, saveCourse, saveLesson,
  setQuestionStatus, startQuiz, submitQuiz, updateQuestion,
} from "./partner-academy";
import { approveApplication, ensurePartnerDefaults, issueCertificate, revokeCertificate, saveSettings, setDirectAccess, submitApplication } from "./partner-stack";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const sent: Outgoing[] = [];
let seq = 0;
let org: string, other: string, manager: string, outsider: string;
type E = { id: string; organizationId: string; name: string };
let ayesha: E, bilal: E;

const sheet = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag} question ${i + 1}?\tRight ${i}\tWrong a${i}\tWrong b${i}\tWrong c${i}\tA\tBecause ${i}.`).join("\n");
const lessonInput = (courseId: string, over: Record<string, unknown> = {}) => ({ organizationId: org, courseId, title: "Lesson", videoUrl: "https://youtu.be/dQw4w9WgXcQ", durationMinutes: "8", script: "", notes: "", sortOrder: "", quizSize: "3", isUpdate: false, status: "DRAFT", ...over });
// Builds a published course with published lessons, each with `bank` published questions
async function publishedCourse(solutionCode: string, title: string, lessons: number, bank = 5) {
  const { after: course } = await saveCourse(db, { organizationId: org, solutionCode, title, summary: "", status: "DRAFT", actorId: manager });
  const ids: string[] = [];
  for (let i = 0; i < lessons; i++) {
    const { after: l } = await saveLesson(db, lessonInput(course.id, { title: `${title} ${i + 1}` }));
    await importQuestions(db, { organizationId: org, lessonId: l.id, sheet: sheet(bank, `${title}-${i}`), actorId: manager });
    for (const q of await db.academyQuestion.findMany({ where: { lessonId: l.id } })) await setQuestionStatus(db, { organizationId: org, id: q.id, action: "publish" });
    await saveLesson(db, lessonInput(course.id, { id: l.id, title: l.title, sortOrder: String(i + 1), status: "PUBLISHED" }));
    ids.push(l.id);
  }
  await saveCourse(db, { organizationId: org, id: course.id, solutionCode, title, summary: "", status: "PUBLISHED", actorId: manager });
  return { courseId: course.id, lessonIds: ids };
}
// Answers a quick check: every answer right, or `wrong` of them wrong (option 0 is always right in the sheet above)
async function answer(e: E, lessonId: string, wrong = 0) {
  const s = await startQuiz(db, { earner: e, lessonId });
  const answers = Object.fromEntries(s.questions.map((q, i) => [q.id, [i < wrong ? 1 : 0]]));
  return { start: s, result: await submitQuiz(db, { earner: e, attemptId: s.attemptId, answers }) };
}
async function finish(e: E, lessonId: string) { await recordWatch(db, { earner: e, lessonId, pct: 100 }); return answer(e, lessonId); }

beforeAll(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  await db.$executeRawUnsafe('TRUNCATE "AcademyQuizAttempt","AcademyLessonProgress","AcademyQuestion","AcademyLesson","AcademyCourse","IntegrationKey","PartnerCertificate","EarnerSolution","Earner","PartnerApplication","PartnerSetting","EarnerType","SaasProduct","EmailMessage","Notification","PasswordResetToken","Session","RolePermission","Permission","UserRole","Role","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Hifi Test" } })).id;
  other = (await db.organization.create({ data: { name: "Elsewhere" } })).id;
  const perm = await db.permission.create({ data: { key: "partners.manage", description: "x" } });
  const role = await db.role.create({ data: { organizationId: org, key: "PARTNER_MANAGER", name: "Partner Manager" } });
  await db.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
  manager = (await db.user.create({ data: { organizationId: org, name: "Pat Manager", email: "pat@hifi.test", passwordHash: "x", roles: { create: { roleId: role.id } } } })).id;
  outsider = (await db.user.create({ data: { organizationId: org, name: "Olly Outsider", email: "olly@hifi.test", passwordHash: "x" } })).id;
  await ensurePartnerDefaults(db, org);
  await ensurePartnerDefaults(db, other);
  const make = async (name: string, email: string, codes: string[]) => {
    await submitApplication(db, { organizationId: org, input: { name, email, phone: "+92 300 1234567", city: "Lahore", country: "Pakistan", professionKind: "STUDENT", solutionCodes: codes, typeKey: "REFERRAL", terms: true } });
    const app = await db.partnerApplication.findFirstOrThrow({ where: { organizationId: org, email } });
    const r = await approveApplication(db, { organizationId: org, applicationId: app.id, actorId: manager, typeKey: "REFERRAL", ratePercent: "20", durationMonths: "lifetime", leadSharing: false, territory: "", solutionCodes: codes, certifyCodes: [] });
    const e = await db.earner.findUniqueOrThrow({ where: { id: r.earnerId } });
    return { id: e.id, organizationId: e.organizationId, name: e.name };
  };
  ayesha = await make("Ayesha Khan", "ayesha@mail.test", ["AGENTIFY"]);
  bilal = await make("Bilal Ahmed", "bilal@mail.test", ["PHARMIVO"]);
});
beforeEach(() => { sent.length = 0; setTransportForTests({ async send(m) { sent.push(m); return { messageId: `re_${++seq}` }; }, async verify() {} }); });
afterAll(async () => { setTransportForTests(null); await db.$disconnect(); });

describe("building courses (staff)", () => {
  it("allows one foundations course and one course per Solution, published only once a lesson is", async () => {
    await expect(saveCourse(db, { organizationId: org, solutionCode: "", title: "Hi", summary: "", status: "DRAFT", actorId: manager })).rejects.toThrow(/title/);
    await expect(saveCourse(db, { organizationId: org, solutionCode: "NOPE", title: "Unknown", summary: "", status: "DRAFT", actorId: manager })).rejects.toThrow(/Choose a Solution/);
    await expect(saveCourse(db, { organizationId: org, solutionCode: "", title: "Foundations", summary: "", status: "PUBLISHED", actorId: manager })).rejects.toThrow(/draft first/);
    const { after } = await saveCourse(db, { organizationId: org, solutionCode: "VELOCITY", title: "Selling Velocity", summary: "", status: "DRAFT", actorId: manager });
    await expect(saveCourse(db, { organizationId: org, solutionCode: "VELOCITY", title: "Again", summary: "", status: "DRAFT", actorId: manager })).rejects.toThrow(/already has a course/);
    await expect(saveCourse(db, { organizationId: org, id: after.id, solutionCode: "VELOCITY", title: "Selling Velocity", summary: "", status: "PUBLISHED", actorId: manager })).rejects.toThrow(/Publish at least one lesson/);
    // Another organisation cannot touch it
    await expect(saveCourse(db, { organizationId: other, id: after.id, solutionCode: "", title: "Taken over", summary: "", status: "DRAFT", actorId: manager })).rejects.toThrow(/not found/);
    await expect(saveLesson(db, { ...lessonInput(after.id), organizationId: other })).rejects.toThrow(/not found/);
  });

  it("checks lessons: a real video link or notes, and enough published questions before publishing", async () => {
    const course = await db.academyCourse.findFirstOrThrow({ where: { organizationId: org, product: { code: "VELOCITY" } } });
    await expect(saveLesson(db, lessonInput(course.id, { videoUrl: "https://example.com/video" }))).rejects.toThrow(/YouTube or Vimeo/);
    await expect(saveLesson(db, lessonInput(course.id, { videoUrl: "" }))).rejects.toThrow(/video link or the lesson notes/);
    await expect(saveLesson(db, lessonInput(course.id, { quizSize: "4" }))).rejects.toThrow(/3 or 5/);
    await expect(saveLesson(db, lessonInput(course.id, { status: "PUBLISHED" }))).rejects.toThrow(/draft/);
    const { after: l } = await saveLesson(db, lessonInput(course.id, { title: "Dealers", notes: "Key points" }));
    expect(l.sortOrder).toBe(1);
    await addQuestion(db, { organizationId: org, lessonId: l.id, input: { text: "Who buys Velocity?", options: ["Car dealers", "Pharmacies"], correct: [0] }, actorId: manager });
    await expect(saveLesson(db, lessonInput(course.id, { id: l.id, status: "PUBLISHED" }))).rejects.toThrow(/at least 3 quick-check questions .* has 0/);
    // A what's new lesson needs no questions
    const { after: news } = await saveLesson(db, lessonInput(course.id, { title: "New in March", isUpdate: true }));
    await saveLesson(db, lessonInput(course.id, { id: news.id, title: "New in March", isUpdate: true, status: "PUBLISHED" }));
  });

  it("keeps question history honest: drafts can be edited or deleted, published ones only retired, never below the quick check size", async () => {
    const l = await db.academyLesson.findFirstOrThrow({ where: { organizationId: org, title: "Dealers" } });
    const draft = await db.academyQuestion.findFirstOrThrow({ where: { lessonId: l.id } });
    const { after } = await updateQuestion(db, { organizationId: org, id: draft.id, input: { text: "Who buys Velocity ERP?", options: ["Car dealers", "Pharmacies", "Schools"], correct: [0], explanation: "Built for dealers." } });
    expect(after.options).toHaveLength(3);
    await expect(importQuestions(db, { organizationId: org, lessonId: l.id, sheet: `${sheet(2, "v")}\nbroken row`, actorId: manager })).rejects.toThrow(/Nothing was imported. Row 3/);
    expect(await db.academyQuestion.count({ where: { lessonId: l.id } })).toBe(1);
    expect((await importQuestions(db, { organizationId: org, lessonId: l.id, sheet: sheet(3, "v"), actorId: manager })).count).toBe(3);
    for (const q of await db.academyQuestion.findMany({ where: { lessonId: l.id } })) await setQuestionStatus(db, { organizationId: org, id: q.id, action: "publish" });
    await saveLesson(db, lessonInput(l.courseId, { id: l.id, title: l.title, notes: "Key points", status: "PUBLISHED", quizSize: "3" }));
    const [first, second] = await db.academyQuestion.findMany({ where: { lessonId: l.id }, orderBy: { createdAt: "asc" } });
    await expect(updateQuestion(db, { organizationId: org, id: first.id, input: { text: "Changed?", options: ["a", "b"], correct: [0] } })).rejects.toThrow(/Only a draft/);
    await expect(setQuestionStatus(db, { organizationId: org, id: first.id, action: "delete" })).rejects.toThrow(/Retire/);
    await setQuestionStatus(db, { organizationId: org, id: first.id, action: "retire" }); // 4 -> 3 published, still enough
    await expect(setQuestionStatus(db, { organizationId: org, id: second.id, action: "retire" })).rejects.toThrow(/needs 3 published/);
    await expect(setQuestionStatus(db, { organizationId: other, id: second.id, action: "retire" })).rejects.toThrow(/not found/);
  });
});

describe("taking the Academy (partners)", () => {
  let foundations: { courseId: string; lessonIds: string[] }, agentify: { courseId: string; lessonIds: string[] };
  beforeAll(async () => {
    foundations = await publishedCourse("", "Foundations", 1);
    agentify = await publishedCourse("AGENTIFY", "Agentify", 2, 10);
    await publishedCourse("PHARMIVO", "Pharmivo", 1);
  });

  it("shows only published courses for the partner's own Solutions, the Solution course locked until foundations is done", async () => {
    const view = await academyFor(db, ayesha);
    expect(view.map((c) => c.course.title)).toEqual(["Foundations", "Agentify"]); // not Velocity (not hers, and a draft) nor Pharmivo
    expect(view[1].open).toBe(false);
    expect(view[1].lessons.map((l) => l.state)).toEqual(["locked", "locked"]);
    await expect(lessonForPartner(db, ayesha, agentify.lessonIds[0])).rejects.toMatchObject({ status: 403 });
    const pharmivoLesson = (await academyFor(db, bilal)).find((c) => c.course.title === "Pharmivo")!.lessons[0].lesson.id;
    await expect(lessonForPartner(db, ayesha, pharmivoLesson)).rejects.toMatchObject({ status: 404 });
  });

  it("needs the video watched before the quick check, and grades only what was drawn", async () => {
    const lessonId = foundations.lessonIds[0];
    await recordWatch(db, { earner: ayesha, lessonId, pct: 40 });
    await expect(startQuiz(db, { earner: ayesha, lessonId })).rejects.toThrow(/Watch the video/);
    await recordWatch(db, { earner: ayesha, lessonId, pct: 20 }); // never goes backwards
    expect((await db.academyLessonProgress.findFirstOrThrow({ where: { earnerId: ayesha.id, lessonId } })).watchedPct).toBe(40);
    await recordWatch(db, { earner: ayesha, lessonId, pct: 95 });
    const a = await startQuiz(db, { earner: ayesha, lessonId });
    expect(a.questions).toHaveLength(3);
    expect(a.questions[0]).not.toHaveProperty("correct");
    expect((await startQuiz(db, { earner: ayesha, lessonId })).attemptId).toBe(a.attemptId); // reloading shows the same set
    // Bilal cannot submit Ayesha's attempt
    await expect(submitQuiz(db, { earner: bilal, attemptId: a.attemptId, answers: {} })).rejects.toThrow(/not found/);
    const fail = await submitQuiz(db, { earner: ayesha, attemptId: a.attemptId, answers: Object.fromEntries(a.questions.map((q) => [q.id, [1]])) });
    expect(fail).toMatchObject({ passed: false, correctCount: 0, total: 3 });
    expect(fail.results[0].explanation).toMatch(/^Because/);
    await expect(submitQuiz(db, { earner: ayesha, attemptId: a.attemptId, answers: {} })).rejects.toThrow(/already submitted/);
    expect((await db.academyLessonProgress.findFirstOrThrow({ where: { earnerId: ayesha.id, lessonId } })).completedAt).toBeNull();
  });

  it("passes with one wrong answer and then opens the Solution course", async () => {
    const { result } = await answer(ayesha, foundations.lessonIds[0], 1);
    expect(result).toMatchObject({ passed: true, correctCount: 2, certificates: [] });
    const view = await academyFor(db, ayesha);
    expect(view[0].doneCount).toBe(1);
    expect(view[1].open).toBe(true);
    expect(view[1].lessons.map((l) => l.state)).toEqual(["open", "locked"]);
  });

  it("issues the training certificate automatically when the Solution course is finished, once, and tells the partner team", async () => {
    expect((await finish(ayesha, agentify.lessonIds[0])).result.certificates).toEqual([]);
    expect(await db.partnerCertificate.count({ where: { earnerId: ayesha.id } })).toBe(0);
    const { result } = await finish(ayesha, agentify.lessonIds[1]);
    expect(result.certificates).toHaveLength(1);
    const cert = await db.partnerCertificate.findFirstOrThrow({ where: { earnerId: ayesha.id }, include: { product: true } });
    expect(cert).toMatchObject({ kind: "TRAINING", expiresAt: null, issuedById: null, status: "ACTIVE" });
    expect(cert.product.code).toBe("AGENTIFY");
    expect(sent.some((m) => m.to === "ayesha@mail.test" && /training certificate/i.test(m.subject))).toBe(true);
    expect((await db.notification.findMany({ where: { userId: manager, kind: "partner.academy_completed" } }))).toHaveLength(1);
    expect(await db.notification.count({ where: { userId: outsider } })).toBe(0);
    expect((await academyFor(db, ayesha))[1].certificate?.publicId).toBe(cert.publicId);
    // Watching again or a new lesson finished later does not issue a second one
    await recordWatch(db, { earner: ayesha, lessonId: agentify.lessonIds[1], pct: 100 });
    expect(await db.partnerCertificate.count({ where: { earnerId: ayesha.id } })).toBe(1);
  });

  it("refuses a quick check on a lesson whose bank is not ready, and keeps started lessons from being deleted", async () => {
    await expect(deleteLesson(db, { organizationId: org, id: agentify.lessonIds[0] })).rejects.toThrow(/started this lesson/);
    const progress = await academyProgress(db, org, { skip: 0, take: 20 });
    const row = progress.rows.find((r) => r.earner.id === ayesha.id)!;
    expect(row.courses).toEqual([{ title: "Foundations", done: 1, of: 1, test: null, expiresAt: null }, { title: "Agentify ERP", done: 2, of: 2, test: null, expiresAt: null }]);
    expect(progress.rows.find((r) => r.earner.id === bilal.id)!.courses.map((c) => c.done)).toEqual([0, 0]);
  });
});

describe("drafting questions with Claude", () => {
  const ok = (payload: unknown, status = 200, stop = "end_turn") => async () => ({ ok: status < 300, status, json: async () => ({ stop_reason: stop, content: [{ type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify(payload) }] }) });
  let lessonId: string;
  beforeAll(async () => {
    const course = await db.academyCourse.findFirstOrThrow({ where: { organizationId: org, product: { code: "VELOCITY" } } });
    lessonId = (await saveLesson(db, lessonInput(course.id, { title: "Pricing", script: "Velocity ERP is sold per branch. ".repeat(10) }))).after.id;
  });

  it("says it is not configured when there is no key, and needs a script", async () => {
    await expect(draftQuestionsWithClaude(db, { organizationId: org, lessonId, actorId: manager })).rejects.toThrow(/not configured/);
    const bare = await db.academyLesson.findFirstOrThrow({ where: { organizationId: org, title: "Dealers" } });
    await expect(draftQuestionsWithClaude(db, { organizationId: org, lessonId: bare.id, actorId: manager, apiKey: "k" })).rejects.toThrow(/script/);
  });

  it("stores Claude's questions as drafts and leaves out the ones that fail the checks", async () => {
    let body = "";
    const fetchImpl = async (_u: string, init: { body: string }) => { body = init.body; return ok({ questions: [
      { question: "How is Velocity priced?", answers: ["Per branch", "Per user", "Per car", "Free"], correct: [0], explanation: "It is sold per branch." },
      { question: "Which is right?", answers: ["Same", "same"], correct: [0], explanation: "" },
    ] })(); };
    const r = await draftQuestionsWithClaude(db, { organizationId: org, lessonId, actorId: manager, apiKey: "test-key", fetchImpl });
    expect(r).toEqual({ count: 1, skipped: 1 });
    const sentBody = JSON.parse(body);
    expect(sentBody.model).toBe("claude-opus-5-5");
    expect(sentBody.output_config.format.type).toBe("json_schema");
    expect(sentBody.messages[0].content).toContain("Velocity ERP is sold per branch.");
    expect(await db.academyQuestion.findMany({ where: { lessonId }, select: { status: true, source: true } })).toEqual([{ status: "DRAFT", source: "CLAUDE" }]);
  });

  it("reports refusals, cut-off answers and a refused key plainly", async () => {
    await expect(draftQuestionsWithClaude(db, { organizationId: org, lessonId, actorId: manager, apiKey: "k", fetchImpl: ok({}, 200, "refusal") })).rejects.toThrow(/declined/);
    await expect(draftQuestionsWithClaude(db, { organizationId: org, lessonId, actorId: manager, apiKey: "k", fetchImpl: ok({}, 200, "max_tokens") })).rejects.toThrow(/cut off/);
    await expect(draftQuestionsWithClaude(db, { organizationId: org, lessonId, actorId: manager, apiKey: "k", fetchImpl: ok({}, 401) })).rejects.toThrow(/refused/);
    await expect(draftQuestionsWithClaude(db, { organizationId: org, lessonId, actorId: manager, apiKey: "k", fetchImpl: ok({ questions: [] }) })).rejects.toBeInstanceOf(AcademyError);
  });
});

describe("the final test", () => {
  const H = 3_600_000, D = 24 * H;
  const t0 = new Date("2027-01-10T09:00:00Z");
  const at = (ms: number) => new Date(t0.getTime() + ms);
  let course: string;
  const rightAnswers = async (attemptId: string) => {
    const paper = await testPaper(db, ayesha, attemptId, t0);
    const qs = await db.academyQuestion.findMany({ where: { id: { in: paper.attempt.questionIds } } });
    return Object.fromEntries(qs.map((q) => [q.id, q.correct]));
  };
  const take = async (now: Date, right: boolean) => {
    const { attemptId } = await startTest(db, { earner: ayesha, courseId: course, declared: true, now });
    const answers = right ? await rightAnswers(attemptId) : Object.fromEntries((await db.academyTestAttempt.findUniqueOrThrow({ where: { id: attemptId } })).questionIds.map((id) => [id, [3]]));
    return { attemptId, ...(await submitTest(db, { earner: ayesha, attemptId, answers, now: new Date(now.getTime() + 10 * 60_000) })) };
  };
  beforeAll(async () => {
    course = (await db.academyCourse.findFirstOrThrow({ where: { organizationId: org, product: { code: "AGENTIFY" } } })).id;
    await saveSettings(db, { organizationId: org, actorId: manager, values: { academy_test_questions: "5", academy_test_pass_pct: "80", academy_test_minutes: "30", academy_retake_hours: "24", academy_max_tries: "3", academy_pause_days: "7" } });
  });

  it("validates its settings", async () => {
    await expect(saveSettings(db, { organizationId: org, actorId: manager, values: { academy_test_pass_pct: "40" } })).rejects.toThrow(/Pass mark .* 50 to 100/);
    await expect(saveSettings(db, { organizationId: org, actorId: manager, values: { academy_test_questions: "abc" } })).rejects.toThrow(/Questions in the final test/);
  });

  it("opens only with the training certificate, and only for the partner's own Solutions", async () => {
    expect((await testStatus(db, ayesha, course, t0)).state).toEqual({ state: "ready", triesLeft: 3 });
    await expect(testStatus(db, bilal, course, t0)).rejects.toMatchObject({ status: 404 });
    const pharmivo = (await db.academyCourse.findFirstOrThrow({ where: { organizationId: org, product: { code: "PHARMIVO" } } })).id;
    expect((await testStatus(db, bilal, pharmivo, t0)).state.state).toBe("no_training");
    await expect(startTest(db, { earner: bilal, courseId: pharmivo, declared: true, now: t0 })).rejects.toThrow(/Finish the course first/);
  });

  it("needs the declaration, stores the drawn paper without answers, and resumes the same paper", async () => {
    await expect(startTest(db, { earner: ayesha, courseId: course, declared: false, now: t0 })).rejects.toThrow(/declaration/);
    const { attemptId } = await startTest(db, { earner: ayesha, courseId: course, declared: true, now: t0 });
    const a = await db.academyTestAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(a).toMatchObject({ total: 5, passMark: 80, status: "IN_PROGRESS" });
    expect(a.deadlineAt.getTime() - t0.getTime()).toBe(30 * 60_000);
    expect(new Set(a.questionIds).size).toBe(5);
    expect((await startTest(db, { earner: ayesha, courseId: course, declared: true, now: at(60_000) })).attemptId).toBe(attemptId);
    const paper = await testPaper(db, ayesha, attemptId, at(60_000));
    expect(paper.questions).toHaveLength(5);
    expect(paper.questions[0]).not.toHaveProperty("correct");
    await expect(testPaper(db, bilal, attemptId, t0)).rejects.toThrow(/not found/);
    // Answers saved as the partner goes; when time runs out they are marked, and a timed-out test never passes
    await saveTestAnswers(db, { earner: ayesha, attemptId, answers: await rightAnswers(attemptId), now: at(5 * 60_000) });
    const st = await testStatus(db, ayesha, course, at(40 * 60_000));
    expect(await db.academyTestAttempt.findUniqueOrThrow({ where: { id: attemptId } })).toMatchObject({ status: "EXPIRED", scorePct: 100, passed: false });
    expect(st.state).toMatchObject({ state: "wait", paused: false, triesLeft: 2 });
    await expect(saveTestAnswers(db, { earner: ayesha, attemptId, answers: {}, now: at(41 * 60_000) })).rejects.toThrow(/Time is up/);
    await expect(submitTest(db, { earner: ayesha, attemptId, answers: {}, now: at(41 * 60_000) })).rejects.toThrow(/already marked/);
  });

  it("makes the partner wait between tries, pauses after the last one and tells the partner team", async () => {
    await expect(startTest(db, { earner: ayesha, courseId: course, declared: true, now: at(2 * H) })).rejects.toThrow(/retake/);
    const second = await take(at(D + H), false);
    expect(second).toMatchObject({ passed: false, scorePct: 0, certificateId: null });
    expect((await testResult(db, ayesha, second.attemptId)).byLesson.reduce((n, l) => n + l.of, 0)).toBe(5);
    const third = await take(at(2 * D + 2 * H), false);
    expect(third.passed).toBe(false);
    const st = await testStatus(db, ayesha, course, at(3 * D));
    expect(st.state).toMatchObject({ state: "wait", paused: true });
    expect((st.state as { nextAt: Date }).nextAt.getTime()).toBe(at(2 * D + 2 * H + 10 * 60_000).getTime() + 7 * D);
    expect(await db.notification.count({ where: { userId: manager, kind: "partner.academy_test_paused" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: outsider } })).toBe(0);
    expect((await testStatus(db, ayesha, course, at(10 * D)).then((s) => s.state))).toEqual({ state: "ready", triesLeft: 3 });
  });

  it("issues the certificate of authorisation automatically on a pass", async () => {
    sent.length = 0;
    const r = await take(at(10 * D), true);
    expect(r).toMatchObject({ passed: true, scorePct: 100, expired: false });
    const cert = await db.partnerCertificate.findUniqueOrThrow({ where: { id: r.certificateId! } });
    expect(cert).toMatchObject({ kind: "AUTHORISATION", issuedById: null, status: "ACTIVE" });
    expect(cert.expiresAt!.getTime()).toBeGreaterThan(at(10 * D).getTime());
    expect(sent.some((m) => m.to === "ayesha@mail.test" && /certificate of authorisation/i.test(m.subject))).toBe(true);
    expect(await db.notification.count({ where: { userId: manager, kind: "partner.academy_test_passed" } })).toBe(1);
    expect((await testStatus(db, ayesha, course, at(10 * D + H))).state).toEqual({ state: "certified", publicId: cert.publicId, expiresAt: cert.expiresAt, renewOpensAt: new Date(cert.expiresAt!.getTime() - 30 * D) });
    await expect(startTest(db, { earner: ayesha, courseId: course, declared: true, now: at(10 * D + H) })).rejects.toThrow(/refresher test opens on/);
    const row = (await academyProgress(db, org, { skip: 0, take: 20 })).rows.find((x) => x.earner.id === ayesha.id)!;
    expect(row.courses[1].test).toEqual({ tries: 4, last: 100, passed: true });
  });

  it("keeps the certificate of authorisation for Academy partners behind the test unless the team grants direct access", async () => {
    await expect(issueCertificate(db, { organizationId: org, earnerId: bilal.id, solutionCode: "PHARMIVO", kind: "AUTHORISATION", actorId: manager })).rejects.toThrow(/final test in the Partner Academy/);
    await expect(setDirectAccess(db, { organizationId: org, earnerId: bilal.id, on: true, reason: "", actorId: manager })).rejects.toThrow(/reason/);
    await expect(setDirectAccess(db, { organizationId: other, earnerId: bilal.id, on: true, reason: "Enterprise client", actorId: manager })).rejects.toThrow(/not found/);
    await setDirectAccess(db, { organizationId: org, earnerId: bilal.id, on: true, reason: "Brings an enterprise pharmacy chain", actorId: manager });
    // Now only the normal training-first rule applies
    await expect(issueCertificate(db, { organizationId: org, earnerId: bilal.id, solutionCode: "PHARMIVO", kind: "AUTHORISATION", actorId: manager })).rejects.toThrow(/training certificate first/);
    await issueCertificate(db, { organizationId: org, earnerId: bilal.id, solutionCode: "PHARMIVO", kind: "TRAINING", actorId: manager });
    expect((await issueCertificate(db, { organizationId: org, earnerId: bilal.id, solutionCode: "PHARMIVO", kind: "AUTHORISATION", actorId: manager })).kind).toBe("AUTHORISATION");
    const { after } = await setDirectAccess(db, { organizationId: org, earnerId: bilal.id, on: false, reason: "", actorId: manager });
    expect(after).toMatchObject({ academyDirectAccess: false, directAccessReason: null });
  });

  it("keeps final-test-only questions out of quick checks", async () => {
    const velocity = await db.academyCourse.findFirstOrThrow({ where: { organizationId: org, product: { code: "VELOCITY" } } });
    const { after: l } = await saveLesson(db, lessonInput(velocity.id, { title: "Finance options" }));
    await importQuestions(db, { organizationId: org, lessonId: l.id, sheet: sheet(2, "quick"), actorId: manager });
    await importQuestions(db, { organizationId: org, lessonId: l.id, sheet: sheet(4, "final"), finalOnly: true, actorId: manager });
    for (const q of await db.academyQuestion.findMany({ where: { lessonId: l.id } })) await setQuestionStatus(db, { organizationId: org, id: q.id, action: "publish" });
    await expect(saveLesson(db, lessonInput(velocity.id, { id: l.id, title: l.title, status: "PUBLISHED" }))).rejects.toThrow(/has 2/);
    expect(await db.academyQuestion.count({ where: { lessonId: l.id, finalOnly: true } })).toBe(4);
  });
});

describe("the Student partner type", () => {
  it("can apply and be approved as a Student, and takes the Academy", async () => {
    await submitApplication(db, { organizationId: org, input: { name: "Sana Student", email: "sana@uni.test", phone: "+92 300 7654321", city: "Lahore", country: "Pakistan", professionKind: "STUDENT", solutionCodes: ["AGENTIFY"], typeKey: "STUDENT", terms: true } });
    const app = await db.partnerApplication.findFirstOrThrow({ where: { organizationId: org, email: "sana@uni.test" } });
    const r = await approveApplication(db, { organizationId: org, applicationId: app.id, actorId: manager, typeKey: "STUDENT", ratePercent: "20", durationMonths: "lifetime", leadSharing: false, territory: "", solutionCodes: ["AGENTIFY"], certifyCodes: [] });
    const e = await db.earner.findUniqueOrThrow({ where: { id: r.earnerId }, include: { type: true } });
    expect(e.type).toMatchObject({ key: "STUDENT", academyRequired: true, publicOffer: true });
  });
});

describe("renewal by the refresher test", () => {
  const H = 3_600_000, D = 24 * H;
  let course: string, certId: string, expires: Date;
  const answersFor = async (attemptId: string, right: boolean) => {
    const a = await db.academyTestAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    if (!right) return Object.fromEntries(a.questionIds.map((id) => [id, [3]]));
    const qs = await db.academyQuestion.findMany({ where: { id: { in: a.questionIds } } });
    return Object.fromEntries(qs.map((q) => [q.id, q.correct]));
  };
  const take = async (now: Date, right: boolean) => {
    const { attemptId } = await startTest(db, { earner: ayesha, courseId: course, declared: true, now });
    return { attemptId, ...(await submitTest(db, { earner: ayesha, attemptId, answers: await answersFor(attemptId, right), now: new Date(now.getTime() + 5 * 60_000) })) };
  };
  beforeAll(async () => {
    course = (await db.academyCourse.findFirstOrThrow({ where: { organizationId: org, product: { code: "AGENTIFY" } } })).id;
    await saveSettings(db, { organizationId: org, actorId: manager, values: { academy_refresher_questions: "5", academy_refresher_minutes: "20", academy_refresher_window_days: "30" } });
    const cert = await db.partnerCertificate.findFirstOrThrow({ where: { earnerId: ayesha.id, kind: "AUTHORISATION" } });
    certId = cert.id; expires = cert.expiresAt!;
  });

  it("gives the certificate of authorisation 12 months by default", async () => {
    const cert = await db.partnerCertificate.findUniqueOrThrow({ where: { id: certId } });
    expect(Math.round((cert.expiresAt!.getTime() - cert.issuedAt.getTime()) / D)).toBe(365);
  });

  it("opens 30 days before expiry with its own length and time, and counts only refresher tries", async () => {
    const before = new Date(expires.getTime() - 31 * D);
    expect((await testStatus(db, ayesha, course, before)).state).toMatchObject({ state: "certified" });
    const open = new Date(expires.getTime() - 29 * D);
    const st = await testStatus(db, ayesha, course, open);
    expect(st).toMatchObject({ kind: "REFRESHER", state: { state: "ready", triesLeft: 3 }, certificate: { id: certId } });
    expect(st.rules).toMatchObject({ questions: 5, minutes: 20 });
    const { attemptId } = await startTest(db, { earner: ayesha, courseId: course, declared: true, now: open });
    const a = await db.academyTestAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(a).toMatchObject({ kind: "REFRESHER", certificateId: certId, total: 5 });
    expect(a.deadlineAt.getTime() - open.getTime()).toBe(20 * 60_000);
    const r = await submitTest(db, { earner: ayesha, attemptId, answers: await answersFor(attemptId, false), now: new Date(open.getTime() + 60_000) });
    expect(r).toMatchObject({ kind: "REFRESHER", passed: false, certificateId: null });
    expect((await testStatus(db, ayesha, course, new Date(open.getTime() + H))).state).toMatchObject({ state: "wait", paused: false, triesLeft: 2 });
    expect((await db.partnerCertificate.findUniqueOrThrow({ where: { id: certId } })).renewals).toBe(0);
  });

  it("renews the same certificate on a pass, emails it and tells the partner team", async () => {
    const now = new Date(expires.getTime() - 27 * D);
    const r = await take(now, true);
    expect(r).toMatchObject({ kind: "REFRESHER", passed: true, certificateId: certId, renewError: null });
    const cert = await db.partnerCertificate.findUniqueOrThrow({ where: { id: certId } });
    expect(cert).toMatchObject({ renewals: 1, status: "ACTIVE" });
    expect(Math.round((cert.expiresAt!.getTime() - cert.issuedAt.getTime()) / D)).toBe(365);
    expect(cert.expiresAt!.getTime()).toBeGreaterThan(expires.getTime());
    expect(await db.partnerCertificate.count({ where: { earnerId: ayesha.id, kind: "AUTHORISATION" } })).toBe(1); // same ID, no new certificate
    expect(sent.some((m) => m.to === "ayesha@mail.test" && /certificate of authorisation/i.test(m.subject))).toBe(true);
    expect(await db.notification.count({ where: { userId: manager, kind: "partner.academy_refresher_passed" } })).toBe(1);
    expect((await testStatus(db, ayesha, course, new Date(now.getTime() + H))).state).toMatchObject({ state: "certified", renewOpensAt: new Date(cert.expiresAt!.getTime() - 30 * D) });
    expect(((await testResult(db, ayesha, r.attemptId)).attempt.kind)).toBe("REFRESHER");
    expires = cert.expiresAt!;
  });

  it("offers the refresher, not the final test, after the certificate has expired", async () => {
    const late = new Date(expires.getTime() + 10 * D);
    expect(await testStatus(db, ayesha, course, late)).toMatchObject({ kind: "REFRESHER", state: { state: "ready", triesLeft: 3 } });
  });

  it("opens at once for everyone certified when the partner team asks after a big change", async () => {
    const now = new Date(expires.getTime() - 200 * D);
    expect((await testStatus(db, ayesha, course, now)).state.state).toBe("certified");
    await expect(askEarlyRefresher(db, { organizationId: other, courseId: course, now })).rejects.toThrow(AcademyError);
    const r = await askEarlyRefresher(db, { organizationId: org, courseId: course, now });
    expect(r.emailed).toBe(1);
    expect(sent.filter((m) => m.to === "ayesha@mail.test" && /refresher test/i.test(m.subject))).toHaveLength(1);
    expect((await testStatus(db, ayesha, course, new Date(now.getTime() + H))).state).toMatchObject({ state: "ready" });
    const cert = await db.partnerCertificate.findUniqueOrThrow({ where: { id: certId } });
    expect(cert.expiresAt).toEqual(expires); // the expiry does not move
  });

  it("does not renew a certificate the partner team revoked during the test", async () => {
    const now = new Date(expires.getTime() - 10 * D);
    const { attemptId } = await startTest(db, { earner: ayesha, courseId: course, declared: true, now });
    await revokeCertificate(db, { organizationId: org, id: certId, actorId: manager, reason: "Broke the brand rules" });
    const r = await submitTest(db, { earner: ayesha, attemptId, answers: await answersFor(attemptId, true), now: new Date(now.getTime() + 60_000) });
    expect(r).toMatchObject({ passed: true, certificateId: null, renewError: expect.stringMatching(/revoked/) });
    expect((await db.partnerCertificate.findUniqueOrThrow({ where: { id: certId } })).status).toBe("REVOKED");
    // With the certificate revoked, the partner is back to the final test
    expect((await testStatus(db, ayesha, course, new Date(now.getTime() + 2 * D))).kind).toBe("FINAL");
  });

  it("reports the questions partners miss most, for this organization only", async () => {
    const r = await questionReport(db, org, course);
    expect(r.attempts).toBeGreaterThanOrEqual(6);
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows.every((x) => x.served >= 1 && x.right <= x.served)).toBe(true);
    expect(r.rows.map((x) => x.pct)).toEqual([...r.rows.map((x) => x.pct)].sort((a, b) => a - b));
    expect((await questionReport(db, other, course)).attempts).toBe(0);
  });

  it("sends the weekly summary to the partner team once a week", async () => {
    const now = new Date(expires.getTime() - 9 * D);
    const w = await academyWeek(db, org, now);
    expect(w).toMatchObject({ refresherTaken: 1, refresherPassed: 1 });
    const first = await sendAcademyWeekly(db, org, { now, weekKey: "2027-W50" });
    expect(first.sent).toBe(1);
    expect(sent.filter((m) => m.to === "pat@hifi.test" && /Partner Academy: your week/.test(m.subject))).toHaveLength(1);
    expect(sent.some((m) => m.to === "olly@hifi.test")).toBe(false);
    expect((await sendAcademyWeekly(db, org, { now, weekKey: "2027-W50" })).sent).toBe(0);
    expect(await db.notification.count({ where: { userId: manager, kind: "partner.academy_weekly" } })).toBe(1);
  });
});
