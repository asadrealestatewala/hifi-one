"use server";

import { requirePermission } from "@/lib/auth";
import { AssistantError, ask, assistantConfigured } from "@/lib/assistant";
import { db } from "@/lib/db";
import { limiter } from "@/lib/rate-limit";

export type AssistantState = { answer?: string; error?: string; tools?: string[]; question?: string };

export async function askAssistant(_prev: AssistantState, formData: FormData): Promise<AssistantState> {
  const user = await requirePermission("assistant.use");
  const question = String(formData.get("question") ?? "");
  const log = (status: string, tools: string[] = []) =>
    db.assistantLog.create({ data: { organizationId: user.organizationId, userId: user.id, question: question.slice(0, 1000), toolsUsed: tools, status } });
  if (!assistantConfigured()) {
    await log("NOT_CONFIGURED");
    return { question, error: "The assistant is not connected, so nothing was asked. An administrator needs to set ANTHROPIC_API_KEY on the server." };
  }
  if (!limiter("assistant-user", 20, 3_600_000).take(user.id)) return { question, error: "You have reached 20 questions this hour. Please try again later." };
  try {
    const r = await ask(db, { id: user.id, name: user.name, organizationId: user.organizationId, permissions: user.permissions }, question);
    await log("ANSWERED", r.toolsUsed);
    return { question, answer: r.answer, tools: r.toolsUsed };
  } catch (e) {
    await log("FAILED");
    if (e instanceof AssistantError) return { question, error: e.message };
    return { question, error: "Something went wrong asking the assistant. Nothing was changed." };
  }
}
