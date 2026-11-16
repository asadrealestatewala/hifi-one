"use server";

import { requirePermission } from "@/lib/auth";
import { AssistantError, ask, assistantConfigured } from "@/lib/assistant";
import { db } from "@/lib/db";
import { limiter } from "@/lib/rate-limit";
import crypto from "node:crypto";

export type ChatMessage = { id: string; role: "USER" | "ASSISTANT"; content: string; tools: string[] };
export type ChatState = { chatId: string | null; messages: ChatMessage[]; connected: boolean; examples: string[] };
export type SendResult = { ok: boolean; chatId: string; answer?: ChatMessage; error?: string };

const toMsg = (m: { id: string; role: string; content: string; toolsUsed: string[] }): ChatMessage => ({ id: m.id, role: m.role === "USER" ? "USER" : "ASSISTANT", content: m.content, tools: m.toolsUsed });

// The person's newest chat, so the window shows the same conversation on every page.
export async function loadAssistantChat(): Promise<ChatState> {
  const user = await requirePermission("assistant.use");
  const last = await db.assistantMessage.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, select: { chatId: true } });
  const rows = last ? await db.assistantMessage.findMany({ where: { userId: user.id, chatId: last.chatId }, orderBy: { createdAt: "asc" }, take: 60 }) : [];
  const examples = [
    ...(user.permissions.has("finance.view") ? ["Which invoices are overdue?"] : []),
    ...(user.permissions.has("reports.view") ? ["How are we doing this month?"] : []),
    ...(user.permissions.has("crm.view") ? ["Where is the sales pipeline?"] : []),
    "How do I give a client portal access?",
  ];
  return { chatId: last?.chatId ?? null, messages: rows.map(toMsg), connected: await assistantConfigured(db, user.organizationId), examples: examples.slice(0, 4) };
}

export async function sendAssistantMessage(chatIdIn: string | null, questionIn: string): Promise<SendResult> {
  const user = await requirePermission("assistant.use");
  const question = String(questionIn ?? "").trim();
  const chatId = chatIdIn && /^[a-f0-9-]{36}$/.test(chatIdIn) ? chatIdIn : crypto.randomUUID();
  const log = (status: string, tools: string[] = []) =>
    db.assistantLog.create({ data: { organizationId: user.organizationId, userId: user.id, question: question.slice(0, 1000), toolsUsed: tools, status } });
  if (!(await assistantConfigured(db, user.organizationId))) {
    await log("NOT_CONFIGURED");
    return { ok: false, chatId, error: "The assistant is not connected, so nothing was asked. A super admin needs to add the Anthropic key in Settings → Integrations." };
  }
  if (!limiter("assistant-user", 20, 3_600_000).take(user.id)) return { ok: false, chatId, error: "You have reached 20 questions this hour. Please try again later." };
  try {
    const prior = await db.assistantMessage.findMany({ where: { userId: user.id, chatId }, orderBy: { createdAt: "asc" }, take: 20 });
    const r = await ask(db, { id: user.id, name: user.name, organizationId: user.organizationId, permissions: user.permissions }, question, undefined,
      prior.map((m) => ({ role: m.role === "USER" ? "user" as const : "assistant" as const, content: m.content })));
    await log("ANSWERED", r.toolsUsed);
    await db.assistantMessage.create({ data: { organizationId: user.organizationId, userId: user.id, chatId, role: "USER", content: question.slice(0, 1000) } });
    const a = await db.assistantMessage.create({ data: { organizationId: user.organizationId, userId: user.id, chatId, role: "ASSISTANT", content: r.answer, toolsUsed: [...new Set(r.toolsUsed)] } });
    return { ok: true, chatId, answer: toMsg(a) };
  } catch (e) {
    await log("FAILED");
    if (e instanceof AssistantError) return { ok: false, chatId, error: e.message };
    return { ok: false, chatId, error: "Something went wrong asking the assistant. Nothing was changed." };
  }
}
