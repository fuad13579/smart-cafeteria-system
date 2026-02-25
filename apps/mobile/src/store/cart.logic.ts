import type { CartLine } from "./cart";

export function upsertLine(lines: CartLine[], item: Omit<CartLine, "qty">): CartLine[] {
  const idx = lines.findIndex((l) => l.id === item.id);
  if (idx < 0) return [...lines, { ...item, qty: 1 }];
  return lines.map((l, i) => (i === idx ? { ...l, qty: l.qty + 1 } : l));
}

export function increaseQty(lines: CartLine[], id: string): CartLine[] {
  return lines.map((l) => (l.id === id ? { ...l, qty: l.qty + 1 } : l));
}

export function decreaseQty(lines: CartLine[], id: string): CartLine[] {
  return lines
    .map((l) => (l.id === id ? { ...l, qty: Math.max(0, l.qty - 1) } : l))
    .filter((l) => l.qty > 0);
}

export function calcTotal(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.price * l.qty, 0);
}
