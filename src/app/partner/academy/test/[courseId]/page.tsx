import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePartnerUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { AcademyError, HONESTY_DECLARATION, testName, testPaper, testResult, testStatus } from "@/lib/partner-academy";
import { Badge, Notice, PageHeader } from "@/components/ui";
import SubmitButton from "@/components/ui/SubmitButton";
import { startTestAction } from "../../actions";
import TestPaper from "./TestPaper";

export const dynamic = "force-dynamic";

const pkt = (d: Date) => `${d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Karachi" })} (Pakistan time)`;

// A Solution's final test: rules and declaration, the paper with its timer, and the result.
export default async function FinalTest({ params, searchParams }: { params: Promise<{ courseId: string }>; searchParams: Promise<{ result?: string; error?: string }> }) {
  const { earner } = await requirePartnerUser();
  const { courseId } = await params;
  const sp = await searchParams;
  let st: Awaited<ReturnType<typeof testStatus>>;
  try { st = await testStatus(db, earner, courseId); }
  catch (e) { if (e instanceof AcademyError) notFound(); throw e; }
  const { product, rules, state, kind, certificate } = st;
  const result = sp.result ? await testResult(db, earner, sp.result).catch((e) => { if (e instanceof AcademyError) return null; throw e; }) : null;
  const shown = result ? result.attempt.kind : kind;
  const title = `${product.name} ${testName(shown)}`;
  const refresher = kind === "REFRESHER";
  const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Karachi" });

  return (
    <>
      <PageHeader back={{ href: "/partner/academy", label: "Academy" }} title={title} subtitle={shown === "REFRESHER" ? "Passing renews your certificate of authorisation for this Solution, with the same certificate ID." : "Passing gives you the certificate of authorisation for this Solution."} />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}

      {result && (
        <section className="card space-y-3" aria-live="polite">
          <h2 className="font-semibold">Your result</h2>
          <p className={`text-lg font-semibold ${result.attempt.passed ? "text-success" : "text-brand"}`}>
            {result.attempt.passed ? `Passed with ${result.attempt.scorePct}%` : result.attempt.status === "EXPIRED" ? `Time ran out: ${result.attempt.scorePct}% from the answers saved` : `${result.attempt.scorePct}%: not passed this time`}
            <span className="ml-2 text-sm font-normal text-muted">pass mark {result.attempt.passMark}%</span>
          </p>
          {result.attempt.passed && (result.attempt.kind === "REFRESHER"
            ? <p className="text-sm">{result.attempt.certificateId ? <>Your certificate of authorisation for {product.name} has been renewed{certificate?.expiresAt ? ` until ${day(certificate.expiresAt)}` : ""} and emailed to you. It keeps the same ID, so links and QR codes you shared still work.</> : "The partner team will be in touch about your certificate."}</p>
            : <p className="text-sm">Your certificate of authorisation for {product.name} has been issued and emailed to you. It is on your <Link className="underline" href="/partner">overview</Link>, ready to download or add to LinkedIn.</p>)}
          <div>
            <p className="text-sm font-medium">By lesson</p>
            <ul className="mt-1 space-y-0.5 text-sm">
              {result.byLesson.map((l) => <li key={l.title} className="flex justify-between gap-3"><span>{l.title}</span><span className={l.right === l.of ? "text-success" : "text-muted"}>{l.right} of {l.of}</span></li>)}
            </ul>
            {!result.attempt.passed && <p className="mt-2 text-xs text-muted">Watch the lessons with the lowest scores again before your next try. The next test has a different set of questions.</p>}
          </div>
        </section>
      )}

      {state.state === "certified" && !result && (
        <section className="card"><p className="text-sm">You hold a valid certificate of authorisation for {product.name} (<a className="underline" href={`/partners/verify/${state.publicId}`} target="_blank" rel="noopener">{state.publicId}</a>){state.expiresAt ? `, valid until ${day(state.expiresAt)}` : ""}. {state.renewOpensAt ? `The refresher test to renew it opens on ${day(state.renewOpensAt)}; we will email you.` : "There is nothing to take."}</p></section>
      )}
      {state.state === "no_training" && (
        <section className="card"><p className="text-sm">Finish the {product.name} course first. The final test opens with your training certificate. <Link className="underline" href="/partner/academy">Back to the Academy</Link></p></section>
      )}
      {state.state === "not_ready" && (
        <section className="card"><p className="text-sm">The {testName(kind)} is not ready yet. The partner team is adding the questions; we will tell you when it opens.</p></section>
      )}
      {state.state === "wait" && (
        <section className="card space-y-1">
          <p className="text-sm font-medium">{state.paused ? `You have used all ${rules.maxTries} tries.` : "You can take the test again soon."}</p>
          <p className="text-sm">The next try opens on {pkt(state.nextAt)}.{!state.paused && ` You have ${state.triesLeft} ${state.triesLeft === 1 ? "try" : "tries"} left before a ${rules.pauseDays}-day pause.`}</p>
          {state.paused && <p className="text-sm text-muted">The partner team has been told and may contact you to help you prepare.</p>}
        </section>
      )}

      {state.state === "ready" && (
        <form action={startTestAction} className="card space-y-3">
          <input type="hidden" name="courseId" value={courseId} />
          <h2 className="font-semibold">Before you start</h2>
          {refresher && certificate && <p className="text-sm">{certificate.expiresAt && certificate.expiresAt <= new Date() ? `Your certificate ${certificate.publicId} expired on ${day(certificate.expiresAt)}.` : `Your certificate ${certificate.publicId} is valid until ${certificate.expiresAt ? day(certificate.expiresAt) : "further notice"}.`} Passing renews it for a new period from today, with the same ID.</p>}
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>{rules.questions} multiple-choice questions from the whole {product.name} course. Some have more than one right answer; they say so.</li>
            <li>{rules.minutes} minutes. The timer keeps running if you leave the page, and the test is marked when time runs out. Your answers are saved as you go.</li>
            <li>The pass mark is {rules.passPct}%. You see your score and which lessons to review, not the answers.</li>
            <li>If you do not pass, you can try again after {rules.retakeHours} hours. You have {state.triesLeft} {state.triesLeft === 1 ? "try" : "tries"} before a {rules.pauseDays}-day pause.</li>
          </ul>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="declared" required className="mt-1" /> <span>{HONESTY_DECLARATION}</span></label>
          <SubmitButton pendingText="Starting…">{refresher ? "Start the refresher test" : "Start the test"}</SubmitButton>
        </form>
      )}

      {state.state === "in_progress" && await (async () => {
        const paper = await testPaper(db, earner, state.attemptId);
        if (paper.attempt.status !== "IN_PROGRESS") return null;
        return <TestPaper attemptId={paper.attempt.id} courseId={courseId} questions={paper.questions} saved={paper.saved} deadline={paper.attempt.deadlineAt.toISOString()} />;
      })()}

      {st.last && !result && state.state !== "in_progress" && (
        <p className="text-sm text-muted">Last try: {st.last.scorePct ?? 0}% {st.last.passed ? <Badge tone="success">passed</Badge> : null} · <Link className="underline" href={`/partner/academy/test/${courseId}?result=${st.last.id}`}>see the result</Link></p>
      )}
    </>
  );
}
