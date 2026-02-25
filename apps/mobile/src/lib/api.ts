import * as SecureStore from "expo-secure-store";

const MODE = process.env.EXPO_PUBLIC_API_MODE ?? "mock";
const BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:8002";
const TIMEOUT_MS = 8000;

export type MenuItem = { id: string; name: string; price: number; available: boolean };
export type OrderResp = { order_id: string; status: string; eta_minutes: number };
export type OrderStatus = "QUEUED" | "IN_PROGRESS" | "READY" | "COMPLETED";
export type OrderStatusResp = { order_id: string; status: OrderStatus; eta_minutes: number };

type RequestOpts = {
  method?: "GET" | "POST";
  body?: unknown;
  withAuth?: boolean;
  retries?: number;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isAbort(e: unknown) {
  return !!e && typeof e === "object" && "name" in e && (e as { name?: string }).name === "AbortError";
}

async function requestJson<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const { method = "GET", body, withAuth = true, retries = 0 } = opts;
  const url = `${BASE}${path}`;
  let lastError: unknown;

  for (let i = 0; i <= retries; i += 1) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (withAuth) {
        const token = await SecureStore.getItemAsync("sc_token");
        if (token) headers.Authorization = `Bearer ${token}`;
      }

      const res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });

      let payload: any = null;
      try {
        payload = await res.json();
      } catch {
        payload = null;
      }

      if (!res.ok) {
        if (res.status === 401) throw new Error("Session expired. Please sign in again.");
        throw new Error(payload?.error ?? payload?.message ?? `Request failed (${res.status})`);
      }

      return payload as T;
    } catch (e) {
      lastError = e;
      if (i < retries) {
        await sleep(300);
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  if (isAbort(lastError)) throw new Error("Request timed out. Please try again.");
  if (lastError instanceof TypeError) throw new Error("Network error. Check your internet connection.");
  if (lastError instanceof Error) throw lastError;
  throw new Error("Something went wrong.");
}

export function isMockMode() {
  return MODE === "mock";
}

export async function apiLogin(student_id: string, password: string) {
  if (isMockMode()) {
    await sleep(400);
    return { access_token: "mock-token", user: { student_id, name: "Mock User" } };
  }
  return requestJson<{ access_token: string; user: { student_id: string; name: string } }>("/login", {
    method: "POST",
    body: { student_id, password },
    withAuth: false,
  });
}

export async function apiMenu(): Promise<MenuItem[]> {
  if (isMockMode()) {
    await sleep(350);
    return [
      { id: "1", name: "Chicken Burger", price: 120, available: true },
      { id: "2", name: "Beef Burger", price: 150, available: true },
      { id: "3", name: "French Fries", price: 60, available: false },
      { id: "4", name: "Water", price: 20, available: true },
    ];
  }
  const data = await requestJson<{ items?: MenuItem[] } | MenuItem[]>("/menu", { retries: 1 });
  return Array.isArray(data) ? data : data.items ?? [];
}

export async function apiCreateOrder(items: { id: string; qty: number }[]): Promise<OrderResp> {
  if (isMockMode()) {
    await sleep(400);
    return { order_id: String(Date.now()), status: "QUEUED", eta_minutes: 12 };
  }
  return requestJson<OrderResp>("/orders", {
    method: "POST",
    body: { items },
  });
}

export async function apiOrderStatus(orderId: string): Promise<OrderStatusResp> {
  if (isMockMode()) {
    await sleep(250);
    const started = Number.parseInt(orderId, 10);
    const elapsed = Number.isNaN(started) ? 0 : Math.floor((Date.now() - started) / 1000);
    const idx = Math.min(3, Math.floor(elapsed / 8));
    const states: OrderStatus[] = ["QUEUED", "IN_PROGRESS", "READY", "COMPLETED"];
    return {
      order_id: orderId,
      status: states[idx],
      eta_minutes: Math.max(0, 12 - idx * 3),
    };
  }
  return requestJson<OrderStatusResp>(`/orders/${orderId}`, { retries: 1 });
}
