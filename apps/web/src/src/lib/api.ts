// src/lib/api.ts
export const API_MODE = process.env.NEXT_PUBLIC_API_MODE ?? "mock";
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8002";

function url(path: string) {
  if (API_MODE === "mock") return path; // use Next.js API routes
  return `${API_BASE_URL}${path}`;
}

export type MenuItem = {
  id: string;
  name: string;
  price: number;
  available: boolean;
};

export async function login(student_id: string, password: string) {
  const res = await fetch(url("/api/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ student_id, password }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "Login failed");
  return res.json() as Promise<{ access_token: string; user: { student_id: string; name: string } }>;
}

export async function getMenu() {
  const res = await fetch(url("/api/menu"), { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load menu");
  return res.json() as Promise<{ items: MenuItem[] }>;
}

export async function createOrder(items: Array<{ id: string; qty: number }>) {
  const res = await fetch(url("/api/orders"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "Order failed");
  return res.json() as Promise<{ order_id: string; status: string; eta_minutes: number }>;
}