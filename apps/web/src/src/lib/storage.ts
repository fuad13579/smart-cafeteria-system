// src/lib/storage.ts
export type CartLine = { id: string; name: string; price: number; qty: number; available: boolean };

const KEY_TOKEN = "sc_token";
const KEY_USER = "sc_user";
const KEY_CART = "sc_cart";

export function getToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(KEY_TOKEN);
}
export function setToken(token: string) {
  localStorage.setItem(KEY_TOKEN, token);
}
export function clearToken() {
  localStorage.removeItem(KEY_TOKEN);
  localStorage.removeItem(KEY_USER);
}

export function getUser() {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(KEY_USER);
  return raw ? (JSON.parse(raw) as { student_id: string; name: string }) : null;
}
export function setUser(user: { student_id: string; name: string }) {
  localStorage.setItem(KEY_USER, JSON.stringify(user));
}

export function getCart(): CartLine[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(KEY_CART);
  return raw ? (JSON.parse(raw) as CartLine[]) : [];
}
export function setCart(lines: CartLine[]) {
  localStorage.setItem(KEY_CART, JSON.stringify(lines));
}
export function clearCart() {
  localStorage.removeItem(KEY_CART);
}