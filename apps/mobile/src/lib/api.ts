import * as SecureStore from "expo-secure-store";

type ApiMode = "mock" | "real";
type MockScenario = "success" | "timeout" | "unauthorized" | "server_error";

const API_MODE: ApiMode =
  process.env.EXPO_PUBLIC_API_MODE === "real" ? "real" : "mock";
const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:8002";
const API_PREFIX = process.env.EXPO_PUBLIC_API_PREFIX ?? "/api";
const API_MOCK_SCENARIO: MockScenario =
  process.env.EXPO_PUBLIC_API_MOCK_SCENARIO === "timeout" ||
  process.env.EXPO_PUBLIC_API_MOCK_SCENARIO === "unauthorized" ||
  process.env.EXPO_PUBLIC_API_MOCK_SCENARIO === "server_error"
    ? process.env.EXPO_PUBLIC_API_MOCK_SCENARIO
    : "success";
const API_MOCK_DELAY_MS = Number(process.env.EXPO_PUBLIC_API_MOCK_DELAY_MS ?? 350);

export type MenuItem = { id: string; name: string; price: number; available: boolean };
export type OrderStatus = "QUEUED" | "IN_PROGRESS" | "READY" | "COMPLETED" | "CANCELLED";
export type OrderResp = { order_id: string; status: OrderStatus; eta_minutes: number };
export type OrderDetails = {
  order_id: string;
  status: OrderStatus;
  eta_minutes: number;
  student_id?: string;
  total_amount?: number;
  created_at?: string;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function resolveUrl(endpoint: string): string {
  const base = API_BASE_URL.replace(/\/+$/, "");
  const prefix = API_PREFIX ? `/${API_PREFIX.replace(/^\/+|\/+$/g, "")}` : "";
  const path = `/${endpoint.replace(/^\/+/, "")}`;
  return `${base}${prefix}${path}`;
}

function buildMockError(endpoint: string): Error {
  if (API_MOCK_SCENARIO === "timeout") {
    return new Error(`Request timed out (${endpoint}) [mock]`);
  }
  if (API_MOCK_SCENARIO === "unauthorized") {
    return new Error(`Unauthorized (401) (${endpoint}) [mock]`);
  }
  if (API_MOCK_SCENARIO === "server_error") {
    return new Error(`Internal server error (500) (${endpoint}) [mock]`);
  }
  return new Error(`Unknown mock error (${endpoint})`);
}

function mockOrderFromId(orderId: string): OrderDetails {
  const seed = Number.parseInt(orderId, 10);
  const now = Date.now();
  const base = Number.isFinite(seed) ? seed : now - 5000;
  const ageSec = Math.max(0, Math.floor((now - base) / 1000));

  if (ageSec < 8) {
    return { order_id: orderId, status: "QUEUED", eta_minutes: 12 };
  }
  if (ageSec < 16) {
    return { order_id: orderId, status: "IN_PROGRESS", eta_minutes: 7 };
  }
  if (ageSec < 24) {
    return { order_id: orderId, status: "READY", eta_minutes: 0 };
  }
  return { order_id: orderId, status: "COMPLETED", eta_minutes: 0 };
}

function parseApiErrorMessage(raw: any, fallback: string): string {
  if (raw?.message && typeof raw.message === "string") return raw.message;
  if (raw?.detail && typeof raw.detail === "string") return raw.detail;
  if (raw?.error && typeof raw.error === "string") return raw.error;
  return fallback;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await SecureStore.getItemAsync("sc_token");
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

export async function apiLogin(student_id: string, _password: string) {
  if (API_MODE === "mock") {
    await sleep(API_MOCK_DELAY_MS);
    if (API_MOCK_SCENARIO !== "success") {
      throw buildMockError("/login");
    }
    return { access_token: "mock-token", user: { student_id, name: "Mock User" } };
  }
  const res = await fetch(resolveUrl("/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ student_id, password: _password }),
  });
  if (!res.ok) throw new Error("Login failed");
  return res.json();
}

export async function apiMenu(): Promise<MenuItem[]> {
  if (API_MODE === "mock") {
    await sleep(API_MOCK_DELAY_MS);
    if (API_MOCK_SCENARIO !== "success") {
      throw buildMockError("/menu");
    }
    return [
      { id: "1", name: "Chicken Burger", price: 120, available: true },
      { id: "2", name: "Beef Burger", price: 150, available: true },
      { id: "3", name: "French Fries", price: 60, available: false },
      { id: "4", name: "Water", price: 20, available: true },
    ];
  }
  const res = await fetch(resolveUrl("/menu"));
  if (!res.ok) throw new Error("Failed to load menu");
  const data = await res.json();
  return data.items ?? data;
}

export async function apiCreateOrder(items: { id: string; qty: number }[]): Promise<OrderResp> {
  if (API_MODE === "mock") {
    await sleep(API_MOCK_DELAY_MS);
    if (API_MOCK_SCENARIO !== "success") {
      throw buildMockError("/orders");
    }
    return { order_id: String(Date.now()), status: "QUEUED", eta_minutes: 12 };
  }
  const auth = await getAuthHeaders();
  const res = await fetch(resolveUrl("/orders"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseApiErrorMessage(err, "Order failed"));
  }
  return res.json();
}

export async function apiGetOrder(orderId: string): Promise<OrderDetails> {
  if (API_MODE === "mock") {
    await sleep(API_MOCK_DELAY_MS);
    if (API_MOCK_SCENARIO !== "success") {
      throw buildMockError(`/orders/${orderId}`);
    }
    return mockOrderFromId(orderId);
  }

  const auth = await getAuthHeaders();
  const res = await fetch(resolveUrl(`/orders/${orderId}`), {
    headers: { ...auth },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseApiErrorMessage(err, "Failed to load order status"));
  }
  return res.json();
}
