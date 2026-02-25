import { getToken } from "./storage";

const API_MODE = process.env.NEXT_PUBLIC_API_MODE || "mock";
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8002";

function resolveUrl(endpoint: string): string {
  if (API_MODE === "mock") return endpoint;
  return `${API_BASE}${endpoint}`;
}

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  available: boolean;
}

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
}

async function makeRequest<T>(
  method: string,
  endpoint: string,
  body?: any
): Promise<T> {
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
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
}

export async function login(
  studentId: string,
  password: string
): Promise<LoginResponse> {
  return makeRequest<LoginResponse>("POST", "/api/login", {
    student_id: studentId,
    password,
  });
}

export async function getMenu(): Promise<MenuResponse> {
  return makeRequest<MenuResponse>("GET", "/api/menu");
}

export async function createOrder(
  items: { id: string; qty: number }[]
): Promise<OrderResponse> {
  return makeRequest<OrderResponse>("POST", "/api/orders", {
    items,
  });
}
