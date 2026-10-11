import "server-only";
import { cookies, headers } from "next/headers";
import { cookieName } from "./meeting-http";

// The participant ticket lives in an httpOnly cookie scoped to this one meeting.
export async function setTicket(meetingId: string, ticket: string) {
  (await cookies()).set(cookieName(meetingId), ticket, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 12 * 3600 });
}

export async function readTicket(meetingId: string): Promise<string | null> {
  return (await cookies()).get(cookieName(meetingId))?.value ?? null;
}

export async function baseUrl() {
  const h = await headers();
  return process.env.APP_URL?.replace(/\/$/, "") ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000"}`;
}
