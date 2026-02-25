import { create } from "zustand";

export type CartLine = { id: string; name: string; price: number; qty: number; available: boolean };

type State = {
  lines: CartLine[];
  add: (item: Omit<CartLine, "qty">) => void;
  inc: (id: string) => void;
  dec: (id: string) => void;
  clear: () => void;
  total: () => number;
};

export const useCart = create<State>((set, get) => ({
  lines: [],
  add: (item) =>
    set((s) => {
      const idx = s.lines.findIndex((l) => l.id === item.id);
      if (idx >= 0) {
        const next = s.lines.map((l, i) => (i === idx ? { ...l, qty: l.qty + 1 } : l));
        return { lines: next };
      }
      return { lines: [...s.lines, { ...item, qty: 1 }] };
    }),
  inc: (id) => set((s) => ({ lines: s.lines.map((l) => (l.id === id ? { ...l, qty: l.qty + 1 } : l)) })),
  dec: (id) =>
    set((s) => ({
      lines: s.lines
        .map((l) => (l.id === id ? { ...l, qty: Math.max(0, l.qty - 1) } : l))
        .filter((l) => l.qty > 0),
    })),
  clear: () => set({ lines: [] }),
  total: () => get().lines.reduce((sum, l) => sum + l.price * l.qty, 0),
}));