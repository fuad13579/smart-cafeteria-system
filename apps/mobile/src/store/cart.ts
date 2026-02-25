import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import { calcTotal, decreaseQty, increaseQty, upsertLine } from "./cart.logic";

export type CartLine = { id: string; name: string; price: number; qty: number; available: boolean };
const CART_KEY = "sc_cart";

type State = {
  lines: CartLine[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  add: (item: Omit<CartLine, "qty">) => void;
  inc: (id: string) => void;
  dec: (id: string) => void;
  clear: () => void;
  total: () => number;
};

async function save(lines: CartLine[]) {
  try {
    await SecureStore.setItemAsync(CART_KEY, JSON.stringify(lines));
  } catch {
    // best effort; avoid blocking UX for storage issues
  }
}

async function load(): Promise<CartLine[]> {
  try {
    const raw = await SecureStore.getItemAsync(CART_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x) => x && typeof x.id === "string" && typeof x.qty === "number");
  } catch {
    return [];
  }
}

export const useCart = create<State>((set, get) => ({
  lines: [],
  hydrated: false,
  hydrate: async () => {
    const lines = await load();
    set({ lines, hydrated: true });
  },
  add: (item) =>
    set((s) => {
      const lines = upsertLine(s.lines, item);
      void save(lines);
      return { lines };
    }),
  inc: (id) =>
    set((s) => {
      const lines = increaseQty(s.lines, id);
      void save(lines);
      return { lines };
    }),
  dec: (id) =>
    set((s) => {
      const lines = decreaseQty(s.lines, id);
      void save(lines);
      return { lines };
    }),
  clear: () => {
    void save([]);
    set({ lines: [] });
  },
  total: () => calcTotal(get().lines),
}));
