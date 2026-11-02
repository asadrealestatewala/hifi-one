import * as SecureStore from "expo-secure-store";

// The app talks to the same server as the website. Change it with EXPO_PUBLIC_API_URL when building.
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "https://hifimarketing.co").replace(/\/$/, "");
const KEY = "hifi_token";

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

let token: string | null = null;
let onSignedOut: () => void = () => {};
export const setSignedOutHandler = (fn: () => void) => { onSignedOut = fn; };

export async function loadToken() { token = await SecureStore.getItemAsync(KEY); return token; }
export async function saveToken(t: string) { token = t; await SecureStore.setItemAsync(KEY, t); }
export async function clearToken() { token = null; await SecureStore.deleteItemAsync(KEY); }

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/mobile/v1/${path}`, {
      method: init.method ?? "GET",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError("Cannot reach the server. Check your connection and try again.", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) { await clearToken(); onSignedOut(); }
  if (!res.ok) throw new ApiError(data.error ?? "Something went wrong.", res.status, data.code);
  return data as T;
}

export type Me = {
  user: { id: string; name: string; email: string | null; phone: string | null; roles: string[]; can: { tasks: boolean; editTasks: boolean; attendance: boolean; leave: boolean } };
  timezone: string; today: string;
  tasks: { open: number; overdue: number; dueToday: number };
  notifications: { unread: number };
  pendingLeave: number;
  clockedIn: { since: string; mode: string; onBreak: boolean } | null;
};
export type Task = { id: string; title: string; description: string | null; status: string; priority: string; blocked: boolean; dueDate: string | null; project: { id: string; name: string; number: string | null } };
export type Attendance = { open: { since: string; mode: string; onBreak: boolean; workedMinutes: number } | null; recent: { id: string; date: string; clockIn: string; clockOut: string | null; mode: string; workedMinutes: number }[] };
export type Leave = { year: string; types: { id: string; name: string }[]; balances: { type: string; allowance: number; approved: number; pending: number; remaining: number; available: number }[]; requests: { id: string; type: string; startDate: string; endDate: string; days: number; status: string; reason: string | null; decisionNote: string | null }[] };
export type Notice = { id: string; kind: string; title: string; body: string | null; link: string | null; read: boolean; createdAt: string };
