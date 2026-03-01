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
  stock_quantity?: number;
}

export type OrderStatus =
  | "QUEUED"
  | "IN_PROGRESS"
  | "READY"
  | "COMPLETED"
  | "CANCELLED";

interface LoginResponse {
  access_token?: string;
  user: {
    name: string;
    id: string;
    student_id?: string;
    account_balance?: number;
    role?: string;
  };
}

export type MenuMain = "regular" | "ramadan";
export type MenuSlot = "breakfast" | "lunch" | "dinner" | "iftar" | "suhoor";
export type WalletMethod = "BANK" | "BKASH" | "NAGAD";

interface MenuResponse {
  main: MenuMain;
  slot: MenuSlot;
  generated_at?: string;
  next_change_at?: string | null;
  ramadan_visible?: boolean;
  items: MenuItem[];
}

interface OrderResponse {
  order_id: string;
  token_no?: number;
  pickup_counter?: number;
  ready_at?: string | null;
  ready_until?: string | null;
  status: OrderStatus;
  eta_minutes: number;
}

export interface OrderDetails {
  order_id: string;
  token_no?: number;
  pickup_counter?: number;
  ready_at?: string | null;
  ready_until?: string | null;
  status: OrderStatus;
  eta_minutes: number;
  student_id?: string;
  total_amount?: number;
  created_at?: string;
}

export interface OrdersMeResponse {
  orders: OrderDetails[];
}

export interface WalletBalanceResponse {
  student_id: string;
  account_balance: number;
}

export interface WalletTransaction {
  transaction_id: string;
  topup_id: string;
  method: WalletMethod;
  amount: number;
  status: "Pending" | "Success" | "Failed";
  provider_ref?: string | null;
  created_at?: string;
  completed_at?: string | null;
}

export interface WalletTransactionsResponse {
  transactions: WalletTransaction[];
}

export interface WalletTopupResponse {
  ok: boolean;
  replayed: boolean;
  message?: string;
  account_balance?: number;
  topup: {
    topup_id: string;
    amount: number;
    method: WalletMethod;
    status: "PENDING" | "COMPLETED" | "FAILED";
    reference_id?: string;
    redirect_url?: string | null;
  };
}

