const MODE = process.env.EXPO_PUBLIC_API_MODE ?? "mock";
const BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:8002";

export type MenuItem = { id: string; name: string; price: number; available: boolean };
export type OrderResp = { order_id: string; status: string; eta_minutes: number };

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function apiLogin(student_id: string, _password: string) {
  if (MODE === "mock") {
    await sleep(400);
    return { access_token: "mock-token", user: { student_id, name: "Mock User" } };
  }
  const res = await fetch(`${BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ student_id, password: _password }),
  });
  if (!res.ok) throw new Error("Login failed");
  return res.json();
}

export async function apiMenu(): Promise<MenuItem[]> {
  if (MODE === "mock") {
    await sleep(350);
    return [
      { id: "1", name: "Chicken Burger", price: 120, available: true },
      { id: "2", name: "Beef Burger", price: 150, available: true },
      { id: "3", name: "French Fries", price: 60, available: false },
      { id: "4", name: "Water", price: 20, available: true },
    ];
  }
  const res = await fetch(`${BASE}/menu`);
  if (!res.ok) throw new Error("Failed to load menu");
  const data = await res.json();
  return data.items ?? data;
}

export async function apiCreateOrder(items: Array<{ id: string; qty: number }>): Promise<OrderResp> {
  if (MODE === "mock") {
    await sleep(400);
    return { order_id: String(Date.now()), status: "QUEUED", eta_minutes: 12 };
  }
  const res = await fetch(`${BASE}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error("Order failed");
  return res.json();
}