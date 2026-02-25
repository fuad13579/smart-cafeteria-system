import { calcTotal, decreaseQty, increaseQty, upsertLine } from "./cart.logic";
import type { CartLine } from "./cart";

export function runCartLogicSelfTest() {
  const seed: CartLine[] = [{ id: "1", name: "Burger", price: 100, qty: 1, available: true }];

  const plus = upsertLine(seed, { id: "1", name: "Burger", price: 100, available: true });
  if (plus[0]?.qty !== 2) throw new Error("cart logic failed: upsert increment");

  const inc = increaseQty(seed, "1");
  if (inc[0]?.qty !== 2) throw new Error("cart logic failed: increase");

  const dec = decreaseQty(seed, "1");
  if (dec.length !== 0) throw new Error("cart logic failed: decrease remove zero");

  const total = calcTotal([
    { id: "1", name: "Burger", price: 100, qty: 2, available: true },
    { id: "2", name: "Water", price: 20, qty: 1, available: true },
  ]);
  if (total !== 220) throw new Error("cart logic failed: total");
}