let mockAccountBalance = 1250;
type MockTopup = {
  topup_id: string;
  amount: number;
  method: WalletMethod;
  status: "PENDING" | "COMPLETED" | "FAILED";
  reference_id: string;
  created_at: string;
  completed_at?: string | null;
};
let mockWalletTopups: MockTopup[] = [];

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
    return { order_id: orderId, token_no: Number(orderId.slice(-4)) || 1001, pickup_counter: 1, ready_at: null, ready_until: null, status: "QUEUED", eta_minutes: 12 };
  }
  if (ageSec < 16) {
    return { order_id: orderId, token_no: Number(orderId.slice(-4)) || 1001, pickup_counter: 1, ready_at: null, ready_until: null, status: "IN_PROGRESS", eta_minutes: 7 };
  }
  if (ageSec < 24) {
    return {
      order_id: orderId,
      token_no: Number(orderId.slice(-4)) || 1001,
      pickup_counter: 1,
      ready_at: new Date(Date.now() - 60 * 1000).toISOString(),
      ready_until: new Date(Date.now() + 14 * 60 * 1000).toISOString(),
      status: "READY",
      eta_minutes: 0,
    };
  }
  return { order_id: orderId, token_no: Number(orderId.slice(-4)) || 1001, pickup_counter: 1, ready_at: null, ready_until: null, status: "COMPLETED", eta_minutes: 0 };
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
        student_id: studentId,
        account_balance: 1250,
      },
    } as T;
  }

  if (method === "POST" && endpoint === "/auth/login") {
    const studentId = body?.student_id || "2100000";
    const role = studentId === "admin-demo" ? "admin" : "student";
    return {
      access_token: "mock-token",
      user: {
        name: "Mock User",
        id: studentId,
        student_id: studentId,
        account_balance: mockAccountBalance,
        role,
      },
    } as T;
  }

  if (method === "GET" && endpoint === "/auth/me") {
    return {
      user: {
        name: "Mock User",
        id: "2100000",
        student_id: "2100000",
        account_balance: mockAccountBalance,
        role: "student",
      },
    } as T;
  }

  if (method === "GET" && (endpoint === "/wallet/balance" || endpoint === "/wallet")) {
    return {
      student_id: "2100000",
      account_balance: mockAccountBalance,
    } as T;
  }

  if (method === "GET" && endpoint.startsWith("/wallet/transactions")) {
    const m = endpoint.match(/[?&]status=(all|success|pending|failed)/i);
    const filter = (m?.[1] || "all").toLowerCase();
    const filtered = mockWalletTopups.filter((x) => {
      if (filter === "all") return true;
      if (filter === "success") return x.status === "COMPLETED";
      if (filter === "pending") return x.status === "PENDING";
      return x.status === "FAILED";
    });
    return {
      transactions: filtered.map((x) => ({
        transaction_id: x.topup_id,
        topup_id: x.topup_id,
        method: x.method,
        amount: x.amount,
        status: x.status === "COMPLETED" ? "Success" : x.status === "FAILED" ? "Failed" : "Pending",
        provider_ref: x.reference_id,
        created_at: x.created_at,
        completed_at: x.completed_at ?? null,
      })),
    } as T;
  }

  if (method === "POST" && endpoint === "/wallet/topups") {
    const amount = Number(body?.amount ?? 0);
    const rawMethod = String(body?.method ?? "BKASH").toUpperCase();
    const method = (rawMethod === "BANK" || rawMethod === "BKASH" || rawMethod === "NAGAD" ? rawMethod : "BKASH") as WalletMethod;
    const mode = String(body?.mode ?? "normal").toLowerCase();
    const details = body?.details ?? {};
    const topupId = `topup-${Date.now()}`;
    const reference = String(details?.reference_id || `TOPUP-${Math.random().toString(36).slice(2, 6).toUpperCase()}`);
    const completedNow = mode === "demo" && method !== "BANK";
    const status = completedNow ? "COMPLETED" : "PENDING";
    mockWalletTopups = [
      {
        topup_id: topupId,
        amount: Math.max(amount, 0),
        method,
        status,
        reference_id: reference,
        created_at: new Date().toISOString(),
        completed_at: completedNow ? new Date().toISOString() : null,
      },
      ...mockWalletTopups,
    ];
    if (completedNow) {
      mockAccountBalance += Math.max(amount, 0);
    }
    return {
      ok: true,
      replayed: false,
      message: completedNow ? "Demo top-up successful" : "Top-up submitted for verification",
      account_balance: completedNow ? mockAccountBalance : undefined,
      topup: {
        topup_id: topupId,
        amount: Math.max(amount, 0),
        method,
        status,
        reference_id: reference,
        redirect_url: method === "BANK" ? null : `https://pay.local/${method.toLowerCase()}/${topupId}`,
      },
    } as T;
  }

  if (method === "POST" && endpoint.startsWith("/wallet/webhook/")) {
    const provider = endpoint.split("/").pop()?.toUpperCase() || "BKASH";
    const topupId = String(body?.topup_id || "");
    const status = String(body?.status || "SUCCESS").toUpperCase();
    const idx = mockWalletTopups.findIndex((x) => x.topup_id === topupId);
    if (idx < 0) {
      throw new Error("Top-up not found");
    }
    if (mockWalletTopups[idx].status === "PENDING") {
      if (status === "SUCCESS") {
        mockWalletTopups[idx] = {
          ...mockWalletTopups[idx],
          status: "COMPLETED",
          reference_id: String(body?.provider_txn_id || `${provider}-MOCK-${Date.now()}`),
          completed_at: new Date().toISOString(),
        };
        mockAccountBalance += mockWalletTopups[idx].amount;
      } else {
        mockWalletTopups[idx] = {
          ...mockWalletTopups[idx],
          status: "FAILED",
          completed_at: new Date().toISOString(),
        };
      }
    }
    return {
      ok: true,
      already_processed: false,
      topup_id: topupId,
      status,
      account_balance: mockAccountBalance,
    } as T;
  }

  if (method === "POST" && endpoint === "/auth/logout") {
    return { ok: true } as T;
  }

  if (method === "GET" && endpoint.startsWith("/menu")) {
    const mainMatch = endpoint.match(/[?&]main=(regular|ramadan)/);
    const slotMatch = endpoint.match(/[?&]slot=(breakfast|lunch|dinner|iftar|suhoor)/);
    const main = (mainMatch?.[1] as MenuMain | undefined) ?? "regular";
    const slot = (slotMatch?.[1] as MenuSlot | undefined) ?? (main === "regular" ? "breakfast" : "iftar");
    return {
      main,
      slot,
      generated_at: new Date().toISOString(),
      next_change_at: null,
      ramadan_visible: true,
      items: [
        {
          id: "1",
          name: "Platter 1 (Khichuri + Chicken + Pickle)",
          price: 220,
          available: true,
          stock_quantity: 12,
        },
        {
          id: "2",
          name: "Platter 2 (Polao + Roast + Salad)",
          price: 280,
          available: true,
          stock_quantity: 4,
        },
      ],
    } as T;
  }

  if (method === "POST" && endpoint === "/orders") {
    const now = Date.now();
    return {
      order_id: String(now),
      token_no: Number(String(now).slice(-4)) || 1001,
      pickup_counter: 1,
      ready_at: null,
      ready_until: null,
      status: "QUEUED",
      eta_minutes: 12,
    } as T;
  }

  if (method === "GET" && endpoint.startsWith("/orders/")) {
    const orderId = endpoint.split("/").pop() || String(Date.now());
    return mockOrderFromId(orderId) as T;
  }

  if (method === "GET" && endpoint === "/orders/me") {
    const now = Date.now();
    return {
      orders: [
        {
          order_id: String(now),
          token_no: Number(String(now).slice(-4)) || 1001,
          pickup_counter: 1,
          ready_at: null,
          ready_until: null,
          status: "QUEUED",
          eta_minutes: 12,
          total_amount: 120,
          created_at: new Date(now).toISOString(),
        },
      ],
    } as T;
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

  const response = await fetch(resolveUrl(endpoint), {
    method,
    headers,
    credentials: "include",
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
  return makeRequest<LoginResponse>("POST", "/auth/login", {
    student_id: studentId,
    password,
  });
}

export async function me(): Promise<{ user: LoginResponse["user"] }> {
  return makeRequest<{ user: LoginResponse["user"] }>("GET", "/auth/me");
}

export async function logout(): Promise<{ ok: boolean }> {
  return makeRequest<{ ok: boolean }>("POST", "/auth/logout");
}

export async function getMenu(main: MenuMain = "regular", slot: MenuSlot = "breakfast"): Promise<MenuResponse> {
  return makeRequest<MenuResponse>(
    "GET",
    `/menu?main=${encodeURIComponent(main)}&slot=${encodeURIComponent(slot)}`
  );
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

export async function getMyOrders(): Promise<OrdersMeResponse> {
  return makeRequest<OrdersMeResponse>("GET", "/orders/me");
}

export async function deleteOrder(orderId: string): Promise<{ ok: boolean; order_id: string }> {
  return makeRequest<{ ok: boolean; order_id: string }>("DELETE", `/orders/${orderId}`);
}

export function getOrderSlipUrl(orderId: string, autoPrint = true): string {
  const qp = autoPrint ? "?auto_print=1" : "";
  return resolveUrl(`/orders/${encodeURIComponent(orderId)}/slip${qp}`);
}

export async function markOrderSlipPrinted(orderId: string): Promise<{ ok: boolean; order_id: string }> {
  return makeRequest<{ ok: boolean; order_id: string }>("POST", `/orders/${orderId}/slip/printed`);
}

export async function getWalletBalance(): Promise<WalletBalanceResponse> {
  return makeRequest<WalletBalanceResponse>("GET", "/wallet");
}

export async function getWalletTransactions(
  status: "all" | "success" | "pending" | "failed" = "all",
  limit = 50
): Promise<WalletTransactionsResponse> {
  return makeRequest<WalletTransactionsResponse>(
    "GET",
    `/wallet/transactions?status=${encodeURIComponent(status)}&limit=${limit}`
  );
}

export async function createWalletTopup(
  amount: number,
  method: WalletMethod,
  details?: Record<string, any>,
  mode: "normal" | "demo" = "demo"
): Promise<WalletTopupResponse> {
  return makeRequest<WalletTopupResponse>("POST", "/wallet/topups", { amount, method, details, mode });
}

export async function postWalletWebhook(
  provider: "bkash" | "nagad" | "bank",
  payload: { topup_id: string; status: "SUCCESS" | "FAILED"; provider_txn_id?: string }
): Promise<{ ok: boolean; status: "SUCCESS" | "FAILED"; account_balance?: number }> {
  return makeRequest<{ ok: boolean; status: "SUCCESS" | "FAILED"; account_balance?: number }>(
    "POST",
    `/wallet/webhook/${provider}`,
    payload
  );
}
