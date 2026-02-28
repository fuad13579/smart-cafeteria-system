import { getToken } from "./storage";

type ApiMode = "mock" | "real";
type MockScenario = "success" | "timeout" | "unauthorized" | "server_error";

const API_MODE: ApiMode =
  process.env.NEXT_PUBLIC_API_MODE === "real" ? "real" : "mock";
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8002";
const API_PREFIX = process.env.NEXT_PUBLIC_API_PREFIX || "/api";
const API_MOCK_SCENARIO: MockScenario =
  process.env.NEXT_PUBLIC_API_MOCK_SCENARIO === "timeout" ||
  process.env.NEXT_PUBLIC_API_MOCK_SCENARIO === "unauthorized" ||
  process.env.NEXT_PUBLIC_API_MOCK_SCENARIO === "server_error"
    ? process.env.NEXT_PUBLIC_API_MOCK_SCENARIO
    : "success";
const API_MOCK_DELAY_MS = Number(process.env.NEXT_PUBLIC_API_MOCK_DELAY_MS || 350);

function resolveUrl(endpoint: string): string {
  const base = API_BASE_URL.replace(/\/+$/, "");
  const prefix = API_PREFIX ? `/${API_PREFIX.replace(/^\/+|\/+$/g, "")}` : "";
  const path = `/${endpoint.replace(/^\/+/, "")}`;
  return `${base}${prefix}${path}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  available: boolean;
}

export type OrderStatus =
  | "QUEUED"
  | "IN_PROGRESS"
  | "READY"
  | "COMPLETED"
  | "CANCELLED";

interface LoginResponse {
  access_token: string;
  user: {
    name: string;
    id: string;
  };
}

interface MenuResponse {
  items: MenuItem[];
}

interface OrderResponse {
  order_id: string;
  status: OrderStatus;
  eta_minutes: number;
}

export interface OrderDetails {
  order_id: string;
  status: OrderStatus;
  eta_minutes: number;
  student_id?: string;
  total_amount?: number;
  created_at?: string;
}

function parseApiErrorMessage(raw: any, status: number): string {
  if (raw?.message && typeof raw.message === "string") return raw.message;
  if (raw?.detail && typeof raw.detail === "string") return raw.detail;
  if (raw?.error && typeof raw.error === "string") return raw.error;
  return `HTTP ${status}`;
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

async function makeMockRequest<T>(
  method: string,
  endpoint: string,
  body?: any
): Promise<T> {
  await sleep(API_MOCK_DELAY_MS);

  if (API_MOCK_SCENARIO !== "success") {
    throw buildMockError(endpoint);
  }

  if (method === "POST" && endpoint === "/login") {
    const studentId = body?.student_id || "2100000";
    return {
      access_token: "mock-token",
      user: {
        name: "Mock User",
        id: studentId,
      },
    } as T;
  }

  if (method === "GET" && endpoint === "/menu") {
    return {
      items: [
        { id: "1", name: "Chicken Burger", price: 120, available: true },
        { id: "2", name: "Beef Burger", price: 150, available: true },
        { id: "3", name: "French Fries", price: 60, available: false },
        { id: "4", name: "Water", price: 20, available: true },
      ],
    } as T;
  }

  if (method === "POST" && endpoint === "/orders") {
    return {
      order_id: String(Date.now()),
      status: "QUEUED",
      eta_minutes: 12,
    } as T;
  }

  if (method === "GET" && endpoint.startsWith("/orders/")) {
    const orderId = endpoint.split("/").pop() || String(Date.now());
    return mockOrderFromId(orderId) as T;
  }

  throw new Error(`Mock endpoint not implemented: ${method} ${endpoint}`);
}

async function makeRequest<T>(
  method: string,
  endpoint: string,
  body?: any
): Promise<T> {
  if (API_MODE === "mock") {
    return makeMockRequest<T>(method, endpoint, body);
  }

  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };

  const token = getToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(resolveUrl(endpoint), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(parseApiErrorMessage(error, response.status));
  }

  return response.json();
}

export async function login(
  studentId: string,
  password: string
): Promise<LoginResponse> {
  return makeRequest<LoginResponse>("POST", "/login", {
    student_id: studentId,
    password,
  });
}

export async function getMenu(): Promise<MenuResponse> {
  return makeRequest<MenuResponse>("GET", "/menu");
}

export async function createOrder(
  items: { id: string; qty: number }[]
): Promise<OrderResponse> {
  return makeRequest<OrderResponse>("POST", "/orders", {
    items,
  });
}

export async function getOrder(orderId: string): Promise<OrderDetails> {
  return makeRequest<OrderDetails>("GET", `/orders/${orderId}`);
}
