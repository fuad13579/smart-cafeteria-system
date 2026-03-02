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
  token_no?: number;
  pickup_counter?: number;
  status: OrderStatus;
  eta_minutes: number;
  ready_until?: string | null;
  is_expired?: boolean;
  student_id?: string;
  total_amount?: number;
  created_at?: string;
};
export type WalletMethod = "BANK" | "BKASH" | "NAGAD";
export type WalletBalanceResp = { student_id: string; account_balance: number };
export type WalletTopupResp = {
  ok: boolean;
  replayed?: boolean;
  account_balance?: number;
  topup: {
    topup_id: string;
    amount: number;
    method: WalletMethod;
    status: "PENDING" | "COMPLETED" | "FAILED";
  };
};
export type WalletTx = {
  transaction_id: string;
  topup_id: string;
  method: WalletMethod;
  amount: number;
  status: "Pending" | "Success" | "Failed";
  created_at?: string;
};
export type WalletTxResp = { transactions: WalletTx[] };

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
    return { order_id: orderId, token_no: Number(orderId.slice(-4)) || 1001, pickup_counter: 1, status: "QUEUED", eta_minutes: 12, ready_until: null, is_expired: false };
  }
  if (ageSec < 16) {
    return { order_id: orderId, token_no: Number(orderId.slice(-4)) || 1001, pickup_counter: 1, status: "IN_PROGRESS", eta_minutes: 7, ready_until: null, is_expired: false };
  }
  if (ageSec < 24) {
    return {
      order_id: orderId,
      token_no: Number(orderId.slice(-4)) || 1001,
      pickup_counter: 1,
      status: "READY",
      eta_minutes: 0,
      ready_until: new Date(Date.now() + 14 * 60 * 1000).toISOString(),
      is_expired: false,
    };
  }
  return {
    order_id: orderId,
    token_no: Number(orderId.slice(-4)) || 1001,
    pickup_counter: 1,
    status: "COMPLETED",
    eta_minutes: 0,
    ready_until: null,
    is_expired: false,
  };
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

let mockAccountBalance = 1250;
let mockOrders: OrderDetails[] = [];
let mockTx: WalletTx[] = [];

export async function apiLogin(student_id: string, _password: string) {
  if (API_MODE === "mock") {
    await sleep(API_MOCK_DELAY_MS);
    if (API_MOCK_SCENARIO !== "success") {
      throw buildMockError("/login");
    }
    return { access_token: "mock-token", user: { student_id, name: "Mock User", account_balance: mockAccountBalance } };
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
      {
        id: "1",
        name: "Platter 1 (Khichuri + Chicken + Pickle)",
        price: 220,
        available: true,
      },
      {
        id: "2",
        name: "Platter 2 (Polao + Roast + Salad)",
        price: 280,
        available: true,
      },
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
    const order_id = String(Date.now());
    const total_amount = items.reduce((acc, cur) => acc + cur.qty * (cur.id === "2" ? 280 : 220), 0);
    mockOrders = [
      {
        order_id,
        token_no: Number(order_id.slice(-4)) || 1001,
        pickup_counter: 1,
        status: "QUEUED",
        eta_minutes: 12,
        total_amount,
        created_at: new Date().toISOString(),
      },
      ...mockOrders,
    ].slice(0, 50);
    return { order_id, status: "QUEUED", eta_minutes: 12 };
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
    return mockOrders.find((o) => o.order_id === orderId) ?? mockOrderFromId(orderId);
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

export async function apiGetMyOrders(): Promise<{ orders: OrderDetails[] }> {
  if (API_MODE === "mock") {
    await sleep(API_MOCK_DELAY_MS);
    if (API_MOCK_SCENARIO !== "success") {
      throw buildMockError("/orders/me");
    }
    return { orders: mockOrders };
  }
  const auth = await getAuthHeaders();
  const res = await fetch(resolveUrl("/orders/me"), {
    headers: { ...auth },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseApiErrorMessage(err, "Failed to load orders"));
  }
  return res.json();
}

export async function apiWalletBalance(): Promise<WalletBalanceResp> {
  if (API_MODE === "mock") {
    await sleep(API_MOCK_DELAY_MS);
    return { student_id: "mock-user", account_balance: mockAccountBalance };
  }
  const auth = await getAuthHeaders();
  const res = await fetch(resolveUrl("/wallet"), {
    headers: { ...auth },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseApiErrorMessage(err, "Failed to load wallet balance"));
  }
  return res.json();
}

export async function apiWalletTopup(amount: number, method: WalletMethod): Promise<WalletTopupResp> {
  if (API_MODE === "mock") {
    await sleep(API_MOCK_DELAY_MS);
    const topup_id = `topup-${Date.now()}`;
    const completed = method !== "BANK";
    if (completed) {
      mockAccountBalance += amount;
    }
    mockTx = [
      {
        transaction_id: topup_id,
        topup_id,
        method,
        amount,
        status: completed ? "Success" : "Pending",
        created_at: new Date().toISOString(),
      },
      ...mockTx,
    ].slice(0, 100);
    return {
      ok: true,
      account_balance: mockAccountBalance,
      topup: {
        topup_id,
        amount,
        method,
        status: completed ? "COMPLETED" : "PENDING",
      },
    };
  }
  const auth = await getAuthHeaders();
  const res = await fetch(resolveUrl("/wallet/topups"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth },
    body: JSON.stringify({ amount, method, mode: "demo" }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseApiErrorMessage(err, "Top-up failed"));
  }
  return res.json();
}

export async function apiWalletTransactions(
  status: "all" | "success" | "pending" | "failed" = "all"
): Promise<WalletTxResp> {
  if (API_MODE === "mock") {
    await sleep(API_MOCK_DELAY_MS);
    const filtered = mockTx.filter((x) => {
      if (status === "all") return true;
      if (status === "success") return x.status === "Success";
      if (status === "pending") return x.status === "Pending";
      return x.status === "Failed";
    });
    return { transactions: filtered };
  }
  const auth = await getAuthHeaders();
  const res = await fetch(resolveUrl(`/wallet/transactions?status=${encodeURIComponent(status)}`), {
    headers: { ...auth },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseApiErrorMessage(err, "Failed to load transactions"));
  }
  return res.json();
}
