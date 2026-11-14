import { describe, expect, it } from "vitest";
import { AcademyError, cleanQuestion, draftPrompt, lessonStates, parseCorrect, parseQuestionSheet, parseVideoUrl, quizPassed, refresherOpensAt, refresherRules, scorePct, testGate, testName, testRules } from "./partner-academy";
import { reminderTier } from "./partner-stack";

describe("video links", () => {
  it("reads YouTube links in every common form, including unlisted ones", () => {
    for (const u of ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ?si=abc", "https://youtube.com/shorts/dQw4w9WgXcQ", "https://www.youtube.com/embed/dQw4w9WgXcQ", "https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=10"]) {
      expect(parseVideoUrl(u)).toMatchObject({ provider: "youtube", id: "dQw4w9WgXcQ" });
    }
    expect(parseVideoUrl("https://youtu.be/dQw4w9WgXcQ")!.embedUrl).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ?enablejsapi=1");
  });
  it("reads Vimeo links and keeps the private hash of an unlisted video", () => {
    expect(parseVideoUrl("https://vimeo.com/123456789")).toMatchObject({ provider: "vimeo", id: "123456789" });
    expect(parseVideoUrl("https://vimeo.com/123456789/abcdef1234")!.embedUrl).toBe("https://player.vimeo.com/video/123456789?h=abcdef1234&dnt=1");
    expect(parseVideoUrl("https://player.vimeo.com/video/123456789?h=abcdef1234")!.embedUrl).toContain("h=abcdef1234");
  });
  it("accepts direct https video files and refuses everything else", () => {
    expect(parseVideoUrl("https://cdn.hifi.test/lesson1.mp4")).toMatchObject({ provider: "file" });
    for (const u of ["", "not a link", "http://youtu.be/dQw4w9WgXcQ", "https://youtu.be/short", "https://example.com/page", "javascript:alert(1)", "https://vimeo.com/channels/x"]) expect(parseVideoUrl(u)).toBeNull();
  });
});

describe("questions", () => {
  it("cleans a valid question", () => {
    expect(cleanQuestion({ text: "  Who buys Agentify?  ", options: ["Real estate agencies", "Pharmacies", "", "Car dealers"], correct: [0], explanation: "It is built for agencies." }))
      .toEqual({ text: "Who buys Agentify?", options: ["Real estate agencies", "Pharmacies", "Car dealers"], correct: [0], explanation: "It is built for agencies." });
  });
  it("refuses questions partners could not answer fairly", () => {
    const base = { text: "Which plan?", options: ["A", "B", "C"], correct: [1] };
    expect(() => cleanQuestion({ ...base, text: "Hm" })).toThrow(/question/);
    expect(() => cleanQuestion({ ...base, options: ["Only one"] })).toThrow(/two answers/);
    expect(() => cleanQuestion({ ...base, options: ["Same", "same", "C"] })).toThrow(/same/);
    expect(() => cleanQuestion({ ...base, correct: [] })).toThrow(/correct answer/);
    expect(() => cleanQuestion({ ...base, correct: [5] })).toThrow(/one of the answers/);
    expect(() => cleanQuestion({ ...base, correct: [0, 1, 2] })).toThrow(/wrong/);
    expect(() => cleanQuestion({ ...base, options: ["1", "2", "3", "4", "5", "6", "7"] })).toThrow(/at most 6/);
  });
  it("reads correct letters and numbers", () => {
    expect(parseCorrect("B")).toEqual([1]);
    expect(parseCorrect("a, c")).toEqual([0, 2]);
    expect(parseCorrect("2")).toEqual([1]);
    expect(parseCorrect("Z").every(Number.isNaN)).toBe(true);
  });
  it("imports rows pasted from Google Sheets (tabs) with a header row", () => {
    const sheet = "Question\tA\tB\tC\tD\tCorrect\tWhy\nWho buys Pharmivo?\tPharmacies\tSchools\tBanks\tFarms\tA\tIt is pharmacy software.\nTwo right?\tYes\tAlso yes\tNo\t\tA,B\t";
    const r = parseQuestionSheet(sheet);
    expect(r.errors).toEqual([]);
    expect(r.questions).toEqual([
      { text: "Who buys Pharmivo?", options: ["Pharmacies", "Schools", "Banks", "Farms"], correct: [0], explanation: "It is pharmacy software." },
      { text: "Two right?", options: ["Yes", "Also yes", "No"], correct: [0, 1], explanation: null },
    ]);
  });
  it("imports a CSV file with quoted commas, and maps letters past an empty answer", () => {
    const r = parseQuestionSheet('"Pick one, please",Alpha,,Gamma,Delta,C,"Gamma, of course"');
    expect(r.errors).toEqual([]);
    expect(r.questions[0]).toEqual({ text: "Pick one, please", options: ["Alpha", "Gamma", "Delta"], correct: [1], explanation: "Gamma, of course" });
  });
  it("lists every problem with its row number", () => {
    const r = parseQuestionSheet("Fine question?,A,B,C,D,A\nShort,A,B\nBad letter?,A,B,C,D,X\nEmpty pick?,A,B,,,C");
    expect(r.questions).toHaveLength(1);
    expect(r.errors).toEqual([expect.stringMatching(/^Row 2: needs at least 6 columns/), expect.stringMatching(/^Row 3: .*"X"/), expect.stringMatching(/^Row 4: answer C is empty/)]);
    expect(parseQuestionSheet("   ").errors[0]).toMatch(/Nothing to import/);
  });
});

describe("lesson order and passing", () => {
  const lessons = [{ id: "a", isUpdate: false }, { id: "new", isUpdate: true }, { id: "b", isUpdate: false }, { id: "c", isUpdate: false }];
  it("opens lessons one after another; what's new lessons are always open", () => {
    expect([...lessonStates(lessons, new Set(), true)]).toEqual([["a", "open"], ["new", "open"], ["b", "locked"], ["c", "locked"]]);
    expect([...lessonStates(lessons, new Set(["a"]), true)]).toEqual([["a", "done"], ["new", "open"], ["b", "open"], ["c", "locked"]]);
    expect([...lessonStates(lessons, new Set(), false)].filter(([, s]) => s !== "locked")).toEqual([["new", "open"]]);
  });
  it("allows one wrong answer", () => {
    expect([quizPassed(3, 3), quizPassed(2, 3), quizPassed(1, 3), quizPassed(4, 5), quizPassed(3, 5), quizPassed(0, 0)]).toEqual([true, true, false, true, false, false]);
  });
  it("asks Claude to stick to the script", () => {
    const p = draftPrompt({ title: "Pricing", script: "Agentify costs 5,000 a month." }, "Agentify ERP", 10);
    expect(p).toContain("Write 10 multiple-choice questions");
    expect(p).toContain("never invent features, prices or policies");
    expect(p).toContain("<script>\nAgentify costs 5,000 a month.\n</script>");
    expect(new AcademyError("x").status).toBe(400);
  });
});

describe("final test rules", () => {
  const r = { retakeHours: 24, maxTries: 3, pauseDays: 7 };
  const H = 3_600_000, D = 24 * H;
  const t = (h: number) => new Date(Date.UTC(2027, 0, 1) + h * H);
  it("opens straight away with no failed tries", () => {
    expect(testGate([], t(0), r)).toEqual({ canStart: true, paused: false, nextAt: null, triesLeft: 3 });
  });
  it("waits between tries", () => {
    expect(testGate([t(0)], t(10), r)).toMatchObject({ canStart: false, paused: false, nextAt: t(24), triesLeft: 2 });
    expect(testGate([t(0)], t(24), r)).toMatchObject({ canStart: true, triesLeft: 2 });
  });
  it("pauses after the last try, then starts the count again", () => {
    const fails = [t(0), t(30), t(60)];
    expect(testGate(fails, t(100), r)).toMatchObject({ canStart: false, paused: true, nextAt: new Date(t(60).getTime() + 7 * D) });
    expect(testGate(fails, new Date(t(60).getTime() + 7 * D), r)).toMatchObject({ canStart: true, triesLeft: 3 });
    expect(testGate([...fails, new Date(t(60).getTime() + 8 * D)], new Date(t(60).getTime() + 8 * D + H), r)).toMatchObject({ canStart: false, paused: false, triesLeft: 2 });
  });
  it("scores down, never up, and reads the settings", () => {
    expect([scorePct(22, 30), scorePct(23, 30), scorePct(0, 0)]).toEqual([73, 76, 0]);
    expect(testRules({})).toEqual({ questions: 30, passPct: 75, minutes: 45, retakeHours: 24, maxTries: 3, pauseDays: 7 });
    expect(testRules({ academy_test_questions: "40", academy_test_pass_pct: "80" })).toMatchObject({ questions: 40, passPct: 80 });
  });
});

describe("renewal", () => {
  const D = 86_400_000;
  const issued = new Date(Date.UTC(2027, 0, 1));
  const cert = { issuedAt: issued, expiresAt: new Date(issued.getTime() + 365 * D) };
  it("opens the refresher 30 days before expiry, or earlier when the partner team asks after the last renewal", () => {
    expect(refresherOpensAt(cert, 30, null)).toEqual(new Date(issued.getTime() + 335 * D));
    const asked = new Date(issued.getTime() + 100 * D);
    expect(refresherOpensAt(cert, 30, asked)).toEqual(asked);
    expect(refresherOpensAt(cert, 30, new Date(issued.getTime() - D))).toEqual(new Date(issued.getTime() + 335 * D)); // asked before this renewal: ignored
    expect(refresherOpensAt({ issuedAt: issued, expiresAt: null }, 30, null)).toBeNull();
  });
  it("reads the refresher settings and keeps the final test's pass mark and retake rules", () => {
    expect(refresherRules({})).toEqual({ questions: 15, passPct: 75, minutes: 20, retakeHours: 24, maxTries: 3, pauseDays: 7, windowDays: 30 });
    expect(refresherRules({ academy_refresher_questions: "10", academy_test_pass_pct: "80" })).toMatchObject({ questions: 10, passPct: 80 });
    expect([testName("FINAL"), testName("REFRESHER")]).toEqual(["final test", "refresher test"]);
  });
  it("picks the reminder due: 30, 7 or 1 day before expiry", () => {
    const days = { first: 30, second: 7, final: 1 };
    expect([31, 30, 8, 7, 2, 1, 0.2, 0, -1].map((d) => reminderTier(d * D, days))).toEqual([0, 1, 1, 2, 2, 3, 3, 0, 0]);
  });
});
